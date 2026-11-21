const mongoose = require('mongoose');

const supplierPaymentSchema = new mongoose.Schema({
  type: { type: String, enum: ['Cr', 'Dr'], default: 'Dr' },
  mode: { type: String, default: 'Other' },
  amount: { type: Number, default: 0, min: 0 },
  date: { type: String, default: '' },
  note: { type: String, default: '' }
}, { _id: false });

const purchaseItemSchema = new mongoose.Schema({
  item_code: { type: String, default: '' },
  description: { type: String, required: true },
  category: { type: String, default: 'General' },
  hsn_code: { type: String, default: '5407' },
  qty: { type: Number, required: true, default: 1, min: 0 },
  mrp: { type: Number, default: 0, min: 0 },
  margin_percent: { type: Number, default: 0, min: 0 },
  purchase_rate: { type: Number, default: 0, min: 0 },
  selling_price: { type: Number, default: 0, min: 0 },
  // `rate` retained for compatibility with older purchase records and screens.
  rate: { type: Number, required: true, default: 0, min: 0 },
  gst_rate: { type: Number, required: true, default: 5, min: 0 },
  amount: { type: Number, required: true, default: 0 },
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null }
});

const purchaseSchema = new mongoose.Schema({
  supplier: { type: String, required: true, trim: true },
  supplier_gstin: { type: String, default: '' },
  invoice_number: { type: String, required: true },
  unique_bill_number: { type: String, default: '' },
  invoice_date: { type: Date, default: Date.now },
  supplier_state: { type: String, default: '' },
  reference: { type: String, default: '' },
  bill_image_url: { type: String, default: '' },
  items: { type: [purchaseItemSchema], default: [] },
  taxable_amount: { type: Number, default: 0 },
  gst_percent: { type: Number, default: 0 },
  gst_total: { type: Number, default: 0 },
  total_gst_amount: { type: Number, default: 0 },
  extra_charges: { type: Number, default: 0 },
  dealer_discount_percent: { type: Number, default: 0 },
  dealer_discount_amount: { type: Number, default: 0 },
  grand_total: { type: Number, default: 0 },
  default_margin_percent: { type: Number, default: 70 },
  payments: { type: [supplierPaymentSchema], default: [] },
  advance_paid: { type: Number, default: 0 },
  cash_paid: { type: Number, default: 0 },
  other_paid: { type: Number, default: 0 },
  extra_credit: { type: Number, default: 0 },
  balance_amount: { type: Number, default: 0 },
  balance_type: { type: String, enum: ['Cr', 'Dr'], default: 'Cr' }
}, { timestamps: true, strict: true });

purchaseSchema.index({ supplier: 1, invoice_date: -1 });
purchaseSchema.index({ unique_bill_number: 1 });
purchaseSchema.index({ 'items.product_id': 1 });

module.exports = mongoose.models.Purchase || mongoose.model('Purchase', purchaseSchema);
