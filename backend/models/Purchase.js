const mongoose = require('mongoose');

const purchaseItemSchema = new mongoose.Schema({
  item_code: {
    type: String,
    default: ''
  },

  description: {
    type: String,
    required: true
  },

  hsn_code: {
    type: String,
    default: ''
  },

  qty: {
    type: Number,
    required: true,
    default: 1
  },

  // MRP of product
  mrp: {
    type: Number,
    default: 0
  },

  // Purchase price/rate from supplier
  purchase_rate: {
    type: Number,
    default: 0
  },

  // Selling price to customer INCLUDING GST
  selling_price: {
    type: Number,
    default: 0
  },

  // Keep rate for compatibility with existing purchase records
  rate: {
    type: Number,
    required: true,
    default: 0
  },

  gst_rate: {
    type: Number,
    required: true,
    default: 5
  },

  amount: {
    type: Number,
    required: true,
    default: 0
  },

  product_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }

}, {
  _id: false
});


const purchaseSchema = new mongoose.Schema({

  supplier: {
    type: String,
    required: true
  },

  supplier_gstin: {
    type: String,
    default: ''
  },

  invoice_number: {
    type: String,
    required: true
  },

  invoice_date: {
    type: Date,
    default: Date.now
  },

  supplier_state: {
    type: String,
    default: ''
  },

  reference: {
    type: String,
    default: ''
  },

  bill_image_url: {
    type: String,
    default: ''
  },

  items: [purchaseItemSchema],

  taxable_amount: {
    type: Number,
    default: 0
  },

  gst_total: {
    type: Number,
    default: 0
  },

  grand_total: {
    type: Number,
    default: 0
  }

}, {
  timestamps: true
});


module.exports = mongoose.model('Purchase', purchaseSchema);
