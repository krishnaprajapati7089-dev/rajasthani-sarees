require('dotenv').config();
const connectDB = require('../config/db');
const ShopProfile = require('../models/ShopProfile');

(async () => {
  try {
    await connectDB();
    const shop = await ShopProfile.findOneAndUpdate(
      { key: 'main' },
      { $setOnInsert: { key: 'main', shop_name: 'Rajastani Saree', invoice_prefix: 'INV' } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log('Shop profile ready:', shop.shop_name);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
