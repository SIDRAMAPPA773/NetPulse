const express = require('express');
const { 
  getDevices, 
  getDeviceById, 
  createDevice, 
  updateDevice, 
  deleteDevice,
  discoverLocalDevices,
  enrollMultipleDevices
} = require('../controllers/deviceController');
const { getDeviceMetrics } = require('../controllers/metricController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

router.route('/')
  .get(protect, getDevices)
  .post(protect, admin, createDevice);

// Network Auto-Discovery routes (placed before /:id)
router.get('/discover', protect, discoverLocalDevices);
router.post('/enroll-multiple', protect, admin, enrollMultipleDevices);

router.route('/:id')
  .get(protect, getDeviceById)
  .put(protect, admin, updateDevice)
  .delete(protect, admin, deleteDevice);

router.get('/:id/metrics', protect, getDeviceMetrics);

module.exports = router;
