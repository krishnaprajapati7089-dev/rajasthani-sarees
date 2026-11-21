
const express = require('express');
const mongoose = require('mongoose');

const Product = require('../models/Product');
const Supplier = require('../models/Supplier');
const DebitNote = require('../models/DebitNote');
const SupplierTransaction = require('../models/SupplierTransaction');

const router = express.Router();

const num = value =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

const round2 = value =>
  Math.round((num(value) + Number.EPSILON) * 100) / 100;

const escapeRegex = value =>
  String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');


// ==========================================
// SEARCH PRODUCT BY BARCODE
// ==========================================

router.get('/search-product/:barcode', async (req, res) => {
  try {
    const barcode = String(req.params.barcode || '').trim();

    if (!barcode) {
      return res.status(400).json({
        message: 'Barcode is required.'
      });
    }

    const product = await Product.findOne({
      barcode,
      active: { $ne: false }
    }).select(
      'name barcode category hsn_code purchase_price gst_rate stock_qty'
    );

    if (!product) {
      return res.status(404).json({
        message: `No product found for barcode ${barcode}.`
      });
    }

    res.json({
      product: {
        _id: product._id,
        name: product.name,
        barcode: product.barcode,
        category: product.category || '',
        hsn_code: product.hsn_code || '5407',
        purchase_price: num(product.purchase_price),
        gst_rate: num(product.gst_rate),
        stock_qty: num(product.stock_qty)
      }
    });

  } catch (error) {
    console.error('Debit note product lookup:', error);

    res.status(500).json({
      message: 'Could not find product.'
    });
  }
});


// ==========================================
// GET SUPPLIERS
// ==========================================

router.get('/suppliers', async (req, res) => {
  try {
    const suppliers = await Supplier.find()
      .select('name phone city gst')
      .sort({ name: 1 })
      .lean();

    res.json({ suppliers });

  } catch (error) {
    console.error('Debit note suppliers:', error);

    res.status(500).json({
      message: 'Could not load suppliers.'
    });
  }
});


// ==========================================
// GET ALL DEBIT NOTES
// ==========================================

router.get('/', async (req, res) => {
  try {
    const filter = {};

    if (req.query.supplier) {
      filter.supplier = new RegExp(
        `^${escapeRegex(req.query.supplier)}$`,
        'i'
      );
    }

    if (req.query.from || req.query.to) {
      filter.date = {};

      if (req.query.from) {
        filter.date.$gte = new Date(
          `${req.query.from}T00:00:00.000`
        );
      }

      if (req.query.to) {
        filter.date.$lte = new Date(
          `${req.query.to}T23:59:59.999`
        );
      }
    }

    if (req.query.status) {
      filter.status = req.query.status;
    }

    const notes = await DebitNote.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .limit(300)
      .lean();

    res.json({ debitNotes: notes });

  } catch (error) {
    console.error('Debit note list:', error);

    res.status(500).json({
      message: 'Could not load debit notes.'
    });
  }
});


// ==========================================
// GET SINGLE DEBIT NOTE
// ==========================================

router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: 'Invalid debit note ID.'
      });
    }

    const note = await DebitNote.findById(
      req.params.id
    ).lean();

    if (!note) {
      return res.status(404).json({
        message: 'Debit note not found.'
      });
    }

    res.json(note);

  } catch (error) {
    res.status(500).json({
      message: 'Could not load debit note.'
    });
  }
});


// ==========================================
// CREATE DEBIT NOTE
// ==========================================

