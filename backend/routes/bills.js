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

  return `INV-${String(Number(match[1]) + 1).padStart(6, '0')}`;
}


function round2(value) {
  return Math.round(
    (Number(value) + Number.EPSILON) * 100
  ) / 100;
}


// ============================================================
// PREPARE BILL ITEMS
//
// IMPORTANT:
// Selling price/rate is GST-INCLUSIVE.
//
// The frontend sends:
// rate = FINAL price charged to customer
//
// Example:
// Inventory selling price = 800
// Billing screen price    = 700
//
// Backend uses 700.
// It does NOT take 700 and apply another discount to it.
//
// discount_percent is kept for compatibility with existing
// bills/API. The billing page sends 0 when rate is already the
// final customer price.
// ============================================================

async function prepareBillItems(
  items,
  interstate,
  extraDiscount = 0,
  stockOverrides = {}
) {

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(
      'Bill must contain at least one product'
    );
  }

  const prepared = [];
  const requiredByProduct = {};


  for (const line of items) {

    const productId =
      String(line.product_id || '').trim();

    if (!productId) {
      throw new Error(
        'Product ID is required for every bill item'
      );
    }


    const product =
      await Product.findById(productId);

    if (!product) {
      throw new Error(
        `Product not found: ${productId}`
      );
    }


    const qty =
      Number(line.qty);


    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(
        `Invalid quantity for product: ${product.name}`
      );
    }


    const available =
      Object.prototype.hasOwnProperty.call(
        stockOverrides,
        productId
      )
        ? Number(stockOverrides[productId])
        : Number(product.stock_qty || 0);


    requiredByProduct[productId] =
      (requiredByProduct[productId] || 0) + qty;


    // ========================================================
    // IMPORTANT FIX
    //
    // Use the price/rate sent by the billing page.
    //
    // If billing sends:
    // rate = 700
    //
    // then sellingPrice = 700.
    //
    // We only fall back to inventory selling_price when
    // billing does not send a rate.
    // ========================================================

    const requestedRate =
      Number(
        line.rate ??
        line.selling_price ??
        line.price
      );


    const sellingPrice =
      Number.isFinite(requestedRate) &&
      requestedRate >= 0
        ? requestedRate
        : (
            Number(product.selling_price) || 0
          );


    const mrp =
      Number(
        product.mrp ||
        product.selling_price
      ) || 0;


    const gstRate =
      Number(product.gst_rate) || 0;


    // Selling price is already GST inclusive.
    const grossInclusive =
      round2(
        qty * sellingPrice
      );


    // Normally billing page sends 0 because its rate
    // is already the FINAL customer price.
    const discountPercent =
      Math.max(
        0,
        Math.min(
          100,
          Number(line.discount_percent) || 0
        )
      );


    const lineDiscount =
      round2(
        grossInclusive *
        discountPercent /
        100
      );


    const inclusiveAfterLineDiscount =
      round2(
        grossInclusive -
        lineDiscount
      );


    let taxable =
      inclusiveAfterLineDiscount;

    let gstAmount = 0;


    // GST is included inside selling price.
    if (gstRate > 0) {

      taxable =
        inclusiveAfterLineDiscount /
        (1 + gstRate / 100);

      gstAmount =
        inclusiveAfterLineDiscount -
        taxable;
    }


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

      // IMPORTANT:
      // This is now the actual rate entered in billing.
      rate:
        sellingPrice,

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

      line_total:
        inclusiveAfterLineDiscount
    });


    if (
      available <
      requiredByProduct[productId]
    ) {

      throw new Error(
        `Insufficient stock for ${product.name}. Available: ${available}`
      );
    }
  }


  // ============================================================
  // BILL LEVEL DISCOUNT
  // ============================================================

  let totalInclusive =
    prepared.reduce(
      (sum, item) =>
        sum +
        Number(
          item._inclusiveBeforeExtra || 0
        ),
      0
    );


  let billDiscount =
    Math.max(
      0,
      Number(extraDiscount) || 0
    );


  billDiscount =
    Math.min(
      billDiscount,
      round2(totalInclusive)
    );


  /*
    Allocate bill-level discount proportionally.
  */

  if (
    billDiscount > 0 &&
    totalInclusive > 0
  ) {

    let allocated = 0;


    prepared.forEach(
      (item, index) => {

        const isLast =
          index === prepared.length - 1;


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
            allocated + share
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

        let gstAmount = 0;


        if (
          Number(item.gst_rate) > 0
        ) {

          taxable =
            inclusiveAfterAllDiscounts /
            (
              1 +
              Number(item.gst_rate) / 100
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


  // ============================================================
  // FINAL TOTALS
  // ============================================================

  totalInclusive =
    prepared.reduce(
      (sum, item) =>
        sum +
        Number(
          item.line_total || 0
        ),
      0
    );


  const taxableTotal =
    prepared.reduce(
      (sum, item) =>
        sum +
        Number(
          item.taxable_value || 0
        ),
      0
    );


  const cgstTotal =
    prepared.reduce(
      (sum, item) =>
        sum +
        Number(
          item.cgst_amount || 0
        ),
      0
    );


  const sgstTotal =
    prepared.reduce(
      (sum, item) =>
        sum +
        Number(
          item.sgst_amount || 0
        ),
      0
    );


  const igstTotal =
    prepared.reduce(
      (sum, item) =>
        sum +
        Number(
          item.igst_amount || 0
        ),
      0
    );


  // Final customer payable amount.
  const grandTotal =
    Math.round(
      totalInclusive
    );


  const roundOff =
    round2(
      grandTotal -
      totalInclusive
    );


  // ============================================================
  // SAVE BILL ITEMS
  // ============================================================

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

        rate:
          item.rate,

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
// OLD BILL STOCK
// ============================================================

function getOldStockOverrides(bill) {

  const overrides = {};


  for (
    const item of bill.items || []
  ) {

    const id =
      String(
        item.product_id || ''
      );


    if (!id) continue;


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
// STOCK CHANGE
// ============================================================

async function applyStockChange(
  prepared,
  direction
) {

  const quantities = {};


  for (
    const item of prepared
  ) {

    const id =
      String(
        item.product_id
      );


    quantities[id] =
      (
        quantities[id] || 0
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
      direction * qty;


    if (
      product.stock_qty < 0
    ) {

      throw new Error(
        `Insufficient stock for ${product.name}. Available: ${
          Number(product.stock_qty || 0) + qty
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
  async (req, res) => {

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
  async (req, res) => {

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
  async (req, res) => {

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


      const interstate =
        Boolean(
          is_interstate
        );


      const calculation =
        await prepareBillItems(
          items,
          interstate,
          discount_amount
        );


      // Reduce stock only after full validation.
      await applyStockChange(
        calculation.prepared,
        -1
      );


      const invoice_no =
        await nextInvoiceNo();


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
            payment_mode ||
            'Cash',

          payment_status:
            payment_status ||
            'Paid',

          paid_amount:
            Number(paid_amount) ||
            calculation.grand_total,

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
  async (req, res) => {

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
        discount_amount,
        items
      } = req.body;


      // Restore old quantities virtually.
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


      // ========================================================
      // NET STOCK CHANGE
      // ========================================================

      const netChanges = {};


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
            netChanges[productId] || 0
          ) +
          Number(
            qty || 0
          );
      }


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
            netChanges[productId] || 0
          ) -
          Number(
            item.qty || 0
          );
      }


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


      // ========================================================
      // UPDATE BILL
      // ========================================================

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
        payment_mode ||
        'Cash';


      bill.payment_status =
        payment_status ||
        'Paid';


      bill.paid_amount =
        Number(paid_amount) ||
        calculation.grand_total;


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
// CANCEL BILL
// ============================================================

router.post(
  '/:id/cancel',
  async (req, res) => {

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
// ============================================================

router.delete(
  '/:id',
  async (req, res) => {

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
// INVOICE HTML
// ============================================================

router.get(
  '/:id/invoice',
  async (req, res) => {

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
          key: 'main'
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
        .send(html);

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


module.exports = router;
