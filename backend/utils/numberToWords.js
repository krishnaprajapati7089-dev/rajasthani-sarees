// utils/numberToWords.js — Indian-format currency helpers used by templates/invoice.js

function formatINR(amount, withSymbol = true) {
  const num = Number(amount) || 0;
  const formatted = num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return withSymbol ? `₹${formatted}` : formatted;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n) {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o ? ' ' + ONES[o] : '');
}

function threeDigits(n) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  let str = '';
  if (h) str += ONES[h] + ' Hundred';
  if (rest) str += (str ? ' ' : '') + twoDigits(rest);
  return str;
}

// Converts an integer into words using the Indian numbering system
// (Crore / Lakh / Thousand / Hundred).
function integerToWords(n) {
  if (n === 0) return 'Zero';

  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = n;

  const parts = [];
  if (crore) parts.push(threeDigits(crore) + ' Crore');
  if (lakh) parts.push(twoDigits(lakh) + ' Lakh');
  if (thousand) parts.push(twoDigits(thousand) + ' Thousand');
  if (hundred) parts.push(threeDigits(hundred));

  return parts.join(' ');
}

// e.g. amountInWords(1974.50) -> "Rupees One Thousand Nine Hundred Seventy Four and Fifty Paise Only"
function amountInWords(amount) {
  const num = Math.round((Number(amount) || 0) * 100) / 100;
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);

  let words = 'Rupees ' + integerToWords(rupees);
  if (paise > 0) {
    words += ' and ' + twoDigits(paise) + ' Paise';
  }
  return words + ' Only';
}

module.exports = { formatINR, amountInWords };
