const mongoose = require('mongoose');

const discoveryJobSchema = new mongoose.Schema({
  cidr: { type: String, required: true },
  subnet: { type: mongoose.Schema.Types.ObjectId, ref: 'Subnet', default: null },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  trigger: { type: String, enum: ['manual', 'scheduled', 'legacy'], default: 'manual' },
  status: { type: String, enum: ['running', 'completed', 'cancelled', 'failed'], required: true },
  totalHosts: { type: Number, required: true },
  checkedHosts: { type: Number, default: 0 },
  respondingHosts: { type: Number, default: 0 },
  results: { type: [mongoose.Schema.Types.Mixed], default: [] },
  startedAt: { type: Date, default: Date.now },
  finishedAt: { type: Date },
  errorMessage: { type: String },
  enrolledCount: { type: Number, default: 0 },
  pendingApprovalCount: { type: Number, default: 0 },
  duplicateCount: { type: Number, default: 0 },
}, { timestamps: true });

discoveryJobSchema.index({ startedAt: -1 });
discoveryJobSchema.index({ status: 1, startedAt: -1 });
discoveryJobSchema.index({ subnet: 1, status: 1, startedAt: -1 });
discoveryJobSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('DiscoveryJob', discoveryJobSchema);
