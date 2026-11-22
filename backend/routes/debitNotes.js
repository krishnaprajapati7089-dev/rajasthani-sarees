const express = require('express');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Supplier = require('../models/Supplier');
const DebitNote = require('../models/DebitNote');
const SupplierTransaction = require('../models/SupplierTransaction');

const router = express.Router();
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const round2 = value => Math.round((num(value) + Number.EPSILON) * 100) / 100;
const escapeRegex = value => String(value || '').replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');

// Product lookup used by the USB barcode scanner (scanner types the barcode and presses Enter).
router.get('/search-product/:barcode', async (req, res) => {
  try {
    const barcode = String(req.params.barcode || '').trim();
    if (!barcode) return res.status(400).json({ message: 'Barcode is required.' });
    const product = await Product.findOne({ barcode, active: { $ne: false } })
      .select('name barcode category hsn_code purchase_price gst_rate stock_qty');
    if (!product) return res.status(404).json({ message: `No product found for barcode ${barcode}.` });
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
    res.status(500).json({ message: 'Could not find product.' });
  }
});

// Supplier list for the debit-note selector.
router.get('/suppliers', async (req, res) => {
  try {
    const suppliers = await Supplier.find().select('name phone city gst').sort({ name: 1 }).lean();
    res.json({ suppliers });
  } catch (error) {
    console.error('Debit note suppliers:', error);
    res.status(500).json({ message: 'Could not load suppliers.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.supplier) filter.supplier = new RegExp(`^${escapeRegex(req.query.supplier)}$`, 'i');
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(`${req.query.from}T00:00:00.000`);
      if (req.query.to) filter.date.$lte = new Date(`${req.query.to}T23:59:59.999`);
    }
    if (req.query.status) filter.status = req.query.status;
    const notes = await DebitNote.find(filter).sort({ date: -1, createdAt: -1 }).limit(300).lean();
    res.json({ debitNotes: notes });
  } catch (error) {
    console.error('Debit note list:', error);
    res.status(500).json({ message: 'Could not load debit notes.' });
  }
});

// Single product (used when an existing debit note is opened for editing).
router.get('/product/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid product ID.' });
    const product = await Product.findById(req.params.id)
      .select('name barcode category hsn_code purchase_price gst_rate stock_qty');
    if (!product) return res.status(404).json({ message: 'Product not found.' });
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
    console.error('Debit note product by id:', error);
    res.status(500).json({ message: 'Could not load product.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid debit note ID.' });
    const note = await DebitNote.findById(req.params.id).lean();
    if (!note) return res.status(404).json({ message: 'Debit note not found.' });
    res.json(note);
  } catch (error) {
    res.status(500).json({ message: 'Could not load debit note.' });
  }
});

