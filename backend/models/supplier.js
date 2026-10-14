
const mongoose = require('mongoose');

const SupplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: '' },
    city: { type: String, default: '' },
    gst: { type: String, default: '' },
    openingBalance: { type: Number, default: 0 },
    notes: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.Supplier ||
  mongoose.model('Supplier', SupplierSchema);
