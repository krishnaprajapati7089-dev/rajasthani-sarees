// routes/dashboard.js
// One API call to feed the owner dashboard screen

const express = require("express");

const Bill = require("../models/Bill");
const Product = require("../models/Product");

const router = express.Router();


router.get("/", async (req, res) => {

  try {

    // ================= TODAY =================

    const startOfDay = new Date();

    startOfDay.setHours(
      0,
      0,
      0,
      0
    );


    const endOfDay = new Date();

    endOfDay.setHours(
      23,
      59,
      59,
      999
    );


    // ================= TODAY'S SALES =================

    const [todaySalesAgg] =
      await Bill.aggregate([

        {
          $match: {
            status: "ACTIVE",
            bill_date: {
              $gte: startOfDay,
              $lte: endOfDay
            }
          }
        },

        {
          $group: {
            _id: null,

            total: {
              $sum: "$grand_total"
            },

            bill_count: {
              $sum: 1
            }
          }
        }

      ]);


    // ================= STOCK VALUE =================

    // Stock value is calculated using
    // purchase_price (cost price), NOT MRP.

    const [stockAgg] =
      await Product.aggregate([

        {
          $match: {
            active: true
          }
        },

        {
          $group: {

            _id: null,

            value: {
              $sum: {
                $multiply: [
                  "$stock_qty",
                  "$purchase_price"
                ]
              }
            },

            pieces: {
              $sum: "$stock_qty"
            }

          }
        }

      ]);


    // ================= LOW STOCK =================

    // Dashboard displays only the first 5
    // low-stock products.
    //
    // The complete inventory remains available
    // on inventory.html.

    const lowStock =
      await Product.find({

        active: true,

        $expr: {
          $lte: [
            "$stock_qty",
            "$reorder_level"
          ]
        }

      })
      .sort({
        stock_qty: 1
      })
      .limit(5)
      .select(
        "name stock_qty reorder_level"
      );


    // ================= RECENT BILLS =================

    const recentBills =
      await Bill.find({
        status: "ACTIVE"
      })
      .sort({
        createdAt: -1
      })
      .limit(6)
      .select(
        "invoice_no customer_name grand_total payment_status bill_date"
      );


    // ================= RESPONSE =================

    res.json({

      today_sales:
        todaySalesAgg?.total || 0,

      bills_today:
        todaySalesAgg?.bill_count || 0,

      stock_value:
        stockAgg?.value || 0,

      stock_pieces:
        stockAgg?.pieces || 0,

      low_stock_count:
        lowStock.length,

      low_stock:
        lowStock,

      recent_bills:
        recentBills

    });


  } catch (err) {

    console.error(
      "Dashboard API error:",
      err
    );

    res.status(500).json({
      error: err.message
    });

  }

});


module.exports = router;
