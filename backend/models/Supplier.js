const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const Supplier = require('../models/Supplier');
const Txn = require('../models/SupplierTransaction');
const Purchase = require('../models/Purchase');

/* =====================================================================
   FIELD MAP
   Har list me upar se neeche pehli jo field milti hai wahi use hoti hai.
   ===================================================================== */
const F = {
  party: ['supplier'],
  total: ['grand_total'], // bill ki final amount (GST included)
  date: ['invoice_date', 'createdAt'],
  billNo: ['unique_bill_number'],
  invoiceNo: ['invoice_number'],
  items: ['items'],
};

const num = (v) => Number(v) || 0;
const round = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const normName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const UNKNOWN = 'Unknown Party';

function pick(doc, keys) {
  for (const k of keys) {
    if (doc[k] !== undefined && doc[k] !== null && doc[k] !== '') return doc[k];
  }
  return undefined;
}

/* ---------- Purchase bills padhna ---------- */
async function loadBills() {
  const docs = await Purchase.find().lean();

  return docs.map((d) => {
    const rawParty = pick(d, F.party);
    let partyName = '';
    let partyRef = null;

    if (rawParty instanceof mongoose.Types.ObjectId) partyRef = String(rawParty);
    else if (rawParty && typeof rawParty === 'object') partyName = rawParty.name || '';
    else partyName = String(rawParty || '');

    const items = pick(d, F.items);
    const quantity = Array.isArray(items)
      ? items.reduce((sum, item) => sum + num(item.qty ?? item.quantity ?? item.pcs), 0)
      : 0;

    const billDate = d.invoice_date || d.createdAt || new Date();

    // Detailed payment rows are preferred. Summary fields are used only for older
    // bills where detailed rows were never stored (avoids double counting).
    let payments = Array.isArray(d.payments)
      ? d.payments
          .filter((p) => num(p.amount) > 0)
          .map((p) => ({
            type: p.type === 'Cr' ? 'Cr' : 'Dr',
            mode: String(p.mode || 'Other'),
            amount: round(num(p.amount)),
            date: p.date || billDate,
            note: String(p.note || ''),
          }))
      : [];

    if (payments.length === 0) {
      if (num(d.advance_paid) > 0) payments.push({ type: 'Dr', mode: 'Advance', amount: round(num(d.advance_paid)), date: billDate, note: 'Legacy saved advance' });
      if (num(d.cash_paid) > 0) payments.push({ type: 'Dr', mode: 'Cash', amount: round(num(d.cash_paid)), date: billDate, note: 'Legacy saved payment' });
      if (num(d.other_paid) > 0) payments.push({ type: 'Dr', mode: 'Other', amount: round(num(d.other_paid)), date: billDate, note: 'Legacy saved payment' });
      if (num(d.extra_credit) > 0) payments.push({ type: 'Cr', mode: 'Other', amount: round(num(d.extra_credit)), date: billDate, note: 'Legacy credit entry' });
    }

    const paid = round(payments.filter((p) => p.type === 'Dr').reduce((sum, p) => sum + p.amount, 0));
    const credit = round(payments.filter((p) => p.type === 'Cr').reduce((sum, p) => sum + p.amount, 0));
    const advance = round(payments.filter((p) => p.type === 'Dr' && p.mode.toLowerCase() === 'advance').reduce((sum, p) => sum + p.amount, 0));
    const otherPaid = round(paid - advance);

    return {
      id: String(d._id),
      partyName: partyName.trim(),
      partyRef,
      date: pick(d, F.date) || d.createdAt || new Date(),
      billNo: String(pick(d, F.billNo) || ''),
      invoiceNo: String(pick(d, F.invoiceNo) || ''),
      total: num(pick(d, F.total)),
      paid,
      advance,
      otherPaid,
      credit,
      payments,
      quantity,
    };
  });
}

/* ---------- Purchase wali parties ke liye Supplier banana (agar nahi hai) ---------- */
async function loadSuppliersAndBills() {
  const bills = await loadBills();
  const suppliers = await Supplier.find().lean();
  const idSet = new Set(suppliers.map((s) => String(s._id)));
  const keyToId = new Map(suppliers.map((s) => [normName(s.name), String(s._id)]));

  const missing = new Map();
  bills.forEach((b) => {
    if (b.partyRef && idSet.has(b.partyRef)) return;
    const name = b.partyName || UNKNOWN;
    if (!keyToId.has(normName(name)) && !missing.has(normName(name))) missing.set(normName(name), name);
  });

  for (const [key, name] of missing) {
    const created = await Supplier.create({ name });
    suppliers.push(created.toObject());
    keyToId.set(key, String(created._id));
  }

  bills.forEach((b) => {
    b.supplierId =
      b.partyRef && idSet.has(b.partyRef) ? b.partyRef : keyToId.get(normName(b.partyName || UNKNOWN));
  });

  return { suppliers, bills };
}

