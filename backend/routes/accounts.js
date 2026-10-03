const express = require("express");

const Bill = require("../models/Bill");
const Purchase = require("../models/Purchase");
const Product = require("../models/Product");

const router = express.Router();


// ============================================================
// HELPERS
// ============================================================

function num(value) {
  return Number(value || 0);
}


function round2(value) {
  return Math.round(
    (Number(value) + Number.EPSILON) * 100
  ) / 100;
}


function validDate(value, fallback) {

  const d =
    value
      ? new Date(value)
      : fallback;

  return Number.isNaN(d.getTime())
    ? fallback
    : d;
}


// ============================================================
// CA SUMMARY
// ============================================================

router.get(
  "/summary",
  async (req, res) => {

    try {

      const now =
        new Date();


      const from =
        validDate(
          req.query.from,
          new Date(
            now.getFullYear(),
            now.getMonth(),
            1
          )
        );


      const to =
        validDate(
          req.query.to,
          now
        );


      /*
        ACTIVE bills only.

        Cancelled bills are excluded from
        sales/GST accounting totals.
      */

      const bills =
        await Bill.find({
          status: {
            $ne: "CANCELLED"
          },

          createdAt: {
            $gte: from,
            $lte: to
          }
        })
        .sort({
          createdAt: -1
        })
        .lean();


      const purchases =
        await Purchase.find({
          $or: [
            {
              invoice_date: {
                $gte: from,
                $lte: to
              }
            },

            /*
              Fallback for older records
              where invoice_date may be absent.
            */

            {
              invoice_date: {
                $exists: false
              },

              createdAt: {
                $gte: from,
                $lte: to
              }
            }
          ]
        })
        .sort({
          invoice_date: -1,
          createdAt: -1
        })
        .lean();


      // ======================================================
      // SALES TOTALS
      // ======================================================

      let salesTotal = 0;

      let outputCGST = 0;
      let outputSGST = 0;
      let outputIGST = 0;

      let salesTaxable = 0;


      bills.forEach(
        bill => {

          salesTotal +=
            num(
              bill.grand_total
            );


          salesTaxable +=
            num(
              bill.taxable_value
            );


          outputCGST +=
            num(
              bill.cgst_amount
            );


          outputSGST +=
            num(
              bill.sgst_amount
            );


          outputIGST +=
            num(
              bill.igst_amount
            );

        }
      );


      // ======================================================
      // PURCHASE TOTALS
      // ======================================================

      let purchaseTotal = 0;

      let inputGST = 0;

      let inputCGST = 0;
      let inputSGST = 0;
      let inputIGST = 0;

      let purchaseTaxable = 0;


      /*
        Current Purchase model stores gst_total
        rather than separate CGST/SGST/IGST.

        Therefore inputGST is available accurately,
        while individual purchase tax components cannot
        be reconstructed reliably from this schema.
      */

      purchases.forEach(
        purchase => {

          purchaseTotal +=
            num(
              purchase.grand_total
            );


          purchaseTaxable +=
            num(
              purchase.taxable_amount
            );


          inputGST +=
            num(
              purchase.gst_total
            );

        }
      );


      /*
        We don't invent CGST/SGST/IGST split for old
        purchase records.
      */

      inputCGST = 0;
      inputSGST = 0;
      inputIGST = 0;


      // ======================================================
      // HSN SUMMARY
      // ======================================================

      const hsnMap = {};


      bills.forEach(
        bill => {

          (bill.items || [])
            .forEach(
              item => {

                const hsn =
                  String(
                    item.hsn_code ||
                    "N/A"
                  );


                if (!hsnMap[hsn]) {

                  hsnMap[hsn] = {
                    hsn,
                    qty: 0,
                    taxable: 0,
                    cgst: 0,
                    sgst: 0,
                    igst: 0,
                    total: 0
                  };

                }


                hsnMap[hsn].qty +=
                  num(item.qty);


                hsnMap[hsn].taxable +=
                  num(
                    item.taxable_value
                  );


                hsnMap[hsn].cgst +=
                  num(
                    item.cgst_amount
                  );


                hsnMap[hsn].sgst +=
                  num(
                    item.sgst_amount
                  );


                hsnMap[hsn].igst +=
                  num(
                    item.igst_amount
                  );


                hsnMap[hsn].total +=
                  num(
                    item.line_total
                  );

              }
            );

        }
      );


      const hsn =
        Object.values(
          hsnMap
        )
        .map(
          row => ({

            hsn:
              row.hsn,

            qty:
              round2(row.qty),

            taxable:
              round2(row.taxable),

            cgst:
              round2(row.cgst),

            sgst:
              round2(row.sgst),

            igst:
              round2(row.igst),

            total:
              round2(row.total)

          })
        )
        .sort(
          (a, b) =>
            b.taxable -
            a.taxable
        );


      // ======================================================
      // CUSTOMER LEDGER
      // ======================================================

      const customerMap = {};


      bills.forEach(
        bill => {

          const name =
            String(
              bill.customer_name ||
              "Walk-in Customer"
            )
            .trim();


          const key =
            name.toLowerCase();


          if (!customerMap[key]) {

            customerMap[key] = {

              name,

              type:
                "Customer",

              gstin:
                bill.customer_gstin ||
                "",

              transactions:
                0,

              amount:
                0,

              paid:
                0,

              balance:
                0

            };

          }


          customerMap[key]
            .transactions += 1;


          customerMap[key]
            .amount +=
              num(
                bill.grand_total
              );


          /*
            For Paid bills this becomes zero balance.

            For credit/partial-payment bills,
            the difference becomes receivable.
          */

          customerMap[key]
            .paid +=
              num(
                bill.paid_amount
              );

        }
      );


      Object.values(
        customerMap
      ).forEach(
        row => {

          row.balance =
            round2(
              row.amount -
              row.paid
            );

        }
      );


      // ======================================================
      // SUPPLIER LEDGER
      // ======================================================

      const supplierMap = {};


      purchases.forEach(
        purchase => {

          const name =
            String(
              purchase.supplier ||
              "Unknown Supplier"
            )
            .trim();


          const key =
            name.toLowerCase();


          if (!supplierMap[key]) {

            supplierMap[key] = {

              name,

              type:
                "Supplier",

              gstin:
                purchase.supplier_gstin ||
                "",

              transactions:
                0,

              amount:
                0,

              paid:
                0,

              balance:
                0

            };

          }


          supplierMap[key]
            .transactions += 1;


          supplierMap[key]
            .amount +=
              num(
                purchase.grand_total
              );

        }
      );


      /*
        Purchase schema currently doesn't have
        a payment amount field.

        Therefore we do not invent supplier payments.
      */

      Object.values(
        supplierMap
      ).forEach(
        row => {

          row.balance =
            round2(
              row.amount -
              row.paid
            );

        }
      );


      const ledgers = [
        ...Object.values(
          customerMap
        ),
        ...Object.values(
          supplierMap
        )
      ];


      // ======================================================
      // CURRENT STOCK
      // ======================================================

      const products =
        await Product.find({
          active: {
            $ne: false
          }
        })
        .sort({
          name: 1
        })
        .lean();


      const stock =
        products.map(
          product => {

            const stockQty =
              num(
                product.stock_qty
              );


            const purchasePrice =
              num(
                product.purchase_price
              );


            const sellingPrice =
              num(
                product.selling_price
              );


            return {

              name:
                product.name,

              category:
                product.category ||
                "General",

              hsn_code:
                product.hsn_code ||
                "",

              stock_qty:
                stockQty,

              purchase_price:
                purchasePrice,

              selling_price:
                sellingPrice,

              stock_value:
                round2(
                  stockQty *
                  purchasePrice
                ),

              sale_value:
                round2(
                  stockQty *
                  sellingPrice
                )

            };

          }
        );


      // ======================================================
      // STOCK VALUE
      // ======================================================

      const stockValue =
        stock.reduce(
          (sum, item) =>
            sum +
            num(
              item.stock_value
            ),
          0
        );


      // ======================================================
      // GROSS PROFIT ESTIMATE
      // ======================================================

      /*
        Uses current product purchase price.

        This is only an estimate because the current Bill
        schema doesn't store historical purchase cost per
        sold line.
      */

      let grossProfit = 0;


      const productCache = {};


      const productIds =
        new Set();


      bills.forEach(
        bill => {

          (bill.items || [])
            .forEach(
              item => {

                if (
                  item.product_id
                ) {

                  productIds.add(
                    String(
                      item.product_id
                    )
                  );

                }

              }
            );

        }
      );


      if (productIds.size) {

        const costProducts =
          await Product.find({
            _id: {
              $in:
                [...productIds]
            }
          })
          .select(
            "purchase_price"
          )
          .lean();


        costProducts.forEach(
          product => {

            productCache[
              String(
                product._id
              )
            ] =
              num(
                product.purchase_price
              );

          }
        );

      }


      bills.forEach(
        bill => {

          (bill.items || [])
            .forEach(
              item => {

                const cost =
                  num(
                    productCache[
                      String(
                        item.product_id
                      )
                    ]
                  );


                const qty =
                  num(
                    item.qty
                  );


                grossProfit +=
                  num(
                    item.line_total
                  ) -
                  (
                    cost *
                    qty
                  );

              }
            );

        }
      );


      // ======================================================
      // RECEIVABLE
      // ======================================================

      const receivable =
        Object.values(
          customerMap
        )
        .reduce(
          (sum, row) =>
            sum +
            num(row.balance),
          0
        );


      // ======================================================
      // PAYABLE
      // ======================================================

      const payable =
        Object.values(
          supplierMap
        )
        .reduce(
          (sum, row) =>
            sum +
            num(row.balance),
          0
        );


      // ======================================================
      // RESPONSE
      // ======================================================

      res.json({

        range: {
          from,
          to
        },


        summary: {

          sales: {
            count:
              bills.length,

            total:
              round2(
                salesTotal
              ),

            taxable:
              round2(
                salesTaxable
              )
          },


          purchases: {

            count:
              purchases.length,

            total:
              round2(
                purchaseTotal
              ),

            taxable:
              round2(
                purchaseTaxable
              )
          },


          gst: {

            output:
              round2(
                outputCGST +
                outputSGST +
                outputIGST
              ),

            input:
              round2(
                inputGST
              ),

            outputCGST:
              round2(
                outputCGST
              ),

            outputSGST:
              round2(
                outputSGST
              ),

            outputIGST:
              round2(
                outputIGST
              ),

            inputCGST:
              round2(
                inputCGST
              ),

            inputSGST:
              round2(
                inputSGST
              ),

            inputIGST:
              round2(
                inputIGST
              )

          },


          stock: {

            value:
              round2(
                stockValue
              ),

            products:
              stock.length

          },


          receivable:
            round2(
              receivable
            ),


          payable:
            round2(
              payable
            ),


          grossProfit:
            round2(
              grossProfit
            )

        },


        sales:
          bills,


        purchases:
          purchases,


        hsn,


        ledgers,


        stock

      });

    } catch (error) {

      console.error(
        "CA summary error:",
        error
      );


      res.status(500).json({
        error:
          error.message
      });

    }
  }
);


