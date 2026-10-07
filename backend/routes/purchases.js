// routes/purchases.js

const express = require('express');

const Product = require('../models/Product');
const Purchase = require('../models/Purchase');

const { generateUniqueBarcode } = require('../utils/barcode');

const router = express.Router();

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;


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
// GST is a percentage of the taxable bill amount (per item gst_rate).
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
  const discountAmount = totalBeforeDiscount * discountPercent / 100;
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
// SUPPLIER ACCOUNT (Cr / Dr)
//
// The purchase bill is a Cr (payable) to the supplier.
//   Dr entries = money paid to supplier (Advance / Cash / Online ...)
//   Cr entries = extra amount credited to supplier
// balance = grand_total + extra Cr - all Dr
//   balance >= 0 -> we still owe the supplier  (Cr)
//   balance <  0 -> we paid more / advance     (Dr)
//
// Cash payments carry NO GST. GST only exists on the bill amount.
// Everything is recalculated here so the browser cannot send a wrong balance.
// ============================================================

function normalizePayments(list) {
  if (!Array.isArray(list)) return [];

  return list
    .map((p) => ({
      type: p && p.type === 'Cr' ? 'Cr' : 'Dr',
      mode: String((p && p.mode) || 'Other').trim(),
      amount: Math.max(0, Number(p && p.amount) || 0),
      date: p && p.date ? String(p.date).slice(0, 10) : '',
      note: String((p && p.note) || '').trim()
    }))
    .filter((p) => p.amount > 0);
}

function calculatePaymentSummary(grandTotal, payments) {
  let advance = 0;
  let cash = 0;
  let other = 0;
  let extraCredit = 0;

  for (const p of payments) {
    if (p.type === 'Cr') {
      extraCredit += p.amount;
    } else if (p.mode === 'Advance') {
      advance += p.amount;
    } else if (p.mode === 'Cash') {
      cash += p.amount;
    } else {
      other += p.amount;
    }
  }

  const balance = grandTotal + extraCredit - advance - cash - other;

  return {
    advance_paid: round2(advance),
    cash_paid: round2(cash),
    other_paid: round2(other),
    extra_credit: round2(extraCredit),
    balance_amount: round2(Math.abs(balance)),
    balance_type: balance >= 0 ? 'Cr' : 'Dr'
  };
}

// Fields shared by create + update that come from the new UI.
function buildAccountFields(body, totals, purchaseItems) {
  const payments = normalizePayments(body.payments);

  let gstPercent = Number(body.gst_percent);
  if (!Number.isFinite(gstPercent)) {
    gstPercent = purchaseItems.length ? Number(purchaseItems[0].gst_rate) || 0 : 0;
  }
  gstPercent = Math.min(100, Math.max(0, gstPercent));

  const defaultMargin = Number(body.default_margin_percent);

  return {
    gst_percent: gstPercent,
    default_margin_percent: Number.isFinite(defaultMargin) ? Math.max(0, defaultMargin) : 70,
    payments,
    ...calculatePaymentSummary(totals.grandTotal, payments)
  };
}


// ============================================================
// PREPARE PURCHASE ITEM
// ============================================================

function preparePurchaseLine(line) {
  const qty = Number(line.qty) || 0;
  const purchaseRate = Number(line.purchase_rate ?? line.rate) || 0;
  const mrp = Number(line.mrp) || 0;
  const sellingPrice = Number(line.selling_price) || 0;
  const gstRate = Number(line.gst_rate) || 0;
  const marginPercent = Math.max(0, Number(line.margin_percent) || 0);
  const category = String(line.category || '').trim() || 'General';

  if (qty <= 0) {
    throw new Error(`Invalid quantity for ${line.description || 'item'}`);
  }

  if (sellingPrice <= 0) {
    throw new Error(`Selling Price is required for ${line.description || 'item'}`);
  }

  if (mrp > 0 && sellingPrice > mrp) {
    throw new Error(`Selling Price cannot be greater than MRP for ${line.description || 'item'}`);
  }

  const base = qty * purchaseRate;
  const gst = base * gstRate / 100;
  const amount = base + gst;

  return {
    line,
    qty,
    purchaseRate,
    mrp,
    sellingPrice,
    gstRate,
    marginPercent,
    category,
    base,
    gst,
    amount
  };
}


