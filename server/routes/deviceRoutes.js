const express = require('express');
const { getDevices, getDeviceById, createDevice, updateDevice, deleteDevice } = require('../controllers/deviceController');
const { getDeviceMetrics } = require('../controllers/metricController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

router.route('/')
  .get(protect, getDevices)
  .post(protect, admin, createDevice);

router.route('/:id')
  .get(protect, getDeviceById)
  .put(protect, admin, updateDevice)
  .delete(protect, admin, deleteDevice);

router.get('/:id/metrics', protect, getDeviceMetrics);

module.exports = router;
