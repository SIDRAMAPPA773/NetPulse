const AuditLog = require('../models/AuditLog');

function redactSensitiveData(data) {
  if (!data || typeof data !== 'object') return data;
  const redacted = Array.isArray(data) ? [...data] : { ...data };
  for (const [key, value] of Object.entries(redacted)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('password') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('key') ||
      lowerKey.includes('community') ||
      lowerKey.includes('token')
    ) {
      redacted[key] = '[REDACTED]';
    } else if (value && typeof value === 'object') {
      redacted[key] = redactSensitiveData(value);
    }
  }
  return redacted;
}

async function recordAuditEvent({
  action,
  category = 'SETTING',
  userId = null,
  targetId = null,
  targetName = null,
  details = {},
  ipAddress = null,
}) {
  try {
    const sanitizedDetails = redactSensitiveData(details);
    return await AuditLog.create({
      action,
      category,
      performedBy: userId,
      targetId: targetId ? String(targetId) : null,
      targetName,
      details: sanitizedDetails,
      ipAddress,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Failed to write audit log:', error.message);
    return null;
  }
}

module.exports = {
  redactSensitiveData,
  recordAuditEvent,
};
