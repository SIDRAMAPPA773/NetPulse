export const mapTrafficRecords = (records, devices) => {
  const devicesById = new Map(devices.map(device => [String(device._id), device]));

  return records.map(record => {
    const device = devicesById.get(String(record._id));
    const incoming = Number.isFinite(record.avgIncoming) ? record.avgIncoming / 1_000_000 : null;
    const outgoing = Number.isFinite(record.avgOutgoing) ? record.avgOutgoing / 1_000_000 : null;

    return {
      deviceId: String(record._id),
      interfaceId: record.interfaceId || 'configured interface',
      name: `${device?.name || 'Unknown device'} · ${record.interfaceId || 'interface'} (${record.measurementSource || 'unknown source'} · ${record.sourceProtocol || record.source || 'unknown collector'})`,
      Incoming: incoming,
      Outgoing: outgoing,
      total: incoming === null && outgoing === null ? null : (incoming || 0) + (outgoing || 0),
      measurementSource: record.measurementSource || 'unknown',
      source: record.source || 'unknown',
      sourceProtocol: record.sourceProtocol || 'unknown',
      unit: record.unit || 'bit/s',
      sampleCount: record.sampleCount || 0,
      latestCreatedAt: record.latestCreatedAt || null,
    };
  });
};

export const summarizeTraffic = traffic => {
  const inboundSamples = traffic.filter(row => row.Incoming !== null);
  const outboundSamples = traffic.filter(row => row.Outgoing !== null);
  const busiestInterface = traffic
    .filter(row => row.total !== null)
    .reduce((busiest, row) => !busiest || row.total > busiest.total ? row : busiest, null);

  return {
    meanIncoming: inboundSamples.length
      ? inboundSamples.reduce((total, row) => total + row.Incoming, 0) / inboundSamples.length
      : null,
    meanOutgoing: outboundSamples.length
      ? outboundSamples.reduce((total, row) => total + row.Outgoing, 0) / outboundSamples.length
      : null,
    busiestInterface,
    hasThroughputData: inboundSamples.length > 0 || outboundSamples.length > 0,
  };
};
