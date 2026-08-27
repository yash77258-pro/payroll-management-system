require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Import Routes
const authRoutes       = require('./routes/auth');
const employeeRoutes   = require('./routes/employees');
const payrollRoutes    = require('./routes/payrollRoutes');
const reportsRoutes    = require('./routes/reports');

// API Routes
app.use('/api/auth',      authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api',           payrollRoutes);
app.use('/api/reports',   reportsRoutes);

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ success: true, status: 'Server Running', timestamp: new Date().toISOString() });
});

// Global Error Handler — must be BEFORE the 404 handler
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
});

// 404 — must be LAST, after all routes
app.use((req, res) => {
    console.log(`404: ${req.method} ${req.originalUrl}`);  // helpful for debugging
    res.status(404).json({ success: false, error: 'API Route Not Found' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

module.exports = app;