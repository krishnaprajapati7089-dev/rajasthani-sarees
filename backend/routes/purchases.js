// routes/purchases.js  (FAST VERSION - batched database operations)

const express = require('express');
const mongoose = require('mongoose');

const Product = require('../models/Product');
const Purchase = require('../models/Purchase');

const { generateUniqueBarcode } = require('../utils/barcode');

const router = express.Router();

const PRODUCT_FIELDS =
  'name barcode category mrp purchase_price selling_price gst_rate stock_qty';


// ============================================================
// GENERATE SHORT UNIQUE BILL NUMBER  (Example: P582431)
// ============================================================

async function generateUniqueBillNumber() {
  let billNumber;
  let exists = true;

  while (exists) {
    const number = Math.floor(100000 + Math.random() * 900000);
    billNumber = `P${number}`;
    exists = await Purchase.exists({ unique_bill_number: billNumber });
  }

  return billNumber;
}


// ============================================================
// CALCULATE TOTAL
// ============================================================

function calculateTotals(taxableAmount, gstTotal, extraCharges, discountPercent) {
  taxableAmount = Number(taxableAmount) || 0;
  gstTotal = Number(gstTotal) || 0;
  extraCharges = Number(extraCharges) || 0;
  discountPercent = Number(discountPercent) || 0;

  if (extraCharges < 0) extraCharges = 0;
  if (discountPercent < 0) discountPercent = 0;
  if (discountPercent > 100) discountPercent = 100;

  const totalBeforeDiscount = taxableAmount + gstTotal + extraCharges;
  const discountAmount = (totalBeforeDiscount * discountPercent) / 100;
  const grandTotal = Math.max(0, totalBeforeDiscount - discountAmount);

  return {
    taxableAmount,
    gstTotal,
    extraCharges,
    discountPercent,
    discountAmount,
    grandTotal
  };
}


// ============================================================
// PARSE + VALIDATE ONE BILL LINE (no database access)
// ============================================================

function parseLine(line) {
  const label = line.description || 'item';

  const qty = Number(line.qty) || 0;
  const purchaseRate = Number(line.purchase_rate ?? line.rate) || 0;
  const mrp = Number(line.mrp) || 0;
  const sellingPrice = Number(line.selling_price) || 0;
  const gstRate = Number(line.gst_rate) || 0;
  const category = String(line.category || '').trim() || 'General';
  const code = String(line.item_code || '').trim();
  const hsn = String(line.hsn_code || '').trim();

  if (qty <= 0) {
    throw new Error(`Invalid quantity for ${label}`);
  }
  if (sellingPrice <= 0) {
    throw new Error(`Selling Price is required for ${label}`);
  }
  if (mrp > 0 && sellingPrice > mrp) {
    throw new Error(`Selling Price cannot be greater than MRP for ${label}`);
  }

  const base = qty * purchaseRate;
  const gst = (base * gstRate) / 100;

  return {
    raw: line,
    product_id:
      line.product_id && mongoose.Types.ObjectId.isValid(line.product_id)
        ? String(line.product_id)
        : null,
    code,
    hsn,
    qty,
    purchaseRate,
    mrp,
    sellingPrice,
    gstRate,
    category,
    base,
    gst,
    amount: base + gst
  };
}


// ============================================================
// FIND ALL PRODUCTS FOR MANY LINES IN ONE QUERY
// Returns { byId, byBarcode }
// ============================================================

async function loadProducts(refs) {
  const ids = [...new Set(refs.map(r => r.product_id).filter(Boolean))];
  const codes = [...new Set(refs.map(r => r.code).filter(Boolean))];

  const or = [];
  if (ids.length) or.push({ _id: { $in: ids } });
  if (codes.length) or.push({ barcode: { $in: codes } });

  const found = or.length ? await Product.find({ $or: or }) : [];

  const byId = new Map();
  const byBarcode = new Map();

  for (const p of found) {
    byId.set(String(p._id), p);
    if (p.barcode) byBarcode.set(p.barcode, p);
  }

  return { byId, byBarcode };
}


// ============================================================
// ADD STOCK FOR ALL ITEMS  (BATCHED)
//
//  - 1 query to load existing products
//  - 1 bulkWrite to update existing products
//  - 1 insertMany to create new products
// ============================================================

