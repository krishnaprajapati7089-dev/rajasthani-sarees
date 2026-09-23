// routes/dashboard.js — one call to feed the owner dashboard screen
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

    // Stock value on hand is valued at cost (purchase_price), not at MRP —
    // MRP is what you'd sell it for, not what it cost you, so pricing this
    // by selling_price overstated the value of goods actually on the shelf.
    const [stockAgg] = await Product.aggregate([
      { $match: { active: true } },
      { $group: {
          _id: null,
          value: { $sum: { $multiply: ['$stock_qty', '$purchase_price'] } },
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
