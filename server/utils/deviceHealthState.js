const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_RECOVERY_THRESHOLD = 2;

function boundedThreshold(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(10, Math.max(1, parsed)) : fallback;
}

function transitionDeviceHealth(device, {
  reachable,
  degraded = false,
  collectionError = false,
} = {}, {
  failureThreshold = DEFAULT_FAILURE_THRESHOLD,
  recoveryThreshold = DEFAULT_RECOVERY_THRESHOLD,
} = {}) {
  const failures = boundedThreshold(failureThreshold, DEFAULT_FAILURE_THRESHOLD);
  const recoveries = boundedThreshold(recoveryThreshold, DEFAULT_RECOVERY_THRESHOLD);
  const previousStatus = device.status || 'UNKNOWN';

  if (collectionError) {
    device.consecutiveFailureCount = 0;
    device.consecutiveRecoveryCount = 0;
    return previousStatus;
  }

  if (typeof reachable !== 'boolean') {
    device.consecutiveFailureCount = 0;
    device.consecutiveRecoveryCount = 0;
    return previousStatus;
  }

  if (!reachable) {
    device.consecutiveFailureCount = Math.max(0, Number(device.consecutiveFailureCount) || 0) + 1;
    device.consecutiveRecoveryCount = 0;
    if (previousStatus === 'DOWN' || previousStatus === 'UNREACHABLE') return previousStatus;
    return device.consecutiveFailureCount >= failures ? 'DOWN' : previousStatus;
  }

  device.consecutiveFailureCount = 0;
  const recoveredStatus = degraded ? 'WARNING' : 'UP';
  if (previousStatus === 'DOWN' || previousStatus === 'UNREACHABLE') {
    device.consecutiveRecoveryCount = Math.max(0, Number(device.consecutiveRecoveryCount) || 0) + 1;
    if (device.consecutiveRecoveryCount < recoveries) return previousStatus;
  } else {
    device.consecutiveRecoveryCount = 0;
  }

  device.consecutiveRecoveryCount = 0;
  return recoveredStatus;
}

module.exports = {
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_RECOVERY_THRESHOLD,
  transitionDeviceHealth,
};
