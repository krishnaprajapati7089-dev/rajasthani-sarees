// routes/purchases.js

const express = require('express');

const Product = require('../models/Product');
const Purchase = require('../models/Purchase');

const { generateUniqueBarcode } = require('../utils/barcode');

const router = express.Router();

const round2 = (v) =>
  Math.round((Number(v) + Number.EPSILON) * 100) / 100;


// ============================================================
// GENERATE SHORT UNIQUE BILL NUMBER (Example: P582431)
// ============================================================

async function generateUniqueBillNumber() {
  let billNumber;
  let exists = true;

  while (exists) {
    const number = Math.floor(100000 + Math.random() * 900000);
    billNumber = `P${number}`;

    exists = await Purchase.exists({
      unique_bill_number: billNumber
    });
  }

  return billNumber;
}


// ============================================================
// BILL SUMMARY TOTALS
//
// Dealer discount is a fixed ₹ amount, NOT percentage.
// GST remains a percentage selected in the Bill Summary.
//
// GST base:
// If Advance payment exists = Net Total - Advance
// Otherwise = full Net Total
// ============================================================

function calculateTotals(
  taxableAmount,
  extraCharges,
  discountAmount,
  gstPercent,
  payments
) {
  taxableAmount = Math.max(0, Number(taxableAmount) || 0);
  extraCharges = Math.max(0, Number(extraCharges) || 0);
  discountAmount = Math.max(0, Number(discountAmount) || 0);

  gstPercent = Math.min(
    100,
    Math.max(0, Number(gstPercent) || 0)
  );

  // Dealer discount cannot exceed the available amount.
  discountAmount = Math.min(
    discountAmount,
    taxableAmount + extraCharges
  );

  // Net total after discount.
  const netTotal = round2(
    Math.max(
      0,
      taxableAmount + extraCharges - discountAmount
    )
  );

  const normalizedPayments = normalizePayments(payments);

  // Calculate Advance payment.
  const advance = normalizedPayments.reduce((sum, p) => {
    return sum +
      (
        p.type !== 'Cr' && p.mode === 'Advance'
          ? p.amount
          : 0
      );
  }, 0);

  // GST is calculated after subtracting Advance.
  const gstBase = round2(
    advance > 0
      ? Math.max(0, netTotal - advance)
      : netTotal
  );

  const gstTotal = round2(
    gstBase * gstPercent / 100
  );

  // Final bill total includes GST.
  const grandTotal = round2(
    netTotal + gstTotal
  );

  return {
    taxableAmount: round2(taxableAmount),
    gstTotal,
    gstPercent,
    gstBase,
    extraCharges: round2(extraCharges),
    discountPercent: 0,
    discountAmount: round2(discountAmount),
    netTotal,
    grandTotal
  };
}


// ============================================================
// SUPPLIER ACCOUNT (Cr / Dr)
//
// Cr = Amount payable to supplier.
// Dr = Amount paid to supplier.
//
// Balance = Grand Total + Extra Cr - All Dr
//
// Positive balance = Cr (we owe supplier).
// Negative balance = Dr (we paid extra).
// ============================================================

function normalizePayments(list) {
  if (!Array.isArray(list)) return [];

  return list
    .map((p) => ({
      type: p && p.type === 'Cr' ? 'Cr' : 'Dr',

      mode: String(
        (p && p.mode) || 'Other'
      ).trim(),

      amount: Math.max(
        0,
        Number(p && p.amount) || 0
      ),

      date: p && p.date
        ? String(p.date).slice(0, 10)
        : '',

      note: String(
        (p && p.note) || ''
      ).trim()
    }))
    .filter((p) => p.amount > 0);
}


// ============================================================
// CALCULATE PAYMENT SUMMARY
// ============================================================

