const express = require('express');
const {
  listSubnets,
  getSubnet,
  createSubnet,
  updateSubnet,
  approveSubnet,
  disableSubnet,
  deleteSubnet,
} = require('../controllers/subnetController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

router.route('/')
  .get(protect, listSubnets)
  .post(protect, admin, createSubnet);

router.route('/:id')
  .get(protect, getSubnet)
  .put(protect, admin, updateSubnet)
  .delete(protect, admin, deleteSubnet);

router.post('/:id/approve', protect, admin, approveSubnet);
router.post('/:id/disable', protect, admin, disableSubnet);

module.exports = router;
