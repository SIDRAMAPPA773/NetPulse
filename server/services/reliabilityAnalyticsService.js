'use strict';

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function calculateReliability(events = [], options = {}) {
  const start = asDate(options.start) || new Date(Date.now() - 24 * 60 * 60 * 1000);
  const end = asDate(options.end) || new Date();
  const ordered = events
    .map((event) => ({ ...event, at: asDate(event.at || event.createdAt) }))
    .filter((event) => event.at && event.at >= start && event.at <= end)
    .sort((a, b) => a.at - b.at);
  if (ordered.length < 2) {
    return {
      sampleCount: ordered.length,
      outageCount: 0,
      completedOutageCount: 0,
      downtimeMs: null,
      uptimeMs: null,
      availabilityPercent: null,
      mttrMs: null,
      mtbfMs: null,
      failureFrequency: null,
      outages: [],
      insufficientData: true,
      lastKnownStatus: ordered[0]?.status || null,
    };
  }

  let previous = null;
  let outageStartedAt = null;
  const outages = [];
  for (const event of ordered) {
    const status = event.status;
    if (status === 'DOWN' && !outageStartedAt) outageStartedAt = event.at;
    if (status === 'UP' && outageStartedAt) {
      outages.push({ startedAt: outageStartedAt, recoveredAt: event.at });
      outageStartedAt = null;
    }
    if (status === 'UP' || status === 'DOWN') previous = status;
  }
  if (outageStartedAt) outages.push({ startedAt: outageStartedAt, recoveredAt: null });

  const windowMs = Math.max(0, end - start);
  const completed = outages.filter((outage) => outage.recoveredAt);
  const downtimeMs = outages.reduce((total, outage) => (
    total + Math.max(0, (outage.recoveredAt || end) - outage.startedAt)
  ), 0);
  const uptimeMs = Math.max(0, windowMs - downtimeMs);
  const mttrMs = completed.length
    ? completed.reduce((total, outage) => total + (outage.recoveredAt - outage.startedAt), 0) / completed.length
    : null;
  const failureIntervals = [];
  for (let i = 1; i < outages.length; i++) {
    failureIntervals.push(outages[i].startedAt - (outages[i - 1].recoveredAt || end));
  }

  return {
    sampleCount: ordered.length,
    outageCount: outages.length,
    completedOutageCount: completed.length,
    downtimeMs,
    uptimeMs,
    availabilityPercent: windowMs > 0 ? Math.round((uptimeMs / windowMs) * 10000) / 100 : null,
    mttrMs: completed.length ? Math.round(mttrMs) : null,
    mtbfMs: failureIntervals.length
      ? Math.round(failureIntervals.reduce((sum, value) => sum + value, 0) / failureIntervals.length)
      : null,
    failureFrequency: outages.length,
    outages,
    insufficientData: ordered.length < 2,
    lastKnownStatus: previous,
  };
}

module.exports = { calculateReliability };
