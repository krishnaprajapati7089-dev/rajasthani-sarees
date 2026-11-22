// Add these routes to the existing debit-note router.
// Place GET /product/:id near the existing SEARCH PRODUCT BY BARCODE route.
// Place PUT /:id after CREATE DEBIT NOTE and before CANCEL DEBIT NOTE.

// ==========================================
// GET PRODUCT BY ID (used when editing older notes)
// ==========================================
router.get('/product/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid product ID.' });
    }
    const product = await Product.findById(req.params.id)
      .select('name barcode category hsn_code purchase_price gst_rate stock_qty active')
      .lean();
    if (!product || product.active === false) {
      return res.status(404).json({ message: 'Product not found.' });
    }
    res.json({ product: {
      _id: product._id, name: product.name, barcode: product.barcode || '',
      category: product.category || '', hsn_code: product.hsn_code || '5407',
      purchase_price: num(product.purchase_price), gst_rate: num(product.gst_rate),
      stock_qty: num(product.stock_qty)
    }});
  } catch (error) {
    console.error('Debit note product by ID:', error);
    res.status(500).json({ message: 'Could not load product.' });
  }
});

// ==========================================
// UPDATE EXISTING DEBIT NOTE
// PUT /api/debit-notes/:id
// ==========================================
router.put('/:id', async (req, res) => {
  const stockChanges = [];
  let note = null;
  let oldNoteSnapshot = null;
  let ledgerTxn = null;
  let ledgerSnapshot = null;
  let ledgerWasCreated = false;

  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid debit note ID.' });
    }

    note = await DebitNote.findById(req.params.id);
    if (!note) return res.status(404).json({ message: 'Debit note not found.' });
    if (note.status !== 'issued') {
      return res.status(400).json({ message: 'Cancelled debit notes cannot be edited.' });
    }
    if (!Array.isArray(req.body?.items) || req.body.items.length === 0) {
      return res.status(400).json({ message: 'At least one saree is required.' });
    }

    const supplierId = req.body.supplier_id;
    if (!supplierId || !mongoose.isValidObjectId(supplierId)) {
      return res.status(400).json({ message: 'Please select a valid supplier.' });
    }
    const supplierDoc = await Supplier.findById(supplierId);
    if (!supplierDoc) return res.status(404).json({ message: 'Supplier not found.' });

    const newDate = req.body.date ? new Date(req.body.date) : note.date;
    if (Number.isNaN(newDate.getTime())) throw new Error('Invalid debit note date.');

    oldNoteSnapshot = note.toObject();
    const oldItems = new Map();
    for (const item of note.items) {
      const plain = item.toObject ? item.toObject() : item;
      oldItems.set(String(item.product_id), plain);
    }

    const quantities = new Map();
    for (const line of req.body.items) {
      const productId = String(line.product_id || '');
      const qty = num(line.qty);
      if (!mongoose.isValidObjectId(productId) || !(qty > 0)) {
        throw new Error('One of the products or return quantities is invalid.');
      }
      quantities.set(productId, (quantities.get(productId) || 0) + qty);
    }

    const newItems = [];
    let taxableTotal = 0;
    let gstTotal = 0;

    for (const [productId, qty] of quantities) {
      const product = await Product.findById(productId)
        .select('name barcode category hsn_code purchase_price gst_rate stock_qty active');
      if (!product || product.active === false) {
        throw new Error(`Product not found: ${productId}`);
      }

      const oldItem = oldItems.get(productId);
      // Preserve the original purchase rate/GST for items already on this note.
      const rate = oldItem ? num(oldItem.rate) : num(product.purchase_price);
      const gstRate = oldItem ? num(oldItem.gst_rate) : num(product.gst_rate);
      const taxable = round2(qty * rate);
      const gst = round2(taxable * gstRate / 100);

      newItems.push({
        product_id: product._id,
        barcode: product.barcode || oldItem?.barcode || '',
        description: product.name,
        category: product.category || oldItem?.category || '',
        hsn_code: product.hsn_code || oldItem?.hsn_code || '5407',
        qty, rate, gst_rate: gstRate,
        taxable_amount: taxable,
        gst_amount: gst,
        amount: round2(taxable + gst)
      });
      taxableTotal += taxable;
      gstTotal += gst;
    }

    // Only adjust the difference between the previous and new quantities.
    const allIds = new Set([...oldItems.keys(), ...quantities.keys()]);
    for (const productId of allIds) {
      const oldQty = num(oldItems.get(productId)?.qty);
      const newQty = num(quantities.get(productId));
      const delta = round2(newQty - oldQty);
      if (!delta) continue;

      let updated;
      if (delta > 0) {
        updated = await Product.findOneAndUpdate(
          { _id: productId, stock_qty: { $gte: delta }, active: { $ne: false } },
          { $inc: { stock_qty: -delta } },
          { new: true }
        );
        if (!updated) {
          const p = await Product.findById(productId).select('name');
          throw new Error(`Insufficient stock for ${p?.name || productId}. Refresh and try again.`);
        }
      } else {
        updated = await Product.findByIdAndUpdate(
          productId, { $inc: { stock_qty: -delta } }, { new: true }
        );
        if (!updated) throw new Error(`Could not restore stock for product ${productId}.`);
      }
      stockChanges.push({ productId, delta });
    }

    note.supplier_id = supplierDoc._id;
    note.supplier = supplierDoc.name;
    note.supplier_gst = supplierDoc.gst || '';
    note.supplier_phone = supplierDoc.phone || '';
    note.supplier_city = supplierDoc.city || '';
    note.date = newDate;
    note.reference_purchase_bill = String(req.body.reference_purchase_bill || '').trim();
    note.reason = String(req.body.reason || 'Return to supplier').trim();
    note.remarks = String(req.body.remarks || '').trim();
    note.items = newItems;
    note.taxable_total = round2(taxableTotal);
    note.gst_total = round2(gstTotal);
    note.grand_total = round2(taxableTotal + gstTotal);
    await note.save();

    // Update the existing debit-note ledger row; do not create a cash payment.
    ledgerTxn = await SupplierTransaction.findOne({
      reference: oldNoteSnapshot.debit_note_no,
      type: 'payment',
      paymentKind: 'debit_note'
    });

    if (ledgerTxn) {
      ledgerSnapshot = ledgerTxn.toObject();
      ledgerTxn.supplier = supplierDoc._id;
      ledgerTxn.date = note.date;
      ledgerTxn.amount = note.grand_total;
      ledgerTxn.reference = note.debit_note_no;
      ledgerTxn.note = `Saree return / Debit Note ${note.debit_note_no}`;
      await ledgerTxn.save();
    } else {
      ledgerTxn = await SupplierTransaction.create({
        supplier: supplierDoc._id,
        type: 'payment',
        date: note.date,
        amount: note.grand_total,
        paymentKind: 'debit_note',
        reference: note.debit_note_no,
        note: `Saree return / Debit Note ${note.debit_note_no}`
      });
      ledgerWasCreated = true;
    }

    return res.json({
      success: true,
      message: 'Debit note updated; stock and supplier ledger adjusted.',
      debitNote: note,
      ledgerTransactionId: ledgerTxn?._id || null
    });
  } catch (error) {
    console.error('Update debit note error:', error);

    // Best-effort compensation if any later write fails.
    for (const change of stockChanges.reverse()) {
      await Product.updateOne(
        { _id: change.productId }, { $inc: { stock_qty: -change.delta } }
      ).catch(rollbackError => console.error('Stock rollback:', rollbackError));
    }

    if (note && oldNoteSnapshot) {
      try { note.set(oldNoteSnapshot); await note.save(); }
      catch (rollbackError) { console.error('Debit note rollback:', rollbackError); }
    }

    if (ledgerWasCreated && ledgerTxn?._id) {
      await SupplierTransaction.findByIdAndDelete(ledgerTxn._id)
        .catch(rollbackError => console.error('Ledger rollback:', rollbackError));
    } else if (ledgerSnapshot?._id) {
      await SupplierTransaction.findByIdAndUpdate(
        ledgerSnapshot._id, { $set: ledgerSnapshot }
      ).catch(rollbackError => console.error('Ledger rollback:', rollbackError));
    }

    return res.status(400).json({ message: error.message || 'Could not update debit note.' });
  }
});
