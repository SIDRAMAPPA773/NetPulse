const express = require('express');
const { getAlerts, updateAlertStatus } = require('../controllers/alertController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

router.get('/', protect, getAlerts);
router.put('/:id', protect, admin, updateAlertStatus);

module.exports = router;
