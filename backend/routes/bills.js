const express = require('express');

const Product = require('../models/Product');
const Bill = require('../models/Bill');
const ShopProfile = require('../models/ShopProfile');
const { renderInvoiceHTML } = require('../templates/invoice');

const router = express.Router();


// ============================================================
// Generate next invoice number
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


// ============================================================
// GET all bills
// ============================================================

router.get('/', async (req, res) => {
  try {

    const bills = await Bill
      .find({})
      .sort({ createdAt: -1 });

    res.json(bills);

  } catch (err) {

    res.status(500).json({
      error: err.message
    });

  }
});


// ============================================================
// GET single bill
// ============================================================

router.get('/:id', async (req, res) => {
  try {

    const bill = await Bill.findById(req.params.id);

    if (!bill) {
      return res.status(404).json({
        error: 'Bill not found'
      });
    }

    res.json(bill);

  } catch (err) {

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


    // --------------------------------------------------------
    // Validate items
    // --------------------------------------------------------

    if (!Array.isArray(items) || items.length === 0) {

      return res.status(400).json({
        error: 'Bill must contain at least one product'
      });

    }


    // --------------------------------------------------------
    // Determine interstate
    // --------------------------------------------------------

    const interstate = Boolean(is_interstate);


    // --------------------------------------------------------
    // Generate invoice number
    // --------------------------------------------------------

    const invoice_no = await nextInvoiceNo();


    // --------------------------------------------------------
    // Totals
    //
    // subtotalDiscounted / finalInclusiveTotal both track the amount
    // AFTER each line's discount_percent has been applied — this is what
    // the customer is actually being charged. (The old bug: `subtotal`
    // was accumulating the pre-discount gross amount, so a discounted
    // sale still billed the customer as if no discount had been given.)
    // --------------------------------------------------------

    let subtotalDiscounted = 0; // = taxableTotal, kept as its own variable for clarity

    let finalInclusiveTotal = 0; // GST-inclusive, post-discount — what grand_total is built from

    let taxableTotal = 0;

    let cgstTotal = 0;

    let sgstTotal = 0;

    let igstTotal = 0;


    const billItems = [];


    // ========================================================
    // PROCESS EACH PRODUCT
    // ========================================================

    for (const line of items) {

      const product = await Product.findById(line.product_id);


      if (!product) {

        throw new Error(
          `Product not found: ${line.product_id}`
        );

      }


      // ------------------------------------------------------
      // Quantity
      // ------------------------------------------------------

      const qty = Number(line.qty) || 1;


      if (qty <= 0) {

        throw new Error(
          `Invalid quantity for product: ${product.name}`
        );

      }


      // ------------------------------------------------------
      // Stock validation
      // ------------------------------------------------------

      if (Number(product.stock_qty) < qty) {

        throw new Error(
          `Insufficient stock for ${product.name}. Available: ${product.stock_qty}`
        );

      }


      // ------------------------------------------------------
      // MRP
      //
      // Your Product model doesn't have a separate `mrp` field today —
      // only `selling_price`, which IS the MRP (GST-inclusive, as set in
      // Inventory). Falls back to product.mrp first in case you add that
      // field to the Product schema later.
      // ------------------------------------------------------

      const mrp =
        Number(product.mrp || product.selling_price) || 0;


      // ------------------------------------------------------
      // SELLING PRICE
      //
      // IMPORTANT:
      // selling_price ALREADY INCLUDES GST
      // ------------------------------------------------------

      const sellingPrice =
        Number(product.selling_price) || 0;


      const gstRate =
        Number(product.gst_rate) || 0;


      // ------------------------------------------------------
      // Gross customer amount
      //
      // Example:
      // selling price = ₹1180
      // qty = 2
      //
      // grossInclusive = ₹2360
      // ------------------------------------------------------

      const grossInclusive =
        qty * sellingPrice;


      // ------------------------------------------------------
      // Line discount
      // ------------------------------------------------------

      const discountPercent =
        Number(line.discount_percent) || 0;


      const discountAmount =
        grossInclusive *
        discountPercent /
        100;


      // Amount customer actually pays for this line
      const finalInclusiveAmount =
        grossInclusive - discountAmount;


      // ------------------------------------------------------
      // EXTRACT GST FROM GST-INCLUSIVE PRICE
      //
      // Example:
      //
      // Selling price = ₹1180
      // GST = 18%
      //
      // Taxable:
      //
      // 1180 / 1.18 = 1000
      //
      // GST:
      //
      // 1180 - 1000 = 180
      // ------------------------------------------------------

      let taxable = finalInclusiveAmount;

      let gstAmount = 0;


      if (gstRate > 0) {

        taxable =
          finalInclusiveAmount /
          (1 + gstRate / 100);

        gstAmount =
          finalInclusiveAmount - taxable;

      }


      // ------------------------------------------------------
      // CGST / SGST / IGST
      // ------------------------------------------------------

      let cgst = 0;

      let sgst = 0;

      let igst = 0;


      if (interstate) {

        igst = gstAmount;

      } else {

        cgst = gstAmount / 2;

        sgst = gstAmount / 2;

      }


      // ------------------------------------------------------
      // Final line total
      //
      // GST is already included.
      // DO NOT add GST again.
      // ------------------------------------------------------

      const lineTotal =
        finalInclusiveAmount;


      // ------------------------------------------------------
      // Save bill item
      // ------------------------------------------------------

      billItems.push({

        product_id: product._id,

        product_name: product.name,

        hsn_code: product.hsn_code,

        unit: product.unit,

        qty: qty,

        mrp: mrp,

        // Selling price INCLUDING GST
        rate: sellingPrice,

        discount_percent: discountPercent,

        taxable_value: taxable,

        gst_rate: gstRate,

        cgst_amount: cgst,

        sgst_amount: sgst,

        igst_amount: igst,

        line_total: lineTotal

      });


      // ------------------------------------------------------
      // Add totals — all post-discount
      // ------------------------------------------------------

      subtotalDiscounted += taxable;

      finalInclusiveTotal += finalInclusiveAmount;

      taxableTotal += taxable;

      cgstTotal += cgst;

      sgstTotal += sgst;

      igstTotal += igst;


      // ------------------------------------------------------
      // Reduce stock
      // ------------------------------------------------------

      product.stock_qty =
        Number(product.stock_qty) - qty;


      await product.save();

    }


    // ========================================================
    // EXTRA BILL DISCOUNT
    // ========================================================

    const extraDiscount =
      Number(discount_amount) || 0;


    // --------------------------------------------------------
    // Amount before rounding
    //
    // Built from the POST-DISCOUNT, GST-inclusive total — not the raw
    // undiscounted subtotal — so per-item discounts actually reduce what
    // the customer is charged.
    // --------------------------------------------------------

    const inclusiveBeforeRound =
      finalInclusiveTotal - extraDiscount;


    // --------------------------------------------------------
    // Grand total
    // --------------------------------------------------------

    const grandTotal =
      Math.round(inclusiveBeforeRound);


    const roundOff =
      grandTotal - inclusiveBeforeRound;


    // ========================================================
    // CREATE BILL
    // ========================================================

    const bill = await Bill.create({

      invoice_no,

      customer_name:
        customer_name || 'Walk-in Customer',

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
        Number(paid_amount) || grandTotal,

      // The actual charged amount, net of every line discount, net of GST
      // — matches the "Subtotal" line shown on the New Bill page.
      subtotal:
        subtotalDiscounted,

      discount_amount:
        extraDiscount,

      taxable_value:
        taxableTotal,

      cgst_amount:
        cgstTotal,

      sgst_amount:
        sgstTotal,

      igst_amount:
        igstTotal,

      round_off:
        roundOff,

      grand_total:
        grandTotal,

      status:
        'ACTIVE',

      items:
        billItems

    });


    // ========================================================
    // RESPONSE
    // ========================================================

    res.status(201).json(bill);


  } catch (err) {

    console.error('Create bill error:', err);

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


    // --------------------------------------------------------
    // Restore stock
    // --------------------------------------------------------

    for (const item of bill.items) {

      const product =
        await Product.findById(item.product_id);


      if (product) {

        product.stock_qty =
          Number(product.stock_qty) +
          Number(item.qty || 0);

        await product.save();

      }

    }


    bill.status = 'CANCELLED';

    await bill.save();


    res.json(bill);


  } catch (err) {

    console.error('Cancel bill error:', err);

    res.status(400).json({
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
      await Bill.findById(req.params.id);


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
