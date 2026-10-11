
require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/db');

const productsRouter = require('./routes/products');
const billsRouter = require('./routes/bills');
const purchasesRouter = require('./routes/purchases');
const shopRouter = require('./routes/shop');
const dashboardRouter = require('./routes/dashboard');
const reportsRouter = require('./routes/reports');
const caRouter = require('./routes/accounts');

const app = express();
const PORT = process.env.PORT || 5000;

// ============================================================
// CONFIGURATION
// ============================================================

const FRONTEND_ORIGIN =
  process.env.FRONTEND_URL || 'https://rajasthani-sarees.vercel.app';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error(
    'JWT_SECRET is missing. Add JWT_SECRET in your .env file and Render environment variables.'
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
// MIDDLEWARE
// ============================================================

const allowedOrigins = [
  FRONTEND_ORIGIN,
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow requests without Origin, such as server-to-server requests.
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
// AUTHENTICATION DATABASE (SQLite)
// ============================================================

// AUTH_DB_PATH can point to a persistent disk on Render.
// Locally, users.db will be created beside server.js.
const authDbPath =
  process.env.AUTH_DB_PATH || path.join(__dirname, 'users.db');

const authDB = new Database(authDbPath);

authDB.pragma('journal_mode = WAL');

authDB.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

const findUserByUsername = authDB.prepare(
  'SELECT id, username, password_hash FROM users WHERE username = ?'
);

const findUserById = authDB.prepare(
  'SELECT id, username FROM users WHERE id = ?'
);

const insertUser = authDB.prepare(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);

// ============================================================
// RATE LIMITING
// ============================================================

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    ok: false,
    message: 'Too many authentication attempts. Try again after 15 minutes.'
  }
});

// ============================================================
// CREATE AND VERIFY LOGIN TOKEN
// ============================================================

function createToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function requireAuth(req, res, next) {
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
    const user = findUserById.get(decoded.userId);

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
    res.clearCookie('token', COOKIE_CLEAR_OPTIONS);

    return res.status(401).json({
      ok: false,
      message: 'Your session has expired. Please log in again.'
    });
  }
}

// ============================================================
// REGISTER
// POST /api/register
// Body: { "username": "...", "password": "..." }
// ============================================================

app.post('/api/register', authLimiter, async (req, res, next) => {
  try {
    const username =
      typeof req.body.username === 'string'
        ? req.body.username.trim()
        : '';

    const password =
      typeof req.body.password === 'string'
        ? req.body.password
        : '';

    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
      return res.status(400).json({
        ok: false,
        message:
          'Username must be 3–30 characters and contain only letters, numbers, dots, underscores or hyphens.'
      });
    }

    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({
        ok: false,
        message: 'Password must be between 8 and 128 characters.'
      });
    }

    const existingUser = findUserByUsername.get(username);

    if (existingUser) {
      return res.status(409).json({
        ok: false,
        message: 'This username is already registered.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    let result;

    try {
      result = insertUser.run(username, passwordHash);
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({
          ok: false,
          message: 'This username is already registered.'
        });
      }

      throw err;
    }

    const user = {
      id: Number(result.lastInsertRowid),
      username
    };

    const token = createToken(user);

    res.cookie('token', token, COOKIE_OPTIONS);

    return res.status(201).json({
      ok: true,
      message: 'Account created successfully.',
      user
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// LOGIN
// POST /api/login
// Body: { "username": "...", "password": "..." }
// ============================================================

app.post('/api/login', authLimiter, async (req, res, next) => {
  try {
    const username =
      typeof req.body.username === 'string'
        ? req.body.username.trim()
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

    const user = findUserByUsername.get(username);

    if (!user) {
      return res.status(401).json({
        ok: false,
        message: 'Invalid username or password.'
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatches) {
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
        id: user.id,
        username: user.username
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
    user: req.user
  });
});

// ============================================================
// HEALTH CHECK — PUBLIC
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
// All routes below require a valid login.
// Existing route files and URL paths are preserved.
// ============================================================

app.use('/api/products', requireAuth, productsRouter);
app.use('/api/bills', requireAuth, billsRouter);
app.use('/api/purchases', requireAuth, purchasesRouter);
app.use('/api/shop', requireAuth, shopRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);
app.use('/api/reports', requireAuth, reportsRouter);
app.use('/api/ca', requireAuth, caRouter);

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

  const status = err.message === 'Origin not allowed by CORS' ? 403 : 500;

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
      console.log(`Authentication database: ${authDbPath}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
