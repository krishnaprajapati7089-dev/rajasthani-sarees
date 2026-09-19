// routes/products.js — inventory CRUD, backs inventory.html and the
// product-search box on billing.html
const express = require('express');
const Product = require('../models/Product');
const { generateUniqueBarcode } = require('../utils/barcode');

const router = express.Router();

// GET /api/products?q=search-term
router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    const filter = { active: true };
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { barcode: { $regex: q, $options: 'i' } },
        { category: { $regex: q, $options: 'i' } }
      ];
    }
    const products = await Product.find(filter).sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products
// If no barcode is supplied (e.g. adding a brand-new saree with no existing
// tag), one is generated automatically so a label can be printed for it.
router.post('/', async (req, res) => {
  try {
    const payload = { ...req.body };

    if (!payload.barcode || !String(payload.barcode).trim()) {
      payload.barcode = await generateUniqueBarcode(Product);
    } else {
      payload.barcode = String(payload.barcode).trim();
    }

    const product = await Product.create(payload);
    res.status(201).json(product);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A product with this barcode already exists' });
    }
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/products/:id
router.put('/:id', async (req, res) => {
  try {
    const payload = { ...req.body };
    if (payload.barcode !== undefined && !String(payload.barcode).trim()) {
      // Don't let an edit accidentally blank out the barcode — keep the
      // existing one instead of wiping it.
      delete payload.barcode;
    }

    const product = await Product.findByIdAndUpdate(req.params.id, payload, {
      new: true, runValidators: true
    });
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A product with this barcode already exists' });
    }
    res.status(400).json({ error: err.message });
  }
});

// POST /api/products/:id/regenerate-barcode
// Useful if a printed label got lost/damaged and you need a fresh code.
router.post('/:id/regenerate-barcode', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    product.barcode = await generateUniqueBarcode(Product);
    await product.save();
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/products/:id — soft delete (keeps history on old bills intact)
router.delete('/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json({ message: 'Product deactivated', product });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;