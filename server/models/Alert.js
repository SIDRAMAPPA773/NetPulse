const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  device: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', required: true },
  type: { type: String, required: true },
  severity: { type: String, enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'], required: true },
  message: { type: String, required: true },
  status: { type: String, enum: ['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED'], default: 'ACTIVE' },
  firstOccurredAt: { type: Date },
  lastOccurredAt: { type: Date },
  occurrenceCount: { type: Number, default: 1, min: 1 },
  acknowledgedAt: { type: Date },
  resolvedAt: { type: Date },
}, { timestamps: true });

alertSchema.index({ device: 1, type: 1, status: 1 });
alertSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Alert', alertSchema);
