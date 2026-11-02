const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCollectorReport } = require('../utils/collectorReport');

const subnet = { cidr: '192.168.44.0/29' };
const now = Date.parse('2026-11-02T12:00:00.000Z');

function observation(ipAddress, overrides = {}) {
  return {
    ipAddress,
    reachable: true,
    latencyMs: 12.5,
    packetLoss: 0,
    observedAt: new Date(now).toISOString(),
    ...overrides,
  };
}

test('collector reports accept only bounded observations inside the assigned subnet', () => {
  const result = validateCollectorReport({
    observations: [observation('192.168.44.1'), observation('192.168.44.6')],
  }, subnet, now);

  assert.equal(result.error, undefined);
  assert.equal(result.observations.length, 2);
  assert.ok(result.observations[0].observedAt instanceof Date);
});

test('collector reports reject duplicate and out-of-scope IP addresses', () => {
  assert.match(validateCollectorReport({
    observations: [observation('192.168.44.1'), observation('192.168.44.1')],
  }, subnet, now).error, /duplicate/);
  assert.match(validateCollectorReport({
    observations: [observation('192.168.45.1')],
  }, subnet, now).error, /out-of-scope/);
});

test('collector reports reject invalid values, unknown fields, and stale timestamps', () => {
  assert.match(validateCollectorReport({
    observations: [observation('192.168.44.1', { packetLoss: 101 })],
  }, subnet, now).error, /invalid telemetry/);
  assert.match(validateCollectorReport({
    observations: [observation('192.168.44.1', { status: 'UP' })],
  }, subnet, now).error, /out-of-scope/);
  assert.match(validateCollectorReport({
    observations: [observation('192.168.44.1', {
      observedAt: new Date(now - 6 * 60 * 1000).toISOString(),
    })],
  }, subnet, now).error, /stale observation/);
  assert.match(validateCollectorReport({
    observations: [observation('192.168.44.1', { reachable: false, latencyMs: 2 })],
  }, subnet, now).error, /cannot include a latency/);
  const unreachable = validateCollectorReport({
    observations: [observation('192.168.44.1', { reachable: false, latencyMs: null, packetLoss: 0 })],
  }, subnet, now);
  assert.equal(unreachable.observations[0].packetLoss, 100);
});

test('collector reports reject oversized payloads and unsafe subnet scopes', () => {
  assert.match(validateCollectorReport({
    observations: [observation('192.168.44.1')],
    extra: 'unexpected',
  }, subnet, now).error, /only an observations array/);
  assert.match(validateCollectorReport({
    observations: [observation('10.0.0.1')],
  }, { cidr: '10.0.0.0/16' }, now).error, /permitted private subnet scope/);
  assert.match(validateCollectorReport({
    observations: [observation('192.168.44.1', { ipAddress: 'x'.repeat(70000) })],
  }, subnet, now).error, /64 KB/);
});