/* ---------- Supplier account summary ---------- */
function summarize(supplier, a = {}) {
  const billTotal = a.billTotal || 0;
  const extraCredit = a.billCredit || 0;
  const advancePaid = (a.billAdvance || 0) + (a.manualAdvance || 0);
  const otherPaid = (a.billOther || 0) + (a.manualOther || 0);
  const totalPaid = advancePaid + otherPaid;
  const opening = num(supplier.openingBalance);
  const balance = round(opening + billTotal + extraCredit - totalPaid);

  return {
    openingBalance: round(opening),
    totalBills: round(billTotal + extraCredit), // Cr side: bills + extra Cr entries
    billCount: a.billCount || 0,
    advancePaid: round(advancePaid),
    otherPaid: round(otherPaid),
    totalPaid: round(totalPaid),
    extraCredit: round(extraCredit),
    balance,
    pending: balance > 0 ? balance : 0,
    advanceLeft: balance < 0 ? -balance : 0,
    status: balance > 0.009 ? 'due' : balance < -0.009 ? 'advance' : 'clear',
    lastBill: a.lastBill || null,
    lastPayment: a.lastPayment || null,
  };
}

async function buildData() {
  const { suppliers, bills } = await loadSuppliersAndBills();
  const txns = await Txn.find({ type: 'payment' }).sort({ date: 1, createdAt: 1 }).lean();

  const agg = {};
  const A = (id) => (agg[id] = agg[id] || {
    billTotal: 0,
    billCount: 0,
    billAdvance: 0,
    billOther: 0,
    billCredit: 0,
    manualAdvance: 0,
    manualOther: 0,
    lastBill: null,
    lastPayment: null,
  });
  const later = (cur, d) => (!cur || (d && new Date(d) > new Date(cur)) ? d : cur);

  bills.forEach((b) => {
    const a = A(b.supplierId);
    a.billTotal += b.total;
    a.billCount += 1;
    a.billAdvance += b.advance;
    a.billOther += b.otherPaid;
    a.billCredit += b.credit;
    a.lastBill = later(a.lastBill, b.date);
    if (b.paid > 0) {
      const billPaymentDates = b.payments.filter((p) => p.type === 'Dr').map((p) => p.date);
      a.lastPayment = later(a.lastPayment, billPaymentDates.sort((x, y) => new Date(y) - new Date(x))[0] || b.date);
    }
  });

  txns.forEach((t) => {
    const a = A(String(t.supplier));
    if (t.paymentKind === 'advance') a.manualAdvance += num(t.amount);
    else a.manualOther += num(t.amount);
    a.lastPayment = later(a.lastPayment, t.date || t.createdAt);
  });

  Object.values(agg).forEach((a) => {
    for (const key of ['billTotal', 'billAdvance', 'billOther', 'billCredit', 'manualAdvance', 'manualOther']) {
      a[key] = round(a[key]);
    }
  });

  return { suppliers, bills, txns, agg };
}