function calculatePaymentSummary(grandTotal, payments) {
  let advance = 0;
  let cash = 0;
  let other = 0;
  let extraCredit = 0;

  for (const p of payments) {
    if (p.type === 'Cr') {
      extraCredit += p.amount;
    } else if (p.mode === 'Advance') {
      advance += p.amount;
    } else if (p.mode === 'Cash') {
      cash += p.amount;
    } else {
      other += p.amount;
    }
  }

  const balance =
    grandTotal +
    extraCredit -
    advance -
    cash -
    other;

  return {
    advance_paid: round2(advance),
    cash_paid: round2(cash),
    other_paid: round2(other),
    extra_credit: round2(extraCredit),

    balance_amount: round2(
      Math.abs(balance)
    ),

    balance_type: balance >= 0 ? 'Cr' : 'Dr'
  };
}


// ============================================================
// SHARED ACCOUNT FIELDS FOR CREATE AND UPDATE
// ============================================================

function buildAccountFields(body, totals, purchaseItems) {
  const payments = normalizePayments(body.payments);

  let gstPercent = Number(body.gst_percent);

  if (!Number.isFinite(gstPercent)) {
    gstPercent = Number(totals.gstPercent) || 0;
  }

  gstPercent = Math.min(
    100,
    Math.max(0, gstPercent)
  );

  const defaultMargin = Number(
    body.default_margin_percent
  );

  return {
    gst_percent: gstPercent,

    default_margin_percent:
      Number.isFinite(defaultMargin)
        ? Math.max(0, defaultMargin)
        : 70,

    payments,

    ...calculatePaymentSummary(
      totals.grandTotal,
      payments
    )
  };
}


// ============================================================
// PREPARE PURCHASE ITEM
// ============================================================

function preparePurchaseLine(line) {
  const qty = Number(line.qty) || 0;

  const purchaseRate = Number(
    line.purchase_rate ?? line.rate
  ) || 0;

  const mrp = Number(line.mrp) || 0;

  const sellingPrice =
    Number(line.selling_price) || 0;

  const gstRate =
    Number(line.gst_rate) || 0;

  const marginPercent = Math.max(
    0,
    Number(line.margin_percent) || 0
  );

  const category =
    String(line.category || '').trim() || 'General';

  if (qty <= 0) {
    throw new Error(
      `Invalid quantity for ${line.description || 'item'}`
    );
  }

  if (sellingPrice <= 0) {
    throw new Error(
      `Selling Price is required for ${line.description || 'item'}`
    );
  }

  if (mrp > 0 && sellingPrice > mrp) {
    throw new Error(
      `Selling Price cannot be greater than MRP for ${line.description || 'item'}`
    );
  }

  const base = qty * purchaseRate;

  const gst = base * gstRate / 100;

  const amount = base + gst;

  return {
    line,
    qty,
    purchaseRate,
    mrp,
    sellingPrice,
    gstRate,
    marginPercent,
    category,
    base,
    gst,
    amount
  };
}


// ============================================================
// ADD STOCK FOR PURCHASE
// Existing products are updated in bulk.
// New products are inserted together.
// ============================================================