async function addStockForItems(parsedLines) {

  const { byId, byBarcode } = await loadProducts(parsedLines);

  const updateOps = [];
  const newByBarcode = new Map();
  const lineProducts = [];

  for (const p of parsedLines) {

    const product =
      (p.product_id && byId.get(p.product_id)) ||
      (p.code && byBarcode.get(p.code)) ||
      null;

    // ---------- EXISTING PRODUCT ----------
    if (product) {

      const set = {
        purchase_price: p.purchaseRate,
        mrp: p.mrp,
        selling_price: p.sellingPrice,
        gst_rate: p.gstRate,
        category: p.category
      };

      if (p.hsn) set.hsn_code = p.hsn;

      updateOps.push({
        updateOne: {
          filter: { _id: product._id },
          update: {
            $inc: { stock_qty: p.qty },
            $set: set
          }
        }
      });

      lineProducts.push({
        _id: product._id,
        barcode: product.barcode,
        name: product.name,
        hsn_code: p.hsn || product.hsn_code || ''
      });

      continue;
    }

    // ---------- SAME NEW ITEM TWICE ON ONE BILL ----------
    if (p.code && newByBarcode.has(p.code)) {

      const n = newByBarcode.get(p.code);

      n.stock_qty += p.qty;
      n.purchase_price = p.purchaseRate;
      n.mrp = p.mrp;
      n.selling_price = p.sellingPrice;
      n.gst_rate = p.gstRate;
      n.category = p.category;
      if (p.hsn) n.hsn_code = p.hsn;

      lineProducts.push(n);
      continue;
    }

    // ---------- NEW PRODUCT ----------
    let barcodeValue = p.code;

    if (!barcodeValue) {
      // Only items WITHOUT a code need a generated barcode
      for (let i = 0; i < 10; i++) {
        const candidate = await generateUniqueBarcode(Product);
        if (!newByBarcode.has(candidate)) {
          barcodeValue = candidate;
          break;
        }
      }
      if (!barcodeValue) {
        throw new Error('Could not generate a unique barcode');
      }
    }

    const newProduct = {
      _id: new mongoose.Types.ObjectId(),
      name: String(p.raw.description || 'Unnamed item').trim(),
      barcode: barcodeValue,
      category: p.category,
      hsn_code: p.hsn,
      purchase_price: p.purchaseRate,
      mrp: p.mrp,
      selling_price: p.sellingPrice,
      gst_rate: p.gstRate,
      stock_qty: p.qty,
      reorder_level: 5
    };

    newByBarcode.set(barcodeValue, newProduct);
    lineProducts.push(newProduct);
  }

  // ---------- WRITE EVERYTHING AT ONCE ----------
  const writes = [];

  if (updateOps.length) {
    writes.push(Product.bulkWrite(updateOps, { ordered: true }));
  }

  if (newByBarcode.size) {
    writes.push(Product.insertMany([...newByBarcode.values()]));
  }

  await Promise.all(writes);

  return lineProducts;
}


// ============================================================
// REMOVE STOCK  (BATCHED)  - used during EDIT and DELETE
// ============================================================

async function removeStockForPurchase(purchase) {

  if (!purchase || !Array.isArray(purchase.items)) return;

  const refs = purchase.items
    .filter(item => (Number(item.qty) || 0) > 0)
    .map(item => ({
      product_id:
        item.product_id && mongoose.Types.ObjectId.isValid(item.product_id)
          ? String(item.product_id)
          : null,
      code: String(item.item_code || '').trim(),
      qty: Number(item.qty) || 0
    }));

  if (!refs.length) return;

  const { byId, byBarcode } = await loadProducts(refs);

  const ops = [];

  for (const r of refs) {

    const product =
      (r.product_id && byId.get(r.product_id)) ||
      (r.code && byBarcode.get(r.code)) ||
      null;

    if (!product) continue;

    // stock_qty = max(0, stock_qty - qty)
    ops.push({
      updateOne: {
        filter: { _id: product._id },
        update: [
          {
            $set: {
              stock_qty: {
                $max: [
                  0,
                  { $subtract: [{ $ifNull: ['$stock_qty', 0] }, r.qty] }
                ]
              }
            }
          }
        ]
      }
    });
  }

  if (ops.length) {
    await Product.bulkWrite(ops, { ordered: true });
  }
}


