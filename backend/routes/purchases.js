// routes/purchases.js

const express = require('express');

const Product = require('../models/Product');
const Purchase = require('../models/Purchase');

const { generateUniqueBarcode } = require('../utils/barcode');

const router = express.Router();


// ============================================================
// GENERATE SHORT UNIQUE BILL NUMBER
// Example: P582431
// ============================================================

async function generateUniqueBillNumber() {

  let billNumber;
  let exists = true;

  while (exists) {

    const number = Math.floor(
      100000 + Math.random() * 900000
    );

    billNumber = `P${number}`;

    exists = await Purchase.exists({
      unique_bill_number: billNumber
    });
  }

  return billNumber;
}


// ============================================================
// CALCULATE TOTAL
// ============================================================

function calculateTotals(
  taxableAmount,
  gstTotal,
  extraCharges,
  discountPercent
) {

  taxableAmount = Number(taxableAmount) || 0;
  gstTotal = Number(gstTotal) || 0;
  extraCharges = Number(extraCharges) || 0;
  discountPercent = Number(discountPercent) || 0;

  if (extraCharges < 0) {
    extraCharges = 0;
  }

  if (discountPercent < 0) {
    discountPercent = 0;
  }

  const grossTotal =
    taxableAmount + gstTotal;

  const totalBeforeDiscount =
    grossTotal + extraCharges;

  const discountAmount =
    totalBeforeDiscount *
    discountPercent /
    100;

  const grandTotal =
    totalBeforeDiscount -
    discountAmount;

  return {
    taxableAmount,
    gstTotal,
    extraCharges,
    discountPercent,
    discountAmount,
    grandTotal
  };
}


// ============================================================
// ADD STOCK / CREATE PRODUCT
// ============================================================

async function addStockForItem(line) {

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


  let product = null;


  // ----------------------------------------------------------
  // FIND PRODUCT BY ID
  // ----------------------------------------------------------

  if (line.product_id) {

    product =
      await Product.findById(
        line.product_id
      );
  }


  // ----------------------------------------------------------
  // FIND PRODUCT BY BARCODE
  // ----------------------------------------------------------

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


  // ----------------------------------------------------------
  // EXISTING PRODUCT
  // ----------------------------------------------------------

  if (product) {

    product.stock_qty =
      Number(product.stock_qty || 0) +
      qty;

    product.purchase_price =
      purchaseRate;

    product.mrp =
      mrp;

    product.selling_price =
      sellingPrice;

    product.gst_rate =
      gstRate;


    if (line.hsn_code) {

      product.hsn_code =
        line.hsn_code;
    }


    await product.save();

    return product;
  }


  // ----------------------------------------------------------
  // NEW PRODUCT
  // ----------------------------------------------------------

  let barcodeValue;


  if (
    line.item_code &&
    String(line.item_code).trim()
  ) {

    barcodeValue =
      String(line.item_code).trim();

  } else {

    barcodeValue =
      await generateUniqueBarcode(
        Product
      );
  }


  product =
    await Product.create({

      name:
        line.description ||
        'Unnamed item',

      barcode:
        barcodeValue,

      hsn_code:
        line.hsn_code || '',

      purchase_price:
        purchaseRate,

      mrp:
        mrp,

      selling_price:
        sellingPrice,

      gst_rate:
        gstRate,

      stock_qty:
        qty,

      reorder_level:
        5
    });


  return product;
}


// ============================================================
// REMOVE STOCK
// Used during EDIT and DELETE
// ============================================================

async function removeStockForPurchase(
  purchase
) {

  if (
    !purchase ||
    !Array.isArray(purchase.items)
  ) {
    return;
  }


  for (
    const item of purchase.items
  ) {

    const qty =
      Number(item.qty) || 0;


    if (qty <= 0) {
      continue;
    }


    let product = null;


    // --------------------------------------------------------
    // FIND BY PRODUCT ID
    // --------------------------------------------------------

    if (item.product_id) {

      product =
        await Product.findById(
          item.product_id
        );
    }


    // --------------------------------------------------------
    // FIND BY BARCODE
    // --------------------------------------------------------

    if (
      !product &&
      item.item_code
    ) {

      product =
        await Product.findOne({
          barcode:
            String(item.item_code).trim()
        });
    }


    // --------------------------------------------------------
    // REMOVE STOCK
    // --------------------------------------------------------

    if (product) {

      product.stock_qty =
        Math.max(
          0,
          Number(product.stock_qty || 0) -
          qty
        );


      await product.save();
    }
  }
}


