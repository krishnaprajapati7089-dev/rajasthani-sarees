
const mongoose = require('mongoose');

const SupplierTransactionSchema = new mongoose.Schema(
  {
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: ['payment'],
      default: 'payment',
      required: true
    },
    date: { type: Date, default: Date.now, required: true },
    amount: { type: Number, required: true, min: 0.01 },
    paymentKind: {
      type: String,
      enum: ['advance', 'against_bill', 'settlement'],
      default: 'against_bill'
    },
    mode: {
      type: String,
      enum: ['online', 'upi', 'cash', 'cheque', 'other'],
      default: 'cash'
    },
    reference: { type: String, default: '' },
    chequeDate: { type: Date, default: null },
    note: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.SupplierTransaction ||
  mongoose.model('SupplierTransaction', SupplierTransactionSchema);
