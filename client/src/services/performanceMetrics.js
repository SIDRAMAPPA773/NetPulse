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
      p95Rtt: Number.isFinite(sample.p95Rtt) ? sample.p95Rtt : null,
      p99Rtt: Number.isFinite(sample.p99Rtt) ? sample.p99Rtt : null,
      jitter: Number.isFinite(sample.jitter) ? sample.jitter : null,
      availability: Number.isFinite(sample.availability) ? sample.availability : null,
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
  const p95 = samples.map(sample => sample.p95Rtt).filter(value => Number.isFinite(value));
  const p99 = samples.map(sample => sample.p99Rtt).filter(value => Number.isFinite(value));
  const jitter = samples.map(sample => sample.jitter).filter(value => Number.isFinite(value));
  const availability = samples.map(sample => sample.availability).filter(value => Number.isFinite(value));

  return {
    averageLatency: latencies.length
      ? Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length)
      : null,
    minimumLatency: latencies.length ? Math.min(...latencies) : null,
    maximumLatency: latencies.length ? Math.max(...latencies) : null,
    averagePacketLoss: packetLoss.length
      ? (packetLoss.reduce((total, value) => total + value, 0) / packetLoss.length).toFixed(1)
      : null,
    p95Latency: p95.length ? Math.round(p95.reduce((total, value) => total + value, 0) / p95.length) : null,
    p99Latency: p99.length ? Math.round(p99.reduce((total, value) => total + value, 0) / p99.length) : null,
    averageJitter: jitter.length ? Math.round(jitter.reduce((total, value) => total + value, 0) / jitter.length * 10) / 10 : null,
    averageAvailability: availability.length ? Math.round(availability.reduce((total, value) => total + value, 0) / availability.length * 10) / 10 : null,
  };
};