// ============================================================
// GET ALL PURCHASES
// ============================================================

router.get('/', async (req, res) => {

  try {

    const purchases =
      await Purchase
        .find()
        .sort({
          createdAt: -1
        });


    res.json(purchases);

  } catch (err) {

    console.error(
      'Get purchases error:',
      err
    );

    res.status(500).json({
      error: err.message
    });
  }
});


// ============================================================
// SEARCH PURCHASE BILLS
//
// Search:
// - Party / Supplier name
// - Unique bill number
// - Invoice number
//
// IMPORTANT:
// Keep this BEFORE /:id
// ============================================================

router.get('/search', async (req, res) => {

  try {

    const q =
      String(
        req.query.q || ''
      ).trim();


    if (!q) {

      return res.json([]);
    }


    const escaped =
      q.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      );


    const regex =
      new RegExp(
        escaped,
        'i'
      );


    const purchases =
      await Purchase
        .find({
          $or: [

            {
              supplier:
                regex
            },

            {
              unique_bill_number:
                regex
            },

            {
              invoice_number:
                regex
            }

          ]
        })
        .sort({
          createdAt: -1
        })
        .limit(50);


    res.json(purchases);

  } catch (err) {

    console.error(
      'Purchase search error:',
      err
    );

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
      await Purchase.findById(
        req.params.id
      );


    if (!purchase) {

      return res.status(404).json({
        error:
          'Purchase not found'
      });
    }


    res.json(purchase);

  } catch (err) {

    console.error(
      'Get purchase error:',
      err
    );

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
      unique_bill_number,
      bill_image_url,
      dealer_discount_percent,
      extra_charges,
      items
    } = req.body;


    // --------------------------------------------------------
    // VALIDATION
    // --------------------------------------------------------

    if (
      !supplier ||
      !invoice_number
    ) {

      return res.status(400).json({
        error:
          'Supplier and invoice number are required'
      });
    }


    if (
      !Array.isArray(items) ||
      items.length === 0
    ) {

      return res.status(400).json({
        error:
          'At least one item is required'
      });
    }


    // --------------------------------------------------------
    // UNIQUE BILL NUMBER
    // --------------------------------------------------------

    let finalBillNumber;


    if (
      unique_bill_number &&
      String(unique_bill_number).trim()
    ) {

      finalBillNumber =
        String(
          unique_bill_number
        )
          .trim()
          .toUpperCase();

    } else {

      finalBillNumber =
        await generateUniqueBillNumber();
    }


    // --------------------------------------------------------
    // CHECK DUPLICATE BILL NUMBER
    // --------------------------------------------------------

    const duplicate =
      await Purchase.findOne({
        unique_bill_number:
          finalBillNumber
      });


    if (duplicate) {

      return res.status(409).json({
        error:
          `Bill number ${finalBillNumber} already exists`
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
    // PROCESS EVERY ITEM
    // ========================================================

    for (
      const line of items
    ) {

      const qty =
        Number(line.qty) || 0;


      const purchaseRate =
        Number(
          line.purchase_rate ??
          line.rate
        ) || 0;


      const mrp =
        Number(line.mrp) || 0;


      const sellingPrice =
        Number(
          line.selling_price
        ) || 0;


      const gstRate =
        Number(
          line.gst_rate
        ) || 0;


      // ------------------------------------------------------
      // QUANTITY VALIDATION
      // ------------------------------------------------------

      if (qty <= 0) {

        throw new Error(
          `Invalid quantity for ${
            line.description ||
            'item'
          }`
        );
      }


      // ------------------------------------------------------
      // SELLING PRICE VALIDATION
      // ------------------------------------------------------

      if (sellingPrice <= 0) {

        throw new Error(
          `Selling Price is required for ${
            line.description ||
            'item'
          }`
        );
      }


      // ------------------------------------------------------
      // SELLING PRICE CANNOT EXCEED MRP
      // ------------------------------------------------------

      if (
        mrp > 0 &&
        sellingPrice > mrp
      ) {

        throw new Error(
          `Selling Price cannot be greater than MRP for ${
            line.description ||
            'item'
          }`
        );
      }


      // ------------------------------------------------------
      // CALCULATE ITEM
      // ------------------------------------------------------

      const base =
        qty *
        purchaseRate;


      const gst =
        base *
        gstRate /
        100;


      const amount =
        base + gst;


      // ------------------------------------------------------
      // ADD STOCK
      // ------------------------------------------------------

      const product =
        await addStockForItem(
          line
        );


      touchedProductIds.push(
        product._id
      );


      // ------------------------------------------------------
      // SAVE ITEM
      // ------------------------------------------------------

      purchaseItems.push({

        item_code:
          product.barcode ||
          line.item_code ||
          '',

        description:
          line.description ||
          product.name,

        category:
          line.category ||
          '',

        hsn_code:
          line.hsn_code ||
          product.hsn_code ||
          '',

        qty,

        mrp,

        purchase_rate:
          purchaseRate,

        selling_price:
          sellingPrice,

        rate:
          purchaseRate,

        gst_rate:
          gstRate,

        amount,

        product_id:
          product._id
      });


      taxableTotal +=
        base;

      gstTotal +=
        gst;
    }


    // ========================================================
    // FINAL BILL TOTAL
    // ========================================================

    const totals =
      calculateTotals(
        taxableTotal,
        gstTotal,
        extra_charges,
        dealer_discount_percent
      );


    // ========================================================
    // CREATE PURCHASE DOCUMENT
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

        unique_bill_number:
          finalBillNumber,

        bill_image_url:
          bill_image_url || '',

        items:
          purchaseItems,

        taxable_amount:
          totals.taxableAmount,

        gst_total:
          totals.gstTotal,

        extra_charges:
          totals.extraCharges,

        dealer_discount_percent:
          totals.discountPercent,

        dealer_discount_amount:
          totals.discountAmount,

        grand_total:
          totals.grandTotal
      });


    // ========================================================
    // GET UPDATED PRODUCTS
    // ========================================================

    const products =
      await Product.find({
        _id: {
          $in:
            touchedProductIds
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


    if (
      err.code === 11000
    ) {

      return res.status(409).json({
        error:
          'This unique bill number already exists. Please generate another number.'
      });
    }


    res.status(400).json({
      error:
        err.message
    });
  }
});


// ============================================================
// UPDATE / EDIT PURCHASE
// ============================================================

router.put('/:id', async (req, res) => {

  try {

    const purchase =
      await Purchase.findById(
        req.params.id
      );


    if (!purchase) {

      return res.status(404).json({
        error:
          'Purchase not found'
      });
    }


    const {
      supplier,
      supplier_gstin,
      invoice_number,
      invoice_date,
      supplier_state,
      reference,
      unique_bill_number,
      bill_image_url,
      dealer_discount_percent,
      extra_charges,
      items
    } = req.body;


    // --------------------------------------------------------
    // VALIDATION
    // --------------------------------------------------------

    if (
      !supplier ||
      !invoice_number
    ) {

      return res.status(400).json({
        error:
          'Supplier and invoice number are required'
      });
    }


    if (
      !Array.isArray(items) ||
      items.length === 0
    ) {

      return res.status(400).json({
        error:
          'At least one item is required'
      });
    }


    // --------------------------------------------------------
    // BILL NUMBER
    // --------------------------------------------------------

    let finalBillNumber =
      unique_bill_number &&
      String(
        unique_bill_number
      ).trim()
        ? String(
            unique_bill_number
          )
            .trim()
            .toUpperCase()
        : purchase.unique_bill_number;


    // --------------------------------------------------------
    // CHECK DUPLICATE
    // --------------------------------------------------------

    const duplicate =
      await Purchase.findOne({

        unique_bill_number:
          finalBillNumber,

        _id: {
          $ne:
            purchase._id
        }

      });


    if (duplicate) {

      return res.status(409).json({
        error:
          `Bill number ${finalBillNumber} already exists`
      });
    }


    // ========================================================
    // FIRST REMOVE OLD STOCK
    // ========================================================

    await removeStockForPurchase(
      purchase
    );


    // ========================================================
    // PROCESS NEW ITEMS
    // ========================================================

    const purchaseItems = [];

    const touchedProductIds = [];

    let taxableTotal = 0;

    let gstTotal = 0;


    for (
      const line of items
    ) {

      const qty =
        Number(line.qty) || 0;


      const purchaseRate =
        Number(
          line.purchase_rate ??
          line.rate
        ) || 0;


      const mrp =
        Number(line.mrp) || 0;


      const sellingPrice =
        Number(
          line.selling_price
        ) || 0;


      const gstRate =
        Number(
          line.gst_rate
        ) || 0;


      if (qty <= 0) {

        throw new Error(
          `Invalid quantity for ${
            line.description ||
            'item'
          }`
        );
      }


      if (sellingPrice <= 0) {

        throw new Error(
          `Selling Price is required for ${
            line.description ||
            'item'
          }`
        );
      }


      if (
        mrp > 0 &&
        sellingPrice > mrp
      ) {

        throw new Error(
          `Selling Price cannot be greater than MRP for ${
            line.description ||
            'item'
          }`
        );
      }


      const base =
        qty *
        purchaseRate;


      const gst =
        base *
        gstRate /
        100;


      const amount =
        base + gst;


      // Add edited stock
      const product =
        await addStockForItem(
          line
        );


      touchedProductIds.push(
        product._id
      );


      purchaseItems.push({

        item_code:
          product.barcode ||
          line.item_code ||
          '',

        description:
          line.description ||
          product.name,

        category:
          line.category ||
          '',

        hsn_code:
          line.hsn_code ||
          product.hsn_code ||
          '',

        qty,

        mrp,

        purchase_rate:
          purchaseRate,

        selling_price:
          sellingPrice,

        rate:
          purchaseRate,

        gst_rate:
          gstRate,

        amount,

        product_id:
          product._id
      });


      taxableTotal +=
        base;

      gstTotal +=
        gst;
    }


    // ========================================================
    // CALCULATE NEW TOTAL
    // ========================================================

    const totals =
      calculateTotals(
        taxableTotal,
        gstTotal,
        extra_charges,
        dealer_discount_percent
      );


    // ========================================================
    // UPDATE DOCUMENT
    // ========================================================

    purchase.supplier =
      supplier;

    purchase.supplier_gstin =
      supplier_gstin || '';

    purchase.invoice_number =
      invoice_number;

    purchase.invoice_date =
      invoice_date
        ? new Date(invoice_date)
        : new Date();

    purchase.supplier_state =
      supplier_state || '';

    purchase.reference =
      reference || '';

    purchase.unique_bill_number =
      finalBillNumber;

    purchase.bill_image_url =
      bill_image_url || '';

    purchase.items =
      purchaseItems;

    purchase.taxable_amount =
      totals.taxableAmount;

    purchase.gst_total =
      totals.gstTotal;

    purchase.extra_charges =
      totals.extraCharges;

    purchase.dealer_discount_percent =
      totals.discountPercent;

    purchase.dealer_discount_amount =
      totals.discountAmount;

    purchase.grand_total =
      totals.grandTotal;


    await purchase.save();


    // ========================================================
    // GET PRODUCTS
    // ========================================================

    const products =
      await Product.find({
        _id: {
          $in:
            touchedProductIds
        }
      }).select(
        'name barcode mrp purchase_price selling_price gst_rate stock_qty'
      );


    res.json({

      ...purchase.toObject(),

      products

    });


  } catch (err) {

    console.error(
      'Purchase update error:',
      err
    );


    if (
      err.code === 11000
    ) {

      return res.status(409).json({
        error:
          'This unique bill number already exists.'
      });
    }


    res.status(400).json({
      error:
        err.message
    });
  }
});


// ============================================================
// DELETE PURCHASE
// ============================================================

router.delete('/:id', async (req, res) => {

  try {

    const purchase =
      await Purchase.findById(
        req.params.id
      );


    if (!purchase) {

      return res.status(404).json({
        error:
          'Purchase not found'
      });
    }


    // --------------------------------------------------------
    // REMOVE STOCK
    // --------------------------------------------------------

    await removeStockForPurchase(
      purchase
    );


    // --------------------------------------------------------
    // DELETE BILL
    // --------------------------------------------------------

    await Purchase.findByIdAndDelete(
      req.params.id
    );


    res.json({

      success: true,

      message:
        `Purchase bill ${
          purchase.unique_bill_number || ''
        } deleted successfully`

    });


  } catch (err) {

    console.error(
      'Purchase delete error:',
      err
    );


    res.status(500).json({
      error:
        err.message
    });
  }
});


// ============================================================
// EXPORT
// ============================================================

module.exports = router;
