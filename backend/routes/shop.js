// routes/shop.js — your shop's own GST/billing profile, used on every printed invoice
// (converted from the original better-sqlite3 version to Mongoose)
const express = require('express');
const ShopProfile = require('../models/ShopProfile');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const shop = await ShopProfile.findOneAndUpdate(
      { key: 'main' },
      {},
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json(shop);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', async (req, res) => {
  try {
    const shop = await ShopProfile.findOneAndUpdate(
      { key: 'main' },
      { $set: req.body },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.json(shop);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
