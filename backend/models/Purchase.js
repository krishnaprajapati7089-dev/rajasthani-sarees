const mongoose = require('mongoose');


/* =========================================================
   PURCHASE ITEM SCHEMA
   ========================================================= */

const purchaseItemSchema = new mongoose.Schema({

  item_code: {
    type: String,
    default: ''
  },

  description: {
    type: String,
    required: true
  },

  // Category of the saree/product
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


/* =========================================================
   PURCHASE SCHEMA
   ========================================================= */

const purchaseSchema = new mongoose.Schema({

  /* -------------------------------------------------------
     SUPPLIER / DEALER DETAILS
     ------------------------------------------------------- */

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


  /* -------------------------------------------------------
     UNIQUE BILL NUMBER
     
     Example:
     PB-260929-123456-582
     ------------------------------------------------------- */

  unique_bill_number: {
    type: String,
    required: true,
    unique: true,
    index: true
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

  items: [purchaseItemSchema],


  /* -------------------------------------------------------
     BILL CALCULATION
     ------------------------------------------------------- */

  taxable_amount: {
    type: Number,
    default: 0
  },

  gst_total: {
    type: Number,
    default: 0
  },


  /* -------------------------------------------------------
     EXTRA / SHIPPING / OTHER CHARGES
     
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
     Discount = 5%
     ------------------------------------------------------- */

  dealer_discount_percent: {
    type: Number,
    default: 0,
    min: 0
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
     
     Formula used by frontend/backend:
     
     Gross Total
     + Extra Charges
     - Dealer Discount
     = Grand Total
     ------------------------------------------------------- */

  grand_total: {
    type: Number,
    default: 0
  }

}, {
  timestamps: true
});


/* =========================================================
   EXPORT MODEL
   ========================================================= */

module.exports = mongoose.model('Purchase', purchaseSchema);
