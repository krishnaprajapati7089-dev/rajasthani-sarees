
const { amountInWords, formatINR } = require('../utils/numberToWords');

function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmtDateTime(value) {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

function renderInvoiceHTML({ bill, items, shop }) {
  const interState = Boolean(bill.is_interstate);

  const rows = (items || []).map((it, index) => {
    const category =
      it.category ||
      it.product_category ||
      it.category_name ||
      '-';

    const barcode =
      it.barcode_number ||
      it.barcode ||
      it.barcode_no ||
      it.code ||
      it.product_code ||
      '-';

    const tax = interState
      ? `<td class="right">${formatINR(num(it.igst_amount), false)}</td>`
      : `<td class="right">
           <div>${formatINR(num(it.cgst_amount), false)} CGST</div>
           <div class="sub">${formatINR(num(it.sgst_amount), false)} SGST</div>
         </td>`;

    return `
      <tr>
        <td class="center">${index + 1}</td>
        <td class="item-cell">
          <strong>${esc(it.product_name || '-')}</strong>
          <div class="details">
            Category: ${esc(category)} |
            Code: ${esc(barcode)} |
            HSN: ${esc(it.hsn_code || '-')}
          </div>
        </td>
        <td class="center">${num(it.qty)} ${esc(it.unit || '')}</td>
        <td class="right">${formatINR(num(it.rate), false)}</td>
        <td class="center">
          ${num(it.discount_percent) > 0
            ? num(it.discount_percent) + '%'
            : '-'}
        </td>
        <td class="right">${formatINR(num(it.taxable_value), false)}</td>
        <td class="center">${num(it.gst_rate)}%</td>
        ${tax}
        <td class="right strong">${formatINR(num(it.line_total), false)}</td>
      </tr>
    `;
  }).join('');

  const taxHeaders = interState
    ? '<th>IGST</th>'
    : '<th>CGST + SGST</th>';

  const invoiceDate =
    bill.created_at ||
    bill.createdAt ||
    bill.bill_date;

  const address = [
    shop.address_line1,
    shop.address_line2,
    shop.city,
    shop.pincode,
    shop.state
  ].filter(Boolean).map(esc).join(', ');

  const bankDetails = shop.bank_name
    ? `
      <div><strong>Bank Details</strong></div>
      <div>${esc(shop.bank_name)}</div>
      <div>A/C: ${esc(shop.bank_account_no || '')}</div>
      <div>IFSC: ${esc(shop.bank_ifsc || '')}</div>
    `
    : '';

  const upiDetails = shop.upi_id
    ? `<div>UPI: ${esc(shop.upi_id)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice ${esc(bill.invoice_no)}</title>

<style>
  @page {
    size: A5 landscape;
    margin: 4mm;
  }

  * {
    box-sizing: border-box;
  }

  html, body {
    margin: 0;
    padding: 0;
    font-family: Arial, Helvetica, sans-serif;
    color: #2B1210;
    background: #fff;
  }

  body {
    width: 202mm;
    font-size: 8px;
  }

  .print-bar {
    width: 100%;
    text-align: right;
    margin-bottom: 5px;
  }

  .print-bar button {
    padding: 7px 14px;
    border: 0;
    border-radius: 4px;
    color: white;
    background: #5E1620;
    cursor: pointer;
  }

  /* Fixed half-A4 print area */
  .page {
    position: relative;
    width: 202mm;
    height: 140mm;
    overflow: hidden;
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .sheet {
    width: 202mm;
    padding: 2mm;
    margin: 0;
    transform-origin: top left;
  }

  .top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 5mm;
    border-bottom: 2px solid #5E1620;
    padding-bottom: 3px;
    margin-bottom: 4px;
  }

  .shop-name {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 16px;
    line-height: 1.1;
    font-weight: bold;
    color: #5E1620;
    margin: 0 0 3px;
  }

  .shop-meta {
    font-size: 8px;
    line-height: 1.3;
    color: #444;
    overflow-wrap: anywhere;
  }

  .invoice-tag {
    text-align: right;
    flex-shrink: 0;
  }

  .invoice-tag .label {
    display: inline-block;
    background: #5E1620;
    color: white;
    padding: 3px 8px;
    font-size: 9px;
    font-weight: bold;
    margin-bottom: 2px;
  }

  .invoice-tag table {
    font-size: 8px;
    border-collapse: collapse;
  }

  .invoice-tag td {
    padding: 1px 2px;
  }

  .invoice-tag td:last-child {
    text-align: right;
    font-weight: bold;
  }

  .parties {
    display: flex;
    gap: 5px;
    margin-bottom: 4px;
  }

  .party-box {
    width: 50%;
    min-width: 0;
    border: 1px solid #E9DFCD;
    border-radius: 3px;
    padding: 4px 6px;
    overflow-wrap: anywhere;
  }

  .party-box h4 {
    margin: 0 0 2px;
    font-size: 7px;
    color: #A47D2B;
    text-transform: uppercase;
  }

  .party-box .name {
    font-size: 9px;
    font-weight: bold;
  }

  .party-box .line {
    font-size: 7px;
    margin-top: 1px;
  }

  .supply-badge {
    display: inline-block;
    margin-top: 2px;
    padding: 2px 5px;
    border-radius: 3px;
    font-size: 7px;
    background: ${interState ? '#FBEAE7' : '#E7F5ED'};
    color: ${interState ? '#B23A2E' : '#1E7A4C'};
  }

  table.items {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    margin: 0 0 3px;
  }

  table.items th {
    background: #5E1620;
    color: white;
    font-size: 7px;
    font-weight: bold;
    text-align: left;
    padding: 3px 2px;
    overflow-wrap: anywhere;
  }

  table.items td {
    padding: 3px 2px;
    border-bottom: 1px solid #E9DFCD;
    font-size: 7px;
    vertical-align: top;
    overflow-wrap: anywhere;
  }

  table.items th:nth-child(1) { width: 4%; }
  table.items th:nth-child(2) { width: 27%; }
  table.items th:nth-child(3) { width: 7%; }
  table.items th:nth-child(4) { width: 10%; }
  table.items th:nth-child(5) { width: 6%; }
  table.items th:nth-child(6) { width: 12%; }
  table.items th:nth-child(7) { width: 5%; }
  table.items th:nth-child(8) { width: 13%; }
  table.items th:nth-child(9) { width: 16%; }

  .center { text-align: center !important; }
  .right { text-align: right !important; }
  .strong { font-weight: bold; }

  .item-cell strong {
    font-size: 8px;
  }

  .details {
    font-size: 6px;
    color: #555;
    line-height: 1.2;
    margin-top: 1px;
  }

  .sub {
    color: #666;
    font-size: 6px;
  }

  .bottom {
    display: grid;
    grid-template-columns: 1fr 62mm;
    gap: 4mm;
    align-items: start;
    margin-top: 3px;
  }

  .words {
    grid-column: 1;
    grid-row: 1;
    background: #FBF3E4;
    border-radius: 3px;
    padding: 4px 5px;
    font-size: 7px;
    overflow-wrap: anywhere;
  }

  .words strong {
    color: #5E1620;
  }

  .footer {
    grid-column: 1;
    grid-row: 2;
    display: flex;
    justify-content: space-between;
    gap: 4px;
    border-top: 1px solid #E9DFCD;
    padding-top: 4px;
    margin-top: 3px;
    font-size: 7px;
    color: #555;
  }

  .bank {
    overflow-wrap: anywhere;
  }

  .sign-box {
    text-align: center;
    flex-shrink: 0;
  }

  .sign-line {
    width: 28mm;
    border-top: 1px solid #888;
    padding-top: 2px;
    margin-top: 12px;
  }

  .totals-wrap {
    grid-column: 2;
    grid-row: 1 / span 2;
    margin-top: 0;
  }

  .totals {
    width: 100%;
    font-size: 7px;
  }

  .totals .row {
    display: flex;
    justify-content: space-between;
    gap: 5px;
    padding: 2px 0;
    border-bottom: 1px dashed #E9DFCD;
  }

  .totals .row span:last-child {
    text-align: right;
    white-space: nowrap;
  }

  .totals .row.grand {
    border-top: 2px solid #5E1620;
    border-bottom: 0;
    margin-top: 2px;
    padding-top: 3px;
    font-size: 10px;
    font-weight: bold;
    color: #5E1620;
  }

  .note-line {
    margin: 4px 0 0;
    font-size: 6px;
    color: #777;
    overflow-wrap: anywhere;
  }

  @media print {
    .print-bar {
      display: none !important;
    }

    html, body {
      width: 202mm !important;
      margin: 0 !important;
      padding: 0 !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .page {
      width: 202mm !important;
      height: 140mm !important;
      overflow: hidden !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .sheet {
      margin: 0 !important;
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
  }
</style>
</head>

<body>
<div class="print-bar">
  <button type="button" onclick="window.print()">Print Bill</button>
</div>

<div class="page" id="printPage">
  <div class="sheet" id="invoiceSheet">

    <div class="top">
      <div>
        <p class="shop-name">${esc(shop.shop_name || 'RAJASTHANI SAREE')}</p>
        <div class="shop-meta">
          ${address}<br>
          Phone: ${esc(shop.phone || '-')}
          ${shop.email ? ' · ' + esc(shop.email) : ''}<br>
          <strong>GSTIN: ${esc(shop.gstin || '-')}</strong>
          ${shop.pan ? ' · PAN: ' + esc(shop.pan) : ''}
        </div>
      </div>

      <div class="invoice-tag">
        <span class="label">TAX INVOICE</span>
        <table>
          <tr>
            <td>Invoice No.</td>
            <td>${esc(bill.invoice_no || '-')}</td>
          </tr>
          <tr>
            <td>Date &amp; Time</td>
            <td>${esc(fmtDateTime(invoiceDate))}</td>
          </tr>
          <tr>
            <td>Payment</td>
            <td>${esc(bill.payment_mode || '-')} · ${esc(bill.payment_status || '-')}</td>
          </tr>
        </table>
      </div>
    </div>

    <div class="parties">
      <div class="party-box">
        <h4>Billed To</h4>
        <div class="name">${esc(bill.customer_name || '-')}</div>
        ${bill.customer_phone
          ? `<div class="line">Phone: ${esc(bill.customer_phone)}</div>`
          : ''}
        ${bill.customer_gstin
          ? `<div class="line">GSTIN: ${esc(bill.customer_gstin)}</div>`
          : ''}
        ${bill.customer_state
          ? `<div class="line">State: ${esc(bill.customer_state)}</div>`
          : ''}
      </div>

      <div class="party-box">
        <h4>Place of Supply</h4>
        <div class="name">${esc(bill.customer_state || shop.state || '-')}</div>
        <span class="supply-badge">
          ${interState ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'}
        </span>
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th>#</th>
          <th>Item / Saree</th>
          <th>Qty</th>
          <th>Rate (₹)</th>
          <th>Disc.</th>
          <th>Taxable (₹)</th>
          <th>GST</th>
          ${taxHeaders}
          <th>Amount (₹)</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <div class="bottom">
      <div class="totals-wrap">
        <div class="totals">
          <div class="row">
            <span>Subtotal</span>
            <span>${formatINR(num(bill.subtotal), false)}</span>
          </div>
          <div class="row">
            <span>Discount</span>
            <span>- ${formatINR(num(bill.discount_amount), false)}</span>
          </div>
          <div class="row">
            <span>Taxable Value</span>
            <span>${formatINR(num(bill.taxable_value), false)}</span>
          </div>

          ${interState
            ? `<div class="row">
                 <span>IGST</span>
                 <span>${formatINR(num(bill.igst_amount), false)}</span>
               </div>`
            : `<div class="row">
                 <span>CGST</span>
                 <span>${formatINR(num(bill.cgst_amount), false)}</span>
               </div>
               <div class="row">
                 <span>SGST</span>
                 <span>${formatINR(num(bill.sgst_amount), false)}</span>
               </div>`}

          <div class="row">
            <span>Round Off</span>
            <span>${num(bill.round_off) >= 0 ? '+' : ''}${formatINR(num(bill.round_off), false)}</span>
          </div>
          <div class="row grand">
            <span>Grand Total</span>
            <span>${formatINR(num(bill.grand_total))}</span>
          </div>
        </div>
      </div>

      <div class="words">
        <strong>Amount in words:</strong>
        ${esc(amountInWords(num(bill.grand_total)))}
      </div>

      <div class="footer">
        <div class="bank">
          ${bankDetails}
          ${upiDetails}
        </div>
        <div class="sign-box">
          <div class="sign-line">Authorised Signatory</div>
        </div>
      </div>
    </div>

    <p class="note-line">
      This is a computer-generated invoice.
      Goods once sold
      ${bill.is_interstate
        ? 'are not returnable across state lines except as per applicable exchange policy'
        : 'can be exchanged within 7 days with this invoice'}.
      Subject to ${esc(shop.city || shop.state || '')} jurisdiction only.
    </p>

  </div>
</div>

<script>
(function () {
  const page = document.getElementById('printPage');
  const sheet = document.getElementById('invoiceSheet');

  function fitInvoice() {
    if (!page || !sheet) return;

    sheet.style.transform = 'none';
    sheet.style.width = '202mm';

    const contentHeight = sheet.scrollHeight;
    const availableHeight = page.clientHeight;

    if (contentHeight > availableHeight && contentHeight > 0) {
      const scale = availableHeight / contentHeight;
      sheet.style.transformOrigin = 'top left';
      sheet.style.transform = 'scale(' + scale + ')';
    }
  }

  window.addEventListener('load', fitInvoice);
  window.addEventListener('beforeprint', fitInvoice);
})();
</script>

</body>
</html>`;
}

module.exports = { renderInvoiceHTML };
