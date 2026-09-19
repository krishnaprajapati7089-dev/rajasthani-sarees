const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },

  barcode: {
    type: String,
    trim: true,
    unique: true,
    sparse: true
  },

  category: {
    type: String,
    trim: true,
    default: 'General'
  },

  hsn_code: {
    type: String,
    trim: true,
    default: '5407'
  },

  unit: {
    type: String,
    trim: true,
    default: 'pcs'
  },

  // Purchase price from supplier
  purchase_price: {
    type: Number,
    required: true,
    default: 0
  },

  // MRP printed on the product
  mrp: {
    type: Number,
    required: true,
    default: 0
  },

  // FINAL CUSTOMER PRICE.
  // This price already includes GST.
  selling_price: {
    type: Number,
    required: true,
    default: 0
  },

  // Example: 5, 12, 18
  gst_rate: {
    type: Number,
    required: true,
    default: 5
  },

  stock_qty: {
    type: Number,
    required: true,
    default: 0
  },

  reorder_level: {
    type: Number,
    required: true,
    default: 5
  },

  active: {
    type: Boolean,
    default: true
  }

}, {
  timestamps: true
});

productSchema.index({
  name: 'text',
  category: 'text'
});

module.exports = mongoose.model('Product', productSchema);
