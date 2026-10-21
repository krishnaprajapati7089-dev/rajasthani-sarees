// routes/reports.js
// MongoDB / Mongoose reports
// Daily Sales + Sales Trend + GST Reports + Sales Returns & Exchanges
// India timezone: Asia/Kolkata

const express = require('express');
const mongoose = require('mongoose');
const Bill = require('../models/Bill');

const router = express.Router();

const INDIA_TIMEZONE = 'Asia/Kolkata';

/* =========================================================
   HELPERS
========================================================= */

/**
 * Convert YYYY-MM-DD India date into UTC Date boundaries.
 *
 * Example:
 * 2026-09-30
 *
 * Start:
 * 2026-09-29T18:30:00.000Z
 *
 * End:
 * 2026-09-30T18:29:59.999Z
 */
function indiaDayRange(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error('Invalid date format. Expected YYYY-MM-DD');
  }

  const [year, month, day] = dateStr.split('-').map(Number);

  // India is UTC+05:30
  const start = new Date(
    Date.UTC(year, month - 1, day, 0, 0, 0, 0) - (5.5 * 60 * 60 * 1000)
  );

  const end = new Date(
    Date.UTC(year, month - 1, day, 23, 59, 59, 999) - (5.5 * 60 * 60 * 1000)
  );

  return { start, end };
}


/**
 * Get current date in India as YYYY-MM-DD
 */
function getIndiaDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: INDIA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}


/**
 * Get month boundaries using India calendar.
 */
