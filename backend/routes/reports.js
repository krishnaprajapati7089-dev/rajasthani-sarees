// routes/reports.js — daily sales report + GST return-ready summaries
// (converted from the original better-sqlite3 version to Mongoose)
const express = require('express');
const Bill = require('../models/Bill');

const router = express.Router();

function dayRange(dateStr) {
  const start = new Date(dateStr + 'T00:00:00');
  const end = new Date(dateStr + 'T23:59:59.999');
  return { start, end };
}

// GET /api/reports/daily?date=2026-09-14  (defaults to today)
router.get('/daily', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const { start, end } = dayRange(date);
    const match = { status: 'ACTIVE', bill_date: { $gte: start, $lte: end } };

    const [summaryAgg] = await Bill.aggregate([
      { $match: match },
      { $group: {
          _id: null,
          bill_count: { $sum: 1 },
          total_sales: { $sum: '$grand_total' },
          total_taxable_value: { $sum: '$taxable_value' },
          total_cgst: { $sum: '$cgst_amount' },
          total_sgst: { $sum: '$sgst_amount' },
          total_igst: { $sum: '$igst_amount' },
          total_collected: { $sum: '$paid_amount' }
        }
      }
    ]);

    const byPaymentMode = await Bill.aggregate([
      { $match: match },
      { $group: { _id: '$payment_mode', bill_count: { $sum: 1 }, total: { $sum: '$grand_total' } } },
      { $project: { _id: 0, payment_mode: '$_id', bill_count: 1, total: 1 } }
    ]);

    const topProducts = await Bill.aggregate([
      { $match: match },
      { $unwind: '$items' },
      { $group: {
          _id: '$items.product_id',
          product_name: { $first: '$items.product_name' },
          qty_sold: { $sum: '$items.qty' },
          revenue: { $sum: '$items.line_total' }
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
      { $project: { _id: 0, product_name: 1, qty_sold: 1, revenue: 1 } }
    ]);

    const bills = await Bill.find(match)
      .sort({ createdAt: -1 })
      .select('invoice_no customer_name grand_total payment_mode payment_status bill_date');

    res.json({
      date,
      summary: summaryAgg || {
        bill_count: 0, total_sales: 0, total_taxable_value: 0,
        total_cgst: 0, total_sgst: 0, total_igst: 0, total_collected: 0
      },
      byPaymentMode,
      topProducts,
      bills
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/sales-trend?days=7 — for dashboard chart
router.get('/sales-trend', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 7, 90);
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    from.setHours(0, 0, 0, 0);

    const rows = await Bill.aggregate([
      { $match: { status: 'ACTIVE', bill_date: { $gte: from } } },
      { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$bill_date' } },
          total: { $sum: '$grand_total' }
        }
      }
    ]);
    const byDay = Object.fromEntries(rows.map(r => [r._id, r.total]));

    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      result.push({ date: key, total: byDay[key] || 0 });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reports/gst?month=9&year=2026
 * A GSTR-1-style monthly summary: total taxable value, CGST, SGST, IGST,
 * split by B2B (customer has a GSTIN) vs B2C, plus an HSN-wise breakup —
 * the two things you (or your accountant) need to file the return.
 */
router.get('/gst', async (req, res) => {
  try {
    const now = new Date();
    const month = parseInt(req.query.month, 10) || now.getMonth() + 1;
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const from = new Date(year, month - 1, 1, 0, 0, 0);
    const to = new Date(year, month, 0, 23, 59, 59, 999); // last day of month

    const base = { status: 'ACTIVE', bill_date: { $gte: from, $lte: to } };

    const groupTotals = {
      _id: null,
      bill_count: { $sum: 1 },
      taxable_value: { $sum: '$taxable_value' },
      cgst: { $sum: '$cgst_amount' },
      sgst: { $sum: '$sgst_amount' },
      igst: { $sum: '$igst_amount' },
      grand_total: { $sum: '$grand_total' }
    };

    const [totals] = await Bill.aggregate([{ $match: base }, { $group: groupTotals }]);

    const [b2b] = await Bill.aggregate([
      { $match: { ...base, customer_gstin: { $exists: true, $ne: '' } } },
      { $group: groupTotals }
    ]);

    const [b2c] = await Bill.aggregate([
      { $match: { ...base, $or: [{ customer_gstin: { $exists: false } }, { customer_gstin: '' }] } },
      { $group: groupTotals }
    ]);

    // HSN Summary of Outward Supplies (GSTR-1 Table 12)
    const hsnSummary = await Bill.aggregate([
      { $match: base },
      { $unwind: '$items' },
      { $group: {
          _id: { hsn_code: '$items.hsn_code', gst_rate: '$items.gst_rate' },
          total_qty: { $sum: '$items.qty' },
          taxable_value: { $sum: '$items.taxable_value' },
          cgst: { $sum: '$items.cgst_amount' },
          sgst: { $sum: '$items.sgst_amount' },
          igst: { $sum: '$items.igst_amount' }
        }
      },
      { $sort: { '_id.hsn_code': 1 } },
      { $project: {
          _id: 0, hsn_code: '$_id.hsn_code', gst_rate: '$_id.gst_rate',
          total_qty: 1, taxable_value: 1, cgst: 1, sgst: 1, igst: 1
        }
      }
    ]);

    // Rate-wise summary
    const rateSummary = await Bill.aggregate([
      { $match: base },
      { $unwind: '$items' },
      { $group: {
          _id: '$items.gst_rate',
          taxable_value: { $sum: '$items.taxable_value' },
          cgst: { $sum: '$items.cgst_amount' },
          sgst: { $sum: '$items.sgst_amount' },
          igst: { $sum: '$items.igst_amount' }
        }
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, gst_rate: '$_id', taxable_value: 1, cgst: 1, sgst: 1, igst: 1 } }
    ]);

    const empty = { bill_count: 0, taxable_value: 0, cgst: 0, sgst: 0, igst: 0, grand_total: 0 };

    res.json({
      period: { month, year, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      totals: totals || empty,
      b2b: b2b || empty,
      b2c: b2c || empty,
      hsnSummary,
      rateSummary
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
