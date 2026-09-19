// routes/purchases.js — powers purchase.html: recording a supplier bill and
// adding the purchased stock into inventory.
const express = require('express');
const Product = require('../models/Product');
const Purchase = require('../models/Purchase');
const { generateUniqueBarcode } = require('../utils/barcode');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const purchases = await Purchase.find().sort({ createdAt: -1 });
    res.json(purchases);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
    res.json(purchase);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/purchases
 * Body: {
 *   supplier, supplier_gstin, invoice_number, invoice_date, supplier_state, reference,
 *   items: [{ item_code, description, hsn_code, qty, rate, gst_rate, product_id? }]
 * }
 * For each item: if product_id is given, adds qty to that product's stock and
 * updates its purchase_price. Otherwise tries to match by barcode == item_code;
 * if still not found, creates a new product automatically — and if no item
 * code/barcode was given on the bill, a unique one is generated so a label
 * can be printed and stuck on the saree.
 *
 * The response includes a `products` array (id, name, barcode, price) for
 * every item on the bill, so the frontend can immediately print barcode/QR
 * labels for anything new without a second round of API calls.
 */
router.post('/', async (req, res) => {
  try {
    const { supplier, supplier_gstin, invoice_number, invoice_date, supplier_state, reference, items } = req.body;

    if (!supplier || !invoice_number) {
      return res.status(400).json({ error: 'Supplier and invoice number are required' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    const purchaseItems = [];
    const touchedProductIds = [];
    let taxableTotal = 0, gstTotal = 0;

    for (const line of items) {
      const qty = Number(line.qty) || 0;
      const rate = Number(line.rate) || 0;
      const gstRate = Number(line.gst_rate) || 0;
      const base = qty * rate;
      const gst = base * gstRate / 100;
      const amount = base + gst;

      let product = null;
      if (line.product_id) {
        product = await Product.findById(line.product_id);
      } else if (line.item_code) {
        product = await Product.findOne({ barcode: line.item_code });
      }

      if (product) {
        product.stock_qty += qty;
        product.purchase_price = rate;
        await product.save();
      } else {
        const barcodeValue = line.item_code && String(line.item_code).trim()
          ? String(line.item_code).trim()
          : await generateUniqueBarcode(Product);

        product = await Product.create({
          name: line.description || 'Unnamed item',
          barcode: barcodeValue,
          hsn_code: line.hsn_code || '',
          purchase_price: rate,
          selling_price: rate, // owner should adjust the margin in Inventory afterwards
          gst_rate: gstRate,
          stock_qty: qty,
          reorder_level: 5
        });
      }

      touchedProductIds.push(product._id);

      purchaseItems.push({
        item_code: line.item_code || '',
        description: line.description,
        hsn_code: line.hsn_code || '',
        qty, rate, gst_rate: gstRate, amount,
        product_id: product._id
      });

      taxableTotal += base;
      gstTotal += gst;
    }

    const purchase = await Purchase.create({
      supplier,
      supplier_gstin: supplier_gstin || '',
      invoice_number,
      invoice_date: invoice_date ? new Date(invoice_date) : new Date(),
      supplier_state: supplier_state || '',
      reference: reference || '',
      items: purchaseItems,
      taxable_amount: taxableTotal,
      gst_total: gstTotal,
      grand_total: taxableTotal + gstTotal
    });

    const products = await Product.find({ _id: { $in: touchedProductIds } })
      .select('name barcode selling_price gst_rate stock_qty');

    res.status(201).json({ ...purchase.toObject(), products });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;