router.post('/', async (req, res) => {
  const changedStock = [];
  let createdNote = null;
  let createdTxn = null;
  try {
    const body = req.body || {};
    const supplierId = body.supplier_id && mongoose.isValidObjectId(body.supplier_id) ? body.supplier_id : null;
    let supplierDoc = supplierId ? await Supplier.findById(supplierId).lean() : null;
    const supplierName = String(body.supplier || supplierDoc?.name || '').trim();
    if (!supplierName) return res.status(400).json({ message: 'Please select a supplier.' });
    if (supplierId && !supplierDoc) return res.status(404).json({ message: 'Selected supplier was not found.' });
    if (!Array.isArray(body.items) || body.items.length === 0) return res.status(400).json({ message: 'Scan at least one saree.' });

    const noteItems = [];
    let taxableTotal = 0;
    let gstTotal = 0;
    const seen = new Map();

    // Consolidate duplicate product rows and always use the current product purchase rate/GST.
    for (const line of body.items) {
      const productId = String(line.product_id || '');
      if (!mongoose.isValidObjectId(productId)) throw new Error('One of the scanned products is invalid.');
      const qty = num(line.qty);
      if (!(qty > 0)) throw new Error(`Invalid return quantity for ${line.description || 'product'}.`);
      const product = await Product.findById(productId).select('name barcode category hsn_code purchase_price gst_rate stock_qty active');
      if (!product || product.active === false) throw new Error(`Product not found: ${line.description || productId}`);
      if (seen.has(productId)) {
        seen.get(productId).qty += qty;
        continue;
      }
      const rate = num(product.purchase_price); // requested: original purchase rate, not selling price
      const gstRate = num(product.gst_rate);
      const taxable = round2(qty * rate);
      const gst = round2(taxable * gstRate / 100);
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

    for (const item of seen.values()) {
      // Recalculate after duplicate barcode rows have been combined.
      item.taxable_amount = round2(item.qty * item.rate);
      item.gst_amount = round2(item.taxable_amount * item.gst_rate / 100);
      item.amount = round2(item.taxable_amount + item.gst_amount);
      taxableTotal += item.taxable_amount;
      gstTotal += item.gst_amount;
      noteItems.push(item);
    }

    // Check/decrement stock atomically per product. If any operation fails, rollback below.
    for (const item of noteItems) {
      const updated = await Product.findOneAndUpdate(
        { _id: item.product_id, stock_qty: { $gte: item.qty }, active: { $ne: false } },
        { $inc: { stock_qty: -item.qty } },
        { new: true }
      );
      if (!updated) throw new Error(`Insufficient stock for ${item.description} (${item.barcode}). Available stock may have changed; refresh and try again.`);
      changedStock.push({ productId: item.product_id, qty: item.qty });
    }

    const debitNoteNo = `DN-${Date.now()}`;
    createdNote = await DebitNote.create({
      debit_note_no: debitNoteNo,
      date: body.date ? new Date(body.date) : new Date(),
      supplier_id: supplierDoc?._id || null,
      supplier: supplierName,
      supplier_gst: String(body.supplier_gst || supplierDoc?.gst || '').trim(),
      supplier_phone: String(body.supplier_phone || supplierDoc?.phone || '').trim(),
      supplier_city: String(body.supplier_city || supplierDoc?.city || '').trim(),
      reference_purchase_bill: String(body.reference_purchase_bill || '').trim(),
      reason: String(body.reason || 'Return to supplier').trim(),
      remarks: String(body.remarks || '').trim(),
      items: noteItems,
      taxable_total: round2(taxableTotal),
      gst_total: round2(gstTotal),
      grand_total: round2(taxableTotal + gstTotal),
      created_by: req.user?._id || null
    });

    // Existing supplier-ledger convention: a payment transaction reduces the payable balance.
    // paymentKind=debit_note lets the ledger distinguish this credit adjustment from cash paid.
    if (supplierDoc?._id) {
      createdTxn = await SupplierTransaction.create({
        supplier: supplierDoc._id,
        type: 'payment',
        date: createdNote.date,
        amount: createdNote.grand_total,
        paymentKind: 'debit_note',
        mode: 'debit_note',
        reference: debitNoteNo,
        note: `Saree return / Debit Note ${debitNoteNo}`
      });
    }

    res.status(201).json({ success: true, message: 'Debit note saved and stock updated.', debitNote: createdNote, ledgerTransactionId: createdTxn?._id || null });
  } catch (error) {
    console.error('Create debit note error:', error);
    // Best-effort rollback to avoid stock loss if saving the note/ledger fails.
    if (createdTxn?._id) await SupplierTransaction.findByIdAndDelete(createdTxn._id).catch(() => {});
    if (createdNote?._id) await DebitNote.findByIdAndDelete(createdNote._id).catch(() => {});
    for (const entry of changedStock) {
      await Product.updateOne({ _id: entry.productId }, { $inc: { stock_qty: entry.qty } }).catch(() => {});
    }
    res.status(400).json({ message: error.message || 'Could not save debit note.' });
  }
});

// Edit a saved debit note: add/remove sarees or change quantities.
// Stock is adjusted only by the DIFFERENCE between old and new quantities, and the supplier-ledger entry is updated.
// Existing lines keep their original rate/GST; newly added sarees use the current purchase rate/GST.
router.put('/:id', async (req, res) => {
  const applied = [];            // stock increments actually applied: { productId, inc }
  let note = null;
  let snapshot = null;           // original note, for rollback
  let noteSaved = false;
  let txnBefore = null;          // original ledger entry, for rollback
  let txnTouched = false;
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid debit note ID.' });
    note = await DebitNote.findById(req.params.id);
    if (!note) return res.status(404).json({ message: 'Debit note not found.' });
    if (note.status === 'cancelled') return res.status(400).json({ message: 'Cancelled debit notes cannot be edited.' });
    snapshot = note.toObject();

    const body = req.body || {};
    const supplierId = body.supplier_id && mongoose.isValidObjectId(body.supplier_id) ? body.supplier_id : (note.supplier_id || null);
    const supplierDoc = supplierId ? await Supplier.findById(supplierId).lean() : null;
    if (supplierId && !supplierDoc) return res.status(404).json({ message: 'Selected supplier was not found.' });
    const supplierName = String(body.supplier || supplierDoc?.name || note.supplier || '').trim();
    if (!supplierName) return res.status(400).json({ message: 'Please select a supplier.' });
    if (!Array.isArray(body.items) || body.items.length === 0) return res.status(400).json({ message: 'A debit note needs at least one saree.' });

    // Old quantities / lines by product
    const oldLines = new Map();
    for (const it of snapshot.items) {
      const key = String(it.product_id);
      if (oldLines.has(key)) oldLines.get(key).qty += num(it.qty);
      else oldLines.set(key, { ...it, qty: num(it.qty) });
    }

    // New lines, consolidated by product
    const newLines = new Map();
    for (const line of body.items) {
      const key = String(line.product_id || '');
      if (!mongoose.isValidObjectId(key)) throw new Error('One of the products is invalid.');
      const qty = num(line.qty);
      if (!(qty > 0)) throw new Error(`Invalid return quantity for ${line.description || 'product'}.`);
      if (newLines.has(key)) { newLines.get(key).qty += qty; continue; }
      const old = oldLines.get(key);
      if (old) {
        newLines.set(key, {
          product_id: old.product_id, barcode: old.barcode || '', description: old.description,
          category: old.category || '', hsn_code: old.hsn_code || '5407',
          qty, rate: num(old.rate), gst_rate: num(old.gst_rate)
        });
      } else {
        const product = await Product.findById(key).select('name barcode category hsn_code purchase_price gst_rate active');
        if (!product || product.active === false) throw new Error(`Product not found: ${line.description || key}`);
        newLines.set(key, {
          product_id: product._id, barcode: product.barcode || '', description: product.name,
          category: product.category || '', hsn_code: product.hsn_code || '5407',
          qty, rate: num(product.purchase_price), gst_rate: num(product.gst_rate)
        });
      }
    }

    const items = [];
    let taxableTotal = 0;
    let gstTotal = 0;
    for (const item of newLines.values()) {
      item.taxable_amount = round2(item.qty * item.rate);
      item.gst_amount = round2(item.taxable_amount * item.gst_rate / 100);
      item.amount = round2(item.taxable_amount + item.gst_amount);
      taxableTotal += item.taxable_amount;
      gstTotal += item.gst_amount;
      items.push(item);
    }

    // Stock difference per product (positive = take more stock out, negative = put stock back)
    const deltas = [];
    for (const key of new Set([...oldLines.keys(), ...newLines.keys()])) {
      const delta = round2((newLines.get(key)?.qty || 0) - (oldLines.get(key)?.qty || 0));
      if (delta !== 0) deltas.push({ key, delta, name: (newLines.get(key) || oldLines.get(key)).description });
    }
    // Take stock out first (can fail on insufficient stock), put stock back afterwards.
    for (const d of deltas.filter(x => x.delta > 0)) {
      const updated = await Product.findOneAndUpdate(
        { _id: d.key, stock_qty: { $gte: d.delta } },
        { $inc: { stock_qty: -d.delta } },
        { new: true }
      );
      if (!updated) throw new Error(`Insufficient stock for ${d.name}. Available stock may have changed; refresh and try again.`);
      applied.push({ productId: d.key, inc: -d.delta });
    }
    for (const d of deltas.filter(x => x.delta < 0)) {
      await Product.updateOne({ _id: d.key }, { $inc: { stock_qty: -d.delta } });
      applied.push({ productId: d.key, inc: -d.delta });
    }

    note.set({
      date: body.date ? new Date(body.date) : note.date,
      supplier_id: supplierDoc?._id || null,
      supplier: supplierName,
      supplier_gst: String(body.supplier_gst || supplierDoc?.gst || '').trim(),
      supplier_phone: String(body.supplier_phone || supplierDoc?.phone || '').trim(),
      supplier_city: String(body.supplier_city || supplierDoc?.city || '').trim(),
      reference_purchase_bill: String(body.reference_purchase_bill || '').trim(),
      reason: String(body.reason || 'Return to supplier').trim(),
      remarks: String(body.remarks || '').trim(),
      items,
      taxable_total: round2(taxableTotal),
      gst_total: round2(gstTotal),
      grand_total: round2(taxableTotal + gstTotal)
    });
    await note.save();
    noteSaved = true;

    // Keep the supplier ledger in step with the new total.
    const txnFilter = { type: 'payment', reference: note.debit_note_no, paymentKind: 'debit_note' };
    txnBefore = await SupplierTransaction.findOne(txnFilter).lean();
    txnTouched = true;
    if (supplierDoc?._id) {
      if (txnBefore) {
        await SupplierTransaction.updateOne({ _id: txnBefore._id }, { $set: {
          supplier: supplierDoc._id, date: note.date, amount: note.grand_total,
          note: `Saree return / Debit Note ${note.debit_note_no}`
        } });
      } else {
        await SupplierTransaction.create({
          supplier: supplierDoc._id, type: 'payment', date: note.date, amount: note.grand_total,
          paymentKind: 'debit_note', mode: 'debit_note', reference: note.debit_note_no,
          note: `Saree return / Debit Note ${note.debit_note_no}`
        });
      }
    } else if (txnBefore) {
      await SupplierTransaction.deleteOne({ _id: txnBefore._id });
    }

    res.json({ success: true, message: 'Debit note updated; stock and supplier balance adjusted.', debitNote: note });
  } catch (error) {
    console.error('Update debit note error:', error);
    // Best-effort rollback so a failed edit never leaves stock or ledger half-changed.
    for (const entry of applied) {
      await Product.updateOne({ _id: entry.productId }, { $inc: { stock_qty: -entry.inc } }).catch(() => {});
    }
    if (noteSaved && snapshot) await DebitNote.replaceOne({ _id: snapshot._id }, snapshot).catch(() => {});
    if (txnTouched) {
      const filter = { type: 'payment', reference: snapshot?.debit_note_no, paymentKind: 'debit_note' };
      if (txnBefore) {
        const cur = await SupplierTransaction.findOne(filter).lean().catch(() => null);
        if (cur) await SupplierTransaction.replaceOne({ _id: txnBefore._id }, txnBefore).catch(() => {});
        else await SupplierTransaction.create(txnBefore).catch(() => {});
      } else {
        await SupplierTransaction.deleteOne(filter).catch(() => {});
      }
    }
    res.status(400).json({ message: error.message || 'Could not update debit note.' });
  }
});

