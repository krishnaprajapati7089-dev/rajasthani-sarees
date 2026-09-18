require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");

const productsRouter = require("./routes/products");
const billsRouter = require("./routes/bills");
const purchasesRouter = require("./routes/purchases");
const shopRouter = require("./routes/shop");
const dashboardRouter = require("./routes/dashboard");
const reportsRouter = require("./routes/reports");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cros({
  origin: "https://rajasthani-sarees.vercel.app/"
}))
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// Health Check
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "Rajastani Saree API is running",
  });
});

// API Routes
app.use("/api/products", productsRouter);
app.use("/api/bills", billsRouter);
app.use("/api/purchases", purchasesRouter);
app.use("/api/shop", shopRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/reports", reportsRouter);

// Serve frontend
const frontendDir = path.join(__dirname, "..", "frontend");

app.use(express.static(frontendDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(frontendDir, "dashboard.html"), (err) => {
    if (err) {
      res.json({
        name: "Rajastani Saree Backend",
        status: "running",
        message: "Backend is running. Put your frontend in ../frontend.",
      });
    }
  });
});

// Central Error Handler
app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    error: err.message || "Internal server error",
  });
});

// Connect MongoDB FIRST, then start server
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });