const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  device: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', required: true },
  type: { type: String, required: true },
  severity: { type: String, enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'], required: true },
  message: { type: String, required: true },
  status: { type: String, enum: ['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED'], default: 'ACTIVE' },
  resolvedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('Alert', alertSchema);
