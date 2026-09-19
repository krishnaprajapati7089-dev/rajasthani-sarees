const express = require('express');
const Product = require('../models/Product');
const Purchase = require('../models/Purchase');

const router = express.Router();


// ============================================================
// GET ALL PURCHASES
// ============================================================

router.get('/', async (req, res) => {
  try {

    const purchases = await Purchase
      .find()
      .sort({ createdAt: -1 });

    res.json(purchases);

  } catch (err) {

    res.status(500).json({
      error: err.message
    });

  }
});


// ============================================================
// GET ONE PURCHASE
// ============================================================

router.get('/:id', async (req, res) => {
  try {

    const purchase =
      await Purchase.findById(req.params.id);

    if (!purchase) {

      return res.status(404).json({
        error: 'Purchase not found'
      });

    }

    res.json(purchase);

  } catch (err) {

    res.status(500).json({
      error: err.message
    });

  }
});


// ============================================================
// CREATE PURCHASE
// ============================================================

router.post('/', async (req, res) => {

  try {

    const {
      supplier,
      supplier_gstin,
      invoice_number,
      invoice_date,
      supplier_state,
      reference,
      items
    } = req.body;


    // --------------------------------------------------------
    // Validation
    // --------------------------------------------------------

    if (!supplier || !invoice_number) {

      return res.status(400).json({
        error:
          'Supplier and invoice number are required'
      });

    }


    if (!Array.isArray(items) || items.length === 0) {

      return res.status(400).json({
        error:
          'At least one item is required'
      });

    }


    const purchaseItems = [];

    let taxableTotal = 0;

    let gstTotal = 0;

    const createdProducts = [];


    // ========================================================
    // PROCESS ITEMS
    // ========================================================

    for (const line of items) {

      const qty =
        Number(line.qty) || 0;

      const purchaseRate =
        Number(
          line.purchase_rate ?? line.rate
        ) || 0;

      const mrp =
        Number(line.mrp) || 0;

      const sellingPrice =
        Number(line.selling_price) || 0;

      const gstRate =
        Number(line.gst_rate) || 0;


      // ------------------------------------------------------
      // Validation
      // ------------------------------------------------------

      if (qty <= 0) {

        throw new Error(
          `Invalid quantity for ${line.description}`
        );

      }


      if (purchaseRate < 0) {

        throw new Error(
          `Invalid purchase price for ${line.description}`
        );

      }


      if (sellingPrice < 0) {

        throw new Error(
          `Invalid selling price for ${line.description}`
        );

      }


      // ------------------------------------------------------
      // Purchase bill calculation
      //
      // Purchase rate is treated as pre-GST here,
      // same as your existing purchase system.
      // ------------------------------------------------------

      const base =
        qty * purchaseRate;

      const gst =
        base * gstRate / 100;

      const amount =
        base + gst;


      // ======================================================
      // FIND EXISTING PRODUCT
      // ======================================================

      let product = null;


      if (line.product_id) {

        product =
          await Product.findById(
            line.product_id
          );

      }


      if (!product && line.item_code) {

        product =
          await Product.findOne({
            barcode: line.item_code
          });

      }


      // ======================================================
      // EXISTING PRODUCT
      // ======================================================

      if (product) {

        product.stock_qty =
          Number(product.stock_qty || 0) + qty;


        // Update purchase price
        product.purchase_price =
          purchaseRate;


        // Update MRP if supplied
        if (mrp > 0) {

          product.mrp = mrp;

        }


        // Update selling price if supplied
        if (sellingPrice > 0) {

          product.selling_price =
            sellingPrice;

        }


        // Update GST
        product.gst_rate =
          gstRate;


        // Update HSN if supplied
        if (line.hsn_code) {

          product.hsn_code =
            line.hsn_code;

        }


        await product.save();


      }

      // ======================================================
      // NEW PRODUCT
      // ======================================================

      else {

        product =
          await Product.create({

            name:
              line.description ||
              'Unnamed item',

            barcode:
              line.item_code ||
              undefined,

            hsn_code:
              line.hsn_code ||
              '',

            purchase_price:
              purchaseRate,

            mrp:
              mrp,

            // IMPORTANT:
            // Selling price comes from user input.
            selling_price:
              sellingPrice,

            gst_rate:
              gstRate,

            stock_qty:
              qty,

            reorder_level:
              5

          });

      }


      // ------------------------------------------------------
      // Save created/updated product
      // ------------------------------------------------------

      createdProducts.push({

        _id:
          product._id,

        name:
          product.name,

        barcode:
          product.barcode,

        mrp:
          product.mrp,

        purchase_price:
          product.purchase_price,

        selling_price:
          product.selling_price,

        gst_rate:
          product.gst_rate,

        stock_qty:
          product.stock_qty

      });


      // ======================================================
      // PURCHASE ITEM
      // ======================================================

      purchaseItems.push({

        item_code:
          line.item_code || '',

        description:
          line.description,

        hsn_code:
          line.hsn_code || '',

        qty,

        mrp,

        purchase_rate:
          purchaseRate,

        selling_price:
          sellingPrice,

        // Keep rate for compatibility
        rate:
          purchaseRate,

        gst_rate:
          gstRate,

        amount,

        product_id:
          product._id

      });


      taxableTotal += base;

      gstTotal += gst;

    }


    // ========================================================
    // CREATE PURCHASE RECORD
    // ========================================================

    const purchase =
      await Purchase.create({

        supplier,

        supplier_gstin:
          supplier_gstin || '',

        invoice_number,

        invoice_date:
          invoice_date
            ? new Date(invoice_date)
            : new Date(),

        supplier_state:
          supplier_state || '',

        reference:
          reference || '',

        items:
          purchaseItems,

        taxable_amount:
          taxableTotal,

        gst_total:
          gstTotal,

        grand_total:
          taxableTotal + gstTotal

      });


    // ========================================================
    // RESPONSE
    // ========================================================

    res.status(201).json({

      ...purchase.toObject(),

      products:
        createdProducts

    });


  } catch (err) {

    console.error(
      'Purchase save error:',
      err
    );

    res.status(400).json({
      error: err.message
    });

  }

});


module.exports = router;
