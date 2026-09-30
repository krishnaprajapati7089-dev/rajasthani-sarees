// routes/reports.js
// MongoDB / Mongoose reports
// Daily Sales + Sales Trend + GST Reports
// India timezone: Asia/Kolkata

const express = require('express');
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
   EXPORT
========================================================= */

module.exports = router;
