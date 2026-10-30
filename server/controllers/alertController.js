const Alert = require('../models/Alert');
const mongoose = require('mongoose');

const getAlerts = async (req, res) => {
  try {
    const filter = {};
    if (req.query.device) {
      if (!mongoose.Types.ObjectId.isValid(req.query.device)) {
        return res.status(400).json({ message: 'Invalid device ID' });
      }
      filter.device = req.query.device;
    }
    if (req.query.status) {
      if (!['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED'].includes(req.query.status)) {
        return res.status(400).json({ message: 'Invalid alert status' });
      }
      filter.status = req.query.status;
    }
    const alerts = await Alert.find(filter)
      .populate('device', 'name ipAddress type location')
      .sort({ updatedAt: -1 })
      .limit(100);
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

const updateAlertStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED'].includes(status)) {
      return res.status(400).json({ message: 'Status must be ACTIVE, ACKNOWLEDGED, or RESOLVED' });
    }
    const alert = await Alert.findById(req.params.id);
    
    if (alert) {
      alert.status = status;
      if (status === 'ACKNOWLEDGED') alert.acknowledgedAt = new Date();
      if (status === 'RESOLVED') {
        alert.resolvedAt = new Date();
      }
      const updatedAlert = await alert.save();
      res.json(updatedAlert);
    } else {
      res.status(404).json({ message: 'Alert not found' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = { getAlerts, updateAlertStatus };
