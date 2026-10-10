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
  category: {
    type: String,
    default: ''
  },
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
  // Selling price INCLUDING GST; do not apply discount to it again.
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
  // Final amount customer pays for this line; GST is already included.
  line_total: {
    type: Number,
    required: true,
    default: 0
  }
}, { _id: false });

// Each initial or later payment is stored as a separate history entry.
// Field names match routes/bills.js: amount, date, mode, note.
const paymentSchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  date: {
    type: Date,
    default: Date.now
  },
  mode: {
    type: String,
    default: 'Cash'
  },
  note: {
    type: String,
    default: ''
  }
}, { _id: true });

// ============================================================
// BILL SCHEMA
// ============================================================
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

  // Exact creation time of the bill document.
  created_at: {
    type: Date,
    default: Date.now,
    immutable: true
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

  // ==========================================================
  // PAYMENT
  // ==========================================================
  payment_mode: {
    type: String,
    default: 'Cash'
  },
  payment_status: {
    type: String,
    enum: ['Paid', 'Partial', 'Unpaid'],
    default: 'Paid'
  },
  // Kept for compatibility with existing reports and billing code.
  paid_amount: {
    type: Number,
    default: 0,
    min: 0
  },
  // Total amount received so far, including later instalments.
  amount_received: {
    type: Number,
    default: 0,
    min: 0
  },
  // grand_total minus amount_received.
  outstanding_amount: {
    type: Number,
    default: 0,
    min: 0
  },
  payment_history: {
    type: [paymentSchema],
    default: []
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

  status: {
    type: String,
    default: 'ACTIVE'
  },

  items: [billItemSchema]
}, {
  timestamps: true
});

module.exports = mongoose.model('Bill', billSchema);