// ============================================================
// FAST ADD STOCK FOR PURCHASE
//   find all products once, bulkWrite existing, insertMany new
// ============================================================

async function addStockForPurchaseItems(items) {
  const preparedItems = items.map(preparePurchaseLine);

  // ---- collect product ids + barcodes ----
  const productIds = [];
  const barcodes = [];

  for (const entry of preparedItems) {
    const line = entry.line;

    if (line.product_id) productIds.push(line.product_id);

    if (!line.product_id && line.item_code && String(line.item_code).trim()) {
      barcodes.push(String(line.item_code).trim());
    }
  }

  // ---- find all existing products in one query ----
  const conditions = [];

  if (productIds.length > 0) {
    conditions.push({ _id: { $in: productIds } });
  }

  if (barcodes.length > 0) {
    conditions.push({ barcode: { $in: [...new Set(barcodes)] } });
  }

  let existingProducts = [];

  if (conditions.length > 0) {
    existingProducts = await Product.find({ $or: conditions });
  }

  // ---- lookup maps ----
  const productById = new Map();
  const productByBarcode = new Map();

  for (const product of existingProducts) {
    productById.set(String(product._id), product);

    if (product.barcode) {
      productByBarcode.set(String(product.barcode).trim(), product);
    }
  }

  // ---- prepare bulk operations (no DB save inside loop) ----
  const operations = [];
  const newProducts = [];
  const resolvedProducts = [];

  for (const entry of preparedItems) {
    const line = entry.line;
    let product = null;

    if (line.product_id) {
      product = productById.get(String(line.product_id)) || null;
    }

    if (!product && line.item_code && String(line.item_code).trim()) {
      product = productByBarcode.get(String(line.item_code).trim()) || null;
    }

    // ---- existing product ----
    if (product) {
      const updateSet = {
        purchase_price: entry.purchaseRate,
        mrp: entry.mrp,
        selling_price: entry.sellingPrice,
        gst_rate: entry.gstRate,
        category: entry.category
      };

      if (line.hsn_code) {
        updateSet.hsn_code = String(line.hsn_code).trim();
      }

      operations.push({
        updateOne: {
          filter: { _id: product._id },
          update: {
            $inc: { stock_qty: entry.qty },
            $set: updateSet
          }
        }
      });

      resolvedProducts.push({ entry, product });
      continue;
    }

    // ---- new product ----
    let barcodeValue;

    if (line.item_code && String(line.item_code).trim()) {
      barcodeValue = String(line.item_code).trim();
    } else {
      barcodeValue = await generateUniqueBarcode(Product);
    }

    newProducts.push({ entry, barcodeValue });
  }

  // ---- update all existing products at once ----
  if (operations.length > 0) {
    await Product.bulkWrite(operations, { ordered: true });
  }

  // ---- insert all new products at once ----
  if (newProducts.length > 0) {
    const documents = newProducts.map(({ entry, barcodeValue }) => {
      const line = entry.line;

      return {
        name: String(line.description || 'Unnamed item').trim(),
        barcode: barcodeValue,
        category: entry.category,
        hsn_code: String(line.hsn_code || '').trim(),
        purchase_price: entry.purchaseRate,
        mrp: entry.mrp,
        selling_price: entry.sellingPrice,
        gst_rate: entry.gstRate,
        stock_qty: entry.qty,
        reorder_level: 5
      };
    });

    const createdProducts = await Product.insertMany(documents);

    for (let i = 0; i < createdProducts.length; i++) {
      resolvedProducts.push({
        entry: newProducts[i].entry,
        product: createdProducts[i]
      });
    }
  }

  // ---- build purchase items ----
  const productMap = new Map();

  for (const resolved of resolvedProducts) {
    productMap.set(resolved.entry, resolved.product);
  }

  const purchaseItems = [];
  const touchedProductIds = [];
  let taxableTotal = 0;
  let gstTotal = 0;

  for (const entry of preparedItems) {
    const product = productMap.get(entry);

    if (!product) {
      throw new Error(`Unable to save product for ${entry.line.description || 'item'}`);
    }

    const line = entry.line;

    touchedProductIds.push(product._id);

    purchaseItems.push({
      item_code: product.barcode || line.item_code || '',
      description: line.description || product.name,
      category: entry.category,
      hsn_code: line.hsn_code || product.hsn_code || '',
      qty: entry.qty,
      mrp: entry.mrp,
      margin_percent: entry.marginPercent,
      purchase_rate: entry.purchaseRate,
      selling_price: entry.sellingPrice,
      rate: entry.purchaseRate,
      gst_rate: entry.gstRate,
      amount: entry.amount,
      product_id: product._id
    });

    taxableTotal += entry.base;
    gstTotal += entry.gst;
  }

  return { purchaseItems, touchedProductIds, taxableTotal, gstTotal };
}