// Cancel a note only when its stock and ledger effects can be reversed.
// Every product is verified; if any stock restore fails, everything already restored is undone and an error is returned.
router.delete('/:id', async (req, res) => {
  const restored = [];   // { productId, qty, name, stockNow }
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid debit note ID.' });
    const note = await DebitNote.findById(req.params.id);
    if (!note) return res.status(404).json({ message: 'Debit note not found.' });
    if (note.status === 'cancelled') return res.status(400).json({ message: 'Debit note is already cancelled.' });

    const lines = new Map();
    for (const item of note.items) {
      const key = String(item.product_id);
      const cur = lines.get(key) || { qty: 0, name: item.description || item.barcode || key };
      cur.qty = round2(cur.qty + num(item.qty));
      lines.set(key, cur);
    }

    try {
      for (const [productId, line] of lines) {
        const updated = await Product.findOneAndUpdate(
          { _id: productId },
          { $inc: { stock_qty: line.qty } },
          { new: true, strict: false }
        );
        if (!updated) throw new Error(`Could not restore stock: product "${line.name}" no longer exists.`);
        restored.push({ productId, qty: line.qty, name: line.name, stockNow: num(updated.stock_qty) });
      }
      note.status = 'cancelled';
      await note.save();
    } catch (inner) {
      for (const r of restored) await Product.updateOne({ _id: r.productId }, { $inc: { stock_qty: -r.qty } }, { strict: false }).catch(() => {});
      throw inner;
    }

    if (note.supplier_id) {
      await SupplierTransaction.findOneAndDelete({
        supplier: note.supplier_id,
        type: 'payment',
        reference: note.debit_note_no,
        paymentKind: 'debit_note'
      }).catch(err => console.error('Cancel debit note ledger cleanup:', err));
    }

    const detail = restored.map(r => `${r.name} +${r.qty} (stock now ${r.stockNow})`).join('; ');
    res.json({ success: true, message: `Debit note cancelled; supplier balance reversed. Stock restored: ${detail}`, restored });
  } catch (error) {
    console.error('Cancel debit note error:', error);
    res.status(500).json({ message: error.message || 'Could not cancel debit note.' });
  }
});

module.exports = router;
