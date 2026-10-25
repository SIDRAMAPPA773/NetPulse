const express = require('express');
const { getSettings, updateSettings } = require('../controllers/settingController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

router.get('/', protect, getSettings);
router.put('/', protect, admin, updateSettings);

module.exports = router;
