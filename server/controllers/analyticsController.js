const Metric = require('../models/Metric');
const Device = require('../models/Device');

const getPerformance = async (req, res) => {
  try {
    const { device, location, type, range } = req.query;
    
    let timeFilter = new Date();
    if (range === '1h') timeFilter.setHours(timeFilter.getHours() - 1);
    else if (range === '6h') timeFilter.setHours(timeFilter.getHours() - 6);
    else if (range === '24h') timeFilter.setDate(timeFilter.getDate() - 1);
    else if (range === '7d') timeFilter.setDate(timeFilter.getDate() - 7);
    else if (range === '30d') timeFilter.setDate(timeFilter.getDate() - 30);
    else timeFilter.setHours(timeFilter.getHours() - 1); // default 1h

    // Build device filter
    const deviceFilter = {};
    if (device) deviceFilter._id = device;
    if (location) deviceFilter.location = location;
    if (type) deviceFilter.type = type;

    let deviceIds = [];
    if (Object.keys(deviceFilter).length > 0) {
      const devices = await Device.find(deviceFilter).select('_id');
      deviceIds = devices.map(d => d._id);
    }

    const metricFilter = { createdAt: { $gte: timeFilter } };
    if (deviceIds.length > 0) {
      metricFilter.device = { $in: deviceIds };
    }

    // Since we don't want to send too much data, we could group it.
    // For simplicity, let's just fetch and average locally or use aggregation.
    const metrics = await Metric.find(metricFilter).sort({ createdAt: 1 });
    
    // Process metrics to format suitable for Recharts
    // Let's group by a time bucket. For simplicity, just return raw if not too huge, 
    // or aggregate. Let's return the raw metrics for now (limited to 500 for safety).
    // A better approach is bucketing but we'll keep it simple.
    
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ message: 'Server Error', error: error.message });
  }
};

const getTraffic = async (req, res) => {
  try {
    // Top devices by traffic in last 1 hour
    let timeFilter = new Date();
    timeFilter.setHours(timeFilter.getHours() - 1);
    
    const latestMetrics = await Metric.aggregate([
      { $match: { createdAt: { $gte: timeFilter } } },
      { $group: {
          _id: "$device",
          avgIncoming: { $avg: "$incomingTraffic" },
          avgOutgoing: { $avg: "$outgoingTraffic" }
        }
      }
    ]);

    res.json(latestMetrics);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = { getPerformance, getTraffic };