async function addStockForPurchaseItems(items) {
  const preparedItems = items.map(
    preparePurchaseLine
  );

  // Collect product IDs and barcodes.
  const productIds = [];
  const barcodes = [];

  for (const entry of preparedItems) {
    const line = entry.line;

    if (line.product_id) {
      productIds.push(line.product_id);
    }

    if (
      !line.product_id &&
      line.item_code &&
      String(line.item_code).trim()
    ) {
      barcodes.push(
        String(line.item_code).trim()
      );
    }
  }

  // Find existing products.
  const conditions = [];

  if (productIds.length > 0) {
    conditions.push({
      _id: {
        $in: productIds
      }
    });
  }

  if (barcodes.length > 0) {
    conditions.push({
      barcode: {
        $in: [...new Set(barcodes)]
      }
    });
  }

  let existingProducts = [];

  if (conditions.length > 0) {
    existingProducts = await Product.find({
      $or: conditions
    });
  }

  // Build lookup maps.
  const productById = new Map();
  const productByBarcode = new Map();

  for (const product of existingProducts) {
    productById.set(
      String(product._id),
      product
    );

    if (product.barcode) {
      productByBarcode.set(
        String(product.barcode).trim(),
        product
      );
    }
  }

  const operations = [];
  const newProducts = [];
  const resolvedProducts = [];

  // Prepare existing and new products.
  for (const entry of preparedItems) {
    const line = entry.line;

    let product = null;

    if (line.product_id) {
      product =
        productById.get(String(line.product_id)) ||
        null;
    }

    if (
      !product &&
      line.item_code &&
      String(line.item_code).trim()
    ) {
      product =
        productByBarcode.get(
          String(line.item_code).trim()
        ) || null;
    }

    // Update an existing product.
    if (product) {
      const updateSet = {
        purchase_price: entry.purchaseRate,
        mrp: entry.mrp,
        selling_price: entry.sellingPrice,
        gst_rate: entry.gstRate,
        category: entry.category
      };

      if (line.hsn_code) {
        updateSet.hsn_code =
          String(line.hsn_code).trim();
      }

      operations.push({
        updateOne: {
          filter: {
            _id: product._id
          },

          update: {
            $inc: {
              stock_qty: entry.qty
            },

            $set: updateSet
          }
        }
      });

      resolvedProducts.push({
        entry,
        product
      });

      continue;
    }

    // Create a new product.
    let barcodeValue;

    if (
      line.item_code &&
      String(line.item_code).trim()
    ) {
      barcodeValue =
        String(line.item_code).trim();
    } else {
      barcodeValue =
        await generateUniqueBarcode(Product);
    }

    newProducts.push({
      entry,
      barcodeValue
    });
  }

  // Update existing products together.
  if (operations.length > 0) {
    await Product.bulkWrite(
      operations,
      { ordered: true }
    );
  }

  // Insert new products together.
  if (newProducts.length > 0) {
    const documents = newProducts.map(
      ({ entry, barcodeValue }) => {
        const line = entry.line;

        return {
          name: String(
            line.description || 'Unnamed item'
          ).trim(),

          barcode: barcodeValue,

          category: entry.category,

          hsn_code: String(
            line.hsn_code || ''
          ).trim(),

          purchase_price: entry.purchaseRate,

          mrp: entry.mrp,

          selling_price: entry.sellingPrice,

          gst_rate: entry.gstRate,

          stock_qty: entry.qty,

          reorder_level: 5
        };
      }
    );

    const createdProducts =
      await Product.insertMany(documents);

    for (
      let i = 0;
      i < createdProducts.length;
      i++
    ) {
      resolvedProducts.push({
        entry: newProducts[i].entry,
        product: createdProducts[i]
      });
    }
  }

  // Map prepared items to products.
  const productMap = new Map();

  for (const resolved of resolvedProducts) {
    productMap.set(
      resolved.entry,
      resolved.product
    );
  }

  const purchaseItems = [];
  const touchedProductIds = [];

  let taxableTotal = 0;
  let gstTotal = 0;

  for (const entry of preparedItems) {
    const product = productMap.get(entry);

    if (!product) {
      throw new Error(
        `Unable to save product for ${entry.line.description || 'item'}`
      );
    }

    const line = entry.line;

    touchedProductIds.push(product._id);

    purchaseItems.push({
      item_code:
        product.barcode ||
        line.item_code ||
        '',

      description:
        line.description || product.name,

      category: entry.category,

      hsn_code:
        line.hsn_code ||
        product.hsn_code ||
        '',

      qty: entry.qty,

      mrp: entry.mrp,

      margin_percent: entry.marginPercent,

      purchase_rate: entry.purchaseRate,

      selling_price: entry.sellingPrice,

      rate: entry.purchaseRate,

      gst_rate: entry.gstRate,

      // Store taxable amount only.
      // Summary GST is calculated separately.
      amount: round2(entry.base),

      product_id: product._id
    });

    taxableTotal += entry.base;
    gstTotal += entry.gst;
  }

  return {
    purchaseItems,
    touchedProductIds,
    taxableTotal,
    gstTotal
  };
}


// ============================================================
// REMOVE STOCK FROM PURCHASE
// Used while editing or deleting a purchase.
// ============================================================

async function removeStockForPurchase(purchase) {
  if (
    !purchase ||
    !Array.isArray(purchase.items)
  ) {
    return;
  }

  const items = purchase.items.filter(
    (item) => (Number(item.qty) || 0) > 0
  );

  if (items.length === 0) return;

  const productIds = [];
  const barcodes = [];

  for (const item of items) {
    if (item.product_id) {
      productIds.push(item.product_id);
    }

    if (
      item.item_code &&
      String(item.item_code).trim()
    ) {
      barcodes.push(
        String(item.item_code).trim()
      );
    }
  }

  const conditions = [];

  if (productIds.length > 0) {
    conditions.push({
      _id: {
        $in: productIds
      }
    });
  }

  if (barcodes.length > 0) {
    conditions.push({
      barcode: {
        $in: [...new Set(barcodes)]
      }
    });
  }

  if (conditions.length === 0) return;

  const products = await Product.find({
    $or: conditions
  }).select('_id barcode stock_qty');

  const productById = new Map();
  const productByBarcode = new Map();

  for (const product of products) {
    productById.set(
      String(product._id),
      product
    );

    if (product.barcode) {
      productByBarcode.set(
        String(product.barcode).trim(),
        product
      );
    }
  }

  // Combine quantity by product.
  const quantityMap = new Map();

  for (const item of items) {
    let product = null;

    if (item.product_id) {
      product =
        productById.get(String(item.product_id)) ||
        null;
    }

    if (
      !product &&
      item.item_code &&
      String(item.item_code).trim()
    ) {
      product =
        productByBarcode.get(
          String(item.item_code).trim()
        ) || null;
    }

    if (!product) continue;

    const key = String(product._id);
    const qty = Number(item.qty) || 0;

    quantityMap.set(
      key,
      (quantityMap.get(key) || 0) + qty
    );
  }

  const operations = [];

  for (const [productId, qty] of quantityMap) {
    operations.push({
      updateOne: {
        filter: {
          _id: productId
        },

        update: {
          $inc: {
            stock_qty: -qty
          }
        }
      }
    });
  }

  if (operations.length > 0) {
    await Product.bulkWrite(
      operations,
      { ordered: true }
    );
  }
}


// ============================================================
// GET ALL PURCHASES
// ============================================================

