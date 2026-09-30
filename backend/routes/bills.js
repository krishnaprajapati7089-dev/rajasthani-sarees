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

  const match = String(lastBill.invoice_no).match(/(\d+)$/);

  if (!match) {
    return 'INV-000001';
  }

  const nextNumber = Number(match[1]) + 1;

  return `INV-${String(nextNumber).padStart(6, '0')}`;
}


function calculateLine(product, line, interstate) {

  const qty = Number(line.qty) || 1;

  if (qty <= 0) {
    throw new Error(`Invalid quantity for product: ${product.name}`);
  }

  if (Number(product.stock_qty) < qty) {
    throw new Error(
      `Insufficient stock for ${product.name}. Available: ${product.stock_qty}`
    );
  }

  const mrp =
    Number(product.mrp || product.selling_price) || 0;

  const sellingPrice =
    Number(product.selling_price) || 0;

  const gstRate =
    Number(product.gst_rate) || 0;

  const discountPercent =
    Number(line.discount_percent) || 0;

  const grossInclusive =
    qty * sellingPrice;

  const discountAmount =
    grossInclusive * discountPercent / 100;

  const finalInclusiveAmount =
    grossInclusive - discountAmount;

  let taxable = finalInclusiveAmount;
  let gstAmount = 0;

  if (gstRate > 0) {

    taxable =
      finalInclusiveAmount /
      (1 + gstRate / 100);

    gstAmount =
      finalInclusiveAmount - taxable;
  }

  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  if (interstate) {
    igst = gstAmount;
  } else {
    cgst = gstAmount / 2;
    sgst = gstAmount / 2;
  }

  return {
    product_id: product._id,

    product_name: product.name,

    // IMPORTANT:
    // These were missing from the old CREATE BILL route.
    category: product.category || '',

    barcode_number: product.barcode || '',

    hsn_code: product.hsn_code || '',

    unit: product.unit || 'pcs',

    qty,

    mrp,

    rate: sellingPrice,

    discount_percent: discountPercent,

    taxable_value: taxable,

    gst_rate: gstRate,

    cgst_amount: cgst,

    sgst_amount: sgst,

    igst_amount: igst,

    line_total: finalInclusiveAmount
  };
}


// ============================================================
// GET ALL BILLS
// ============================================================

router.get('/', async (req, res) => {

  try {

    const bills = await Bill
      .find({})
      .sort({ createdAt: -1 });

    res.json(bills);

  } catch (err) {

    console.error('Get bills error:', err);

    res.status(500).json({
      error: err.message
    });

  }

});


// ============================================================
// GET SINGLE BILL
// ============================================================

router.get('/:id', async (req, res) => {

  try {

    const bill =
      await Bill.findById(req.params.id);

    if (!bill) {

      return res.status(404).json({
        error: 'Bill not found'
      });

    }

    res.json(bill);

  } catch (err) {

    console.error('Get bill error:', err);

    res.status(500).json({
      error: err.message
    });

  }

});


// ============================================================
// CREATE BILL
// ============================================================

router.post('/', async (req, res) => {

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
      discount_amount,
      items
    } = req.body;


    if (!Array.isArray(items) || items.length === 0) {

      return res.status(400).json({
        error: 'Bill must contain at least one product'
      });

    }


    const interstate =
      Boolean(is_interstate);


    const invoice_no =
      await nextInvoiceNo();


    let subtotal = 0;
    let taxableTotal = 0;

    let cgstTotal = 0;
    let sgstTotal = 0;
    let igstTotal = 0;

    let finalInclusiveTotal = 0;

    const billItems = [];


    // ========================================================
    // PROCESS ITEMS
    // ========================================================

    for (const line of items) {

      const product =
        await Product.findById(line.product_id);

      if (!product) {

        throw new Error(
          `Product not found: ${line.product_id}`
        );

      }


      const billItem =
        calculateLine(
          product,
          line,
          interstate
        );


      billItems.push(billItem);


      subtotal +=
        Number(billItem.taxable_value || 0);

      taxableTotal +=
        Number(billItem.taxable_value || 0);

      cgstTotal +=
        Number(billItem.cgst_amount || 0);

      sgstTotal +=
        Number(billItem.sgst_amount || 0);

      igstTotal +=
        Number(billItem.igst_amount || 0);

      finalInclusiveTotal +=
        Number(billItem.line_total || 0);


      // Reduce stock
      product.stock_qty =
        Number(product.stock_qty) -
        Number(billItem.qty);


      await product.save();

    }


    // ========================================================
    // EXTRA BILL DISCOUNT
    // ========================================================

    const extraDiscount =
      Number(discount_amount) || 0;


    const inclusiveBeforeRound =
      finalInclusiveTotal -
      extraDiscount;


    /*
      Extra bill discount is treated as a discount
      on the GST-inclusive customer amount.

      GST is recalculated proportionally so the
      stored GST remains consistent with the final
      amount actually charged.
    */

    let finalTaxable = taxableTotal;
    let finalCgst = cgstTotal;
    let finalSgst = sgstTotal;
    let finalIgst = igstTotal;


    if (
      extraDiscount > 0 &&
      finalInclusiveTotal > 0
    ) {

      const ratio =
        Math.max(
          0,
          inclusiveBeforeRound /
          finalInclusiveTotal
        );

      finalTaxable =
        taxableTotal * ratio;

      finalCgst =
        cgstTotal * ratio;

      finalSgst =
        sgstTotal * ratio;

      finalIgst =
        igstTotal * ratio;

    }


    const grandTotal =
      Math.round(inclusiveBeforeRound);


    const roundOff =
      grandTotal -
      inclusiveBeforeRound;


    // ========================================================
    // CREATE BILL
    // ========================================================

    const bill =
      await Bill.create({

        invoice_no,

        customer_name:
          customer_name ||
          'Walk-in Customer',

        customer_phone:
          customer_phone || '',

        customer_gstin:
          customer_gstin || '',

        customer_state:
          customer_state || '',

        is_interstate:
          interstate,

        payment_mode:
          payment_mode || 'Cash',

        payment_status:
          payment_status || 'Paid',

        paid_amount:
          Number(paid_amount) ||
          grandTotal,

        subtotal,

        discount_amount:
          extraDiscount,

        taxable_value:
          finalTaxable,

        cgst_amount:
          finalCgst,

        sgst_amount:
          finalSgst,

        igst_amount:
          finalIgst,

        round_off:
          roundOff,

        grand_total:
          grandTotal,

        status:
          'ACTIVE',

        items:
          billItems

      });


    res.status(201).json(bill);


  } catch (err) {

    console.error(
      'Create bill error:',
      err
    );

    res.status(400).json({
      error: err.message
    });

  }

});


