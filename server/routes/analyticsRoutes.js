const express = require('express');
const { getPerformance, getTraffic } = require('../controllers/analyticsController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.get('/performance', protect, getPerformance);
router.get('/traffic', protect, getTraffic);

module.exports = router;
