const express = require('express');
const mongoose = require('mongoose');
const Purchase = require('../models/Purchase');
const SupplierPayment = require('../models/SupplierPayment');
const router = express.Router();

const round2 = n => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const clean = s => String(s || '').trim().replace(/\s+/g, ' ');
const escRegex = s => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const supplierRegex = s => new RegExp('^' + escRegex(clean(s)) + '$', 'i');
const totalOf = p => Number(p.grand_total ?? p.total_amount ?? p.total ?? 0) || 0;
const dateOf = p => p.invoice_date || p.createdAt || p.created_at || new Date();
const statusOf = signed => signed > 0.009 ? 'Payable' : signed < -0.009 ? 'Advance' : 'Settled';

router.get('/summary', async (req, res) => {
  try {
    const [purchases, payments] = await Promise.all([
      Purchase.find({}).select('supplier grand_total total_amount total invoice_date createdAt').lean(),
      SupplierPayment.find({}).select('supplier amount payment_date').lean()
    ]);
    const map = new Map();
    const get = name => {
      const supplier = clean(name);
      if (!supplier) return null;
      const key = supplier.toLowerCase();
      if (!map.has(key)) map.set(key, { supplier, total_purchased: 0, total_paid: 0, purchase_count: 0, payment_count: 0, last_activity: null });
      return map.get(key);
    };
    const touch = (row, date) => {
      const d = date ? new Date(date) : null;
      if (row && d && !Number.isNaN(d.getTime()) && (!row.last_activity || d > new Date(row.last_activity))) row.last_activity = d;
    };
    for (const p of purchases) {
      const row = get(p.supplier); if (!row) continue;
      row.total_purchased += totalOf(p); row.purchase_count++; touch(row, dateOf(p));
    }
    for (const p of payments) {
      const row = get(p.supplier); if (!row) continue;
      row.total_paid += Number(p.amount) || 0; row.payment_count++; touch(row, p.payment_date || p.createdAt);
    }
    const suppliers = [...map.values()].map(r => {
      r.total_purchased = round2(r.total_purchased); r.total_paid = round2(r.total_paid);
      const signed = round2(r.total_purchased - r.total_paid);
      r.balance_amount = Math.abs(signed); r.balance_type = statusOf(signed); return r;
    }).sort((a, b) => a.supplier.localeCompare(b.supplier));
    res.json({ suppliers });
  } catch (e) {
    console.error('Supplier ledger summary error:', e);
    res.status(500).json({ error: 'Could not load supplier summary.' });
  }
});

router.get('/:supplier', async (req, res) => {
  try {
    const supplier = clean(decodeURIComponent(req.params.supplier || ''));
    if (!supplier) return res.status(400).json({ error: 'Supplier name is required.' });
    const re = supplierRegex(supplier);
    const [purchases, payments] = await Promise.all([
      Purchase.find({ supplier: re }).sort({ invoice_date: 1, createdAt: 1 }).lean(),
      SupplierPayment.find({ supplier: re }).sort({ payment_date: 1, createdAt: 1 }).lean()
    ]);
    const totalPurchased = round2(purchases.reduce((s, p) => s + totalOf(p), 0));
    const totalPaid = round2(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
    const signed = round2(totalPurchased - totalPaid);
    const entries = [];
    for (const p of purchases) entries.push({
      entry_id: String(p._id), entry_type: 'purchase', date: dateOf(p), description: 'Purchase bill',
      invoice_number: p.unique_bill_number || p.invoice_number || p.invoice_no || '', purchase_id: String(p._id),
      debit: round2(totalOf(p)), credit: 0, amount: round2(totalOf(p)), notes: p.reference || '', payment_mode: ''
    });
    for (const p of payments) entries.push({
      entry_id: String(p._id), entry_type: p.kind === 'advance' ? 'advance' : 'payment',
      date: p.payment_date || p.createdAt, description: p.kind === 'advance' ? 'Advance paid' : 'Supplier payment',
      invoice_number: p.purchase_bill_number || '', purchase_id: p.purchase_id ? String(p.purchase_id) : '',
      debit: 0, credit: round2(p.amount), amount: round2(p.amount), payment_mode: p.payment_mode || '',
      reference_number: p.reference_number || '', cheque_number: p.cheque_number || '',
      cheque_date: p.cheque_date || null, cheque_status: p.cheque_status || '', notes: p.notes || ''
    });
    entries.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    let running = 0;
    for (const e of entries) {
      running = round2(running + e.debit - e.credit);
      e.running_balance = Math.abs(running); e.running_balance_type = statusOf(running);
    }
    res.json({
      supplier, total_purchased: totalPurchased, total_paid: totalPaid,
      balance_amount: Math.abs(signed), balance_type: statusOf(signed),
      purchase_count: purchases.length, payment_count: payments.length, entries
    });
  } catch (e) {
    console.error('Supplier ledger detail error:', e);
    res.status(500).json({ error: 'Could not load supplier ledger.' });
  }
});

router.post('/payments', async (req, res) => {
  try {
    const supplier = clean(req.body.supplier);
    const amount = Number(req.body.amount);
    const paymentDate = req.body.payment_date ? new Date(req.body.payment_date) : new Date();
    const kind = req.body.kind === 'advance' ? 'advance' : 'payment';
    const modes = ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Card', 'Other'];
    const paymentMode = modes.includes(req.body.payment_mode) ? req.body.payment_mode : '';
    if (!supplier) return res.status(400).json({ error: 'Supplier is required.' });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Enter an amount greater than zero.' });
    if (!paymentMode) return res.status(400).json({ error: 'Select a valid payment mode.' });
    if (Number.isNaN(paymentDate.getTime())) return res.status(400).json({ error: 'Payment date is invalid.' });
    let purchase = null;
    if (req.body.purchase_id) {
      if (!mongoose.isValidObjectId(req.body.purchase_id)) return res.status(400).json({ error: 'Selected purchase bill is invalid.' });
      purchase = await Purchase.findById(req.body.purchase_id);
      if (!purchase) return res.status(404).json({ error: 'Purchase bill not found.' });
      if (!supplierRegex(supplier).test(String(purchase.supplier || ''))) return res.status(400).json({ error: 'Selected bill belongs to a different supplier.' });
    }
    if (paymentMode === 'Cheque' && !String(req.body.cheque_number || '').trim()) {
      return res.status(400).json({ error: 'Cheque number is required for cheque payments.' });
    }
    const payment = await SupplierPayment.create({
      supplier, amount: round2(amount), payment_date: paymentDate, kind, payment_mode: paymentMode,
      purchase_id: purchase ? purchase._id : null,
      purchase_bill_number: purchase ? String(purchase.unique_bill_number || purchase.invoice_number || '') : String(req.body.purchase_bill_number || '').trim(),
      reference_number: String(req.body.reference_number || '').trim(),
      cheque_number: String(req.body.cheque_number || '').trim(),
      cheque_date: req.body.cheque_date ? new Date(req.body.cheque_date) : null,
      cheque_status: paymentMode === 'Cheque' ? (['Issued','Cleared','Bounced','Cancelled'].includes(req.body.cheque_status) ? req.body.cheque_status : 'Issued') : 'Not Applicable',
      notes: String(req.body.notes || '').trim()
    });
    res.status(201).json({ success: true, message: 'Payment saved.', payment });
  } catch (e) {
    console.error('Supplier payment create error:', e);
    res.status(500).json({ error: 'Could not save supplier payment.' });
  }
});
module.exports = router;
