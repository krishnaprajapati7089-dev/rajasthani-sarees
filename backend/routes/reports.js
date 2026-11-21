// routes/reports.js
// MongoDB / Mongoose reports
// Daily Sales + Sales Trend + GST Reports
// India timezone: Asia/Kolkata

const express = require('express');
const Bill = require('../models/Bill');
const Purchase = require('../models/Purchase');

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
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const err = new Error('Invalid date format. Expected YYYY-MM-DD');
    err.statusCode = 400; // client error, not a server crash
    throw err;
  }

  const [year, month, day] = dateStr.split('-').map(Number);

  // Reject impossible calendar dates such as 2026-02-31 or 2026-13-01.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    const err = new Error('Invalid date. Expected a real calendar date in YYYY-MM-DD');
    err.statusCode = 400;
    throw err;
  }

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
  // India has no daylight saving: always UTC+05:30.
  // Plain arithmetic always returns YYYY-MM-DD. The earlier
  // Intl.DateTimeFormat('en-CA') output depends on the Node/ICU version on the
  // server and can return another format (e.g. MM/DD/YYYY), which then fails
  // the YYYY-MM-DD check in indiaDayRange().
  const time = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (Number.isNaN(time)) {
    throw new RangeError('Invalid date value');
  }
  return new Date(time + (5.5 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}


/**
 * Clean a date query parameter.
 * Accepts YYYY-MM-DD (also with a time part), DD-MM-YYYY and DD/MM/YYYY.
 * Returns '' when the value is empty/undefined/null so no filter is applied.
 * Anything else is returned unchanged so indiaDayRange() reports it as a 400.
 */
function normalizeDateParam(value) {
  if (Array.isArray(value)) value = value[0];
  const text = String(value ?? '').trim();
  if (!text || text === 'undefined' || text === 'null') return '';

  const iso = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
  if (iso) return iso[1];

  const dmy = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }

  return text;
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

    res.status(err.statusCode || 500).json({
      error: err.statusCode ? err.message : 'Failed to generate daily report',
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
   SALES RETURNS / EXCHANGES
   GET  /api/reports/returns?from=YYYY-MM-DD&to=YYYY-MM-DD
   POST /api/reports/returns
   Records returns independently from the original sale so
   original bill dates are never rewritten.
========================================================= */

const mongoose = require('mongoose');

const salesReturnSchema = new mongoose.Schema({
  original_bill_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Bill', required: true },
  original_invoice_no: { type: String, default: '' },
  original_bill_date: { type: Date, default: null },
  customer_name: { type: String, default: 'Walk-in Customer' },
  customer_phone: { type: String, default: '' },
  return_date: { type: Date, default: Date.now, index: true },
  return_amount: { type: Number, required: true, min: 0 },
  refund_amount: { type: Number, default: 0, min: 0 },
  return_type: { type: String, enum: ['EXCHANGE', 'CASH REFUND'], required: true },
  notes: { type: String, default: '' },
  status: { type: String, default: 'ACTIVE', index: true }
}, { timestamps: true });

const SalesReturn = mongoose.models.SalesReturn ||
  mongoose.model('SalesReturn', salesReturnSchema);

router.get('/returns', async (req, res) => {
  try {
    const filter = { status: 'ACTIVE' };
    if (req.query.from || req.query.to) {
      filter.return_date = {};
      if (req.query.from) filter.return_date.$gte = indiaDayRange(req.query.from).start;
      if (req.query.to) filter.return_date.$lte = indiaDayRange(req.query.to).end;
    }
    const returns = await SalesReturn.find(filter)
      .sort({ return_date: -1, createdAt: -1 })
      .lean();

    const summary = returns.reduce((s, r) => {
      s.return_count += 1;
      s.return_amount += num(r.return_amount);
      s.refund_amount += num(r.refund_amount);
      if (r.return_type === 'EXCHANGE') s.exchange_count += 1;
      if (r.return_type === 'CASH REFUND') s.cash_refund_count += 1;
      return s;
    }, { return_count: 0, return_amount: 0, refund_amount: 0, exchange_count: 0, cash_refund_count: 0 });

    res.json({ returns, summary });
  } catch (err) {
    console.error('Sales returns report error:', err);
    res.status(err.statusCode || 500).json({
      error: err.statusCode ? err.message : 'Failed to load sales returns',
      message: err.message
    });
  }
});

router.post('/returns', async (req, res) => {
  try {
    const invoice = String(req.body.invoice_no || req.body.invoice || '').trim();
    const returnAmount = Number(req.body.return_amount);
    const refundAmount = Number(req.body.refund_amount || 0);
    const returnType = String(req.body.return_type || '').toUpperCase();
    const notes = String(req.body.notes || '').trim();

    if (!invoice) return res.status(400).json({ error: 'Enter the original invoice number.' });
    if (!Number.isFinite(returnAmount) || returnAmount <= 0) {
      return res.status(400).json({ error: 'Return amount must be greater than zero.' });
    }
    if (!['EXCHANGE', 'CASH REFUND'].includes(returnType)) {
      return res.status(400).json({ error: 'Choose Exchange or Cash Refund.' });
    }
    if (!Number.isFinite(refundAmount) || refundAmount < 0 || refundAmount > returnAmount) {
      return res.status(400).json({ error: 'Refund amount must be between ₹0 and the return amount.' });
    }
    if (returnType === 'EXCHANGE' && refundAmount > 0) {
      return res.status(400).json({ error: 'For an exchange, refund amount must be ₹0. Record any extra payment on the new bill.' });
    }
    if (returnType === 'CASH REFUND' && refundAmount <= 0) {
      return res.status(400).json({ error: 'Enter the cash amount actually refunded to the customer.' });
    }

    const query = mongoose.isValidObjectId(invoice)
      ? { $or: [{ invoice_no: invoice }, { _id: invoice }] }
      : { invoice_no: invoice };
    const bill = await Bill.findOne(query).lean();

    if (!bill) return res.status(404).json({ error: 'Original bill not found. Check the invoice number.' });
    if (String(bill.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') {
      return res.status(400).json({ error: 'Cannot return against a cancelled bill.' });
    }

    const originalTotal = num(bill.grand_total || bill.total);
    if (returnAmount > originalTotal) {
      return res.status(400).json({ error: `Return amount cannot exceed original bill total ${originalTotal}.` });
    }

    const record = await SalesReturn.create({
      original_bill_id: bill._id,
      original_invoice_no: String(bill.invoice_no || invoice),
      original_bill_date: bill.bill_date || bill.createdAt || null,
      customer_name: bill.customer_name || bill.customer || 'Walk-in Customer',
      customer_phone: bill.customer_phone || bill.phone || '',
      return_date: new Date(),
      return_amount: Math.round(returnAmount * 100) / 100,
      refund_amount: Math.round(refundAmount * 100) / 100,
      return_type: returnType,
      notes
    });

    res.status(201).json({ message: 'Sales return recorded successfully.', return: record });
  } catch (err) {
    console.error('Create sales return error:', err);
    res.status(500).json({ error: 'Failed to record sales return', message: err.message });
  }
});


/**
 * GET /api/reports/supplier-sales?from=YYYY-MM-DD&to=YYYY-MM-DD&supplier=...
 *
 * Reconstructs supplier-wise sales with FIFO because historical bills store
 * product IDs but do not store the purchase lot/supplier from which each unit
 * was sold. This is an estimate for old data, not a claim of exact batch-level
 * traceability. New and old bills are treated consistently by FIFO chronology.
 */
router.get('/supplier-sales', async (req, res) => {
  try {
    // Empty / missing dates mean "no filter". Other formats are cleaned first.
    const fromParam = normalizeDateParam(req.query.from);
    const toParam = normalizeDateParam(req.query.to);
    const from = fromParam ? indiaDayRange(fromParam).start : null;
    const to = toParam ? indiaDayRange(toParam).end : null;
    if (from && to && from > to) return res.status(400).json({ error: 'From date cannot be after To date' });

    const [purchases, bills] = await Promise.all([
      Purchase.find({}).lean(),
      Bill.find({ status: 'ACTIVE' }).lean()
    ]);

    // Compare dates using India calendar days, not raw UTC timestamps.
    const indiaEventDate = value => {
      let parsed = new Date(value || 0);
      if (Number.isNaN(parsed.getTime())) parsed = new Date(0); // unreadable date -> oldest
      return indiaDayRange(getIndiaDateString(parsed)).start;
    };

    const events = [];
    for (const purchase of purchases) {
      const date = indiaEventDate(purchase.invoice_date || purchase.createdAt || 0);
      for (const item of (purchase.items || [])) {
        const productId = String(item.product_id || '').trim();
        const qty = Math.max(0, Number(item.qty) || 0);
        if (!productId || !qty) continue;
        events.push({
          type: 'purchase', date, productId,
          supplier: String(purchase.supplier || 'Unknown Supplier').trim() || 'Unknown Supplier',
          productName: String(item.description || 'Product'),
          qty
        });
      }
    }

    for (const bill of bills) {
      const date = indiaEventDate(bill.bill_date || bill.createdAt || 0);
      for (const item of (bill.items || [])) {
        const productId = String(item.product_id || '').trim();
        const qty = Math.max(0, Number(item.qty) || 0);
        if (!productId || !qty) continue;
        events.push({
          type: 'sale', date, productId,
          productName: String(item.product_name || 'Product'),
          qty,
          revenue: Math.max(0, Number(item.line_total) || (Number(item.rate) || 0) * qty)
        });
      }
    }

    // Chronological replay: purchases are available before sales on the same timestamp.
    events.sort((a, b) => a.date - b.date || (a.type === b.type ? 0 : a.type === 'purchase' ? -1 : 1));

    const lotsByProduct = new Map();
    const aggregate = new Map();
    const addRow = (supplier, productId, productName) => {
      const key = `${supplier.toLowerCase()}::${productId}`;
      if (!aggregate.has(key)) aggregate.set(key, {
        supplier, product_id: productId, product_name: productName,
        purchased_qty: 0, sold_qty: 0, sold_value: 0, remaining_qty: 0
      });
      const row = aggregate.get(key);
      if (!row.product_name || row.product_name === 'Product') row.product_name = productName;
      return row;
    };

    for (const event of events) {
      if (event.type === 'purchase') {
        const lot = {
          supplier: event.supplier,
          productId: event.productId,
          productName: event.productName,
          originalQty: event.qty,
          remainingQty: event.qty
        };
        if (!lotsByProduct.has(event.productId)) lotsByProduct.set(event.productId, []);
        lotsByProduct.get(event.productId).push(lot);
        addRow(event.supplier, event.productId, event.productName).purchased_qty += event.qty;
        continue;
      }

      let qtyLeft = event.qty;
      const lots = lotsByProduct.get(event.productId) || [];
      while (qtyLeft > 0.000001) {
        const lot = lots.find(x => x.remainingQty > 0.000001);
        const take = lot ? Math.min(qtyLeft, lot.remainingQty) : qtyLeft;
        const supplier = lot ? lot.supplier : 'Opening / Unmatched Stock';
        const productName = lot ? lot.productName : event.productName;
        const row = addRow(supplier, event.productId, productName);
        const inRange = (!from || event.date >= from) && (!to || event.date <= to);
        if (inRange) {
          row.sold_qty += take;
          row.sold_value += event.revenue * (take / event.qty);
        }
        if (lot) lot.remainingQty -= take;
        else {
          // Remaining units without a matching purchase are deliberately not attributed to a party.
          // Consume the unmatched remainder in one pass to avoid an infinite loop.
          qtyLeft -= take;
          break;
        }
        qtyLeft -= take;
      }
    }

    // Current remaining stock is independent of the selected sales date range.
    for (const lots of lotsByProduct.values()) {
      for (const lot of lots) {
        addRow(lot.supplier, lot.productId, lot.productName).remaining_qty += lot.remainingQty;
      }
    }

    const supplierFilter = String(req.query.supplier || '').trim().toLowerCase();
    let rows = Array.from(aggregate.values()).map(row => ({
      ...row,
      purchased_qty: Number(row.purchased_qty.toFixed(3)),
      sold_qty: Number(row.sold_qty.toFixed(3)),
      sold_value: Number(row.sold_value.toFixed(2)),
      remaining_qty: Number(row.remaining_qty.toFixed(3))
    }));
    if (supplierFilter) rows = rows.filter(row => row.supplier.toLowerCase() === supplierFilter);
    rows.sort((a, b) => a.supplier.localeCompare(b.supplier) || a.product_name.localeCompare(b.product_name));

    const suppliers = [...new Set(Array.from(aggregate.values()).map(row => row.supplier))]
      .sort((a, b) => a.localeCompare(b));
    const summary = rows.reduce((out, row) => {
      out.purchased_qty += row.purchased_qty;
      out.sold_qty += row.sold_qty;
      out.sold_value += row.sold_value;
      out.remaining_qty += row.remaining_qty;
      return out;
    }, { party_count: new Set(rows.map(row => row.supplier)).size, product_count: rows.length, purchased_qty: 0, sold_qty: 0, sold_value: 0, remaining_qty: 0 });
    summary.sold_value = Number(summary.sold_value.toFixed(2));
    summary.purchased_qty = Number(summary.purchased_qty.toFixed(3));
    summary.sold_qty = Number(summary.sold_qty.toFixed(3));
    summary.remaining_qty = Number(summary.remaining_qty.toFixed(3));

    res.json({
      rows, suppliers, summary,
      date_filter: { from: fromParam, to: toParam },
      allocation_method: 'FIFO estimate based on purchase date and bill date',
      note: 'Older bills do not store supplier/batch allocation. Supplier-wise sold quantities are reconstructed using FIFO; unmatched/opening stock is shown separately.'
    });
  } catch (err) {
    console.error('Supplier-wise sales report error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not generate supplier-wise sales report' });
  }
});


/* =========================================================
   EXPORT
========================================================= */

module.exports = router;
