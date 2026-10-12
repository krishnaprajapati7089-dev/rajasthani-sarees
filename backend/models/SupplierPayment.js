const mongoose = require('mongoose');

const supplierPaymentSchema = new mongoose.Schema({
  supplier: { type: String, required: true, trim: true, index: true },
  amount: { type: Number, required: true, min: 0.01 },
  payment_date: { type: Date, required: true, default: Date.now, index: true },
  kind: { type: String, enum: ['payment', 'advance'], default: 'payment', index: true },
  payment_mode: { type: String, enum: ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Card', 'Other'], required: true, default: 'Cash' },
  purchase_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', default: null, index: true },
  purchase_bill_number: { type: String, default: '', trim: true },
  reference_number: { type: String, default: '', trim: true },
  cheque_number: { type: String, default: '', trim: true },
  cheque_date: { type: Date, default: null },
  cheque_status: { type: String, enum: ['Not Applicable', 'Issued', 'Cleared', 'Bounced', 'Cancelled'], default: 'Not Applicable' },
  notes: { type: String, default: '', trim: true }
}, { timestamps: true });

supplierPaymentSchema.index({ supplier: 1, payment_date: -1 });
module.exports = mongoose.model('SupplierPayment', supplierPaymentSchema);
