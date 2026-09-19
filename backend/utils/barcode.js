// utils/barcode.js — generates short, print-friendly, unique product codes
// used for the barcode/QR label you print and stick on each saree.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion

function randomSegment(length = 6) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/**
 * Generates a barcode value guaranteed not to already exist on another
 * product. Format: PREFIX-XXXXXX (prefix + 6 random chars, e.g. RS-7F3K9Q).
 * Retries a few times on the (very unlikely) chance of a collision, then
 * falls back to a timestamp-based code.
 */
async function generateUniqueBarcode(Product, prefix = 'RS') {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = `${prefix}-${randomSegment(6)}`;
    const exists = await Product.exists({ barcode: code });
    if (!exists) return code;
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

module.exports = { generateUniqueBarcode };