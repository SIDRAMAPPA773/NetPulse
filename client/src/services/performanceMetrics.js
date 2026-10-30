export const getDeviceId = (device) => {
  if (device && typeof device === 'object') {
    return String(device._id || device.id || '');
  }
  return String(device || '');
};

export const mapPerformanceSamples = (samples, devices) => {
  const devicesById = new Map(devices.map(device => [String(device._id), device]));

  return samples.map(sample => {
    const device = devicesById.get(getDeviceId(sample.device));
    return {
      ...sample,
      deviceId: getDeviceId(sample.device),
      deviceName: device?.name || 'Unknown device',
      ipAddress: device?.ipAddress || 'Unknown IP',
      latency: Number.isFinite(sample.latency) ? sample.latency : null,
      packetLoss: Number.isFinite(sample.packetLoss) ? sample.packetLoss : null,
    };
  });
};

export const summarizePerformanceSamples = (samples) => {
  const latencies = samples
    .map(sample => sample.latency)
    .filter(value => Number.isFinite(value));
  const packetLoss = samples
    .map(sample => sample.packetLoss)
    .filter(value => Number.isFinite(value));

  return {
    averageLatency: latencies.length
      ? Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length)
      : null,
    minimumLatency: latencies.length ? Math.min(...latencies) : null,
    maximumLatency: latencies.length ? Math.max(...latencies) : null,
    averagePacketLoss: packetLoss.length
      ? (packetLoss.reduce((total, value) => total + value, 0) / packetLoss.length).toFixed(1)
      : null,
  };
};
