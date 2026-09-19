const mongoose = require('mongoose');

const billItemSchema = new mongoose.Schema({

  product_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  },

  product_name: {
    type: String,
    required: true
  },

  hsn_code: {
    type: String,
    default: ''
  },

  unit: {
    type: String,
    default: 'pcs'
  },

  qty: {
    type: Number,
    required: true,
    default: 1
  },

  // MRP of the product
  mrp: {
    type: Number,
    default: 0
  },

  // Selling price INCLUDING GST
  rate: {
    type: Number,
    required: true,
    default: 0
  },

  discount_percent: {
    type: Number,
    default: 0
  },

  // Price excluding GST after discount
  taxable_value: {
    type: Number,
    required: true,
    default: 0
  },

  gst_rate: {
    type: Number,
    required: true,
    default: 5
  },

  cgst_amount: {
    type: Number,
    default: 0
  },

  sgst_amount: {
    type: Number,
    default: 0
  },

  igst_amount: {
    type: Number,
    default: 0
  },

  // Final amount customer pays for this line
  // GST is already included
  line_total: {
    type: Number,
    required: true,
    default: 0
  }

}, {
  _id: false
});


const billSchema = new mongoose.Schema({

  invoice_no: {
    type: String,
    required: true,
    unique: true
  },

  bill_date: {
    type: Date,
    default: Date.now
  },

  customer_name: {
    type: String,
    default: 'Walk-in Customer'
  },

  customer_phone: {
    type: String,
    default: ''
  },

  customer_gstin: {
    type: String,
    default: ''
  },

  customer_state: {
    type: String,
    default: ''
  },

  is_interstate: {
    type: Boolean,
    default: false
  },

  payment_mode: {
    type: String,
    default: 'Cash'
  },

  payment_status: {
    type: String,
    default: 'Paid'
  },

  paid_amount: {
    type: Number,
    default: 0
  },

  subtotal: {
    type: Number,
    default: 0
  },

  discount_amount: {
    type: Number,
    default: 0
  },

  taxable_value: {
    type: Number,
    default: 0
  },

  cgst_amount: {
    type: Number,
    default: 0
  },

  sgst_amount: {
    type: Number,
    default: 0
  },

  igst_amount: {
    type: Number,
    default: 0
  },

  round_off: {
    type: Number,
    default: 0
  },

  grand_total: {
    type: Number,
    default: 0
  },

  status: {
    type: String,
    default: 'ACTIVE'
  },

  items: [billItemSchema]

}, {
  timestamps: true
});

module.exports = mongoose.model('Bill', billSchema);