// ============================================================
// DATA HEALTH CHECK
// ============================================================

router.get(
  "/health",
  async (req, res) => {

    try {

      const issues = [];


      // ======================================================
      // SALES CHECK
      // ======================================================

      const bills =
        await Bill.find({
          status: {
            $ne: "CANCELLED"
          }
        })
        .lean();


      let missingHSN = 0;
      let missingGST = 0;
      let invalidTotal = 0;


      bills.forEach(
        bill => {

          (bill.items || [])
            .forEach(
              item => {

                if (
                  !item.hsn_code
                ) {
                  missingHSN++;
                }


                if (
                  num(item.gst_rate) < 0
                ) {
                  missingGST++;
                }


                if (
                  num(item.line_total) < 0
                ) {
                  invalidTotal++;
                }

              }
            );

        }
      );


      if (missingHSN) {

        issues.push(
          `${missingHSN} sales item(s) are missing HSN code.`
        );

      }


      if (missingGST) {

        issues.push(
          `${missingGST} sales item(s) have invalid GST rate.`
        );

      }


      if (invalidTotal) {

        issues.push(
          `${invalidTotal} sales item(s) have negative total.`
        );

      }


      // ======================================================
      // PURCHASE CHECK
      // ======================================================

      const purchases =
        await Purchase.find({})
        .lean();


      let missingSupplier = 0;
      let missingInvoice = 0;
      let missingPurchaseHSN = 0;


      purchases.forEach(
        purchase => {

          if (
            !purchase.supplier
          ) {
            missingSupplier++;
          }


          if (
            !purchase.invoice_number
          ) {
            missingInvoice++;
          }


          (purchase.items || [])
            .forEach(
              item => {

                if (
                  !item.hsn_code
                ) {
                  missingPurchaseHSN++;
                }

              }
            );

        }
      );


      if (missingSupplier) {

        issues.push(
          `${missingSupplier} purchase(s) are missing supplier name.`
        );

      }


      if (missingInvoice) {

        issues.push(
          `${missingInvoice} purchase(s) are missing invoice number.`
        );

      }


      if (missingPurchaseHSN) {

        issues.push(
          `${missingPurchaseHSN} purchase item(s) are missing HSN code.`
        );

      }


      // ======================================================
      // PRODUCT CHECK
      // ======================================================

      const products =
        await Product.find({})
        .lean();


      let negativeStock = 0;
      let missingProductHSN = 0;


      products.forEach(
        product => {

          if (
            num(product.stock_qty) < 0
          ) {
            negativeStock++;
          }


          if (
            !product.hsn_code
          ) {
            missingProductHSN++;
          }

        }
      );


      if (negativeStock) {

        issues.push(
          `${negativeStock} product(s) have negative stock.`
        );

      }


      if (missingProductHSN) {

        issues.push(
          `${missingProductHSN} product(s) are missing HSN code.`
        );

      }


      res.json({

        ok:
          issues.length === 0,

        issues,

        checked: {

          bills:
            bills.length,

          purchases:
            purchases.length,

          products:
            products.length

        }

      });

    } catch (error) {

      console.error(
        "CA health error:",
        error
      );


      res.status(500).json({
        error:
          error.message
      });

    }
  }
);


module.exports = router;
