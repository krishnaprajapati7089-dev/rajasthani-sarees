
require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/db');
const User = require('./models/User');

const productsRouter = require('./routes/products')
const billsRouter = require('./routes/bills');
const purchasesRouter = require('./routes/purchases');
const shopRouter = require('./routes/shop');
const dashboardRouter = require('./routes/dashboard');
const reportsRouter = require('./routes/reports');
const caRouter = require('./routes/accounts');
const supplierLedgerRouter = require('./routes/supplierLedger');


const app = express();
const PORT = process.env.PORT || 5000;

// ============================================================
// CONFIGURATION
// ============================================================

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error(
    'JWT_SECRET is missing. Add it in Render Environment Variables.'
  );
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PRODUCTION,
  sameSite: IS_PRODUCTION ? 'none' : 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000
};

const COOKIE_CLEAR_OPTIONS = {
  httpOnly: true,
  secure: IS_PRODUCTION,
  sameSite: IS_PRODUCTION ? 'none' : 'lax',
  path: '/'
};

// ============================================================
// CORS
// ============================================================

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.RENDER_EXTERNAL_URL,
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ============================================================
// AUTHENTICATION RATE LIMITER
// ============================================================

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    ok: false,
    message: 'Too many attempts. Please try again after 15 minutes.'
  }
});

// ============================================================
// JWT TOKEN
// ============================================================

function createToken(user) {
  return jwt.sign(
    {
      userId: user._id.toString(),
      username: user.username
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ============================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================

async function requireAuth(req, res, next) {
  const cookieToken = req.cookies?.token;

  const authorization = req.headers.authorization || '';
  const bearerToken = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : null;

  const token = cookieToken || bearerToken;

  if (!token) {
    return res.status(401).json({
      ok: false,
      message: 'Please log in to continue.'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await User.findById(decoded.userId)
      .select('_id username role');

    if (!user) {
      res.clearCookie('token', COOKIE_CLEAR_OPTIONS);

      return res.status(401).json({
        ok: false,
        message: 'User account not found. Please log in again.'
      });
    }

    req.user = user;
    next();
  } catch (err) {
    if (
      err.name === 'JsonWebTokenError' ||
      err.name === 'TokenExpiredError'
    ) {
      res.clearCookie('token', COOKIE_CLEAR_OPTIONS);

      return res.status(401).json({
        ok: false,
        message: 'Your session has expired. Please log in again.'
      });
    }

    next(err);
  }
}

// ============================================================
// REGISTER
// POST /api/register
// ============================================================

app.post('/api/register', authLimiter, async (req, res, next) => {
  try {
    const username =
      typeof req.body.username === 'string'
        ? req.body.username.trim().toLowerCase()
        : '';

    const password =
      typeof req.body.password === 'string'
        ? req.body.password
        : '';

    if (!/^[a-z0-9_.-]{3,30}$/.test(username)) {
      return res.status(400).json({
        ok: false,
        message:
          'Username must be 3-30 characters using letters, numbers, dots, underscores or hyphens.'
      });
    }

    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({
        ok: false,
        message: 'Password must be between 8 and 128 characters.'
      });
    }

    const existingUser = await User.findOne({ username })
      .select('_id');

    if (existingUser) {
      return res.status(409).json({
        ok: false,
        message: 'This username is already registered.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    let user;

    try {
      user = await User.create({
        username,
        passwordHash,
        role: 'admin'
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({
          ok: false,
          message: 'This username is already registered.'
        });
      }

      throw err;
    }

    const token = createToken(user);

    res.cookie('token', token, COOKIE_OPTIONS);

    return res.status(201).json({
      ok: true,
      message: 'Account created successfully.',
      user: {
        id: user._id,
        username: user.username,
        role: user.role
      }
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// LOGIN
// POST /api/login
// ============================================================

app.post('/api/login', authLimiter, async (req, res, next) => {
  try {
    const username =
      typeof req.body.username === 'string'
        ? req.body.username.trim().toLowerCase()
        : '';

    const password =
      typeof req.body.password === 'string'
        ? req.body.password
        : '';

    if (!username || !password) {
      return res.status(400).json({
        ok: false,
        message: 'Enter both username and password.'
      });
    }

    const user = await User.findOne({ username })
      .select('+passwordHash');

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({
        ok: false,
        message: 'Invalid username or password.'
      });
    }

    const token = createToken(user);

    res.cookie('token', token, COOKIE_OPTIONS);

    return res.json({
      ok: true,
      message: 'Login successful.',
      user: {
        id: user._id,
        username: user.username,
        role: user.role
      }
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// LOGOUT
// POST /api/logout
// ============================================================

app.post('/api/logout', (req, res) => {
  res.clearCookie('token', COOKIE_CLEAR_OPTIONS);

  return res.json({
    ok: true,
    message: 'Logged out successfully.'
  });
});

// ============================================================
// CURRENT USER
// GET /api/me
// ============================================================

app.get('/api/me', requireAuth, (req, res) => {
  res.json({
    ok: true,
    user: {
      id: req.user._id,
      username: req.user.username,
      role: req.user.role
    }
  });
});

// ============================================================
// PUBLIC HEALTH CHECK
// GET /api/health
// ============================================================

app.get('/api/health', async (req, res) => {
  try {
    await connectDB();

    res.json({
      ok: true,
      message: 'Rajastani Saree API is running'
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// ============================================================
// PRIVATE API ROUTES
// ============================================================

app.use('/api/products', requireAuth, productsRouter);
app.use('/api/bills', requireAuth, billsRouter);
app.use('/api/purchases', requireAuth, purchasesRouter);
app.use('/api/shop', requireAuth, shopRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);
app.use('/api/reports', requireAuth, reportsRouter);
app.use('/api/ca', requireAuth, caRouter);
app.use('/api/supplier-ledger', requireAuth, supplierLedgerRouter);
app.use('/api/suppliers', requireAuth, suppliersRouter);


// ============================================================
// FRONTEND
// ============================================================

const frontendDir = path.join(__dirname, '..', 'frontend');

app.use(express.static(frontendDir));

app.get('/', (req, res) => {
  res.sendFile(
    path.join(frontendDir, 'dashboard.html'),
    (err) => {
      if (err) {
        res.json({
          name: 'Rajastani Saree Backend',
          status: 'running',
          message:
            'Backend is running. Put your frontend in a sibling ../frontend folder.'
        });
      }
    }
  );
});

// ============================================================
// CENTRAL ERROR HANDLER
// ============================================================

app.use((err, req, res, next) => {
  console.error(err);

  if (res.headersSent) {
    return next(err);
  }

  const status =
    err.message === 'Origin not allowed by CORS' ? 403 : 500;

  res.status(status).json({
    ok: false,
    error:
      status === 403
        ? 'This website origin is not allowed.'
        : 'Internal server error'
  });
});

// ============================================================
// START SERVER
// ============================================================

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Rajastani Saree server running on port ${PORT}`);
      console.log('Authentication users are stored in MongoDB Atlas.');
    });
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });

