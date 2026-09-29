const mongoose = require('mongoose');


/* =========================================================
   PURCHASE ITEM SCHEMA
   ========================================================= */

const purchaseItemSchema = new mongoose.Schema({

  // Product / barcode code
  item_code: {
    type: String,
    default: ''
  },

  // Saree / product name
  description: {
    type: String,
    required: true
  },

  // Product category
  // Example: Silk, Cotton, Georgette, Designer
  category: {
    type: String,
    default: ''
  },

  // HSN code
  hsn_code: {
    type: String,
    default: ''
  },

  // Quantity purchased
  qty: {
    type: Number,
    required: true,
    default: 1,
    min: 1
  },

  // MRP of product
  mrp: {
    type: Number,
    default: 0,
    min: 0
  },

  // Purchase price/rate paid to supplier
  purchase_rate: {
    type: Number,
    default: 0,
    min: 0
  },

  // Selling price to customer INCLUDING GST
  selling_price: {
    type: Number,
    default: 0,
    min: 0
  },

  // Keep rate for compatibility with old purchase records
  rate: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },

  // GST percentage
  gst_rate: {
    type: Number,
    required: true,
    default: 5,
    min: 0
  },

  // Final amount for this item
  amount: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },

  // Product reference
  product_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }

}, {
  _id: false
});


/* =========================================================
   PURCHASE SCHEMA
   ========================================================= */

const purchaseSchema = new mongoose.Schema({

  /* -------------------------------------------------------
     SUPPLIER / DEALER DETAILS
     ------------------------------------------------------- */

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


  /* -------------------------------------------------------
     UNIQUE PURCHASE BILL NUMBER
     
     Example:
     P582431
     
     The frontend will generate a 6-digit number
     with the P prefix.
     ------------------------------------------------------- */

  unique_bill_number: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true
  },


  /* -------------------------------------------------------
     UPLOADED BILL IMAGE
     ------------------------------------------------------- */

  bill_image_url: {
    type: String,
    default: ''
  },


  /* -------------------------------------------------------
     PURCHASE ITEMS
     ------------------------------------------------------- */

  items: {
    type: [purchaseItemSchema],
    default: []
  },


  /* -------------------------------------------------------
     TAXABLE AMOUNT
     ------------------------------------------------------- */

  taxable_amount: {
    type: Number,
    default: 0,
    min: 0
  },


  /* -------------------------------------------------------
     TOTAL GST
     ------------------------------------------------------- */

  gst_total: {
    type: Number,
    default: 0,
    min: 0
  },


  /* -------------------------------------------------------
     EXTRA / SHIPPING CHARGES
     
     Example:
     Shipping = ₹150
     ------------------------------------------------------- */

  extra_charges: {
    type: Number,
    default: 0,
    min: 0
  },


  /* -------------------------------------------------------
     DEALER DISCOUNT
     
     Example:
     5 = 5% discount
     ------------------------------------------------------- */

  dealer_discount_percent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },


  /* -------------------------------------------------------
     ACTUAL DISCOUNT AMOUNT
     
     Example:
     Total before discount = ₹10,000
     Discount = 5%
     Discount amount = ₹500
     ------------------------------------------------------- */

  dealer_discount_amount: {
    type: Number,
    default: 0,
    min: 0
  },


  /* -------------------------------------------------------
     FINAL BILL TOTAL
     
     Calculated by the backend:
     
     Taxable Amount
     + GST
     + Extra Charges
     - Dealer Discount
     = Grand Total
     ------------------------------------------------------- */

  grand_total: {
    type: Number,
    default: 0,
    min: 0
  }

}, {
  timestamps: true
});


/* =========================================================
   DATABASE INDEXES
   ========================================================= */

// Search by supplier / party name
purchaseSchema.index({
  supplier: 1
});

// Search by invoice number
purchaseSchema.index({
  invoice_number: 1
});

// unique_bill_number already has:
// unique: true
// index: true


/* =========================================================
   EXPORT MODEL
   ========================================================= */

module.exports = mongoose.model('Purchase', purchaseSchema);
