// routes/bills.js — powers billing.html (create sale + GST calc), and the
// printable tax invoice (uses templates/invoice.js)
const express = require('express');
const Product = require('../models/Product');
const Bill = require('../models/Bill');
const ShopProfile = require('../models/ShopProfile');
const { renderInvoiceHTML } = require('../templates/invoice');

const router = express.Router();

async function nextInvoiceNo() {
  const shop = await ShopProfile.findOneAndUpdate(
    { key: 'main' },
    {},
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const prefix = shop.invoice_prefix || 'INV';
  const count = await Bill.countDocuments();
  const seq = 2481 + count; // starts near your old sample data; change as you like
  return `${prefix}-${seq}`;
}

// GET /api/bills?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/', async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = { status: 'ACTIVE' };
    if (from || to) {
      filter.bill_date = {};
      if (from) filter.bill_date.$gte = new Date(from + 'T00:00:00');
      if (to) filter.bill_date.$lte = new Date(to + 'T23:59:59');
    }
    const bills = await Bill.find(filter).sort({ bill_date: -1, createdAt: -1 });
    res.json(bills);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bills/:id
router.get('/:id', async (req, res) => {
  try {
    const bill = await Bill.findById(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    res.json(bill);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bills
 * Body: {
 *   customer_name, customer_phone, customer_gstin, customer_state,
 *   payment_mode, payment_status, paid_amount, discount_amount,
 *   items: [{ product_id, qty, discount_percent }]
 * }
 * Looks up live price/GST from the product record, computes CGST/SGST
 * (same state as shop) or IGST (different state), decrements stock,
 * and stores the bill.
 */
router.post('/', async (req, res) => {
  try {
    const {
      customer_name, customer_phone, customer_gstin, customer_state,
      payment_mode, payment_status, paid_amount, discount_amount, items
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    const shop = await ShopProfile.findOneAndUpdate(
      { key: 'main' }, {}, { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const isInterstate = !!customer_state && shop.state &&
      customer_state.trim().toLowerCase() !== shop.state.trim().toLowerCase();

    const billItems = [];
    let subtotal = 0, taxableTotal = 0, cgstTotal = 0, sgstTotal = 0, igstTotal = 0;

    for (const line of items) {
      const product = await Product.findById(line.product_id);
      if (!product) return res.status(404).json({ error: `Product ${line.product_id} not found` });
      if (product.stock_qty < line.qty) {
        return res.status(400).json({ error: `Insufficient stock for ${product.name} (have ${product.stock_qty}, need ${line.qty})` });
      }

      const qty = Number(line.qty) || 1;
      const rate = product.selling_price;
      const discountPercent = Number(line.discount_percent) || 0;
      const gross = qty * rate;
      const discountAmt = gross * discountPercent / 100;
      const taxable = gross - discountAmt;
      const gstRate = product.gst_rate;
      const gstAmt = taxable * gstRate / 100;

      let cgst = 0, sgst = 0, igst = 0;
      if (isInterstate) igst = gstAmt;
      else { cgst = gstAmt / 2; sgst = gstAmt / 2; }

      const lineTotal = taxable + gstAmt;

      billItems.push({
        product_id: product._id,
        product_name: product.name,
        hsn_code: product.hsn_code,
        unit: product.unit,
        qty, rate,
        discount_percent: discountPercent,
        taxable_value: taxable,
        gst_rate: gstRate,
        cgst_amount: cgst,
        sgst_amount: sgst,
        igst_amount: igst,
        line_total: lineTotal
      });

      subtotal += gross;
      taxableTotal += taxable;
      cgstTotal += cgst;
      sgstTotal += sgst;
      igstTotal += igst;

      product.stock_qty -= qty;
      await product.save();
    }

    const extraDiscount = Number(discount_amount) || 0;
    const preRoundTotal = taxableTotal - extraDiscount + cgstTotal + sgstTotal + igstTotal;
    const grandTotal = Math.round(preRoundTotal);
    const roundOff = grandTotal - preRoundTotal;

    const bill = await Bill.create({
      invoice_no: await nextInvoiceNo(),
      bill_date: new Date(),
      customer_name: customer_name || 'Walk-in Customer',
      customer_phone: customer_phone || '',
      customer_gstin: customer_gstin || '',
      customer_state: customer_state || shop.state,
      is_interstate: isInterstate,
      payment_mode: payment_mode || 'Cash',
      payment_status: payment_status || 'Paid',
      paid_amount: paid_amount != null ? Number(paid_amount) : grandTotal,
      subtotal,
      discount_amount: extraDiscount,
      taxable_value: taxableTotal,
      cgst_amount: cgstTotal,
      sgst_amount: sgstTotal,
      igst_amount: igstTotal,
      round_off: roundOff,
      grand_total: grandTotal,
      items: billItems
    });

    res.status(201).json(bill);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/bills/:id/cancel — void a bill without deleting it (keeps GST audit trail)
router.post('/:id/cancel', async (req, res) => {
  try {
    const bill = await Bill.findByIdAndUpdate(req.params.id, { status: 'CANCELLED' }, { new: true });
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    res.json(bill);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bills/:id/invoice — printable HTML (open in a new tab / iframe)
router.get('/:id/invoice', async (req, res) => {
  try {
    const bill = await Bill.findById(req.params.id);
    if (!bill) return res.status(404).send('Bill not found');
    const shop = await ShopProfile.findOne({ key: 'main' });
    const html = renderInvoiceHTML({ bill, items: bill.items, shop: shop || {} });
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send('Error rendering invoice: ' + err.message);
  }
});

module.exports = router;
