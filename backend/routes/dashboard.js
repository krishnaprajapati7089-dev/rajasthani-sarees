// routes/dashboard.js — one call to feed the owner dashboard screen
// (converted from the original better-sqlite3 version to Mongoose)
const express = require('express');
const Bill = require('../models/Bill');
const Product = require('../models/Product');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const [todaySalesAgg] = await Bill.aggregate([
      { $match: { status: 'ACTIVE', bill_date: { $gte: startOfDay, $lte: endOfDay } } },
      { $group: { _id: null, total: { $sum: '$grand_total' }, bill_count: { $sum: 1 } } }
    ]);

    const [stockAgg] = await Product.aggregate([
      { $match: { active: true } },
      { $group: {
          _id: null,
          value: { $sum: { $multiply: ['$stock_qty', '$selling_price'] } },
          pieces: { $sum: '$stock_qty' }
        }
      }
    ]);

    const lowStock = await Product.find({
      active: true,
      $expr: { $lte: ['$stock_qty', '$reorder_level'] }
    }).sort({ stock_qty: 1 }).limit(10)
      .select('name stock_qty reorder_level');

    const recentBills = await Bill.find({ status: 'ACTIVE' })
      .sort({ createdAt: -1 }).limit(6)
      .select('invoice_no customer_name grand_total payment_status bill_date');

    res.json({
      today_sales: todaySalesAgg?.total || 0,
      bills_today: todaySalesAgg?.bill_count || 0,
      stock_value: stockAgg?.value || 0,
      stock_pieces: stockAgg?.pieces || 0,
      low_stock_count: lowStock.length,
      low_stock: lowStock,
      recent_bills: recentBills
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
