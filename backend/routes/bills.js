const express = require('express');

const Product = require('../models/Product');
const Bill = require('../models/Bill');
const ShopProfile = require('../models/ShopProfile');
const { renderInvoiceHTML } = require('../templates/invoice');

const router = express.Router();


// ============================================================
// HELPERS
// ============================================================

async function nextInvoiceNo() {
  const lastBill = await Bill
    .findOne({})
    .sort({ createdAt: -1 })
    .select('invoice_no');

  if (!lastBill || !lastBill.invoice_no) {
    return 'INV-000001';
  }

  const match =
    String(lastBill.invoice_no).match(/(\d+)$/);

  if (!match) {
    return 'INV-000001';
  }

  return `INV-${String(
    Number(match[1]) + 1
  ).padStart(6, '0')}`;
}


function round2(value) {
  return Math.round(
    (Number(value) + Number.EPSILON) * 100
  ) / 100;
}

function getPaymentStatus(total, paid) {
  const billTotal = round2(Math.max(0, Number(total) || 0));
  const paidTotal = round2(Math.max(0, Number(paid) || 0));
  if (paidTotal <= 0) return 'Unpaid';
  if (paidTotal >= billTotal) return 'Paid';
  return 'Partial';
}

function validatePaymentAmount(amount, total, label = 'Received amount') {
  const value = Number(amount);
  const billTotal = round2(Math.max(0, Number(total) || 0));

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a valid amount of ₹0 or more`);
  }
  if (value > billTotal) {
    throw new Error(`${label} cannot be greater than the bill total (₹${billTotal.toFixed(2)})`);
  }
  return round2(value);
}


// ============================================================
// PREPARE BILL ITEMS
//
// IMPORTANT PRICE RULE
//
// The billing page sends:
//
//     rate = FINAL selling price charged to customer
//
// Example:
//
//     MRP             = 850
//     Selling Price   = 700
//     Discount shown  = 17.65%
//
// FINAL CUSTOMER PRICE = 700
//
// The 17.65% is already represented by:
//     850 -> 700
//
// Therefore backend MUST NOT do:
//
//     700 - 17.65%
//
// Otherwise:
//     700 -> 576
//
// This was the problem.
// ============================================================

async function prepareBillItems(
  items,
  interstate,
  extraDiscount = 0,
  stockOverrides = {}
) {

  if (
    !Array.isArray(items) ||
    items.length === 0
  ) {
    throw new Error(
      'Bill must contain at least one product'
    );
  }


  const prepared = [];

  const requiredByProduct = {};



  // ==========================================================
  // PROCESS EACH ITEM
  // ==========================================================

  for (const line of items) {

    const productId =
      String(
        line.product_id || ''
      ).trim();


    if (!productId) {
      throw new Error(
        'Product ID is required for every bill item'
      );
    }


    const product =
      await Product.findById(
        productId
      );


    if (!product) {
      throw new Error(
        `Product not found: ${productId}`
      );
    }


    const qty =
      Number(line.qty);


    if (
      !Number.isFinite(qty) ||
      qty <= 0
    ) {
      throw new Error(
        `Invalid quantity for product: ${product.name}`
      );
    }


    // --------------------------------------------------------
    // AVAILABLE STOCK
    // --------------------------------------------------------

    const available =
      Object.prototype.hasOwnProperty.call(
        stockOverrides,
        productId
      )
        ? Number(
            stockOverrides[productId]
          )
        : Number(
            product.stock_qty || 0
          );


    requiredByProduct[productId] =
      (
        requiredByProduct[productId] ||
        0
      ) + qty;


    // --------------------------------------------------------
    // FINAL SELLING PRICE
    //
    // Priority:
    //
    // 1. line.rate
    // 2. line.selling_price
    // 3. line.price
    // 4. product.selling_price
    //
    // The billing page's entered price is authoritative.
    // --------------------------------------------------------

    const requestedRate =
      Number(
        line.rate ??
        line.selling_price ??
        line.price
      );


    const sellingPrice =
      Number.isFinite(
        requestedRate
      ) &&
      requestedRate >= 0

        ? requestedRate

        : Number(
            product.selling_price || 0
          );


    // --------------------------------------------------------
    // MRP
    // --------------------------------------------------------

    const mrp =
      Number(
        product.mrp ||
        product.selling_price ||
        0
      );


    // --------------------------------------------------------
    // GST RATE
    // --------------------------------------------------------

    const gstRate =
      Number(
        product.gst_rate || 0
      );


    // --------------------------------------------------------
    // GROSS FINAL CUSTOMER AMOUNT
    //
    // Example:
    //
    // qty = 1
    // sellingPrice = 700
    //
    // grossInclusive = 700
    // --------------------------------------------------------

    const grossInclusive =
      round2(
        qty *
        sellingPrice
      );


    // --------------------------------------------------------
    // DISPLAYED DISCOUNT
    //
    // IMPORTANT:
    //
    // This percentage is already represented in sellingPrice.
    //
    // Example:
    // MRP = 850
    // Selling price = 700
    // Discount = 17.65%
    //
    // DO NOT subtract this discount again.
    //
    // We store it only for the bill/invoice display.
    // --------------------------------------------------------

    const discountPercent =
      Math.max(
        0,
        Math.min(
          100,
          Number(
            line.discount_percent
          ) || 0
        )
      );


    // IMPORTANT:
    // NO SECOND DISCOUNT HERE.
    const lineDiscount = 0;


    const inclusiveAfterLineDiscount =
      round2(
        grossInclusive
      );


    // --------------------------------------------------------
    // GST INCLUDED IN SELLING PRICE
    // --------------------------------------------------------

    let taxable =
      inclusiveAfterLineDiscount;

    let gstAmount = 0;


    if (gstRate > 0) {

      taxable =
        inclusiveAfterLineDiscount /
        (
          1 +
          gstRate / 100
        );


      gstAmount =
        inclusiveAfterLineDiscount -
        taxable;
    }


    // --------------------------------------------------------
    // CGST / SGST / IGST
    // --------------------------------------------------------

    const cgst =
      interstate
        ? 0
        : gstAmount / 2;


    const sgst =
      interstate
        ? 0
        : gstAmount / 2;


    const igst =
      interstate
        ? gstAmount
        : 0;


    // --------------------------------------------------------
    // PREPARED ITEM
    // --------------------------------------------------------

    prepared.push({

      product,

      product_id:
        product._id,

      product_name:
        product.name,

      category:
        product.category || '',

      barcode_number:
        product.barcode || '',

      hsn_code:
        product.hsn_code || '',

      unit:
        product.unit || 'pcs',

      qty,

      mrp,

      // FINAL customer price
      rate:
        sellingPrice,

      // Display/reference only
      discount_percent:
        discountPercent,

      _grossInclusive:
        grossInclusive,

      _lineDiscount:
        lineDiscount,

      _inclusiveBeforeExtra:
        inclusiveAfterLineDiscount,

      taxable_value:
        taxable,

      gst_rate:
        gstRate,

      cgst_amount:
        cgst,

      sgst_amount:
        sgst,

      igst_amount:
        igst,

      // FINAL line amount
      line_total:
        inclusiveAfterLineDiscount
    });


    // --------------------------------------------------------
    // STOCK VALIDATION
    // --------------------------------------------------------

    if (
      available <
      requiredByProduct[productId]
    ) {

      throw new Error(
        `Insufficient stock for ${product.name}. Available: ${available}`
      );
    }
  }



  // ==========================================================
  // BILL LEVEL EXTRA DISCOUNT
  //
  // This is different from the MRP -> selling price difference.
  //
  // If the user enters a separate bill-level discount amount,
  // that amount is still applied.
  // ==========================================================

  let totalInclusive =
    prepared.reduce(
      (
        sum,
        item
      ) =>
        sum +
        Number(
          item._inclusiveBeforeExtra ||
          0
        ),
      0
    );


  let billDiscount =
    Math.max(
      0,
      Number(
        extraDiscount
      ) || 0
    );


  billDiscount =
    Math.min(
      billDiscount,
      round2(
        totalInclusive
      )
    );



  // ==========================================================
  // ALLOCATE BILL LEVEL DISCOUNT
  // ==========================================================

  if (
    billDiscount > 0 &&
    totalInclusive > 0
  ) {

    let allocated = 0;


    prepared.forEach(
      (
        item,
        index
      ) => {

        const isLast =
          index ===
          prepared.length - 1;


        const share =
          isLast

            ? round2(
                billDiscount -
                allocated
              )

            : round2(
                billDiscount *
                (
                  Number(
                    item._inclusiveBeforeExtra
                  ) /
                  totalInclusive
                )
              );


        allocated =
          round2(
            allocated +
            share
          );


        const inclusiveAfterAllDiscounts =
          round2(
            Number(
              item._inclusiveBeforeExtra
            ) -
            share
          );


        let taxable =
          inclusiveAfterAllDiscounts;


        let gstAmount =
          0;


        if (
          Number(
            item.gst_rate
          ) > 0
        ) {

          taxable =
            inclusiveAfterAllDiscounts /
            (
              1 +
              Number(
                item.gst_rate
              ) / 100
            );


          gstAmount =
            inclusiveAfterAllDiscounts -
            taxable;
        }


        item.taxable_value =
          taxable;


        item.cgst_amount =
          interstate
            ? 0
            : gstAmount / 2;


        item.sgst_amount =
          interstate
            ? 0
            : gstAmount / 2;


        item.igst_amount =
          interstate
            ? gstAmount
            : 0;


        item.line_total =
          inclusiveAfterAllDiscounts;
      }
    );
  }



  // ==========================================================
  // FINAL TOTALS
  // ==========================================================

  totalInclusive =
    prepared.reduce(
      (
        sum,
        item
      ) =>
        sum +
        Number(
          item.line_total || 0
        ),
      0
    );


  const taxableTotal =
    prepared.reduce(
      (
        sum,
        item
      ) =>
        sum +
        Number(
          item.taxable_value || 0
        ),
      0
    );


  const cgstTotal =
    prepared.reduce(
      (
        sum,
        item
      ) =>
        sum +
        Number(
          item.cgst_amount || 0
        ),
      0
    );


  const sgstTotal =
    prepared.reduce(
      (
        sum,
        item
      ) =>
        sum +
        Number(
          item.sgst_amount || 0
        ),
      0
    );


  const igstTotal =
    prepared.reduce(
      (
        sum,
        item
      ) =>
        sum +
        Number(
          item.igst_amount || 0
        ),
      0
    );


  // ----------------------------------------------------------
  // FINAL CUSTOMER PAYABLE
  //
  // Example:
  //
  // Selling price = 700
  // GST included = 33.33
  // Taxable      = 666.67
  //
  // Grand total  = 700
  // ----------------------------------------------------------

  const grandTotal =
    Math.round(
      totalInclusive
    );


  const roundOff =
    round2(
      grandTotal -
      totalInclusive
    );



  // ==========================================================
  // BILL ITEMS TO SAVE
  // ==========================================================

  const billItems =
    prepared.map(
      item => ({

        product_id:
          item.product_id,

        product_name:
          item.product_name,

        category:
          item.category,

        barcode_number:
          item.barcode_number,

        hsn_code:
          item.hsn_code,

        unit:
          item.unit,

        qty:
          item.qty,

        mrp:
          item.mrp,

        // FINAL customer selling price
        rate:
          item.rate,

        // MRP-based displayed discount
        discount_percent:
          item.discount_percent,

        taxable_value:
          round2(
            item.taxable_value
          ),

        gst_rate:
          item.gst_rate,

        cgst_amount:
          round2(
            item.cgst_amount
          ),

        sgst_amount:
          round2(
            item.sgst_amount
          ),

        igst_amount:
          round2(
            item.igst_amount
          ),

        line_total:
          round2(
            item.line_total
          )
      })
    );



  // ==========================================================
  // RETURN CALCULATION
  // ==========================================================

  return {

    prepared,

    billItems,

    subtotal:
      round2(
        taxableTotal
      ),

    taxable_value:
      round2(
        taxableTotal
      ),

    cgst_amount:
      round2(
        cgstTotal
      ),

    sgst_amount:
      round2(
        sgstTotal
      ),

    igst_amount:
      round2(
        igstTotal
      ),

    discount_amount:
      round2(
        billDiscount
      ),

    grand_total:
      grandTotal,

    round_off:
      roundOff,

    totalInclusive:
      round2(
        totalInclusive
      )
  };
}



// ============================================================
// GET OLD BILL STOCK
// ============================================================

function getOldStockOverrides(
  bill
) {

  const overrides = {};


  for (
    const item
    of bill.items || []
  ) {

    const id =
      String(
        item.product_id || ''
      );


    if (!id) {
      continue;
    }


    overrides[id] =
      Number(
        overrides[id] || 0
      ) +
      Number(
        item.qty || 0
      );
  }


  return overrides;
}



// ============================================================
// APPLY STOCK CHANGE
//
// direction:
//   -1 = sale
//   +1 = restore
// ============================================================

async function applyStockChange(
  prepared,
  direction
) {

  const quantities = {};


  for (
    const item
    of prepared
  ) {

    const id =
      String(
        item.product_id
      );


    quantities[id] =
      (
        quantities[id] ||
        0
      ) +
      Number(
        item.qty || 0
      );
  }


  for (
    const [
      productId,
      qty
    ]
    of Object.entries(
      quantities
    )
  ) {

    const product =
      await Product.findById(
        productId
      );


    if (!product) {

      throw new Error(
        `Product not found: ${productId}`
      );
    }


    product.stock_qty =
      Number(
        product.stock_qty || 0
      ) +
      (
        direction *
        qty
      );


    if (
      product.stock_qty < 0
    ) {

      throw new Error(
        `Insufficient stock for ${product.name}. Available: ${
          Number(
            product.stock_qty || 0
          ) + qty
        }`
      );
    }


    await product.save();
  }
}



// ============================================================
// GET ALL BILLS
// ============================================================

router.get(
  '/',
  async (
    req,
    res
  ) => {

    try {

      const bills =
        await Bill
          .find({})
          .sort({
            createdAt: -1
          });


      res.json(
        bills
      );

    } catch (err) {

      console.error(
        'Get bills error:',
        err
      );


      res.status(500).json({

        error:
          err.message

      });
    }
  }
);



// ============================================================
// GET SINGLE BILL
// ============================================================

router.get(
  '/:id',
  async (
    req,
    res
  ) => {

    try {

      const bill =
        await Bill.findById(
          req.params.id
        );


      if (!bill) {

        return res
          .status(404)
          .json({

            error:
              'Bill not found'

          });
      }


      res.json(
        bill
      );

    } catch (err) {

      console.error(
        'Get bill error:',
        err
      );


      res.status(500).json({

        error:
          err.message

      });
    }
  }
);



// ============================================================
// CREATE BILL
// ============================================================

router.post(
  '/',
  async (
    req,
    res
  ) => {

    try {

      const {
        customer_name,
        customer_phone,
        customer_gstin,
        customer_state,
        is_interstate,
        payment_mode,
        payment_status,
        paid_amount,
        amount_received,
        discount_amount,
        items
      } = req.body;


      const interstate =
        Boolean(
          is_interstate
        );


      // --------------------------------------------------------
      // CALCULATE COMPLETE BILL
      // --------------------------------------------------------

      const calculation =
        await prepareBillItems(
          items,
          interstate,
          discount_amount
        );


      // --------------------------------------------------------
      // REDUCE STOCK
      // --------------------------------------------------------

      await applyStockChange(
        calculation.prepared,
        -1
      );


      // --------------------------------------------------------
      // NEW INVOICE NUMBER
      // --------------------------------------------------------

      const invoice_no =
        await nextInvoiceNo();


      // --------------------------------------------------------
      // CREATE BILL
      // --------------------------------------------------------

      const bill =
        await Bill.create({

          invoice_no,

          customer_name:
            customer_name ||
            'Walk-in Customer',

          customer_phone:
            customer_phone ||
            '',

          customer_gstin:
            customer_gstin ||
            '',

          customer_state:
            customer_state ||
            '',

          is_interstate:
            interstate,

          payment_mode:
            payment_mode ||
            'Cash',

          payment_status:
            getPaymentStatus(
              calculation.grand_total,
              validatePaymentAmount(
                amount_received ?? paid_amount ?? calculation.grand_total,
                calculation.grand_total
              )
            ),

          paid_amount:
            validatePaymentAmount(
              amount_received ?? paid_amount ?? calculation.grand_total,
              calculation.grand_total
            ),

          amount_received:
            validatePaymentAmount(
              amount_received ?? paid_amount ?? calculation.grand_total,
              calculation.grand_total
            ),

          outstanding_amount:
            round2(
              calculation.grand_total -
              validatePaymentAmount(
                amount_received ?? paid_amount ?? calculation.grand_total,
                calculation.grand_total
              )
            ),

          payment_history:
            validatePaymentAmount(
              amount_received ?? paid_amount ?? calculation.grand_total,
              calculation.grand_total
            ) > 0
              ? [{
                  amount: validatePaymentAmount(
                    amount_received ?? paid_amount ?? calculation.grand_total,
                    calculation.grand_total
                  ),
                  date: new Date(),
                  mode: payment_mode || 'Cash',
                  note: 'Initial payment at bill creation'
                }]
              : [],

          subtotal:
            calculation.subtotal,

          discount_amount:
            calculation.discount_amount,

          taxable_value:
            calculation.taxable_value,

          cgst_amount:
            calculation.cgst_amount,

          sgst_amount:
            calculation.sgst_amount,

          igst_amount:
            calculation.igst_amount,

          round_off:
            calculation.round_off,

          grand_total:
            calculation.grand_total,

          status:
            'ACTIVE',

          items:
            calculation.billItems
        });


      res
        .status(201)
        .json(
          bill
        );

    } catch (err) {

      console.error(
        'Create bill error:',
        err
      );


      res
        .status(400)
        .json({

          error:
            err.message

        });
    }
  }
);



// ============================================================
// EDIT / UPDATE BILL
// ============================================================

router.put(
  '/:id',
  async (
    req,
    res
  ) => {

    try {

      const bill =
        await Bill.findById(
          req.params.id
        );


      if (!bill) {

        return res
          .status(404)
          .json({

            error:
              'Bill not found'

          });
      }


      if (
        bill.status ===
        'CANCELLED'
      ) {

        return res
          .status(400)
          .json({

            error:
              'Cancelled bills cannot be edited'

          });
      }


      const {
        customer_name,
        customer_phone,
        customer_gstin,
        customer_state,
        is_interstate,
        payment_mode,
        payment_status,
        paid_amount,
        amount_received,
        discount_amount,
        items
      } = req.body;



      // --------------------------------------------------------
      // VIRTUAL OLD STOCK
      //
      // Existing bill quantities are temporarily considered
      // available again for validation.
      // --------------------------------------------------------

      const oldStock =
        getOldStockOverrides(
          bill
        );


      const productIds =
        new Set([

          ...Object.keys(
            oldStock
          ),

          ...(
            Array.isArray(items)

              ? items.map(
                  item =>
                    String(
                      item.product_id ||
                      ''
                    )
                )

              : []
          )

        ]);


      const virtualStock = {};


      for (
        const productId
        of productIds
      ) {

        if (!productId) {
          continue;
        }


        const product =
          await Product.findById(
            productId
          );


        if (!product) {

          return res
            .status(400)
            .json({

              error:
                `Product not found: ${productId}`

            });
        }


        virtualStock[productId] =
          Number(
            product.stock_qty || 0
          ) +
          Number(
            oldStock[productId] || 0
          );
      }



      // --------------------------------------------------------
      // CALCULATE UPDATED BILL
      // --------------------------------------------------------

      const interstate =
        Boolean(
          is_interstate
        );


      const calculation =
        await prepareBillItems(
          items,
          interstate,
          discount_amount,
          virtualStock
        );



      // --------------------------------------------------------
      // NET STOCK CHANGES
      //
      // OLD BILL STOCK IS RETURNED
      // NEW BILL STOCK IS REMOVED
      // --------------------------------------------------------

      const netChanges = {};


      // Add old quantities back
      for (
        const [
          productId,
          qty
        ]
        of Object.entries(
          oldStock
        )
      ) {

        netChanges[productId] =
          Number(
            netChanges[productId] ||
            0
          ) +
          Number(
            qty || 0
          );
      }


      // Remove new quantities
      for (
        const item
        of calculation.prepared
      ) {

        const productId =
          String(
            item.product_id
          );


        netChanges[productId] =
          Number(
            netChanges[productId] ||
            0
          ) -
          Number(
            item.qty || 0
          );
      }



      // --------------------------------------------------------
      // APPLY NET STOCK CHANGES
      // --------------------------------------------------------

      for (
        const [
          productId,
          change
        ]
        of Object.entries(
          netChanges
        )
      ) {

        if (!change) {
          continue;
        }


        const product =
          await Product.findById(
            productId
          );


        if (!product) {

          throw new Error(
            `Product not found: ${productId}`
          );
        }


        product.stock_qty =
          Number(
            product.stock_qty || 0
          ) +
          Number(
            change
          );


        if (
          product.stock_qty < 0
        ) {

          throw new Error(
            `Stock would become negative for ${product.name}`
          );
        }


        await product.save();
      }



      // --------------------------------------------------------
      // UPDATE BILL
      // --------------------------------------------------------

      bill.customer_name =
        customer_name ||
        'Walk-in Customer';


      bill.customer_phone =
        customer_phone ||
        '';


      bill.customer_gstin =
        customer_gstin ||
        '';


      bill.customer_state =
        customer_state ||
        '';


      bill.is_interstate =
        interstate;


      bill.payment_mode =
        payment_mode ||
        bill.payment_mode ||
        'Cash';

      // Preserve the saved collection when the edit form does not send
      // a payment value. Do not turn a zero payment into a full payment.
      const editedPaidAmount = validatePaymentAmount(
        amount_received ?? paid_amount ?? bill.paid_amount ?? 0,
        calculation.grand_total,
        'Received amount'
      );

      bill.paid_amount = editedPaidAmount;
      bill.amount_received = editedPaidAmount;
      bill.outstanding_amount = round2(
        calculation.grand_total - editedPaidAmount
      );
      bill.payment_status = getPaymentStatus(
        calculation.grand_total,
        editedPaidAmount
      );

      // Existing payment history is retained when editing bill details.
      if (!Array.isArray(bill.payment_history)) {
        bill.payment_history = [];
      }

      bill.subtotal =
        calculation.subtotal;


      bill.discount_amount =
        calculation.discount_amount;


      bill.taxable_value =
        calculation.taxable_value;


      bill.cgst_amount =
        calculation.cgst_amount;


      bill.sgst_amount =
        calculation.sgst_amount;


      bill.igst_amount =
        calculation.igst_amount;


      bill.round_off =
        calculation.round_off;


      bill.grand_total =
        calculation.grand_total;


      bill.items =
        calculation.billItems;


      await bill.save();


      res.json(
        bill
      );

    } catch (err) {

      console.error(
        'Update bill error:',
        err
      );


      res
        .status(400)
        .json({

          error:
            err.message

        });
    }
  }
);



// ============================================================
// RECORD A CUSTOMER PAYMENT / INSTALMENT
// POST /api/bills/:id/payments
// Body: { amount, payment_mode, date?, note? }
// ============================================================

router.post(
  '/:id/payments',
  async (req, res) => {
    try {
      const bill = await Bill.findById(req.params.id);

      if (!bill) {
        return res.status(404).json({ error: 'Bill not found' });
      }

      if (String(bill.status || 'ACTIVE').toUpperCase() === 'CANCELLED') {
        return res.status(400).json({ error: 'Cannot collect payment for a cancelled bill' });
      }

      const amount = Number(req.body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'Payment amount must be greater than ₹0' });
      }

      const total = round2(Number(bill.grand_total) || 0);
      const currentPaid = round2(
        Number(
          bill.amount_received ??
          bill.paid_amount ??
          0
        ) || 0
      );
      const outstanding = round2(Math.max(0, total - currentPaid));

      if (amount > outstanding + 0.001) {
        return res.status(400).json({
          error: `Payment exceeds pending amount. Pending: ₹${outstanding.toFixed(2)}`
        });
      }

      const newPaid = round2(currentPaid + amount);
      const paymentDate = req.body.date ? new Date(req.body.date) : new Date();

      if (Number.isNaN(paymentDate.getTime())) {
        return res.status(400).json({ error: 'Invalid payment date' });
      }

      const entry = {
        amount: round2(amount),
        date: paymentDate,
        mode: String(req.body.payment_mode || req.body.mode || bill.payment_mode || 'Cash').trim(),
        note: String(req.body.note || '').trim()
      };

      if (!Array.isArray(bill.payment_history)) {
        bill.payment_history = [];
      }
      bill.payment_history.push(entry);
      bill.paid_amount = newPaid;
      bill.amount_received = newPaid;
      bill.outstanding_amount = round2(Math.max(0, total - newPaid));
      bill.payment_status = getPaymentStatus(total, newPaid);

      await bill.save();

      return res.json({
        message: 'Payment recorded successfully',
        bill,
        payment: entry,
        paid_amount: newPaid,
        amount_received: newPaid,
        outstanding_amount: bill.outstanding_amount,
        payment_status: bill.payment_status
      });
    } catch (err) {
      console.error('Record payment error:', err);
      return res.status(400).json({ error: err.message });
    }
  }
);


// ============================================================
// CANCEL BILL
// ============================================================

router.post(
  '/:id/cancel',
  async (
    req,
    res
  ) => {

    try {

      const bill =
        await Bill.findById(
          req.params.id
        );


      if (!bill) {

        return res
          .status(404)
          .json({

            error:
              'Bill not found'

          });
      }


      if (
        bill.status ===
        'CANCELLED'
      ) {

        return res
          .status(400)
          .json({

            error:
              'Bill is already cancelled'

          });
      }


      // Restore stock
      await applyStockChange(

        bill.items.map(
          item => ({

            product_id:
              item.product_id,

            qty:
              Number(
                item.qty || 0
              )

          })
        ),

        1
      );


      bill.status =
        'CANCELLED';


      await bill.save();


      res.json(
        bill
      );

    } catch (err) {

      console.error(
        'Cancel bill error:',
        err
      );


      res
        .status(400)
        .json({

          error:
            err.message

        });
    }
  }
);



// ============================================================
// DELETE BILL
//
// Permanently deletes the bill.
// Stock is restored first for an active bill.
// ============================================================

router.delete(
  '/:id',
  async (
    req,
    res
  ) => {

    try {

      const bill =
        await Bill.findById(
          req.params.id
        );


      if (!bill) {

        return res
          .status(404)
          .json({

            error:
              'Bill not found'

          });
      }


      // If bill is active,
      // return its stock to inventory.
      if (
        bill.status !==
        'CANCELLED'
      ) {

        await applyStockChange(

          bill.items.map(
            item => ({

              product_id:
                item.product_id,

              qty:
                Number(
                  item.qty || 0
                )

            })
          ),

          1
        );
      }


      await Bill.findByIdAndDelete(
        req.params.id
      );


      res.json({

        message:
          'Bill deleted',

        id:
          req.params.id

      });

    } catch (err) {

      console.error(
        'Delete bill error:',
        err
      );


      res
        .status(500)
        .json({

          error:
            err.message

        });
    }
  }
);



// ============================================================
// GENERATE INVOICE HTML
// ============================================================

router.get(
  '/:id/invoice',
  async (
    req,
    res
  ) => {

    try {

      const bill =
        await Bill.findById(
          req.params.id
        );


      if (!bill) {

        return res
          .status(404)
          .send(
            'Bill not found'
          );
      }


      const shop =
        await ShopProfile.findOne({

          key:
            'main'

        });


      const html =
        renderInvoiceHTML({

          bill,

          items:
            bill.items,

          shop:
            shop || {}

        });


      res
        .type('html')
        .send(
          html
        );

    } catch (err) {

      console.error(
        'Invoice render error:',
        err
      );


      res
        .status(500)
        .send(
          'Failed to generate invoice'
        );
    }
  }
);



// ============================================================
// EXPORT
// ============================================================

module.exports =
  router;