function indiaMonthRange(year, month) {
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;

  const daysInMonth = new Date(
    Date.UTC(year, month, 0)
  ).getUTCDate();

  const lastDay =
    `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  const startRange = indiaDayRange(firstDay);
  const endRange = indiaDayRange(lastDay);

  return {
    start: startRange.start,
    end: endRange.end,
    from: firstDay,
    to: lastDay
  };
}


/**
 * Safe number helper
 */
function num(value) {
  return Number(value) || 0;
}


/**
 * Empty report summary
 */
function emptySummary() {
  return {
    bill_count: 0,
    total_sales: 0,
    total_taxable_value: 0,
    total_cgst: 0,
    total_sgst: 0,
    total_igst: 0,
    total_collected: 0
  };
}


/**
 * Empty GST summary
 */
function emptyGstSummary() {
  return {
    bill_count: 0,
    taxable_value: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    grand_total: 0
  };
}


/* =========================================================
   DAILY REPORT
   GET /api/reports/daily?date=2026-09-30
========================================================= */

router.get('/daily', async (req, res) => {
  try {
    const date =
      req.query.date ||
      getIndiaDateString();

    const { start, end } = indiaDayRange(date);

    const match = {
      status: 'ACTIVE',
      bill_date: {
        $gte: start,
        $lte: end
      }
    };


    /* -----------------------------------------
       SUMMARY
    ----------------------------------------- */

    const [summaryAgg] = await Bill.aggregate([
      {
        $match: match
      },
      {
        $group: {
          _id: null,

          bill_count: {
            $sum: 1
          },

          total_sales: {
            $sum: {
              $ifNull: ['$grand_total', 0]
            }
          },

          total_taxable_value: {
            $sum: {
              $ifNull: ['$taxable_value', 0]
            }
          },

          total_cgst: {
            $sum: {
              $ifNull: ['$cgst_amount', 0]
            }
          },

          total_sgst: {
            $sum: {
              $ifNull: ['$sgst_amount', 0]
            }
          },

          total_igst: {
            $sum: {
              $ifNull: ['$igst_amount', 0]
            }
          },

          total_collected: {
            $sum: {
              $ifNull: ['$paid_amount', 0]
            }
          }
        }
      }
    ]);


    /* -----------------------------------------
       PAYMENT MODE
    ----------------------------------------- */

    const byPaymentMode = await Bill.aggregate([
      {
        $match: match
      },

      {
        $group: {
          _id: {
            $ifNull: ['$payment_mode', 'Cash']
          },

          bill_count: {
            $sum: 1
          },

          total: {
            $sum: {
              $ifNull: ['$grand_total', 0]
            }
          }
        }
      },

      {
        $project: {
          _id: 0,

          payment_mode: '$_id',

          bill_count: 1,

          total: 1
        }
      },

      {
        $sort: {
          total: -1
        }
      }
    ]);


    /* -----------------------------------------
       TOP PRODUCTS
    ----------------------------------------- */

    const topProducts = await Bill.aggregate([
      {
        $match: match
      },

      {
        $unwind: {
          path: '$items',
          preserveNullAndEmptyArrays: false
        }
      },

      {
        $group: {
          _id: '$items.product_id',

          product_name: {
            $first: '$items.product_name'
          },

          qty_sold: {
            $sum: {
              $ifNull: ['$items.qty', 0]
            }
          },

          revenue: {
            $sum: {
              $ifNull: ['$items.line_total', 0]
            }
          }
        }
      },

      {
        $sort: {
          revenue: -1
        }
      },

      {
        $limit: 10
      },

      {
        $project: {
          _id: 0,

          product_name: 1,

          qty_sold: 1,

          revenue: 1
        }
      }
    ]);


    /* -----------------------------------------
       BILLS
    ----------------------------------------- */

    const bills = await Bill.find(match)
      .sort({
        bill_date: -1,
        createdAt: -1
      })
      .select(
        'invoice_no customer_name customer_phone grand_total payment_mode payment_status bill_date createdAt'
      )
      .lean();


    /* -----------------------------------------
       RESPONSE
    ----------------------------------------- */

    res.json({
      date,

      summary:
        summaryAgg ||
        emptySummary(),

      byPaymentMode,

      topProducts,

      bills
    });

  } catch (err) {

    console.error(
      'Daily reports error:',
      err
    );

    res.status(500).json({
      error: 'Failed to generate daily report',
      message: err.message
    });
  }
});


/* =========================================================
   SALES TREND
   GET /api/reports/sales-trend?days=7
========================================================= */

router.get('/sales-trend', async (req, res) => {
  try {

    let days =
      parseInt(req.query.days, 10) || 7;

    // Keep the request safe.
    days = Math.max(
      1,
      Math.min(days, 90)
    );


    /*
      Determine the India calendar dates.
    */

    const todayIndia =
      getIndiaDateString();

    const [year, month, day] =
      todayIndia.split('-').map(Number);


    /*
      Create today's date as a UTC calendar date
      purely for calculating previous calendar days.
    */

    const todayCalendar =
      new Date(
        Date.UTC(
          year,
          month - 1,
          day
        )
      );


    const firstCalendarDay =
      new Date(todayCalendar);

    firstCalendarDay.setUTCDate(
      firstCalendarDay.getUTCDate() - (days - 1)
    );


    const firstDateString =
      `${firstCalendarDay.getUTCFullYear()}-` +
      `${String(firstCalendarDay.getUTCMonth() + 1).padStart(2, '0')}-` +
      `${String(firstCalendarDay.getUTCDate()).padStart(2, '0')}`;


    const {
      start: from
    } = indiaDayRange(firstDateString);


    /*
      MongoDB groups using India timezone.
    */

    const rows = await Bill.aggregate([

      {
        $match: {
          status: 'ACTIVE',

          bill_date: {
            $gte: from
          }
        }
      },

      {
        $group: {

          _id: {
            $dateToString: {
              format: '%Y-%m-%d',

              date: '$bill_date',

              timezone: INDIA_TIMEZONE
            }
          },

          total: {
            $sum: {
              $ifNull: ['$grand_total', 0]
            }
          },

          bill_count: {
            $sum: 1
          }
        }
      },

      {
        $sort: {
          _id: 1
        }
      }

    ]);


    const byDay =
      Object.fromEntries(
        rows.map(row => [
          row._id,
          {
            total: num(row.total),
            bill_count: num(row.bill_count)
          }
        ])
      );


    /*
      Fill missing dates with zero.
    */

    const result = [];

    for (let i = 0; i < days; i++) {

      const current =
        new Date(firstCalendarDay);

      current.setUTCDate(
        current.getUTCDate() + i
      );


      const key =
        `${current.getUTCFullYear()}-` +
        `${String(current.getUTCMonth() + 1).padStart(2, '0')}-` +
        `${String(current.getUTCDate()).padStart(2, '0')}`;


      const found =
        byDay[key] || {
          total: 0,
          bill_count: 0
        };


      result.push({
        date: key,

        total: found.total,

        bill_count: found.bill_count
      });
    }


    res.json(result);

  } catch (err) {

    console.error(
      'Sales trend error:',
      err
    );

    res.status(500).json({
      error: 'Failed to generate sales trend',
      message: err.message
    });
  }
});


/* =========================================================
   GST REPORT
   GET /api/reports/gst?month=9&year=2026
========================================================= */

router.get('/gst', async (req, res) => {

  try {

    const now =
      new Date();


    let month =
      parseInt(req.query.month, 10);

    let year =
      parseInt(req.query.year, 10);


    /*
      Default to current India month/year.
    */

    if (
      !month ||
      month < 1 ||
      month > 12
    ) {
      month =
        parseInt(
          new Intl.DateTimeFormat(
            'en-US',
            {
              timeZone: INDIA_TIMEZONE,
              month: 'numeric'
            }
          ).format(now),
          10
        );
    }


    if (
      !year ||
      year < 2000 ||
      year > 2100
    ) {
      year =
        parseInt(
          new Intl.DateTimeFormat(
            'en-US',
            {
              timeZone: INDIA_TIMEZONE,
              year: 'numeric'
            }
          ).format(now),
          10
        );
    }


    const {
      start,
      end,
      from,
      to
    } =
      indiaMonthRange(
        year,
        month
      );


    const base = {

      status: 'ACTIVE',

      bill_date: {
        $gte: start,
        $lte: end
      }

    };


    /* -----------------------------------------
       COMMON GROUP
    ----------------------------------------- */

    const groupTotals = {

      _id: null,

      bill_count: {
        $sum: 1
      },

      taxable_value: {
        $sum: {
          $ifNull: ['$taxable_value', 0]
        }
      },

      cgst: {
        $sum: {
          $ifNull: ['$cgst_amount', 0]
        }
      },

      sgst: {
        $sum: {
          $ifNull: ['$sgst_amount', 0]
        }
      },

      igst: {
        $sum: {
          $ifNull: ['$igst_amount', 0]
        }
      },

      grand_total: {
        $sum: {
          $ifNull: ['$grand_total', 0]
        }
      }

    };


    /* -----------------------------------------
       TOTALS
    ----------------------------------------- */

    const [
      totalsResult,

      b2bResult,

      b2cResult,

      hsnSummary,

      rateSummary
    ] = await Promise.all([

      /* TOTALS */

      Bill.aggregate([
        {
          $match: base
        },

        {
          $group: groupTotals
        }
      ]),


      /* B2B */

      Bill.aggregate([

        {
          $match: {
            ...base,

            customer_gstin: {
              $exists: true,

              $type: 'string',

              $regex: /\S/
            }
          }
        },

        {
          $group: groupTotals
        }

      ]),


      /* B2C */

      Bill.aggregate([

        {
          $match: {
            ...base,

            $or: [

              {
                customer_gstin: {
                  $exists: false
                }
              },

              {
                customer_gstin: null
              },

              {
                customer_gstin: ''
              },

              {
                customer_gstin: {
                  $type: 'string',

                  $not: /\S/
                }
              }

            ]
          }
        },

        {
          $group: groupTotals
        }

      ]),


      /* HSN SUMMARY */

      Bill.aggregate([

        {
          $match: base
        },

        {
          $unwind: {
            path: '$items',

            preserveNullAndEmptyArrays: false
          }
        },

        {
          $group: {

            _id: {

              hsn_code: {
                $ifNull: [
                  '$items.hsn_code',
                  ''
                ]
              },

              gst_rate: {
                $ifNull: [
                  '$items.gst_rate',
                  0
                ]
              }

            },

            total_qty: {
              $sum: {
                $ifNull: [
                  '$items.qty',
                  0
                ]
              }
            },

            taxable_value: {
              $sum: {
                $ifNull: [
                  '$items.taxable_value',
                  0
                ]
              }
            },

            cgst: {
              $sum: {
                $ifNull: [
                  '$items.cgst_amount',
                  0
                ]
              }
            },

            sgst: {
              $sum: {
                $ifNull: [
                  '$items.sgst_amount',
                  0
                ]
              }
            },

            igst: {
              $sum: {
                $ifNull: [
                  '$items.igst_amount',
                  0
                ]
              }
            }

          }
        },

        {
          $sort: {
            '_id.hsn_code': 1,

            '_id.gst_rate': 1
          }
        },

        {
          $project: {

            _id: 0,

            hsn_code:
              '$_id.hsn_code',

            gst_rate:
              '$_id.gst_rate',

            total_qty: 1,

            taxable_value: 1,

            cgst: 1,

            sgst: 1,

            igst: 1

          }
        }

      ]),


      /* GST RATE SUMMARY */

      Bill.aggregate([

        {
          $match: base
        },

        {
          $unwind: {
            path: '$items',

            preserveNullAndEmptyArrays: false
          }
        },

        {
          $group: {

            _id: {
              $ifNull: [
                '$items.gst_rate',
                0
              ]
            },

            taxable_value: {
              $sum: {
                $ifNull: [
                  '$items.taxable_value',
                  0
                ]
              }
            },

            cgst: {
              $sum: {
                $ifNull: [
                  '$items.cgst_amount',
                  0
                ]
              }
            },

            sgst: {
              $sum: {
                $ifNull: [
                  '$items.sgst_amount',
                  0
                ]
              }
            },

            igst: {
              $sum: {
                $ifNull: [
                  '$items.igst_amount',
                  0
                ]
              }
            }

          }
        },

        {
          $sort: {
            _id: 1
          }
        },

        {
          $project: {

            _id: 0,

            gst_rate:
              '$_id',

            taxable_value: 1,

            cgst: 1,

            sgst: 1,

            igst: 1

          }
        }

      ])

    ]);


    const totals =
      totalsResult[0] ||
      emptyGstSummary();


    const b2b =
      b2bResult[0] ||
      emptyGstSummary();


    const b2c =
      b2cResult[0] ||
      emptyGstSummary();


    /* -----------------------------------------
       RESPONSE
    ----------------------------------------- */

    res.json({

      period: {

        month,

        year,

        from,

        to

      },

      totals,

      b2b,

      b2c,

      hsnSummary,

      rateSummary

    });

  } catch (err) {

    console.error(
      'GST report error:',
      err
    );

    res.status(500).json({

      error: 'Failed to generate GST report',

      message: err.message

    });

  }

});


/* =========================================================
   SALES RETURNS & EXCHANGES  (NEW)

   Returns are stored in their own collection (salesreturns).
   The original Bill document is never read-modified or written:
   its bill_date, totals and payments stay exactly as billed.

   GET  /api/reports/returns
        optional: ?from=YYYY-MM-DD&to=YYYY-MM-DD   (on return date)
                  ?invoice_no=INV-000123
                  ?bill_id=<Bill _id>
                  ?limit=2000   (max 5000)
   POST /api/reports/returns
        body: {
          invoice_no,            // original invoice number
          return_type,           // 'EXCHANGE' | 'CASH REFUND'
          return_amount,         // value of the returned saree(s)
          refund_amount,         // cash actually paid back (0 for exchange)
          notes,                 // optional
          client_request_id      // optional, prevents double submits
        }

   Inventory is NOT touched here. A return records a value only,
   not which products/quantities came back, so stock cannot be
   restored safely from this data alone.
========================================================= */

const salesReturnSchema = new mongoose.Schema(
  {
    original_bill_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bill',
      required: true,
      index: true
    },

    original_invoice_no: {
      type: String,
      required: true,
      index: true
    },

    // Copied from the original bill. Never edited afterwards.
    original_bill_date: {
      type: Date,
      required: true
    },

    // When the return actually happened.
    return_date: {
      type: Date,
      default: Date.now,
      index: true
    },

    customer_name: {
      type: String,
      default: 'Walk-in Customer'
    },

    customer_phone: {
      type: String,
      default: ''
    },

    // Value of the saree(s) returned (what is credited back).
    return_amount: {
      type: Number,
      required: true,
      min: 0.01
    },

    return_type: {
      type: String,
      enum: ['EXCHANGE', 'CASH REFUND'],
      required: true
    },

    // Real cash handed back to the customer.
    refund_amount: {
      type: Number,
      default: 0,
      min: 0
    },

    notes: {
      type: String,
      default: '',
      maxlength: 300
    },

    status: {
      type: String,
      enum: ['ACTIVE', 'CANCELLED'],
      default: 'ACTIVE',
      index: true
    },

    // Optional token sent by the browser to stop double submissions.
    client_request_id: {
      type: String
    }
  },
  {
    timestamps: true
  }
);

salesReturnSchema.index(
  { client_request_id: 1 },
  {
    unique: true,
    partialFilterExpression: {
      client_request_id: { $type: 'string' }
    }
  }
);

// Guard against "OverwriteModelError" if the model is loaded twice.
const SalesReturn =
  mongoose.models.SalesReturn ||
  mongoose.model('SalesReturn', salesReturnSchema);


/* -----------------------------------------
   RETURN HELPERS
----------------------------------------- */

function roundMoney(value) {
  return Math.round(
    (Number(value) + Number.EPSILON) * 100
  ) / 100;
}


function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


/**
 * Find the original bill from what the user typed.
 * Accepts "INV-000123", "inv-000123", "#INV-000123"
 * or just the number "123".
 */
async function findBillByInvoiceInput(input) {
  const raw = String(input || '')
    .trim()
    .replace(/^#/, '')
    .trim();

  if (!raw) {
    return null;
  }

  let bill = await Bill.findOne({
    invoice_no: new RegExp(`^${escapeRegex(raw)}$`, 'i')
  });

  if (!bill && /^\d+$/.test(raw)) {
    bill = await Bill.findOne({
      invoice_no: `INV-${raw.padStart(6, '0')}`
    });
  }

  return bill;
}


/**
 * Total value already returned (ACTIVE returns only) for one bill.
 */
async function sumReturnedForBill(billId) {
  const [row] = await SalesReturn.aggregate([
    {
      $match: {
        original_bill_id: new mongoose.Types.ObjectId(String(billId)),
        status: 'ACTIVE'
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$return_amount' }
      }
    }
  ]);

  return roundMoney(row ? row.total : 0);
}


/* =========================================================
   RETURNS LIST
   GET /api/reports/returns
========================================================= */

router.get('/returns', async (req, res) => {
  try {
    const query = {
      status: 'ACTIVE'
    };

    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();

    if (
      (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) ||
      (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))
    ) {
      return res.status(400).json({
        error: 'Invalid date. Use YYYY-MM-DD for from and to.'
      });
    }

    if (from || to) {
      query.return_date = {};

      if (from) {
        query.return_date.$gte = indiaDayRange(from).start;
      }

      if (to) {
        query.return_date.$lte = indiaDayRange(to).end;
      }
    }

    const invoiceNo = String(req.query.invoice_no || '')
      .trim()
      .replace(/^#/, '');

    if (invoiceNo) {
      query.original_invoice_no = new RegExp(
        `^${escapeRegex(invoiceNo)}$`,
        'i'
      );
    }

    if (req.query.bill_id) {
      if (!mongoose.Types.ObjectId.isValid(String(req.query.bill_id))) {
        return res.status(400).json({
          error: 'Invalid bill_id'
        });
      }

      query.original_bill_id = new mongoose.Types.ObjectId(
        String(req.query.bill_id)
      );
    }

    const limit = Math.max(
      1,
      Math.min(parseInt(req.query.limit, 10) || 2000, 5000)
    );

    const returns = await SalesReturn.find(query)
      .sort({
        return_date: -1,
        createdAt: -1
      })
      .limit(limit)
      .lean();

    const [summaryAgg] = await SalesReturn.aggregate([
      {
        $match: query
      },
      {
        $group: {
          _id: null,

          return_count: {
            $sum: 1
          },

          total_returned_value: {
            $sum: {
              $ifNull: ['$return_amount', 0]
            }
          },

          total_cash_refunds: {
            $sum: {
              $ifNull: ['$refund_amount', 0]
            }
          },

          exchange_count: {
            $sum: {
              $cond: [{ $eq: ['$return_type', 'EXCHANGE'] }, 1, 0]
            }
          },

          cash_refund_count: {
            $sum: {
              $cond: [{ $eq: ['$return_type', 'CASH REFUND'] }, 1, 0]
            }
          },

          exchange_value: {
            $sum: {
              $cond: [
                { $eq: ['$return_type', 'EXCHANGE'] },
                { $ifNull: ['$return_amount', 0] },
                0
              ]
            }
          }
        }
      }
    ]);

    res.json({
      returns,

      summary: {
        return_count: summaryAgg ? summaryAgg.return_count : 0,
        total_returned_value: roundMoney(summaryAgg ? summaryAgg.total_returned_value : 0),
        total_cash_refunds: roundMoney(summaryAgg ? summaryAgg.total_cash_refunds : 0),
        exchange_count: summaryAgg ? summaryAgg.exchange_count : 0,
        cash_refund_count: summaryAgg ? summaryAgg.cash_refund_count : 0,
        exchange_value: roundMoney(summaryAgg ? summaryAgg.exchange_value : 0)
      }
    });

  } catch (err) {

    console.error(
      'Returns list error:',
      err
    );

    res.status(500).json({
      error: 'Failed to load returns',
      message: err.message
    });
  }
});


/* =========================================================
   RECORD A RETURN / EXCHANGE
   POST /api/reports/returns
========================================================= */

router.post('/returns', async (req, res) => {
  try {
    const body = req.body || {};

    /* -----------------------------------------
       VALIDATE INPUT
    ----------------------------------------- */

    const invoiceInput =
      body.invoice_no ??
      body.original_invoice_no;

    if (!String(invoiceInput || '').trim()) {
      return res.status(400).json({
        error: 'Original invoice number is required'
      });
    }

    const returnType = String(body.return_type || '')
      .trim()
      .toUpperCase()
      .replace(/[_-]+/g, ' ');

    if (!['EXCHANGE', 'CASH REFUND'].includes(returnType)) {
      return res.status(400).json({
        error: 'Return type must be EXCHANGE or CASH REFUND'
      });
    }

    const returnAmountRaw = Number(body.return_amount);

    if (!Number.isFinite(returnAmountRaw) || returnAmountRaw <= 0) {
      return res.status(400).json({
        error: 'Returned saree value must be greater than ₹0'
      });
    }

    const returnAmount = roundMoney(returnAmountRaw);

    const refundRaw =
      body.refund_amount === undefined ||
      body.refund_amount === null ||
      body.refund_amount === ''
        ? 0
        : Number(body.refund_amount);

    if (!Number.isFinite(refundRaw) || refundRaw < 0) {
      return res.status(400).json({
        error: 'Cash refund must be a valid amount of ₹0 or more'
      });
    }

    const refundAmount = roundMoney(refundRaw);

    if (returnType === 'EXCHANGE' && refundAmount > 0) {
      return res.status(400).json({
        error: 'An exchange cannot have a cash refund. Choose Cash Refund to pay money back.'
      });
    }

    if (returnType === 'CASH REFUND' && refundAmount <= 0) {
      return res.status(400).json({
        error: 'Enter the actual cash refunded for a cash refund'
      });
    }

    if (refundAmount > returnAmount + 0.001) {
      return res.status(400).json({
        error: 'Cash refund cannot be greater than the returned saree value'
      });
    }

    const notes = String(body.notes ?? '')
      .trim()
      .slice(0, 300);

    const clientRequestId = String(body.client_request_id ?? '')
      .trim()
      .slice(0, 100);


    /* -----------------------------------------
       DUPLICATE SUBMISSION (same browser token)
    ----------------------------------------- */

    if (clientRequestId) {
      const existing = await SalesReturn.findOne({
        client_request_id: clientRequestId
      }).lean();

      if (existing) {
        return res.json({
          message: 'This return was already recorded.',
          duplicate: true,
          return: existing
        });
      }
    }


    /* -----------------------------------------
       ORIGINAL BILL
    ----------------------------------------- */

    const bill = await findBillByInvoiceInput(invoiceInput);

    if (!bill) {
      return res.status(404).json({
        error: `Original invoice not found: ${String(invoiceInput).trim()}`
      });
    }

    if (String(bill.status || 'ACTIVE').toUpperCase() === 'CANCELLED') {
      return res.status(400).json({
        error: `Invoice ${bill.invoice_no} is cancelled and cannot be returned`
      });
    }

    const billTotal = roundMoney(bill.grand_total);

    if (!(billTotal > 0)) {
      return res.status(400).json({
        error: `Invoice ${bill.invoice_no} has no billed value to return`
      });
    }


    /* -----------------------------------------
       CUMULATIVE LIMIT
    ----------------------------------------- */

    const alreadyReturned = await sumReturnedForBill(bill._id);
    const remaining = roundMoney(billTotal - alreadyReturned);

    if (returnAmount > remaining + 0.001) {
      return res.status(400).json({
        error:
          `Return value ₹${returnAmount.toFixed(2)} exceeds what can still be returned ` +
          `on ${bill.invoice_no}. Bill total ₹${billTotal.toFixed(2)}, ` +
          `already returned ₹${alreadyReturned.toFixed(2)}, ` +
          `remaining ₹${Math.max(0, remaining).toFixed(2)}.`
      });
    }


    /* -----------------------------------------
       ACCIDENTAL DOUBLE CLICK (no token sent)
    ----------------------------------------- */

    const recentDuplicate = await SalesReturn.findOne({
      original_bill_id: bill._id,
      return_type: returnType,
      return_amount: returnAmount,
      refund_amount: refundAmount,
      status: 'ACTIVE',
      createdAt: {
        $gte: new Date(Date.now() - 30 * 1000)
      }
    }).lean();

    if (recentDuplicate) {
      return res.status(409).json({
        error: 'An identical return was recorded for this invoice a few seconds ago. Not saved again.'
      });
    }


    /* -----------------------------------------
       SAVE  (original bill is only read, never changed)
    ----------------------------------------- */

    let saved;

    try {
      saved = await SalesReturn.create({
        original_bill_id: bill._id,
        original_invoice_no: bill.invoice_no,
        original_bill_date: bill.bill_date || bill.createdAt || new Date(),
        return_date: new Date(),
        customer_name: bill.customer_name || 'Walk-in Customer',
        customer_phone: bill.customer_phone || '',
        return_amount: returnAmount,
        return_type: returnType,
        refund_amount: refundAmount,
        notes,
        status: 'ACTIVE',
        ...(clientRequestId ? { client_request_id: clientRequestId } : {})
      });
    } catch (saveErr) {
      if (saveErr && saveErr.code === 11000 && clientRequestId) {
        const existing = await SalesReturn.findOne({
          client_request_id: clientRequestId
        }).lean();

        return res.json({
          message: 'This return was already recorded.',
          duplicate: true,
          return: existing
        });
      }

      throw saveErr;
    }


    /*
      Re-check the cumulative total after saving. If two requests raced
      past the check above, undo this one instead of over-returning.
    */

    const totalAfter = await sumReturnedForBill(bill._id);

    if (totalAfter > billTotal + 0.005) {
      await SalesReturn.deleteOne({ _id: saved._id });

      return res.status(409).json({
        error: 'Another return was saved at the same moment and the bill value would be exceeded. Please check the history and try again.'
      });
    }


    /* -----------------------------------------
       RESPONSE
    ----------------------------------------- */

    res.status(201).json({
      message:
        returnType === 'EXCHANGE'
          ? `Exchange recorded for ${bill.invoice_no}.`
          : `Cash refund recorded for ${bill.invoice_no}.`,

      return: saved,

      remaining_returnable: roundMoney(billTotal - totalAfter)
    });

  } catch (err) {

    console.error(
      'Record return error:',
      err
    );

    res.status(500).json({
      error: 'Failed to record return',
      message: err.message
    });
  }
});


/* =========================================================
   EXPORT
========================================================= */

module.exports = router;
