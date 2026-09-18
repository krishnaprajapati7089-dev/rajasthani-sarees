const mongoose = require('mongoose');

const shopProfileSchema = new mongoose.Schema({

  // Singleton pattern: there is only ever one doc, with key = 'main'
  key: { type: String, default: 'main', unique: true },

  shop_name: { type: String, default: 'Rajastani Saree' },

  address_line1: {
    type: String,
    default: 'Sadar Bazar'
  },

  address_line2: {
    type: String,
    default: 'Nichla Bazar'
  },

  city: {
    type: String,
    default: 'Guna'
  },

  state: {
    type: String,
    default: 'Madhya Pradesh'
  },

  state_code: {
    type: String,
    default: '23'
  },

  pincode: {
    type: String,
    default: '473001'
  },

  phone: {
    type: String,
    default: '+91 7974433843'
  },

  email: { type: String, default: '' },

  gstin: {
    type: String,
    default: '23EOMPP5029A1Z4'
  },

  pan: {
    type: String,
    default: ''
  },

  bank_name: { type: String, default: '' },
  bank_account_no: { type: String, default: '' },
  bank_ifsc: { type: String, default: '' },

  invoice_prefix: {
    type: String,
    default: 'INV'
  },

  upi_id: { type: String, default: '' }

}, { timestamps: true });

module.exports = mongoose.model('ShopProfile', shopProfileSchema);