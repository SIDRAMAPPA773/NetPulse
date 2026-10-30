const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const createCorsOrigin = require('./config/cors');
const morgan = require('morgan');
const connectDB = require('./config/db');
const http = require('http');
const mongoose = require('mongoose');
const socketService = require('./services/socketService');
const { startMonitoring, stopMonitoring } = require('./services/monitoringEngine');

dotenv.config();

const corsOrigin = createCorsOrigin(process.env.CLIENT_ORIGIN, process.env.NODE_ENV);
const app = express();
const server = http.createServer(app);

// Initialize Socket.io
socketService.init(server, corsOrigin);

// Middleware
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/devices', require('./routes/deviceRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/alerts', require('./routes/alertRoutes'));
app.use('/api/settings', require('./routes/settingRoutes'));
app.use('/api/analytics', require('./routes/analyticsRoutes'));
app.use('/api/metrics', require('./routes/metricRoutes'));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET === 'your_jwt_secret_key_here') {
    throw new Error('JWT_SECRET must be configured with at least 32 characters');
  }
  await connectDB();
  if (shuttingDown) return;
  server.listen(PORT, () => {
    console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
    startMonitoring();
  });
};

startServer().catch((error) => {
  console.error('Server startup failed:', error);
  process.exitCode = 1;
});

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await stopMonitoring();
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    await mongoose.disconnect();
  } catch (error) {
    console.error('Server shutdown failed:', error);
    process.exitCode = 1;
  }
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