/* ---------- Supplier list + overall ---------- */
// GET /api/suppliers?search=ram
router.get('/', async (req, res) => {
  try {
    const { suppliers, agg } = await buildData();
    const q = normName(req.query.search);

    const list = suppliers
      .filter((s) => !q || [s.name, s.city, s.phone].some((v) => normName(v).includes(q)))
      .map((s) => ({ ...s, ...summarize(s, agg[String(s._id)]) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const overall = list.reduce(
      (o, s) => {
        o.totalBills += s.totalBills;
        o.totalAdvancePaid += s.advancePaid;
        o.totalPaid += s.totalPaid;
        o.totalPending += s.pending;
        o.totalAdvanceLeft += s.advanceLeft;
        return o;
      },
      { totalBills: 0, totalAdvancePaid: 0, totalPaid: 0, totalPending: 0, totalAdvanceLeft: 0 }
    );
    Object.keys(overall).forEach((k) => (overall[k] = round(overall[k])));

    res.json({ suppliers: list, overall });
  } catch (err) {
    console.error('Supplier list error:', err);
    res.status(500).json({ message: err.message });
  }
});

/* ---------- Supplier add / edit / delete ---------- */
router.post('/', async (req, res) => {
  try {
    const { name, phone, city, gst, openingBalance, notes } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: 'Supplier name is required' });
    const exists = await Supplier.findOne({
      name: new RegExp('^' + name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'),
    });
    if (exists) return res.status(400).json({ message: 'A supplier with this name already exists' });
    const supplier = await Supplier.create({ name: name.trim(), phone, city, gst, openingBalance: num(openingBalance), notes });
    res.status(201).json(supplier);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Naam edit nahi hota, kyunki Purchase bills isi naam se party se jude hote hain.
router.put('/:id', async (req, res) => {
  try {
    const { phone, city, gst, openingBalance, notes } = req.body;
    const supplier = await Supplier.findByIdAndUpdate(
      req.params.id,
      { phone, city, gst, openingBalance: num(openingBalance), notes },
      { new: true }
    );
    if (!supplier) return res.status(404).json({ message: 'Supplier not found' });
    res.json(supplier);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return res.status(404).json({ message: 'Supplier not found' });

    const payments = await Txn.countDocuments({ supplier: supplier._id });
    const bills = await loadBills();
    const hasBills = bills.some((b) => normName(b.partyName || UNKNOWN) === normName(supplier.name));
    if (payments > 0 || hasBills) {
      return res.status(400).json({ message: 'This supplier has purchase bills or payments, so it cannot be deleted.' });
    }
    await Supplier.findByIdAndDelete(req.params.id);
    res.json({ message: 'Supplier deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ---------- Party ka poora khata (ledger) ---------- */
// GET /api/suppliers/:id/ledger?from=2026-04-01&to=2026-10-12
router.get('/:id/ledger', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid supplier id' });

    const { suppliers, bills, txns, agg } = await buildData();
    const supplier = suppliers.find((s) => String(s._id) === id);
    if (!supplier) return res.status(404).json({ message: 'Supplier not found' });

    const all = [];
    bills
      .filter((b) => b.supplierId === id)
      .forEach((b) => {
        // Purchase bill creates a Cr balance (amount owed to supplier).
        all.push({
          _id: 'bill-' + b.id,
          source: 'bill',
          type: 'purchase',
          date: b.date,
          amount: b.total,
          billNo: b.billNo,
          invoiceNo: b.invoiceNo,
          quantity: b.quantity,
          note: 'Purchase bill',
        });

        // Cr rows add to payable; Dr rows reduce payable. Each saved row is shown once.
        b.payments.forEach((p, index) => {
          all.push({
            _id: `billpay-${b.id}-${index}`,
            source: 'bill',
            type: p.type === 'Cr' ? 'credit' : 'payment',
            paymentKind: p.type === 'Cr' ? 'credit' : (p.mode.toLowerCase() === 'advance' ? 'advance' : 'against_bill'),
            mode: p.mode,
            date: p.date || b.date,
            amount: p.amount,
            billNo: b.billNo,
            note: p.note || (p.mode.toLowerCase() === 'advance' ? 'Advance recorded on purchase bill' : ''),
          });
        });
      });

    txns
      .filter((t) => String(t.supplier) === id)
      .forEach((t) => all.push({
        ...t,
        _id: String(t._id),
        source: 'manual',
        type: 'payment',
        date: t.date || t.createdAt || new Date(),
        amount: num(t.amount),
      }));

    const order = { purchase: 0, credit: 1, payment: 2 };
    all.sort((a, b) => new Date(a.date) - new Date(b.date) || (order[a.type] ?? 2) - (order[b.type] ?? 2));

    let running = num(supplier.openingBalance);
    const withBalance = all.map((t) => {
      running += t.type === 'purchase' || t.type === 'credit' ? num(t.amount) : -num(t.amount);
      return { ...t, balanceAfter: round(running) };
    });

    // Date filter uses Indian Standard Time (IST) so late-evening entries stay on the correct day.
    const fromD = req.query.from ? new Date(req.query.from + 'T00:00:00+05:30') : null;
    const toD = req.query.to ? new Date(req.query.to + 'T23:59:59.999+05:30') : null;
    const entries = withBalance.filter((t) =>
      (!fromD || new Date(t.date) >= fromD) &&
      (!toD || new Date(t.date) <= toD)
    );

    res.json({ supplier, summary: summarize(supplier, agg[id]), entries });
  } catch (err) {
    console.error('Supplier ledger load error:', err);
    res.status(500).json({ message: err.message });
  }
});

/* ---------- Extra payments (Dr) added from the ledger page ---------- */
router.post('/:id/transactions', async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return res.status(404).json({ message: 'Supplier not found' });

    const b = req.body;
    if (!(num(b.amount) > 0)) return res.status(400).json({ message: 'Amount must be greater than 0' });

    const txn = await Txn.create({
      supplier: supplier._id,
      type: 'payment',
      date: b.date ? new Date(b.date) : new Date(),
      amount: num(b.amount),
      paymentKind: b.paymentKind || 'against_bill',
      mode: b.mode || 'cash',
      reference: b.reference,
      chequeDate: b.chequeDate ? new Date(b.chequeDate) : undefined,
      note: b.note,
    });
    res.status(201).json(txn);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/transactions/:txId', async (req, res) => {
  try {
    const b = req.body;
    if (!(num(b.amount) > 0)) return res.status(400).json({ message: 'Amount must be greater than 0' });

    const t = await Txn.findById(req.params.txId);
    if (!t) return res.status(404).json({ message: 'Entry not found' });

    t.date = b.date ? new Date(b.date) : t.date;
    t.amount = num(b.amount);
    t.paymentKind = b.paymentKind || t.paymentKind;
    t.mode = b.mode || t.mode;
    t.reference = b.reference;
    t.chequeDate = b.chequeDate ? new Date(b.chequeDate) : undefined;
    t.note = b.note;
    await t.save();
    res.json(t);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/transactions/:txId', async (req, res) => {
  try {
    const t = await Txn.findByIdAndDelete(req.params.txId);
    if (!t) return res.status(404).json({ message: 'Entry not found' });
    res.json({ message: 'Entry deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
