const mongoose = require('mongoose');

const purchaseItemSchema = new mongoose.Schema({
  item_code: { type: String, default: '' },
  description: { type: String, required: true },
  hsn_code: { type: String, default: '' },
  category: { type: String, default: 'General' },
  mrp: { type: Number, default: 0 },
  selling_price: { type: Number, default: 0 },
  margin_percent: { type: Number, default: 0 },
  purchase_rate: { type: Number, default: 0 },
  qty: { type: Number, required: true, default: 1 },
  rate: { type: Number, required: true, default: 0 },
  gst_rate: { type: Number, required: true, default: 5 },
  amount: { type: Number, required: true, default: 0 },
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }
}, { _id: false });

const purchasePaymentSchema = new mongoose.Schema({
  type: { type: String, enum: ['Cr', 'Dr'], default: 'Dr' },
  mode: { type: String, default: 'Other' },
  amount: { type: Number, min: 0, default: 0 },
  date: { type: Date, default: Date.now },
  note: { type: String, default: '' }
}, { _id: false });

const purchaseSchema = new mongoose.Schema({
  supplier: { type: String, required: true, trim: true, index: true },
  supplier_gstin: { type: String, default: '' },
  invoice_number: { type: String, required: true },
  invoice_date: { type: Date, default: Date.now },
  supplier_state: { type: String, default: '' },
  reference: { type: String, default: '' },
  unique_bill_number: { type: String, required: true, unique: true, index: true },
  dealer_discount_percent: { type: Number, default: 0 },
  dealer_discount_amount: { type: Number, default: 0 },
  bill_image_url: { type: String, default: '' },
  items: { type: [purchaseItemSchema], default: [] },
  taxable_amount: { type: Number, default: 0 },
  gst_total: { type: Number, default: 0 },
  extra_charges: { type: Number, default: 0 },
  grand_total: { type: Number, default: 0 },

  // Supplier ledger data sent by purchase.html and used by routes/suppliers.js
  gst_percent: { type: Number, default: 0 },
  default_margin_percent: { type: Number, default: 70 },
  payments: { type: [purchasePaymentSchema], default: [] },
  advance_paid: { type: Number, default: 0 },
  cash_paid: { type: Number, default: 0 },
  other_paid: { type: Number, default: 0 },
  extra_credit: { type: Number, default: 0 },
  balance_amount: { type: Number, default: 0 },
  balance_type: { type: String, enum: ['Cr', 'Dr'], default: 'Cr' }
}, { timestamps: true, minimize: false });

module.exports = mongoose.model('Purchase', purchaseSchema);
