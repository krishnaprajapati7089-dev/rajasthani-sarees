// templates/invoice.js
// Builds the printable GST invoice HTML for a bill.
// Shows saree name, category, barcode/code number (text only),
// HSN, and bill date + time.

const { amountInWords, formatINR } = require('../utils/numberToWords');

function esc(str) {
  if (str === null || str === undefined) return '';

  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

// Format date + time
function fmtDateTime(iso) {
  if (!iso) return '-';

  const d = new Date(iso);

  if (Number.isNaN(d.getTime())) return '-';

  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

function renderInvoiceHTML({ bill, items, shop }) {
  const isInterState = !!bill.is_interstate;

  const rows = items.map((it, idx) => `
    <tr>

      <td class="c">${idx + 1}</td>

      <td>
        <div class="item-name">
          ${esc(it.product_name || '-')}
        </div>

        <div class="item-category">
          Category: ${esc(
            it.category ||
            it.product_category ||
            it.category_name ||
            '-'
          )}
        </div>

        <div class="barcode-number">
          Barcode: ${esc(
            it.barcode_number ||
            it.barcode ||
            it.barcode_no ||
            it.code ||
            it.product_code ||
            '-'
          )}
        </div>

        <div class="hsn">
          HSN ${esc(it.hsn_code || '-')}
        </div>
      </td>

      <td class="c">
        ${it.qty} ${esc(it.unit || '')}
      </td>

      <td class="r">
        ${formatINR(it.rate, false)}
      </td>

      <td class="c">
        ${it.discount_percent ? it.discount_percent + '%' : '-'}
      </td>

      <td class="r">
        ${formatINR(it.taxable_value, false)}
      </td>

      <td class="c">
        ${it.gst_rate}%
      </td>

      ${
        isInterState
          ? `
            <td class="r">
              ${formatINR(it.igst_amount, false)}
            </td>
          `
          : `
            <td class="r">
              ${formatINR(it.cgst_amount, false)}
              <div class="sub">
                ${formatINR(it.sgst_amount, false)} SGST
              </div>
            </td>
          `
      }

      <td class="r strong">
        ${formatINR(it.line_total, false)}
      </td>

    </tr>
  `).join('');

  const taxHeaderCols = isInterState
    ? `<th>IGST</th>`
    : `<th>CGST + SGST</th>`;

  // Use saved bill date first.
  // If bill_date doesn't exist, use created_at.
  const invoiceDateTime =
    bill.bill_date ||
    bill.created_at ||
    bill.createdAt;

  return `<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<title>
  Invoice ${esc(bill.invoice_no)}
</title>

<style>

  @page {
    size: A4;
    margin: 14mm;
  }

  * {
    box-sizing: border-box;
  }

  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    color: #2B1210;
    margin: 0;
    font-size: 13px;
  }

  .sheet {
    max-width: 800px;
    margin: 0 auto;
  }

  /* =========================
     TOP HEADER
     ========================= */

  .top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;

    border-bottom: 3px solid #5E1620;

    padding-bottom: 14px;
    margin-bottom: 16px;
  }

  .shop-name {
    font-family: Georgia, 'Times New Roman', serif;

    font-weight: 700;
    font-size: 24px;

    color: #5E1620;

    margin: 0 0 4px;

    letter-spacing: 0.3px;
  }

  .shop-meta {
    font-size: 12px;
    color: #555;

    line-height: 1.5;
  }

  .shop-meta strong {
    color: #2B1210;
  }

  /* =========================
     INVOICE DETAILS
     ========================= */

  .invoice-tag {
    text-align: right;
  }

  .invoice-tag .label {
    display: inline-block;

    background: #5E1620;
    color: #fff;

    font-size: 12px;
    font-weight: 700;

    letter-spacing: 1px;

    padding: 5px 12px;

    border-radius: 4px;

    margin-bottom: 8px;
  }

  .invoice-tag table {
    font-size: 12px;
  }

  .invoice-tag td {
    padding: 2px 0;
  }

  .invoice-tag td:first-child {
    color: #777;
    padding-right: 10px;
  }

  .invoice-tag td:last-child {
    font-weight: 600;
    text-align: right;
  }

  /* =========================
     CUSTOMER / SUPPLY
     ========================= */

  .parties {
    display: flex;
    gap: 16px;

    margin-bottom: 16px;
  }

  .party-box {
    flex: 1;

    border: 1px solid #E9DFCD;

    border-radius: 6px;

    padding: 10px 12px;
  }

  .party-box h4 {
    margin: 0 0 6px;

    font-size: 11px;

    letter-spacing: 0.5px;

    color: #C9A24A;

    text-transform: uppercase;
  }

  .party-box .name {
    font-weight: 700;

    font-size: 14px;

    margin-bottom: 2px;
  }

  .party-box .line {
    font-size: 12px;

    color: #555;

    line-height: 1.5;
  }

  .supply-badge {
    display: inline-block;

    margin-top: 6px;

    font-size: 11px;

    font-weight: 700;

    padding: 3px 8px;

    border-radius: 20px;

    background: ${isInterState ? '#FBEAE7' : '#E7F5ED'};

    color: ${isInterState ? '#B23A2E' : '#1E7A4C'};
  }

  /* =========================
     ITEMS TABLE
     ========================= */

  table.items {
    width: 100%;

    border-collapse: collapse;

    margin-bottom: 4px;
  }

  table.items th {
    background: #5E1620;

    color: #fff;

    font-size: 11px;

    text-transform: uppercase;

    letter-spacing: 0.3px;

    padding: 8px 8px;

    text-align: left;
  }

  table.items td {
    padding: 8px 8px;

    border-bottom: 1px solid #EEE7DA;

    vertical-align: top;
  }

  table.items td.c {
    text-align: center;
  }

  table.items td.r {
    text-align: right;
  }

  table.items td.strong {
    font-weight: 700;
  }

  /* =========================
     ITEM INFORMATION
     ========================= */

  .item-name {
    font-weight: 700;

    font-size: 12.5px;

    margin-bottom: 2px;
  }

  .item-category {
    font-size: 10.5px;

    color: #555;

    margin-bottom: 2px;
  }

  .barcode-number {
    font-size: 10.5px;

    color: #5E1620;

    font-weight: 600;

    margin-bottom: 2px;
  }

  .hsn {
    font-size: 10px;

    color: #888;
  }

  .sub {
    font-size: 10px;

    color: #888;
  }

  /* =========================
     TOTALS
     ========================= */

  .totals-wrap {
    display: flex;

    justify-content: flex-end;

    margin-top: 10px;
  }

  .totals {
    width: 280px;

    font-size: 12.5px;
  }

  .totals .row {
    display: flex;

    justify-content: space-between;

    padding: 5px 0;

    border-bottom: 1px dashed #E9DFCD;
  }

  .totals .row.grand {
    border-bottom: none;

    border-top: 2px solid #5E1620;

    margin-top: 4px;

    padding-top: 10px;

    font-size: 16px;

    font-weight: 700;

    color: #5E1620;
  }

  /* =========================
     AMOUNT IN WORDS
     ========================= */

  .words {
    margin-top: 14px;

    padding: 10px 12px;

    background: #FBF3E4;

    border-radius: 6px;

    font-size: 12px;
  }

  .words strong {
    color: #5E1620;
  }

  /* =========================
     FOOTER
     ========================= */

  .footer {
    display: flex;

    justify-content: space-between;

    margin-top: 28px;

    padding-top: 16px;

    border-top: 1px solid #E9DFCD;

    font-size: 11.5px;

    color: #555;
  }

  .footer .bank div {
    margin-bottom: 2px;
  }

  .sign-box {
    text-align: center;
  }

  .sign-line {
    margin-top: 46px;

    border-top: 1px solid #999;

    padding-top: 4px;

    width: 160px;
  }

  .note-line {
    margin-top: 10px;

    font-size: 11px;

    color: #888;
  }

  /* =========================
     PRINT BUTTON
     ========================= */

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

  /* =========================
     PRINT
     ========================= */

  @media print {

    .print-bar {
      display: none;
    }

    body {
      font-size: 12px;
    }

  }

</style>

</head>

<body>

  <!-- PRINT BUTTON -->

  <div class="print-bar">
    <button onclick="window.print()">
      Print / Save as PDF
    </button>
  </div>


  <div class="sheet">

    <!-- =========================
         SHOP HEADER
         ========================= -->

    <div class="top">

      <div>

        <p class="shop-name">
          ${esc(shop.shop_name || 'RAJASTHANI SAREE')}
        </p>

        <div class="shop-meta">

          ${esc(shop.address_line1 || '')}

          ${
            shop.address_line2
              ? ', ' + esc(shop.address_line2)
              : ''
          }

          <br>

          ${esc(shop.city || '')}

          ${
            shop.pincode
              ? ' - ' + esc(shop.pincode)
              : ''
          }

          ${
            shop.city || shop.pincode
              ? ', '
              : ''
          }

          ${esc(shop.state || '')}

          <br>

          Phone:
          ${esc(shop.phone || '')}

          ${
            shop.email
              ? ' &middot; ' + esc(shop.email)
              : ''
          }

          <br>

          <strong>
            GSTIN: ${esc(shop.gstin || '')}
          </strong>

          ${
            shop.pan
              ? ' &middot; PAN: ' + esc(shop.pan)
              : ''
          }

        </div>

      </div>


      <!-- =========================
           INVOICE INFORMATION
           ========================= -->

      <div class="invoice-tag">

        <span class="label">
          TAX INVOICE
        </span>

        <table>

          <tr>
            <td>Invoice No.</td>
            <td>
              ${esc(bill.invoice_no)}
            </td>
          </tr>

          <tr>
            <td>Date &amp; Time</td>
            <td>
              ${fmtDateTime(invoiceDateTime)}
            </td>
          </tr>

          <tr>
            <td>Payment</td>
            <td>
              ${esc(bill.payment_mode || '-')}
              &middot;
              ${esc(bill.payment_status || '-')}
            </td>
          </tr>

        </table>

      </div>

    </div>


    <!-- =========================
         CUSTOMER
         ========================= -->

    <div class="parties">

      <div class="party-box">

        <h4>
          Billed to
        </h4>

        <div class="name">
          ${esc(bill.customer_name || '-')}
        </div>

        ${
          bill.customer_gstin
            ? `
              <div class="line">
                GSTIN: ${esc(bill.customer_gstin)}
              </div>
            `
            : ''
        }

        <div class="line">
          ${esc(bill.customer_state || '')}
        </div>

      </div>


      <!-- PLACE OF SUPPLY -->

      <div class="party-box">

        <h4>
          Place of supply
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


    <!-- =========================
         ITEMS
         ========================= -->

    <table class="items">

      <thead>

        <tr>

          <th>#</th>

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


    <!-- =========================
         TOTALS
         ========================= -->

    <div class="totals-wrap">

      <div class="totals">

        <div class="row">

          <span>
            Subtotal
          </span>

          <span>
            ${formatINR(
              bill.subtotal,
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
              bill.discount_amount,
              false
            )}
          </span>

        </div>


        <div class="row">

          <span>
            Taxable value
          </span>

          <span>
            ${formatINR(
              bill.taxable_value,
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
                    bill.igst_amount,
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
                    bill.cgst_amount,
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
                    bill.sgst_amount,
                    false
                  )}
                </span>

              </div>
            `
        }


        <div class="row">

          <span>
            Round off
          </span>

          <span>

            ${
              bill.round_off >= 0
                ? '+'
                : ''
            }

            ${formatINR(
              bill.round_off,
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
              bill.grand_total
            )}
          </span>

        </div>

      </div>

    </div>


    <!-- =========================
         AMOUNT IN WORDS
         ========================= -->

    <div class="words">

      <strong>
        Amount in words:
      </strong>

      ${esc(
        amountInWords(
          bill.grand_total
        )
      )}

    </div>


    <!-- =========================
         FOOTER
         ========================= -->

    <div class="footer">

      <div class="bank">

        ${
          shop.bank_name
            ? `
              <div>
                <strong>
                  Bank details
                </strong>
              </div>

              <div>
                ${esc(shop.bank_name)}
              </div>

              <div>
                A/C:
                ${esc(
                  shop.bank_account_no
                )}
              </div>

              <div>
                IFSC:
                ${esc(
                  shop.bank_ifsc
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
                ${esc(shop.upi_id)}
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


    <!-- =========================
         NOTE
         ========================= -->

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

</body>

</html>`;
}


module.exports = {
  renderInvoiceHTML
};
