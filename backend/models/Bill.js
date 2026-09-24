const mongoose = require('mongoose');


// ============================================================
// BILL ITEM SCHEMA
// ============================================================

const billItemSchema = new mongoose.Schema({

  product_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  },

  product_name: {
    type: String,
    required: true
  },

  // Saree category
  category: {
    type: String,
    default: ''
  },

  // Barcode / code number
  barcode_number: {
    type: String,
    default: ''
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


// ============================================================
// BILL SCHEMA
// ============================================================

const billSchema = new mongoose.Schema({

  invoice_no: {
    type: String,
    required: true,
    unique: true
  },


  // ==========================================================
  // BILL DATE
  // ==========================================================

  bill_date: {
    type: Date,
    default: Date.now
  },


  // ==========================================================
  // EXACT CREATION TIME
  //
  // This stores the exact date/time when the bill document
  // is created.
  // ==========================================================

  created_at: {
    type: Date,
    default: Date.now,
    immutable: true
  },


  // ==========================================================
  // CUSTOMER
  // ==========================================================

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


  // ==========================================================
  // GST
  // ==========================================================

  is_interstate: {
    type: Boolean,
    default: false
  },


  // ==========================================================
  // PAYMENT
  // ==========================================================

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


  // ==========================================================
  // TOTALS
  // ==========================================================

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


  // ==========================================================
  // STATUS
  // ==========================================================

  status: {
    type: String,
    default: 'ACTIVE'
  },


  // ==========================================================
  // ITEMS
  // ==========================================================

  items: [
    billItemSchema
  ]

}, {

  // Mongoose automatically creates:
  //
  // createdAt
  // updatedAt
  //
  // createdAt is also useful as a backup creation timestamp.

  timestamps: true

});


// ============================================================
// MODEL
// ============================================================

module.exports = mongoose.model('Bill', billSchema);