// ============================================================
// REMOVE STOCK FROM PURCHASE (batched) - used for EDIT and DELETE
// ============================================================

async function removeStockForPurchase(purchase) {
  if (!purchase || !Array.isArray(purchase.items)) return;

  const items = purchase.items.filter((item) => (Number(item.qty) || 0) > 0);

  if (items.length === 0) return;

  const productIds = [];
  const barcodes = [];

  for (const item of items) {
    if (item.product_id) productIds.push(item.product_id);

    if (item.item_code && String(item.item_code).trim()) {
      barcodes.push(String(item.item_code).trim());
    }
  }

  const conditions = [];

  if (productIds.length > 0) {
    conditions.push({ _id: { $in: productIds } });
  }

  if (barcodes.length > 0) {
    conditions.push({ barcode: { $in: [...new Set(barcodes)] } });
  }

  if (conditions.length === 0) return;

  const products = await Product.find({ $or: conditions }).select('_id barcode stock_qty');

  const productById = new Map();
  const productByBarcode = new Map();

  for (const product of products) {
    productById.set(String(product._id), product);

    if (product.barcode) {
      productByBarcode.set(String(product.barcode).trim(), product);
    }
  }

  // combine quantity by product
  const quantityMap = new Map();

  for (const item of items) {
    let product = null;

    if (item.product_id) {
      product = productById.get(String(item.product_id)) || null;
    }

    if (!product && item.item_code && String(item.item_code).trim()) {
      product = productByBarcode.get(String(item.item_code).trim()) || null;
    }

    if (!product) continue;

    const key = String(product._id);
    const qty = Number(item.qty) || 0;

    quantityMap.set(key, (quantityMap.get(key) || 0) + qty);
  }

  const operations = [];

  for (const [productId, qty] of quantityMap) {
    operations.push({
      updateOne: {
        filter: { _id: productId },
        update: { $inc: { stock_qty: -qty } }
      }
    });
  }

  if (operations.length > 0) {
    await Product.bulkWrite(operations, { ordered: true });
  }
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
// SEARCH PURCHASE BILLS (party name / unique bill no. / invoice no.)
// IMPORTANT: keep this BEFORE /:id
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
// SUPPLIER LEDGER
// Total Cr (we owe) / Dr (advance with supplier) across all bills
// for one party. IMPORTANT: keep BEFORE /:id
// ============================================================

router.get('/ledger/:supplier', async (req, res) => {
  try {
    const name = String(req.params.supplier || '').trim();

    if (!name) return res.status(400).json({ error: 'Supplier name is required' });

    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const bills = await Purchase
      .find({ supplier: new RegExp(`^${escaped}$`, 'i') })
      .sort({ invoice_date: 1 });

    let signedBalance = 0;
    let totalBilled = 0;
    let totalPaid = 0;

    const rows = bills.map((b) => {
      const signed = (b.balance_type === 'Dr' ? -1 : 1) * (Number(b.balance_amount) || 0);
      signedBalance += signed;
      totalBilled += Number(b.grand_total) || 0;
      totalPaid +=
        (Number(b.advance_paid) || 0) +
        (Number(b.cash_paid) || 0) +
        (Number(b.other_paid) || 0);

      return {
        _id: b._id,
        unique_bill_number: b.unique_bill_number,
        invoice_number: b.invoice_number,
        invoice_date: b.invoice_date,
        grand_total: b.grand_total,
        balance_amount: b.balance_amount,
        balance_type: b.balance_type
      };
    });

    res.json({
      supplier: name,
      total_billed: round2(totalBilled),
      total_paid: round2(totalPaid),
      balance_amount: round2(Math.abs(signedBalance)),
      balance_type: signedBalance >= 0 ? 'Cr' : 'Dr',
      bills: rows
    });
  } catch (err) {
    console.error('Supplier ledger error:', err);
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
      return res.status(400).json({ error: 'Supplier and invoice number are required' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    // ---- unique bill number ----
    let finalBillNumber;

    if (unique_bill_number && String(unique_bill_number).trim()) {
      finalBillNumber = String(unique_bill_number).trim().toUpperCase();
    } else {
      finalBillNumber = await generateUniqueBillNumber();
    }

    const duplicate = await Purchase.findOne({ unique_bill_number: finalBillNumber });

    if (duplicate) {
      return res.status(409).json({ error: `Bill number ${finalBillNumber} already exists` });
    }

    // ---- stock + items ----
    const { purchaseItems, touchedProductIds, taxableTotal, gstTotal } =
      await addStockForPurchaseItems(items);

    const totals = calculateTotals(
      taxableTotal,
      gstTotal,
      extra_charges,
      dealer_discount_percent
    );

    const accountFields = buildAccountFields(req.body, totals, purchaseItems);

    const purchase = await Purchase.create({
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
      grand_total: totals.grandTotal,
      ...accountFields
    });

    const products = await Product.find({
      _id: { $in: touchedProductIds }
    }).select('name barcode category mrp purchase_price selling_price gst_rate stock_qty');

    res.status(201).json({
      ...purchase.toObject(),
      products
    });

  } catch (err) {
    console.error('Purchase save error:', err);

    if (err.code === 11000) {
      return res.status(409).json({
        error: 'This unique bill number already exists. Please generate another number.'
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
      return res.status(400).json({ error: 'Supplier and invoice number are required' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    const finalBillNumber =
      unique_bill_number && String(unique_bill_number).trim()
        ? String(unique_bill_number).trim().toUpperCase()
        : purchase.unique_bill_number;

    const duplicate = await Purchase.findOne({
      unique_bill_number: finalBillNumber,
      _id: { $ne: purchase._id }
    });

    if (duplicate) {
      return res.status(409).json({ error: `Bill number ${finalBillNumber} already exists` });
    }

    // ---- remove old stock, add new stock (batched) ----
    await removeStockForPurchase(purchase);

    const { purchaseItems, touchedProductIds, taxableTotal, gstTotal } =
      await addStockForPurchaseItems(items);

    const totals = calculateTotals(
      taxableTotal,
      gstTotal,
      extra_charges,
      dealer_discount_percent
    );

    const accountFields = buildAccountFields(req.body, totals, purchaseItems);

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

    purchase.gst_percent = accountFields.gst_percent;
    purchase.default_margin_percent = accountFields.default_margin_percent;
    purchase.payments = accountFields.payments;
    purchase.advance_paid = accountFields.advance_paid;
    purchase.cash_paid = accountFields.cash_paid;
    purchase.other_paid = accountFields.other_paid;
    purchase.extra_credit = accountFields.extra_credit;
    purchase.balance_amount = accountFields.balance_amount;
    purchase.balance_type = accountFields.balance_type;

    await purchase.save();

    const products = await Product.find({
      _id: { $in: touchedProductIds }
    }).select('name barcode category mrp purchase_price selling_price gst_rate stock_qty');

    res.json({
      ...purchase.toObject(),
      products
    });

  } catch (err) {
    console.error('Purchase update error:', err);

    if (err.code === 11000) {
      return res.status(409).json({ error: 'This unique bill number already exists.' });
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
