const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  action: { type: String, required: true },
  category: {
    type: String,
    enum: ['ALLOWLIST', 'DEVICE', 'SUBNET', 'COLLECTOR', 'SETTING', 'EMERGENCY_STOP', 'SECURITY'],
    required: true,
  },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  targetId: { type: String, default: null },
  targetName: { type: String, default: null },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  ipAddress: { type: String, default: null },
  timestamp: { type: Date, default: Date.now },
}, { timestamps: true });

auditLogSchema.index({ category: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
