const express = require('express');
const { getMetricRegistry } = require('../controllers/metricController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.get('/registry', protect, getMetricRegistry);

module.exports = router;