router.post('/', async (req, res) => {

  const changedStock = [];

  let createdNote = null;
  let createdTxn = null;

  try {
    const body = req.body || {};

    const supplierId =
      body.supplier_id &&
      mongoose.isValidObjectId(body.supplier_id)
        ? body.supplier_id
        : null;

    const supplierDoc = supplierId
      ? await Supplier.findById(supplierId).lean()
      : null;

    const supplierName = String(
      body.supplier || supplierDoc?.name || ''
    ).trim();

    if (!supplierName) {
      return res.status(400).json({
        message: 'Please select a supplier.'
      });
    }

    if (supplierId && !supplierDoc) {
      return res.status(404).json({
        message: 'Selected supplier was not found.'
      });
    }

    if (!Array.isArray(body.items) || body.items.length === 0) {
      return res.status(400).json({
        message: 'Scan at least one saree.'
      });
    }


    // ======================================
    // CALCULATE ITEMS
    // ======================================

    const noteItems = [];

    let taxableTotal = 0;
    let gstTotal = 0;

    const seen = new Map();

    for (const line of body.items) {

      const productId = String(line.product_id || '');

      if (!mongoose.isValidObjectId(productId)) {
        throw new Error(
          'One of the scanned products is invalid.'
        );
      }

      const qty = num(line.qty);

      if (!(qty > 0)) {
        throw new Error(
          `Invalid return quantity for ${line.description || 'product'}.`
        );
      }

      const product = await Product.findById(
        productId
      ).select(
        'name barcode category hsn_code purchase_price gst_rate stock_qty active'
      );

      if (!product || product.active === false) {
        throw new Error(
          `Product not found: ${line.description || productId}`
        );
      }

      if (seen.has(productId)) {
        seen.get(productId).qty += qty;
        continue;
      }

      // Original purchase rate, not selling price.
      const rate = num(product.purchase_price);

      const gstRate = num(product.gst_rate);

      const taxable = round2(qty * rate);

      const gst = round2(
        taxable * gstRate / 100
      );

      const item = {
        product_id: product._id,
        barcode: product.barcode || '',
        description: product.name,
        category: product.category || '',
        hsn_code: product.hsn_code || '5407',
        qty,
        rate,
        gst_rate: gstRate,
        taxable_amount: taxable,
        gst_amount: gst,
        amount: round2(taxable + gst)
      };

      seen.set(productId, item);
    }


    // ======================================
    // FINAL ITEM TOTALS
    // ======================================

    for (const item of seen.values()) {

      item.taxable_amount = round2(
        item.qty * item.rate
      );

      item.gst_amount = round2(
        item.taxable_amount * item.gst_rate / 100
      );

      item.amount = round2(
        item.taxable_amount + item.gst_amount
      );

      taxableTotal += item.taxable_amount;
      gstTotal += item.gst_amount;

      noteItems.push(item);
    }


    // ======================================
    // REDUCE STOCK
    // ======================================

    for (const item of noteItems) {

      const updated = await Product.findOneAndUpdate(
        {
          _id: item.product_id,
          stock_qty: { $gte: item.qty },
          active: { $ne: false }
        },
        {
          $inc: {
            stock_qty: -item.qty
          }
        },
        {
          new: true
        }
      );

      if (!updated) {
        throw new Error(
          `Insufficient stock for ${item.description} (${item.barcode}). Available stock may have changed; refresh and try again.`
        );
      }

      changedStock.push({
        productId: item.product_id,
        qty: item.qty
      });
    }


    // ======================================
    // SAVE DEBIT NOTE
    // ======================================

    const debitNoteNo = `DN-${Date.now()}`;

    createdNote = await DebitNote.create({

      debit_note_no: debitNoteNo,

      date: body.date
        ? new Date(body.date)
        : new Date(),

      supplier_id: supplierDoc?._id || null,

      supplier: supplierName,

      supplier_gst: String(
        body.supplier_gst || supplierDoc?.gst || ''
      ).trim(),

      supplier_phone: String(
        body.supplier_phone || supplierDoc?.phone || ''
      ).trim(),

      supplier_city: String(
        body.supplier_city || supplierDoc?.city || ''
      ).trim(),

      reference_purchase_bill: String(
        body.reference_purchase_bill || ''
      ).trim(),

      reason: String(
        body.reason || 'Return to supplier'
      ).trim(),

      remarks: String(
        body.remarks || ''
      ).trim(),

      items: noteItems,

      taxable_total: round2(taxableTotal),

      gst_total: round2(gstTotal),

      grand_total: round2(
        taxableTotal + gstTotal
      ),

      created_by: req.user?._id || null
    });


    // ======================================
    // SUPPLIER LEDGER ADJUSTMENT
    // ======================================

    // Debit Note reduces supplier payable.
    // It is NOT a cash, UPI or cheque payment.

    if (supplierDoc?._id) {

      createdTxn = await SupplierTransaction.create({

        supplier: supplierDoc._id,

        type: 'payment',

        date: createdNote.date,

        amount: createdNote.grand_total,

        paymentKind: 'debit_note',

        // No payment mode for debit note.

        reference: debitNoteNo,

        note: `Saree return / Debit Note ${debitNoteNo}`

      });
    }


    // ======================================
    // SUCCESS RESPONSE
    // ======================================

    res.status(201).json({

      success: true,

      message: 'Debit note saved and stock updated.',

      debitNote: createdNote,

      ledgerTransactionId: createdTxn?._id || null

    });

  } catch (error) {

    console.error('Create debit note error:', error);

    // Rollback transaction if saving failed.

    if (createdTxn?._id) {
      await SupplierTransaction
        .findByIdAndDelete(createdTxn._id)
        .catch(() => {});
    }

    if (createdNote?._id) {
      await DebitNote
        .findByIdAndDelete(createdNote._id)
        .catch(() => {});
    }

    for (const entry of changedStock) {

      await Product.updateOne(
        { _id: entry.productId },
        { $inc: { stock_qty: entry.qty } }
      ).catch(() => {});

    }

    res.status(400).json({

      message:
        error.message || 'Could not save debit note.'

    });
  }
});


// ==========================================
// CANCEL DEBIT NOTE
// ==========================================

router.delete('/:id', async (req, res) => {
  try {

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: 'Invalid debit note ID.'
      });
    }

    const note = await DebitNote.findById(
      req.params.id
    );

    if (!note) {
      return res.status(404).json({
        message: 'Debit note not found.'
      });
    }

    if (note.status === 'cancelled') {
      return res.status(400).json({
        message: 'Debit note is already cancelled.'
      });
    }


    // Restore returned products to stock.

    for (const item of note.items) {

      await Product.updateOne(
        { _id: item.product_id },
        {
          $inc: {
            stock_qty: num(item.qty)
          }
        }
      );

    }


    // Remove corresponding supplier ledger adjustment.

    if (note.supplier_id) {

      await SupplierTransaction.findOneAndDelete({

        supplier: note.supplier_id,

        type: 'payment',

        reference: note.debit_note_no,

        paymentKind: 'debit_note'

      });

    }


    note.status = 'cancelled';

    await note.save();

    res.json({

      success: true,

      message: 'Debit note cancelled; stock and supplier balance reversed.'

    });

  } catch (error) {

    console.error('Cancel debit note error:', error);

    res.status(500).json({

      message: 'Could not cancel debit note.'

    });
  }
});


module.exports = router;
