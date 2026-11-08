const express = require('express');
const { getPerformance, getTraffic, getFleet } = require('../controllers/analyticsController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.get('/performance', protect, getPerformance);
router.get('/traffic', protect, getTraffic);
router.get('/fleet', protect, getFleet);

module.exports = router;
