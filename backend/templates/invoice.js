// ============================================================
// templates/invoice.js
// ============================================================
// Printable GST invoice HTML
//
// Includes:
// - Saree name
// - Category
// - Barcode / code number
// - HSN
// - Quantity
// - Rate
// - Discount
// - Taxable value
// - GST
// - CGST / SGST / IGST
// - Correct India date/time (IST)
// - Customer details
// - Shop details
// - Amount in words
// ============================================================

const {
  amountInWords,
  formatINR
} = require('../utils/numberToWords');


// ============================================================
// ESCAPE HTML
// ============================================================

function esc(str) {

  if (
    str === null ||
    str === undefined
  ) {
    return '';
  }

  return String(str).replace(
    /[&<>"']/g,
    (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c])
  );
}


// ============================================================
// FORMAT DATE + TIME
// ============================================================
//
// IMPORTANT:
// Explicitly uses Asia/Kolkata so the invoice does not depend
// on the Render/server timezone.
//
// Example:
// 30 Sep 2026, 12:45:32 PM
// ============================================================

function fmtDateTime(value) {

  if (!value) {
    return '-';
  }

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return '-';
  }

  return d.toLocaleString(
    'en-IN',
    {
      timeZone: 'Asia/Kolkata',

      day: '2-digit',
      month: 'short',
      year: 'numeric',

      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',

      hour12: true
    }
  );
}


// ============================================================
// SAFE NUMBER
// ============================================================

function num(value) {

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}


// ============================================================
// RENDER INVOICE
// ============================================================

