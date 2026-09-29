const mongoose = require('mongoose');


// ============================================================
// PURCHASE ITEM SCHEMA
// ============================================================

const purchaseItemSchema = new mongoose.Schema(
  {
    item_code: {
      type: String,
      default: ''
    },

    description: {
      type: String,
      required: true
    },

    category: {
      type: String,
      default: ''
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

    // MRP
    mrp: {
      type: Number,
      default: 0
    },

    // Purchase rate before GST
    purchase_rate: {
      type: Number,
      default: 0
    },

    // Selling price including GST
    selling_price: {
      type: Number,
      default: 0
    },

    // Kept for compatibility with old records
    rate: {
      type: Number,
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
  },
  {
    _id: false
  }
);


// ============================================================
// PURCHASE SCHEMA
// ============================================================

const purchaseSchema = new mongoose.Schema(
  {
    // Supplier / Party name
    supplier: {
      type: String,
      required: true,
      trim: true
    },

    supplier_gstin: {
      type: String,
      default: '',
      trim: true
    },

    // Dealer's original invoice number
    invoice_number: {
      type: String,
      required: true,
      trim: true
    },

    invoice_date: {
      type: Date,
      default: Date.now
    },

    supplier_state: {
      type: String,
      default: '',
      trim: true
    },

    reference: {
      type: String,
      default: '',
      trim: true
    },

    // ========================================================
    // OUR UNIQUE PURCHASE BILL NUMBER
    // Example: P582431
    // ========================================================

    unique_bill_number: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true
    },

    // Uploaded bill image
    bill_image_url: {
      type: String,
      default: ''
    },

    // ========================================================
    // ITEMS
    // ========================================================

    items: {
      type: [purchaseItemSchema],
      default: []
    },

    // ========================================================
    // AMOUNTS
    // ========================================================

    taxable_amount: {
      type: Number,
      default: 0
    },

    gst_total: {
      type: Number,
      default: 0
    },

    // Extra / shipping / transport charges
    extra_charges: {
      type: Number,
      default: 0,
      min: 0
    },

    // Dealer discount percentage
    dealer_discount_percent: {
      type: Number,
      default: 0,
      min: 0
    },

    // Actual discount amount
    dealer_discount_amount: {
      type: Number,
      default: 0,
      min: 0
    },

    // Final amount after extra charges and discount
    grand_total: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);


// ============================================================
// INDEXES
// ============================================================

purchaseSchema.index({
  supplier: 1
});

purchaseSchema.index({
  invoice_number: 1
});

purchaseSchema.index({
  unique_bill_number: 1
});


// ============================================================
// MODEL
// ============================================================

module.exports = mongoose.model(
  'Purchase',
  purchaseSchema
);
