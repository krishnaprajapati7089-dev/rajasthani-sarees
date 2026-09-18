# Rajastani Saree — Backend API

Node.js + Express + MongoDB/Mongoose backend for the Rajastani Saree billing and inventory system.

## Folder structure

- `server.js` — starts Express and mounts all API routes
- `config/db.js` — cached MongoDB connection
- `models/` — Mongoose schemas
- `routes/` — API endpoints
- `templates/invoice.js` — printable GST invoice HTML
- `utils/numberToWords.js` — Indian currency formatting/amount in words
- `.env.example` — environment variable template

## Requirements

- Node.js 18+
- MongoDB Atlas or a reachable MongoDB server

## Run locally

1. Open a terminal in this `backend` folder.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Put your MongoDB connection string in `.env` as `MONGODB_URI`.
5. Run `npm start`.
6. The API will be available at `http://localhost:5000`.

If a sibling `frontend` folder exists, the server also serves it from `/`.

## Main API routes

- `GET/POST/PUT/DELETE /api/products`
- `GET/POST /api/bills`
- `GET/POST /api/purchases`
- `GET/PUT /api/shop`
- `GET /api/dashboard`
- `GET /api/reports/daily`
- `GET /api/reports/sales-trend`
- `GET /api/reports/gst`

## Important

The purchase endpoint updates inventory: existing products get their stock increased; if no product is found by `product_id` or barcode/item code, a new product is created.

The sales endpoint checks stock, calculates GST, decreases stock, and creates the bill.

Do not commit `.env` or your MongoDB password to GitHub.