// ============================================================
// EDIT / UPDATE BILL
// ============================================================
//
// PUT /api/bills/:id
//
// The old bill's stock is first restored.
// Then the new bill items are validated and stock
// is deducted again.
//
// This allows:
// - changing quantity
// - changing products
// - removing products
// - adding products
// ============================================================

router.put('/:id', async (req, res) => {

  try {

    const bill =
      await Bill.findById(req.params.id);

    if (!bill) {

      return res.status(404).json({
        error: 'Bill not found'
      });

    }


    if (bill.status === 'CANCELLED') {

      return res.status(400).json({
        error: 'Cancelled bills cannot be edited'
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
      discount_amount,
      items
    } = req.body;


    if (!Array.isArray(items) || items.length === 0) {

      return res.status(400).json({
        error: 'Bill must contain at least one product'
      });

    }


    const interstate =
      Boolean(is_interstate);


    // ========================================================
    // RESTORE OLD STOCK
    // ========================================================

    for (const oldItem of bill.items) {

      const product =
        await Product.findById(
          oldItem.product_id
        );

      if (product) {

        product.stock_qty =
          Number(product.stock_qty) +
          Number(oldItem.qty || 0);

        // Make it active again when stock returns.
        product.active = true;

        await product.save();

      }

    }


    // ========================================================
    // PREPARE NEW ITEMS
    // ========================================================

    const billItems = [];

    let subtotal = 0;
    let taxableTotal = 0;

    let cgstTotal = 0;
    let sgstTotal = 0;
    let igstTotal = 0;

    let finalInclusiveTotal = 0;


    try {

      for (const line of items) {

        const product =
          await Product.findById(
            line.product_id
          );

        if (!product) {

          throw new Error(
            `Product not found: ${line.product_id}`
          );

        }


        const billItem =
          calculateLine(
            product,
            line,
            interstate
          );


        billItems.push(billItem);


        subtotal +=
          Number(billItem.taxable_value || 0);

        taxableTotal +=
          Number(billItem.taxable_value || 0);

        cgstTotal +=
          Number(billItem.cgst_amount || 0);

        sgstTotal +=
          Number(billItem.sgst_amount || 0);

        igstTotal +=
          Number(billItem.igst_amount || 0);

        finalInclusiveTotal +=
          Number(billItem.line_total || 0);

      }


      // ======================================================
      // EXTRA DISCOUNT
      // ======================================================

      const extraDiscount =
        Number(discount_amount) || 0;


      const inclusiveBeforeRound =
        finalInclusiveTotal -
        extraDiscount;


      let finalTaxable =
        taxableTotal;

      let finalCgst =
        cgstTotal;

      let finalSgst =
        sgstTotal;

      let finalIgst =
        igstTotal;


      if (
        extraDiscount > 0 &&
        finalInclusiveTotal > 0
      ) {

        const ratio =
          Math.max(
            0,
            inclusiveBeforeRound /
            finalInclusiveTotal
          );


        finalTaxable =
          taxableTotal * ratio;

        finalCgst =
          cgstTotal * ratio;

        finalSgst =
          sgstTotal * ratio;

        finalIgst =
          igstTotal * ratio;

      }


      const grandTotal =
        Math.round(
          inclusiveBeforeRound
        );


      const roundOff =
        grandTotal -
        inclusiveBeforeRound;


      // ======================================================
      // DEDUCT NEW STOCK
      // ======================================================

      for (const item of billItems) {

        const product =
          await Product.findById(
            item.product_id
          );

        if (!product) {

          throw new Error(
            `Product not found: ${item.product_id}`
          );

        }


        if (
          Number(product.stock_qty) <
          Number(item.qty)
        ) {

          throw new Error(
            `Insufficient stock for ${product.name}. Available: ${product.stock_qty}`
          );

        }

      }


      for (const item of billItems) {

        const product =
          await Product.findById(
            item.product_id
          );

        product.stock_qty =
          Number(product.stock_qty) -
          Number(item.qty);

        await product.save();

      }


      // ======================================================
      // UPDATE BILL
      // ======================================================

      bill.customer_name =
        customer_name ||
        'Walk-in Customer';

      bill.customer_phone =
        customer_phone || '';

      bill.customer_gstin =
        customer_gstin || '';

      bill.customer_state =
        customer_state || '';

      bill.is_interstate =
        interstate;

      bill.payment_mode =
        payment_mode || 'Cash';

      bill.payment_status =
        payment_status || 'Paid';

      bill.paid_amount =
        Number(paid_amount) ||
        grandTotal;

      bill.subtotal =
        subtotal;

      bill.discount_amount =
        extraDiscount;

      bill.taxable_value =
        finalTaxable;

      bill.cgst_amount =
        finalCgst;

      bill.sgst_amount =
        finalSgst;

      bill.igst_amount =
        finalIgst;

      bill.round_off =
        roundOff;

      bill.grand_total =
        grandTotal;

      bill.items =
        billItems;

      await bill.save();


      res.json(bill);


    } catch (error) {

      // ======================================================
      // ROLLBACK OLD STOCK IF UPDATE FAILED
      // ======================================================

      for (const oldItem of bill.items) {

        const product =
          await Product.findById(
            oldItem.product_id
          );

        if (product) {

          /*
            At this point old stock was restored.
            If the new transaction failed before completing,
            leave the restored stock in place.
          */

          product.active = true;

          await product.save();

        }

      }


      throw error;

    }


  } catch (err) {

    console.error(
      'Update bill error:',
      err
    );

    res.status(400).json({
      error: err.message
    });

  }

});


// ============================================================
// CANCEL BILL
// ============================================================

router.post('/:id/cancel', async (req, res) => {

  try {

    const bill =
      await Bill.findById(req.params.id);


    if (!bill) {

      return res.status(404).json({
        error: 'Bill not found'
      });

    }


    if (bill.status === 'CANCELLED') {

      return res.status(400).json({
        error: 'Bill is already cancelled'
      });

    }


    // Restore stock

    for (const item of bill.items) {

      const product =
        await Product.findById(
          item.product_id
        );

      if (product) {

        product.stock_qty =
          Number(product.stock_qty) +
          Number(item.qty || 0);

        product.active = true;

        await product.save();

      }

    }


    bill.status =
      'CANCELLED';

    await bill.save();


    res.json(bill);


  } catch (err) {

    console.error(
      'Cancel bill error:',
      err
    );

    res.status(400).json({
      error: err.message
    });

  }

});


// ============================================================
// DELETE BILL
// ============================================================

router.delete('/:id', async (req, res) => {

  try {

    const bill =
      await Bill.findById(
        req.params.id
      );


    if (!bill) {

      return res.status(404).json({
        error: 'Bill not found'
      });

    }


    if (bill.status !== 'CANCELLED') {

      for (const item of bill.items) {

        const product =
          await Product.findById(
            item.product_id
          );

        if (product) {

          product.stock_qty =
            Number(product.stock_qty) +
            Number(item.qty || 0);

          product.active = true;

          await product.save();

        }

      }

    }


    await Bill.findByIdAndDelete(
      req.params.id
    );


    res.json({
      message: 'Bill deleted',
      id: req.params.id
    });


  } catch (err) {

    console.error(
      'Delete bill error:',
      err
    );

    res.status(500).json({
      error: err.message
    });

  }

});


// ============================================================
// INVOICE HTML
// ============================================================

router.get('/:id/invoice', async (req, res) => {

  try {

    const bill =
      await Bill.findById(
        req.params.id
      );


    if (!bill) {

      return res.status(404).send(
        'Bill not found'
      );

    }


    const shop =
      await ShopProfile.findOne({
        key: 'main'
      });


    const html =
      renderInvoiceHTML({
        bill,
        items: bill.items,
        shop: shop || {}
      });


    res.type('html').send(html);


  } catch (err) {

    console.error(
      'Invoice render error:',
      err
    );

    res.status(500).send(
      'Failed to generate invoice'
    );

  }

});


module.exports = router;
