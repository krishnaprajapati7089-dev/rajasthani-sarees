const mongoose = require('mongoose');

const debitNoteItemSchema = new mongoose.Schema({
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  barcode: { type: String, default: '' },
  description: { type: String, required: true },
  category: { type: String, default: '' },
  hsn_code: { type: String, default: '5407' },
  qty: { type: Number, required: true, min: 0.001 },
  rate: { type: Number, required: true, min: 0 }, // original purchase rate
  gst_rate: { type: Number, default: 0, min: 0 },
  taxable_amount: { type: Number, required: true, min: 0 },
  gst_amount: { type: Number, default: 0, min: 0 },
  amount: { type: Number, required: true, min: 0 }
}, { _id: false });

const debitNoteSchema = new mongoose.Schema({
  debit_note_no: { type: String, required: true, unique: true, index: true },
  date: { type: Date, default: Date.now, required: true },
  supplier_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
  supplier: { type: String, required: true, trim: true },
  supplier_gst: { type: String, default: '' },
  supplier_phone: { type: String, default: '' },
  supplier_city: { type: String, default: '' },
  reference_purchase_bill: { type: String, default: '' },
  reason: { type: String, default: 'Return to supplier' },
  remarks: { type: String, default: '' },
  items: { type: [debitNoteItemSchema], validate: v => Array.isArray(v) && v.length > 0 },
  taxable_total: { type: Number, default: 0 },
  gst_total: { type: Number, default: 0 },
  grand_total: { type: Number, default: 0 },
  status: { type: String, enum: ['issued', 'cancelled'], default: 'issued' },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

debitNoteSchema.index({ supplier: 1, date: -1 });
debitNoteSchema.index({ 'items.barcode': 1 });

module.exports = mongoose.models.DebitNote || mongoose.model('DebitNote', debitNoteSchema);