router.get('/', async (req, res) => {
  try {
    const purchases = await Purchase.find()
      .sort({ createdAt: -1 });

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
// Searches supplier name, unique bill number, invoice number.
// Keep this route before /:id.
// ============================================================

router.get('/search', async (req, res) => {
  try {
    const q = String(
      req.query.q || ''
    ).trim();

    if (!q) {
      return res.json([]);
    }

    const escaped = q.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );

    const regex = new RegExp(
      escaped,
      'i'
    );

    const purchases = await Purchase.find({
      $or: [
        { supplier: regex },
        { unique_bill_number: regex },
        { invoice_number: regex }
      ]
    })
      .sort({ createdAt: -1 })
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
// SUPPLIER LEDGER
// Total Cr / Dr for one supplier.
// Keep this route before /:id.
// ============================================================

router.get('/ledger/:supplier', async (req, res) => {
  try {
    const name = String(
      req.params.supplier || ''
    ).trim();

    if (!name) {
      return res.status(400).json({
        error: 'Supplier name is required'
      });
    }

    const escaped = name.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );

    const bills = await Purchase.find({
      supplier: new RegExp(
        `^${escaped}$`,
        'i'
      )
    }).sort({
      invoice_date: 1
    });

    let signedBalance = 0;
    let totalBilled = 0;
    let totalPaid = 0;

    const rows = bills.map((b) => {
      const signed =
        (b.balance_type === 'Dr' ? -1 : 1) *
        (Number(b.balance_amount) || 0);

      signedBalance += signed;

      totalBilled +=
        Number(b.grand_total) || 0;

      totalPaid +=
        (Number(b.advance_paid) || 0) +
        (Number(b.cash_paid) || 0) +
        (Number(b.other_paid) || 0);

      return {
        _id: b._id,

        unique_bill_number:
          b.unique_bill_number,

        invoice_number:
          b.invoice_number,

        invoice_date:
          b.invoice_date,

        grand_total:
          b.grand_total,

        balance_amount:
          b.balance_amount,

        balance_type:
          b.balance_type
      };
    });

    res.json({
      supplier: name,

      total_billed: round2(totalBilled),

      total_paid: round2(totalPaid),

      balance_amount: round2(
        Math.abs(signedBalance)
      ),

      balance_type:
        signedBalance >= 0 ? 'Cr' : 'Dr',

      bills: rows
    });
  } catch (err) {
    console.error(
      'Supplier ledger error:',
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
    const purchase = await Purchase.findById(
      req.params.id
    );

    if (!purchase) {
      return res.status(404).json({
        error: 'Purchase not found'
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
      dealer_discount_amount,
      dealer_discount_percent,
      extra_charges,
      items
    } = req.body;

    if (!supplier || !invoice_number) {
      return res.status(400).json({
        error: 'Supplier and invoice number are required'
      });
    }

    if (
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({
        error: 'At least one item is required'
      });
    }

    // Generate unique bill number.
    let finalBillNumber;

    if (
      unique_bill_number &&
      String(unique_bill_number).trim()
    ) {
      finalBillNumber = String(
        unique_bill_number
      ).trim().toUpperCase();
    } else {
      finalBillNumber =
        await generateUniqueBillNumber();
    }

    const duplicate = await Purchase.findOne({
      unique_bill_number: finalBillNumber
    });

    if (duplicate) {
      return res.status(409).json({
        error: `Bill number ${finalBillNumber} already exists`
      });
    }

    // Add stock and prepare purchase items.
    const {
      purchaseItems,
      touchedProductIds,
      taxableTotal
    } = await addStockForPurchaseItems(items);

    const gstPercent = Number(
      req.body.gst_percent
    );

    const totals = calculateTotals(
      taxableTotal,

      extra_charges,

      dealer_discount_amount ??
        (Number(dealer_discount_percent) || 0),

      Number.isFinite(gstPercent)
        ? gstPercent
        : (
            purchaseItems.length
              ? Number(purchaseItems[0].gst_rate) || 0
              : 0
          ),

      req.body.payments
    );

    const accountFields = buildAccountFields(
      req.body,
      totals,
      purchaseItems
    );

    const purchase = await Purchase.create({
      supplier,

      supplier_gstin:
        supplier_gstin || '',

      invoice_number,

      invoice_date: invoice_date
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

      items: purchaseItems,

      taxable_amount:
        totals.taxableAmount,

      gst_total:
        totals.gstTotal,

      extra_charges:
        totals.extraCharges,

      dealer_discount_percent: 0,

      dealer_discount_amount:
        totals.discountAmount,

      grand_total:
        totals.grandTotal,

      ...accountFields
    });

    const products = await Product.find({
      _id: {
        $in: touchedProductIds
      }
    }).select(
      'name barcode category mrp purchase_price selling_price gst_rate stock_qty'
    );

    res.status(201).json({
      ...purchase.toObject(),
      products
    });

  } catch (err) {
    console.error(
      'Purchase save error:',
      err
    );

    if (err.code === 11000) {
      return res.status(409).json({
        error:
          'This unique bill number already exists. Please generate another number.'
      });
    }

    res.status(400).json({
      error: err.message
    });
  }
});


// ============================================================
// UPDATE / EDIT PURCHASE
// ============================================================

router.put('/:id', async (req, res) => {
  try {
    const purchase = await Purchase.findById(
      req.params.id
    );

    if (!purchase) {
      return res.status(404).json({
        error: 'Purchase not found'
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
      dealer_discount_amount,
      dealer_discount_percent,
      extra_charges,
      items
    } = req.body;

    if (!supplier || !invoice_number) {
      return res.status(400).json({
        error: 'Supplier and invoice number are required'
      });
    }

    if (
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({
        error: 'At least one item is required'
      });
    }

    const finalBillNumber =
      unique_bill_number &&
      String(unique_bill_number).trim()
        ? String(unique_bill_number)
            .trim()
            .toUpperCase()
        : purchase.unique_bill_number;

    const duplicate = await Purchase.findOne({
      unique_bill_number: finalBillNumber,

      _id: {
        $ne: purchase._id
      }
    });

    if (duplicate) {
      return res.status(409).json({
        error:
          `Bill number ${finalBillNumber} already exists`
      });
    }

    // Remove old stock and add updated stock.
    await removeStockForPurchase(purchase);

    const {
      purchaseItems,
      touchedProductIds,
      taxableTotal
    } = await addStockForPurchaseItems(items);

    const gstPercent = Number(
      req.body.gst_percent
    );

    const totals = calculateTotals(
      taxableTotal,

      extra_charges,

      dealer_discount_amount ??
        (Number(dealer_discount_percent) || 0),

      Number.isFinite(gstPercent)
        ? gstPercent
        : (
            purchaseItems.length
              ? Number(purchaseItems[0].gst_rate) || 0
              : 0
          ),

      req.body.payments
    );

    const accountFields = buildAccountFields(
      req.body,
      totals,
      purchaseItems
    );

    purchase.supplier = supplier;

    purchase.supplier_gstin =
      supplier_gstin || '';

    purchase.invoice_number =
      invoice_number;

    purchase.invoice_date = invoice_date
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

    purchase.dealer_discount_percent = 0;

    purchase.dealer_discount_amount =
      totals.discountAmount;

    purchase.grand_total =
      totals.grandTotal;

    purchase.gst_percent =
      accountFields.gst_percent;

    purchase.default_margin_percent =
      accountFields.default_margin_percent;

    purchase.payments =
      accountFields.payments;

    purchase.advance_paid =
      accountFields.advance_paid;

    purchase.cash_paid =
      accountFields.cash_paid;

    purchase.other_paid =
      accountFields.other_paid;

    purchase.extra_credit =
      accountFields.extra_credit;

    purchase.balance_amount =
      accountFields.balance_amount;

    purchase.balance_type =
      accountFields.balance_type;

    await purchase.save();

    const products = await Product.find({
      _id: {
        $in: touchedProductIds
      }
    }).select(
      'name barcode category mrp purchase_price selling_price gst_rate stock_qty'
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

    if (err.code === 11000) {
      return res.status(409).json({
        error:
          'This unique bill number already exists.'
      });
    }

    res.status(400).json({
      error: err.message
    });
  }
});


// ============================================================
// DELETE PURCHASE
// ============================================================

router.delete('/:id', async (req, res) => {
  try {
    const purchase = await Purchase.findById(
      req.params.id
    );

    if (!purchase) {
      return res.status(404).json({
        error: 'Purchase not found'
      });
    }

    // Remove the stock added by this purchase.
    await removeStockForPurchase(purchase);

    await Purchase.findByIdAndDelete(
      req.params.id
    );

    res.json({
      success: true,

      message:
        `Purchase bill ${purchase.unique_bill_number || ''} deleted successfully`
    });

  } catch (err) {
    console.error(
      'Purchase delete error:',
      err
    );

    res.status(500).json({
      error: err.message
    });
  }
});


module.exports = router;
