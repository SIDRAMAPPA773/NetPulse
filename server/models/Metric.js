const mongoose = require('mongoose');

const metricSchema = new mongoose.Schema({
  device: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', required: true },
  latency: { type: Number },
  packetLoss: { type: Number },
  status: { type: String, enum: ['UP', 'DOWN', 'WARNING'] },
  cpuUtilization: { type: Number },
  memoryUtilization: { type: Number },
  incomingTraffic: { type: Number },
  outgoingTraffic: { type: Number },
}, { timestamps: true });

// Add index on timestamps for fast querying of historical data
metricSchema.index({ device: 1, createdAt: -1 });

module.exports = mongoose.model('Metric', metricSchema);
