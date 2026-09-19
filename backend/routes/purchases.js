// routes/purchases.js
// Records supplier purchases, updates inventory, stores MRP/purchase/selling prices,
// generates a barcode when needed, and returns products for printable labels.

const express = require('express');
const Product = require('../models/Product');
const Purchase = require('../models/Purchase');
const { generateUniqueBarcode } = require('../utils/barcode');

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
// GET SINGLE PURCHASE
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
    // VALIDATION
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


    // --------------------------------------------------------
    // TOTALS
    // --------------------------------------------------------

    const purchaseItems = [];

    const touchedProductIds = [];

    let taxableTotal = 0;

    let gstTotal = 0;


    // ========================================================
    // PROCESS EACH ITEM
    // ========================================================

    for (const line of items) {

      const qty =
        Number(line.qty) || 0;


      // Purchase Rate
      const purchaseRate =
        Number(
          line.purchase_rate ?? line.rate
        ) || 0;


      // MRP
      const mrp =
        Number(line.mrp) || 0;


      // Selling Price INCLUDING GST
      const sellingPrice =
        Number(line.selling_price) || 0;


      // GST %
      const gstRate =
        Number(line.gst_rate) || 0;


      // ------------------------------------------------------
      // VALIDATE QUANTITY
      // ------------------------------------------------------

      if (qty <= 0) {

        throw new Error(
          `Invalid quantity for ${
            line.description || 'item'
          }`
        );

      }


      // ------------------------------------------------------
      // VALIDATE SELLING PRICE
      // ------------------------------------------------------

      if (sellingPrice <= 0) {

        throw new Error(
          `Selling Price is required for ${
            line.description || 'item'
          }`
        );

      }


      // ------------------------------------------------------
      // SELLING PRICE SHOULD NOT EXCEED MRP
      // ------------------------------------------------------

      if (
        mrp > 0 &&
        sellingPrice > mrp
      ) {

        throw new Error(
          `Selling Price cannot be greater than MRP for ${
            line.description || 'item'
          }`
        );

      }


      // ======================================================
      // PURCHASE BILL CALCULATION
      //
      // Purchase Rate is treated as taxable/base amount.
      //
      // Example:
      //
      // Purchase Rate = ₹980
      // GST = 5%
      //
      // GST = ₹49
      // Total = ₹1029
      // ======================================================

      const base =
        qty * purchaseRate;


      const gst =
        base * gstRate / 100;


      const amount =
        base + gst;


      // ======================================================
      // FIND PRODUCT
      // ======================================================

      let product = null;


      // First try product ID
      if (line.product_id) {

        product =
          await Product.findById(
            line.product_id
          );

      }


      // Then try barcode
      if (
        !product &&
        line.item_code
      ) {

        product =
          await Product.findOne({
            barcode:
              String(line.item_code).trim()
          });

      }


      // ======================================================
      // EXISTING PRODUCT
      // ======================================================

      if (product) {

        // Add purchased quantity to existing stock
        product.stock_qty =
          Number(product.stock_qty || 0) +
          qty;


        // Save purchase price
        product.purchase_price =
          purchaseRate;


        // Save MRP
        product.mrp =
          mrp;


        // Save selling price
        product.selling_price =
          sellingPrice;


        // Save GST
        product.gst_rate =
          gstRate;


        // Update HSN if provided
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

        // Use supplied barcode.
        // If blank, generate a unique barcode.
        const barcodeValue =
          line.item_code &&
          String(line.item_code).trim()

            ? String(line.item_code).trim()

            : await generateUniqueBarcode(
                Product
              );


        product =
          await Product.create({

            name:
              line.description ||
              'Unnamed item',

            barcode:
              barcodeValue,

            hsn_code:
              line.hsn_code || '',

            // Supplier purchase price
            purchase_price:
              purchaseRate,

            // Product MRP
            mrp:
              mrp,

            // Customer selling price INCLUDING GST
            selling_price:
              sellingPrice,

            // GST rate
            gst_rate:
              gstRate,

            // Initial stock
            stock_qty:
              qty,

            reorder_level:
              5

          });

      }


      // ======================================================
      // SAVE PRODUCT ID
      // ======================================================

      touchedProductIds.push(
        product._id
      );


      // ======================================================
      // SAVE PURCHASE ITEM
      // ======================================================

      purchaseItems.push({

        // Always save the actual product barcode
        item_code:
          product.barcode ||
          line.item_code ||
          '',

        description:
          line.description ||
          product.name,

        hsn_code:
          line.hsn_code ||
          product.hsn_code ||
          '',

        qty,

        // MRP
        mrp,

        // Purchase Rate
        purchase_rate:
          purchaseRate,

        // Selling Price
        selling_price:
          sellingPrice,

        // Keep rate for compatibility
        rate:
          purchaseRate,

        // GST
        gst_rate:
          gstRate,

        // Purchase amount
        amount,

        // Product reference
        product_id:
          product._id

      });


      // ======================================================
      // TOTALS
      // ======================================================

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
    // GET PRODUCTS FOR FRONTEND
    // ========================================================

    const products =
      await Product.find({
        _id: {
          $in: touchedProductIds
        }
      }).select(
        'name barcode mrp purchase_price selling_price gst_rate stock_qty'
      );


    // ========================================================
    // RESPONSE
    // ========================================================

    res.status(201).json({

      ...purchase.toObject(),

      products

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
