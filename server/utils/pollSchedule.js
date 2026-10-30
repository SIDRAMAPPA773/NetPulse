const MIN_POLL_INTERVAL_SECONDS = 10;

function isDeviceDueForPolling(device, now, previousPollAt) {
  if (!device.monitoringStatus) return false;
  const intervalMs = Math.max(
    MIN_POLL_INTERVAL_SECONDS,
    Number(device.pollingInterval) || MIN_POLL_INTERVAL_SECONDS,
  ) * 1000;
  return now - previousPollAt >= intervalMs;
}

module.exports = { isDeviceDueForPolling };
