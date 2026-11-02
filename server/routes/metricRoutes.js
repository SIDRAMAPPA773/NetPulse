const express = require('express');
const { getMetricRegistry, getMetricCoverage } = require('../controllers/metricController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.get('/registry', protect, getMetricRegistry);
router.get('/coverage', protect, getMetricCoverage);

module.exports = router;
