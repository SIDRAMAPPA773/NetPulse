const Alert = require('../models/Alert');

const getAlerts = async (req, res) => {
  try {
    const alerts = await Alert.find({})
                              .populate('device', 'name ipAddress type location')
                              .sort({ createdAt: -1 })
                              .limit(100);
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

const updateAlertStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const alert = await Alert.findById(req.params.id);
    
    if (alert) {
      alert.status = status;
      if (status === 'RESOLVED') {
        alert.resolvedAt = Date.now();
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