// ============================================================
// BUILD PURCHASE ITEMS + TOTALS FROM PARSED LINES
// ============================================================

function buildPurchaseItems(parsedLines, lineProducts) {

  const purchaseItems = [];
  let taxableTotal = 0;
  let gstTotal = 0;

  parsedLines.forEach((p, i) => {

    const product = lineProducts[i];

    purchaseItems.push({
      item_code: product.barcode || p.code || '',
      description: p.raw.description || product.name,
      category: p.category,
      hsn_code: p.raw.hsn_code || product.hsn_code || '',
      qty: p.qty,
      mrp: p.mrp,
      purchase_rate: p.purchaseRate,
      selling_price: p.sellingPrice,
      rate: p.purchaseRate,
      gst_rate: p.gstRate,
      amount: p.amount,
      product_id: product._id
    });

    taxableTotal += p.base;
    gstTotal += p.gst;
  });

  return { purchaseItems, taxableTotal, gstTotal };
}


// ============================================================
// GET ALL PURCHASES
// ============================================================

router.get('/', async (req, res) => {
  try {
    const purchases = await Purchase.find().sort({ createdAt: -1 });
    res.json(purchases);
  } catch (err) {
    console.error('Get purchases error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
// SEARCH PURCHASE BILLS  (keep BEFORE /:id)
// ============================================================

router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();

    if (!q) return res.json([]);

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');

    const purchases = await Purchase
      .find({
        $or: [
          { supplier: regex },
          { unique_bill_number: regex },
          { invoice_number: regex }
        ]
      })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(purchases);
  } catch (err) {
    console.error('Purchase search error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
// GET SINGLE PURCHASE
// ============================================================

router.get('/:id', async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id);

    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found' });
    }

    res.json(purchase);
  } catch (err) {
    console.error('Get purchase error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
// CREATE PURCHASE
// ============================================================

router.post('/', async (req, res) => {

  try {

    const {
      supplier,
      supplier_gstin,
      invoice_number,
      invoice_date,
      supplier_state,
      reference,
      unique_bill_number,
      bill_image_url,
      dealer_discount_percent,
      extra_charges,
      items
    } = req.body;

    if (!supplier || !invoice_number) {
      return res.status(400).json({
        error: 'Supplier and invoice number are required'
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'At least one item is required'
      });
    }

    // ---------- BILL NUMBER ----------
    const finalBillNumber =
      unique_bill_number && String(unique_bill_number).trim()
        ? String(unique_bill_number).trim().toUpperCase()
        : await generateUniqueBillNumber();

    const duplicate = await Purchase.exists({
      unique_bill_number: finalBillNumber
    });

    if (duplicate) {
      return res.status(409).json({
        error: `Bill number ${finalBillNumber} already exists`
      });
    }

    // ---------- VALIDATE ALL LINES FIRST (before touching stock) ----------
    const parsedLines = items.map(parseLine);

    // ---------- ADD STOCK (batched) ----------
    const lineProducts = await addStockForItems(parsedLines);

    const { purchaseItems, taxableTotal, gstTotal } =
      buildPurchaseItems(parsedLines, lineProducts);

    const totals = calculateTotals(
      taxableTotal,
      gstTotal,
      extra_charges,
      dealer_discount_percent
    );

    const touchedProductIds = [
      ...new Set(lineProducts.map(p => String(p._id)))
    ];

    // ---------- SAVE BILL + FETCH UPDATED PRODUCTS IN PARALLEL ----------
    const [purchase, products] = await Promise.all([
      Purchase.create({
        supplier,
        supplier_gstin: supplier_gstin || '',
        invoice_number,
        invoice_date: invoice_date ? new Date(invoice_date) : new Date(),
        supplier_state: supplier_state || '',
        reference: reference || '',
        unique_bill_number: finalBillNumber,
        bill_image_url: bill_image_url || '',
        items: purchaseItems,
        taxable_amount: totals.taxableAmount,
        gst_total: totals.gstTotal,
        extra_charges: totals.extraCharges,
        dealer_discount_percent: totals.discountPercent,
        dealer_discount_amount: totals.discountAmount,
        grand_total: totals.grandTotal
      }),
      Product.find({ _id: { $in: touchedProductIds } }).select(PRODUCT_FIELDS)
    ]);

    res.status(201).json({
      ...purchase.toObject(),
      products
    });

  } catch (err) {

    console.error('Purchase save error:', err);

    if (err.code === 11000) {
      return res.status(409).json({
        error:
          'This unique bill number already exists. Please generate another number.'
      });
    }

    res.status(400).json({ error: err.message });
  }
});


// ============================================================
// UPDATE / EDIT PURCHASE
// ============================================================

router.put('/:id', async (req, res) => {

  try {

    const purchase = await Purchase.findById(req.params.id);

    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found' });
    }

    const {
      supplier,
      supplier_gstin,
      invoice_number,
      invoice_date,
      supplier_state,
      reference,
      unique_bill_number,
      bill_image_url,
      dealer_discount_percent,
      extra_charges,
      items
    } = req.body;

    if (!supplier || !invoice_number) {
      return res.status(400).json({
        error: 'Supplier and invoice number are required'
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'At least one item is required'
      });
    }

    const finalBillNumber =
      unique_bill_number && String(unique_bill_number).trim()
        ? String(unique_bill_number).trim().toUpperCase()
        : purchase.unique_bill_number;

    const duplicate = await Purchase.exists({
      unique_bill_number: finalBillNumber,
      _id: { $ne: purchase._id }
    });

    if (duplicate) {
      return res.status(409).json({
        error: `Bill number ${finalBillNumber} already exists`
      });
    }

    // ---------- VALIDATE FIRST (so old stock is never lost on bad input) ----------
    const parsedLines = items.map(parseLine);

    // ---------- REMOVE OLD STOCK, ADD NEW STOCK (both batched) ----------
    await removeStockForPurchase(purchase);

    const lineProducts = await addStockForItems(parsedLines);

    const { purchaseItems, taxableTotal, gstTotal } =
      buildPurchaseItems(parsedLines, lineProducts);

    const totals = calculateTotals(
      taxableTotal,
      gstTotal,
      extra_charges,
      dealer_discount_percent
    );

    purchase.supplier = supplier;
    purchase.supplier_gstin = supplier_gstin || '';
    purchase.invoice_number = invoice_number;
    purchase.invoice_date = invoice_date ? new Date(invoice_date) : new Date();
    purchase.supplier_state = supplier_state || '';
    purchase.reference = reference || '';
    purchase.unique_bill_number = finalBillNumber;
    purchase.bill_image_url = bill_image_url || '';
    purchase.items = purchaseItems;
    purchase.taxable_amount = totals.taxableAmount;
    purchase.gst_total = totals.gstTotal;
    purchase.extra_charges = totals.extraCharges;
    purchase.dealer_discount_percent = totals.discountPercent;
    purchase.dealer_discount_amount = totals.discountAmount;
    purchase.grand_total = totals.grandTotal;

    const touchedProductIds = [
      ...new Set(lineProducts.map(p => String(p._id)))
    ];

    const [, products] = await Promise.all([
      purchase.save(),
      Product.find({ _id: { $in: touchedProductIds } }).select(PRODUCT_FIELDS)
    ]);

    res.json({
      ...purchase.toObject(),
      products
    });

  } catch (err) {

    console.error('Purchase update error:', err);

    if (err.code === 11000) {
      return res.status(409).json({
        error: 'This unique bill number already exists.'
      });
    }

    res.status(400).json({ error: err.message });
  }
});


// ============================================================
// DELETE PURCHASE
// ============================================================

router.delete('/:id', async (req, res) => {

  try {

    const purchase = await Purchase.findById(req.params.id);

    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found' });
    }

    await removeStockForPurchase(purchase);

    await Purchase.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: `Purchase bill ${purchase.unique_bill_number || ''} deleted successfully`
    });

  } catch (err) {

    console.error('Purchase delete error:', err);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
