const express = require('express');
const { 
  getDevices, 
  getNetworkInterfaces,
  synchronizeNetworkInterfaces,
  getDeviceById, 
  createDevice, 
  updateDevice, 
  deleteDevice,
  discoverLocalDevices,
  cancelDiscovery,
  getDiscoveryJobs,
  enrollMultipleDevices,
  getPassiveInventory,
  refreshPassiveInventory,
} = require('../controllers/deviceController');
const { getDeviceMetrics } = require('../controllers/metricController');
const { testTelemetry } = require('../controllers/telemetryController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

router.route('/')
  .get(protect, getDevices)
  .post(protect, admin, createDevice);

// Passive IP Intelligence routes (placed before /:id)
router.get('/passive-intelligence', protect, getPassiveInventory);
router.post('/passive-intelligence/refresh', protect, admin, refreshPassiveInventory);

// Network Auto-Discovery routes (placed before /:id)
router.get('/network-interfaces', protect, admin, getNetworkInterfaces);
router.post('/network-interfaces/synchronize', protect, admin, synchronizeNetworkInterfaces);
router.get('/discovery/jobs', protect, admin, getDiscoveryJobs);
router.post('/discovery/jobs/:id/cancel', protect, admin, cancelDiscovery);
router.post('/:id/telemetry/test', protect, admin, testTelemetry);
router.post('/discover', protect, admin, discoverLocalDevices);
router.post('/enroll-multiple', protect, admin, enrollMultipleDevices);

router.route('/:id')
  .get(protect, getDeviceById)
  .put(protect, admin, updateDevice)
  .delete(protect, admin, deleteDevice);

router.get('/:id/metrics', protect, getDeviceMetrics);

module.exports = router;
