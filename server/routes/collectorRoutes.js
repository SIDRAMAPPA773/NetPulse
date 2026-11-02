const express = require('express');
const {
  collectorHeartbeat,
  collectorReport,
  createCollector,
  listCollectors,
  revokeCollector,
} = require('../controllers/collectorController');
const { protect, admin } = require('../middleware/auth');
const { authenticateCollector } = require('../utils/collectorToken');

const router = express.Router();

router.get('/', protect, admin, listCollectors);
router.post('/', protect, admin, createCollector);
router.post('/:id/revoke', protect, admin, revokeCollector);
router.post('/ingest/heartbeat', authenticateCollector, collectorHeartbeat);
router.post('/ingest/report', authenticateCollector, collectorReport);

module.exports = router;
