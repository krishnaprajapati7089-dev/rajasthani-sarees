require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const productsRouter = require('./routes/products');
const billsRouter = require('./routes/bills');
const purchasesRouter = require('./routes/purchases');
const shopRouter = require('./routes/shop');
const dashboardRouter = require('./routes/dashboard');
const reportsRouter = require('./routes/reports');

// ============================================================
// NEW — CA & ACCOUNTS ROUTE
// ============================================================
const caRouter = require('./routes/accounts');


const app = express();

const PORT =
  process.env.PORT || 5000;


// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors());

app.use(
  express.json({
    limit: '5mb'
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);


// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
  '/api/health',
  async (req, res) => {

    try {

      await connectDB();

      res.json({
        ok: true,
        message:
          'Rajastani Saree API is running'
      });

    } catch (err) {

      res.status(500).json({
        ok: false,
        error: err.message
      });

    }

  }
);


// ============================================================
// API ROUTES
// ============================================================

app.use(
  '/api/products',
  productsRouter
);


app.use(
  '/api/bills',
  billsRouter
);


app.use(
  '/api/purchases',
  purchasesRouter
);


app.use(
  '/api/shop',
  shopRouter
);


app.use(
  '/api/dashboard',
  dashboardRouter
);


app.use(
  '/api/reports',
  reportsRouter
);


// ============================================================
// NEW — CA & ACCOUNTS
// ============================================================

app.use(
  '/api/ca',
  caRouter
);


// ============================================================
// FRONTEND
// ============================================================

const frontendDir =
  path.join(
    __dirname,
    '..',
    'frontend'
  );


app.use(
  express.static(
    frontendDir
  )
);


app.get(
  '/',
  (req, res) => {

    res.sendFile(
      path.join(
        frontendDir,
        'dashboard.html'
      ),
      (err) => {

        if (err) {

          res.json({

            name:
              'Rajastani Saree Backend',

            status:
              'running',

            message:
              'Backend is running. Put your frontend in a sibling ../frontend folder.'

          });

        }

      }
    );

  }
);


// ============================================================
// CENTRAL ERROR HANDLER
// ============================================================

app.use(
  (err, req, res, next) => {

    console.error(
      err
    );

    res.status(500).json({

      error:
        err.message ||
        'Internal server error'

    });

  }
);


// ============================================================
// START SERVER
// ============================================================

connectDB()

  .then(() => {

    app.listen(
      PORT,
      () => {

        console.log(
          `Rajastani Saree server running at http://localhost:${PORT}`
        );

      }
    );

  })

  .catch(
    (err) => {

      console.error(
        'MongoDB connection failed:',
        err.message
      );

      process.exit(1);

    }
  );