function renderInvoiceHTML({
  bill,
  items,
  shop
}) {

  const isInterState =
    Boolean(bill.is_interstate);


  // ==========================================================
  // ITEMS
  // ==========================================================

  const rows =
    items.map((it, idx) => {

      // ------------------------------------------------------
      // CATEGORY
      // ------------------------------------------------------

      const category =
        it.category ||
        it.product_category ||
        it.category_name ||
        '-';


      // ------------------------------------------------------
      // BARCODE
      // ------------------------------------------------------

      const barcode =
        it.barcode_number ||
        it.barcode ||
        it.barcode_no ||
        it.code ||
        it.product_code ||
        '-';


      // ------------------------------------------------------
      // GST DISPLAY
      // ------------------------------------------------------

      const gstRate =
        num(it.gst_rate);


      // ------------------------------------------------------
      // TAX COLUMN
      // ------------------------------------------------------

      const taxColumn =
        isInterState

          ? `
              <td class="r">
                ${formatINR(
                  num(it.igst_amount),
                  false
                )}
              </td>
            `

          : `
              <td class="r">

                <div>
                  ${formatINR(
                    num(it.cgst_amount),
                    false
                  )}
                  CGST
                </div>

                <div class="sub">
                  ${formatINR(
                    num(it.sgst_amount),
                    false
                  )}
                  SGST
                </div>

              </td>
            `;


      // ------------------------------------------------------
      // ROW
      // ------------------------------------------------------

      return `
        <tr>

          <!-- SERIAL NUMBER -->

          <td class="c">
            ${idx + 1}
          </td>


          <!-- ITEM -->

          <td>

            <div class="item-name">
              ${esc(
                it.product_name || '-'
              )}
            </div>


            <div class="item-category">
              Category:
              ${esc(category)}
            </div>


            <div class="barcode-number">
              Barcode:
              ${esc(barcode)}
            </div>


            <div class="hsn">
              HSN:
              ${esc(it.hsn_code || '-')}
            </div>

          </td>


          <!-- QTY -->

          <td class="c">

            ${num(it.qty)}

            ${esc(
              it.unit || ''
            )}

          </td>


          <!-- RATE -->

          <td class="r">

            ${formatINR(
              num(it.rate),
              false
            )}

          </td>


          <!-- DISCOUNT -->

          <td class="c">

            ${
              num(it.discount_percent) > 0
                ? `${num(it.discount_percent)}%`
                : '-'
            }

          </td>


          <!-- TAXABLE -->

          <td class="r">

            ${formatINR(
              num(it.taxable_value),
              false
            )}

          </td>


          <!-- GST RATE -->

          <td class="c">

            ${gstRate}%

          </td>


          <!-- GST -->

          ${taxColumn}


          <!-- FINAL AMOUNT -->

          <td class="r strong">

            ${formatINR(
              num(it.line_total),
              false
            )}

          </td>

        </tr>
      `;

    }).join('');


  // ==========================================================
  // TAX HEADER
  // ==========================================================

  const taxHeaderCols =
    isInterState

      ? `
          <th>
            IGST
          </th>
        `

      : `
          <th>
            CGST + SGST
          </th>
        `;


  // ==========================================================
  // INVOICE DATE
  // ==========================================================
  //
  // created_at is preferred because it represents the exact
  // creation timestamp.
  //
  // Existing old bills may not have created_at, therefore
  // bill_date / createdAt remain fallbacks.
  // ==========================================================

  const invoiceDateTime =
    bill.created_at ||
    bill.createdAt ||
    bill.bill_date;


  // ==========================================================
  // RETURN HTML
  // ==========================================================

  return `<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>
  Invoice ${esc(bill.invoice_no)}
</title>


<style>

/* ==========================================================
   PAGE
   ========================================================== */

@page {
  size: A4 portrait;
  margin: 5mm;
}


* {

  box-sizing: border-box;

}


body {

  font-family:
    'Segoe UI',
    Arial,
    sans-serif;

  color: #2B1210;

  margin: 0;

  font-size: 13px;

  background: #fff;

}


.sheet {

  max-width: 800px;

  margin: 0 auto;

}


/* ==========================================================
   PRINT BUTTON
   ========================================================== */

.print-bar {

  max-width: 800px;

  margin: 0 auto 12px;

  text-align: right;

}


.print-bar button {

  background: #5E1620;

  color: #fff;

  border: none;

  padding: 9px 18px;

  border-radius: 6px;

  font-size: 13px;

  cursor: pointer;

  font-weight: 600;

}


.print-bar button:hover {

  background: #3E0E15;

}


/* ==========================================================
   HEADER
   ========================================================== */

.top {

  display: flex;

  justify-content:
    space-between;

  align-items:
    flex-start;

  border-bottom:
    3px solid #5E1620;

  padding-bottom:
    14px;

  margin-bottom:
    16px;

}


.shop-name {

  font-family:
    Georgia,
    'Times New Roman',
    serif;

  font-weight:
    700;

  font-size:
    24px;

  color:
    #5E1620;

  margin:
    0 0 4px;

  letter-spacing:
    .3px;

}


.shop-meta {

  font-size:
    12px;

  color:
    #555;

  line-height:
    1.5;

}


.shop-meta strong {

  color:
    #2B1210;

}


/* ==========================================================
   INVOICE DETAILS
   ========================================================== */

.invoice-tag {

  text-align:
    right;

}


.invoice-tag .label {

  display:
    inline-block;

  background:
    #5E1620;

  color:
    #fff;

  font-size:
    12px;

  font-weight:
    700;

  letter-spacing:
    1px;

  padding:
    5px 12px;

  border-radius:
    4px;

  margin-bottom:
    8px;

}


.invoice-tag table {

  font-size:
    12px;

}


.invoice-tag td {

  padding:
    2px 0;

}


.invoice-tag td:first-child {

  color:
    #777;

  padding-right:
    10px;

}


.invoice-tag td:last-child {

  font-weight:
    600;

  text-align:
    right;

}


/* ==========================================================
   CUSTOMER / SUPPLY
   ========================================================== */

.parties {

  display:
    flex;

  gap:
    16px;

  margin-bottom:
    16px;

}


.party-box {

  flex:
    1;

  border:
    1px solid #E9DFCD;

  border-radius:
    6px;

  padding:
    10px 12px;

}


.party-box h4 {

  margin:
    0 0 6px;

  font-size:
    11px;

  letter-spacing:
    .5px;

  color:
    #C9A24A;

  text-transform:
    uppercase;

}


.party-box .name {

  font-weight:
    700;

  font-size:
    14px;

  margin-bottom:
    2px;

}


.party-box .line {

  font-size:
    12px;

  color:
    #555;

  line-height:
    1.5;

}


.supply-badge {

  display:
    inline-block;

  margin-top:
    6px;

  font-size:
    11px;

  font-weight:
    700;

  padding:
    3px 8px;

  border-radius:
    20px;

  background:
    ${isInterState
      ? '#FBEAE7'
      : '#E7F5ED'};

  color:
    ${isInterState
      ? '#B23A2E'
      : '#1E7A4C'};

}


/* ==========================================================
   ITEMS TABLE
   ========================================================== */

table.items {

  width:
    100%;

  border-collapse:
    collapse;

  margin-bottom:
    4px;

}


table.items th {

  background:
    #5E1620;

  color:
    #fff;

  font-size:
    11px;

  text-transform:
    uppercase;

  letter-spacing:
    .3px;

  padding:
    8px;

  text-align:
    left;

}


table.items td {

  padding:
    8px;

  border-bottom:
    1px solid #EEE7DA;

  vertical-align:
    top;

}


table.items td.c {

  text-align:
    center;

}


table.items td.r {

  text-align:
    right;

}


table.items td.strong {

  font-weight:
    700;

}


/* ==========================================================
   ITEM DETAILS
   ========================================================== */

.item-name {

  font-weight:
    700;

  font-size:
    12.5px;

  margin-bottom:
    3px;

}


.item-category {

  font-size:
    10.5px;

  color:
    #555;

  margin-bottom:
    3px;

}


.barcode-number {

  font-size:
    10.5px;

  color:
    #5E1620;

  font-weight:
    600;

  margin-bottom:
    3px;

}


.hsn {

  font-size:
    10px;

  color:
    #888;

}


.sub {

  font-size:
    10px;

  color:
    #888;

  margin-top:
    2px;

}


/* ==========================================================
   TOTALS
   ========================================================== */

.totals-wrap {

  display:
    flex;

  justify-content:
    flex-end;

  margin-top:
    10px;

}


.totals {

  width:
    280px;

  font-size:
    12.5px;

}


.totals .row {

  display:
    flex;

  justify-content:
    space-between;

  padding:
    5px 0;

  border-bottom:
    1px dashed #E9DFCD;

}


.totals .row.grand {

  border-bottom:
    none;

  border-top:
    2px solid #5E1620;

  margin-top:
    4px;

  padding-top:
    10px;

  font-size:
    16px;

  font-weight:
    700;

  color:
    #5E1620;

}


/* ==========================================================
   AMOUNT IN WORDS
   ========================================================== */

.words {

  margin-top:
    14px;

  padding:
    10px 12px;

  background:
    #FBF3E4;

  border-radius:
    6px;

  font-size:
    12px;

}


.words strong {

  color:
    #5E1620;

}


/* ==========================================================
   FOOTER
   ========================================================== */

.footer {

  display:
    flex;

  justify-content:
    space-between;

  margin-top:
    28px;

  padding-top:
    16px;

  border-top:
    1px solid #E9DFCD;

  font-size:
    11.5px;

  color:
    #555;

}


.footer .bank div {

  margin-bottom:
    2px;

}


.sign-box {

  text-align:
    center;

}


.sign-line {

  margin-top:
    46px;

  border-top:
    1px solid #999;

  padding-top:
    4px;

  width:
    160px;

}


.note-line {

  margin-top:
    10px;

  font-size:
    11px;

  color:
    #888;

}


/* ==========================================================
   MOBILE
   ========================================================== */

@media (max-width: 700px) {

  body {

    font-size:
      11px;

  }


  .top {

    flex-direction:
      column;

    gap:
      14px;

  }


  .invoice-tag {

    text-align:
      left;

  }


  .invoice-tag table {

    text-align:
      left;

  }


  .invoice-tag td:last-child {

    text-align:
      left;

  }


  .parties {

    flex-direction:
      column;

  }


  table.items {

    font-size:
      10px;

  }


  table.items th,
  table.items td {

    padding:
      5px;

  }


  .totals {

    width:
      100%;

  }


  .footer {

    flex-direction:
      column;

    gap:
      20px;

  }


  .sign-box {

    text-align:
      left;

  }

}


/* ==========================================================
   PRINT — TWO IDENTICAL HALF-A4 COPIES
   ========================================================== */

@media print {
  .print-bar { display: none !important; }
  html, body {
    width: 200mm;
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet {
    box-sizing: border-box;
    width: 161.29%;
    max-width: none !important;
    height: 230mm;
    margin: 0 !important;
    padding: 0;
    overflow: hidden;
    zoom: 0.62;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .sheet + .sheet {
    border-top: 0.3mm dashed #999;
    padding-top: 2mm;
  }
  .top { padding-bottom: 6px; margin-bottom: 7px; border-bottom-width: 2px; }
  .shop-name { font-size: 18px; margin-bottom: 2px; }
  .shop-meta { font-size: 9px; line-height: 1.25; }
  .invoice-tag .label { font-size: 9px; padding: 3px 7px; margin-bottom: 3px; }
  .invoice-tag table { font-size: 9px; }
  .parties { gap: 7px; margin-bottom: 7px; }
  .party-box { padding: 5px 7px; border-radius: 3px; }
  .party-box h4 { font-size: 8px; margin-bottom: 3px; }
  .party-box .name { font-size: 10px; }
  .party-box .line { font-size: 8px; line-height: 1.25; }
  .supply-badge { font-size: 8px; margin-top: 3px; padding: 2px 5px; }
  table.items { margin-bottom: 2px; }
  table.items th { font-size: 7px; padding: 4px 3px; }
  table.items td { font-size: 8px; padding: 3px; }
  .item-name { font-size: 8px; margin-bottom: 1px; }
  .item-category, .barcode-number { font-size: 7px; margin-bottom: 1px; }
  .hsn, .sub { font-size: 6.5px; }
  .totals-wrap { margin-top: 4px; }
  .totals { width: 220px; font-size: 8px; }
  .totals .row { padding: 2px 0; }
  .totals .row.grand { font-size: 11px; padding-top: 4px; margin-top: 2px; }
  .words { margin-top: 5px; padding: 5px 7px; border-radius: 3px; font-size: 8px; }
  .footer { margin-top: 8px; padding-top: 6px; font-size: 7.5px; }
  .sign-line { margin-top: 15px; width: 120px; padding-top: 2px; }
  .note-line { margin-top: 4px; font-size: 7px; }
}

</style>

</head>


<body>


<!-- ========================================================
     PRINT BUTTON
     ======================================================== -->

<div class="print-bar">

  <button
    onclick="window.print()"
  >
    Print / Save as PDF
  </button>

</div>


<div class="sheet">


<!-- ========================================================
     SHOP HEADER
     ======================================================== -->

<div class="top">

  <div>

    <p class="shop-name">

      ${esc(
        shop.shop_name ||
        'RAJASTHANI SAREE'
      )}

    </p>


    <div class="shop-meta">

      ${esc(
        shop.address_line1 ||
        ''
      )}

      ${
        shop.address_line2
          ? ', ' +
            esc(shop.address_line2)
          : ''
      }

      <br>


      ${esc(
        shop.city ||
        ''
      )}

      ${
        shop.pincode
          ? ' - ' +
            esc(shop.pincode)
          : ''
      }

      ${
        shop.city ||
        shop.pincode
          ? ', '
          : ''
      }

      ${esc(
        shop.state ||
        ''
      )}

      <br>


      Phone:
      ${esc(
        shop.phone ||
        ''
      )}

      ${
        shop.email
          ? ' · ' +
            esc(shop.email)
          : ''
      }

      <br>


      <strong>

        GSTIN:
        ${esc(
          shop.gstin ||
          ''
        )}

      </strong>

      ${
        shop.pan
          ? ' · PAN: ' +
            esc(shop.pan)
          : ''
      }

    </div>

  </div>


  <!-- ======================================================
       INVOICE INFORMATION
       ====================================================== -->

  <div class="invoice-tag">

    <span class="label">

      TAX INVOICE

    </span>


    <table>

      <tr>

        <td>
          Invoice No.
        </td>

        <td>

          ${esc(
            bill.invoice_no
          )}

        </td>

      </tr>


      <tr>

        <td>
          Date &amp; Time
        </td>

        <td>

          ${fmtDateTime(
            invoiceDateTime
          )}

        </td>

      </tr>


      <tr>

        <td>
          Payment
        </td>

        <td>

          ${esc(
            bill.payment_mode ||
            '-'
          )}

          ·

          ${esc(
            bill.payment_status ||
            '-'
          )}

        </td>

      </tr>

    </table>

  </div>

</div>


<!-- ========================================================
     CUSTOMER
     ======================================================== -->

<div class="parties">


  <div class="party-box">

    <h4>
      Billed To
    </h4>


    <div class="name">

      ${esc(
        bill.customer_name ||
        '-'
      )}

    </div>


    ${
      bill.customer_phone
        ? `
          <div class="line">
            Phone:
            ${esc(
              bill.customer_phone
            )}
          </div>
        `
        : ''
    }


    ${
      bill.customer_gstin
        ? `
          <div class="line">
            GSTIN:
            ${esc(
              bill.customer_gstin
            )}
          </div>
        `
        : ''
    }


    ${
      bill.customer_state
        ? `
          <div class="line">
            State:
            ${esc(
              bill.customer_state
            )}
          </div>
        `
        : ''
    }

  </div>


  <!-- ======================================================
       PLACE OF SUPPLY
       ====================================================== -->

  <div class="party-box">

    <h4>
      Place of Supply
    </h4>


    <div class="name">

      ${esc(
        bill.customer_state ||
        shop.state ||
        '-'
      )}

    </div>


    <span class="supply-badge">

      ${
        isInterState
          ? 'Inter-state (IGST)'
          : 'Intra-state (CGST + SGST)'
      }

    </span>

  </div>

</div>


<!-- ========================================================
     ITEMS
     ======================================================== -->

<table class="items">


  <thead>

    <tr>

      <th>
        #
      </th>


      <th>
        Item / Saree
      </th>


      <th>
        Qty
      </th>


      <th>
        Rate (₹)
      </th>


      <th>
        Disc.
      </th>


      <th>
        Taxable (₹)
      </th>


      <th>
        GST
      </th>


      ${taxHeaderCols}


      <th>
        Amount (₹)
      </th>

    </tr>

  </thead>


  <tbody>

    ${rows}

  </tbody>

</table>


<!-- ========================================================
     TOTALS
     ======================================================== -->

<div class="totals-wrap">

  <div class="totals">


    <div class="row">

      <span>
        Subtotal
      </span>

      <span>

        ${formatINR(
          num(bill.subtotal),
          false
        )}

      </span>

    </div>


    <div class="row">

      <span>
        Discount
      </span>

      <span>

        -
        ${formatINR(
          num(bill.discount_amount),
          false
        )}

      </span>

    </div>


    <div class="row">

      <span>
        Taxable Value
      </span>

      <span>

        ${formatINR(
          num(bill.taxable_value),
          false
        )}

      </span>

    </div>


    ${
      isInterState

        ? `

          <div class="row">

            <span>
              IGST
            </span>

            <span>

              ${formatINR(
                num(bill.igst_amount),
                false
              )}

            </span>

          </div>

        `

        : `

          <div class="row">

            <span>
              CGST
            </span>

            <span>

              ${formatINR(
                num(bill.cgst_amount),
                false
              )}

            </span>

          </div>


          <div class="row">

            <span>
              SGST
            </span>

            <span>

              ${formatINR(
                num(bill.sgst_amount),
                false
              )}

            </span>

          </div>

        `
    }


    <div class="row">

      <span>
        Round Off
      </span>

      <span>

        ${
          num(bill.round_off) >= 0
            ? '+'
            : ''
        }

        ${formatINR(
          num(bill.round_off),
          false
        )}

      </span>

    </div>


    <!-- GRAND TOTAL -->

    <div class="row grand">

      <span>
        Grand Total
      </span>

      <span>

        ${formatINR(
          num(bill.grand_total)
        )}

      </span>

    </div>


  </div>

</div>


<!-- ========================================================
     AMOUNT IN WORDS
     ======================================================== -->

<div class="words">

  <strong>
    Amount in words:
  </strong>


  ${esc(
    amountInWords(
      num(bill.grand_total)
    )
  )}

</div>


<!-- ========================================================
     FOOTER
     ======================================================== -->

<div class="footer">


  <div class="bank">


    ${
      shop.bank_name

        ? `

          <div>

            <strong>
              Bank Details
            </strong>

          </div>


          <div>

            ${esc(
              shop.bank_name
            )}

          </div>


          <div>

            A/C:
            ${esc(
              shop.bank_account_no ||
              ''
            )}

          </div>


          <div>

            IFSC:
            ${esc(
              shop.bank_ifsc ||
              ''
            )}

          </div>

        `

        : ''
    }


    ${
      shop.upi_id

        ? `

          <div>

            UPI:
            ${esc(
              shop.upi_id
            )}

          </div>

        `

        : ''
    }


  </div>


  <div class="sign-box">

    <div class="sign-line">

      Authorised Signatory

    </div>

  </div>


</div>


<!-- ========================================================
     NOTE
     ======================================================== -->

<p class="note-line">

  This is a computer-generated invoice.

  Goods once sold

  ${
    bill.is_interstate

      ? 'are not returnable across state lines except as per applicable exchange policy'

      : 'can be exchanged within 7 days with this invoice'
  }.

  Subject to

  ${esc(
    shop.city ||
    shop.state ||
    ''
  )}

  jurisdiction only.

</p>


</div>

<script>
  // Print two identical copies of the saved invoice on one A4 sheet.
  window.addEventListener('DOMContentLoaded', function () {
    const original = document.querySelector('.sheet');
    if (!original || document.querySelector('.sheet-copy')) return;
    const duplicate = original.cloneNode(true);
    duplicate.classList.add('sheet-copy');
    duplicate.setAttribute('aria-label', 'Second copy of the same invoice');
    original.after(duplicate);
  });
</script>

</body>

</html>`;

}


// ============================================================
// EXPORT
// ============================================================

module.exports = {
  renderInvoiceHTML
};
