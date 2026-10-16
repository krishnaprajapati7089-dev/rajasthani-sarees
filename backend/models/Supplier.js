const mongoose = require('mongoose');

const SupplierSchema = new mongoose.Schema(
  {
    // Name is used to link Purchase bills (Purchase.supplier) to this supplier.
    name: { type: String, required: true, trim: true, index: true },
    phone: { type: String, default: '', trim: true },
    city: { type: String, default: '', trim: true },
    gst: { type: String, default: '', trim: true },

    // Positive = we already owed the supplier (Cr).
    // Negative = supplier is holding an advance from us (Dr).
    openingBalance: { type: Number, default: 0 },

    notes: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.Supplier ||
  mongoose.model('Supplier', SupplierSchema);
