# API route map

| Method | Endpoint | Purpose |
|---|---|---|
| GET | /api/health | Check server + MongoDB |
| GET | /api/products | List/search active products |
| POST | /api/products | Create product |
| PUT | /api/products/:id | Update product |
| DELETE | /api/products/:id | Deactivate product |
| GET | /api/bills | List sales bills |
| POST | /api/bills | Create sale, calculate GST, reduce stock |
| GET | /api/bills/:id | Get one bill |
| POST | /api/bills/:id/cancel | Cancel bill |
| GET | /api/bills/:id/invoice | Printable invoice |
| GET | /api/purchases | List purchase bills |
| POST | /api/purchases | Record purchase and increase stock |
| GET | /api/purchases/:id | Get one purchase |
| GET | /api/shop | Get shop profile |
| PUT | /api/shop | Update shop profile |
| GET | /api/dashboard | Dashboard summary |
| GET | /api/reports/daily | Daily sales report |
| GET | /api/reports/sales-trend | Sales chart data |
| GET | /api/reports/gst | Monthly GST summary |
