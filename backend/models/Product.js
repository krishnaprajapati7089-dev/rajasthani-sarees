const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  barcode: { type: String, trim: true, unique: true, sparse: true },
  category: { type: String, trim: true, default: 'General' },
  hsn_code: { type: String, trim: true, default: '5407' },
  unit: { type: String, trim: true, default: 'pcs' },
  purchase_price: { type: Number, required: true, default: 0, min: 0 },
  mrp: { type: Number, default: 0, min: 0 },
  selling_price: { type: Number, required: true, default: 0, min: 0 },
  margin_percent: { type: Number, default: 0, min: 0 },
  gst_rate: { type: Number, required: true, default: 5, min: 0 },
  stock_qty: { type: Number, required: true, default: 0 },
  reorder_level: { type: Number, required: true, default: 5 },
  active: { type: Boolean, default: true }
}, { timestamps: true });

productSchema.index({ name: 'text', category: 'text' });

module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);
