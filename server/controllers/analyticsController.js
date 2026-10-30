const Metric = require('../models/Metric');
const Device = require('../models/Device');
const mongoose = require('mongoose');

const getPerformance = async (req, res) => {
  try {
    const { device, location, type, range } = req.query;
    const allowedRanges = ['1h', '6h', '24h', '7d', '30d'];
    if (range && !allowedRanges.includes(range)) {
      return res.status(400).json({ message: 'Range must be one of 1h, 6h, 24h, 7d, or 30d' });
    }

    const rangeMilliseconds = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };
    const timeFilter = new Date(Date.now() - rangeMilliseconds[range || '1h']);

    // Build device filter
    const deviceFilter = {};
    if (device) {
      if (!mongoose.Types.ObjectId.isValid(device)) {
        return res.status(400).json({ message: 'Invalid device ID' });
      }
      deviceFilter._id = device;
    }
    if (type && !['router', 'switch', 'server', 'pc', 'other'].includes(type)) {
      return res.status(400).json({ message: 'Invalid device type' });
    }
    if (location) deviceFilter.location = location;
    if (type) deviceFilter.type = type;

    let deviceIds = [];
    const hasDeviceFilter = Object.keys(deviceFilter).length > 0;
    if (hasDeviceFilter) {
      const devices = await Device.find(deviceFilter).select('_id');
      deviceIds = devices.map(d => d._id);
      if (deviceIds.length === 0) return res.json([]);
    }

    const metricFilter = { createdAt: { $gte: timeFilter } };
    if (hasDeviceFilter) {
      metricFilter.device = { $in: deviceIds };
    }

    const metrics = await Metric.find(metricFilter).sort({ createdAt: -1 }).limit(500);
    res.json(metrics.reverse());
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

const getTraffic = async (req, res) => {
  try {
    // Top devices by traffic in last 1 hour
    const timeFilter = new Date(Date.now() - 60 * 60 * 1000);
    
    const latestMetrics = await Metric.aggregate([
      {
        $match: {
          createdAt: { $gte: timeFilter },
          metricSchemaVersion: 2,
          $or: [{ incomingThroughputBps: { $type: 'number' } }, { outgoingThroughputBps: { $type: 'number' } }],
        },
      },
      { $group: {
          _id: {
            device: '$device',
            interfaceId: '$interfaceId',
            measurementSource: '$measurementSource',
            source: '$source',
            sourceProtocol: '$sourceProtocol',
            unit: '$unit',
          },
          avgIncoming: { $avg: "$incomingThroughputBps" },
          avgOutgoing: { $avg: "$outgoingThroughputBps" },
          sampleCount: { $sum: 1 },
          latestCreatedAt: { $max: '$createdAt' },
        }
      },
      { $sort: { latestCreatedAt: -1 } },
      { $limit: 100 },
      {
        $project: {
          _id: '$_id.device',
          interfaceId: '$_id.interfaceId',
          measurementSource: '$_id.measurementSource',
          source: '$_id.source',
          sourceProtocol: '$_id.sourceProtocol',
          unit: '$_id.unit',
          avgIncoming: 1,
          avgOutgoing: 1,
          sampleCount: 1,
          latestCreatedAt: 1,
        },
      },
    ]);

    res.json(latestMetrics);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = { getPerformance, getTraffic };
