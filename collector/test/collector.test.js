'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_REPORT_QUEUE,
  SiteCollector,
  loadConfig,
  parseCidr,
  parsePingLatency,
} = require('../index');

function validEnv(overrides = {}) {
  return {
    NETPULSE_BACKEND_URL: 'https://netpulse.example/base/',
    NETPULSE_TOKEN: 'test-token.123',
    NETPULSE_SUBNET_CIDR: '192.168.20.0/30',
    ...overrides,
  };
}

test('requires a trusted HTTPS backend and strict private bounded CIDR', () => {
  assert.throws(() => loadConfig({}), /NETPULSE_BACKEND_URL is required/);
  assert.throws(() => loadConfig(validEnv({ NETPULSE_BACKEND_URL: 'http://netpulse.example' })), /HTTPS/);
  assert.throws(() => loadConfig(validEnv({ NETPULSE_BACKEND_URL: 'https://user:pass@netpulse.example' })), /HTTPS/);
  assert.throws(() => loadConfig(validEnv({ NETPULSE_BACKEND_URL: 'https://netpulse.example/?q=1' })), /query/);
  assert.throws(() => loadConfig(validEnv({ NETPULSE_BACKEND_URL: 'https://netpulse.example/#secret' })), /query/);
  assert.throws(() => loadConfig(validEnv({ NETPULSE_TOKEN: 'token with spaces' })), /bearer token/);
  assert.throws(() => loadConfig(validEnv({ NETPULSE_SUBNET_CIDR: '192.168.20.1/30' })), /canonical/);
  assert.throws(() => loadConfig(validEnv({ NETPULSE_SUBNET_CIDR: '192.168.0.0/23' })), /1 to 256/);
  assert.throws(() => loadConfig(validEnv({ NETPULSE_SUBNET_CIDR: '192.168.0.0/22' })), /1 to 256/);
  assert.throws(() => loadConfig(validEnv({ NETPULSE_SUBNET_CIDR: '192.168.20.0/30x' })), /strict IPv4 CIDR/);
  assert.throws(() => loadConfig(validEnv({ NETPULSE_SUBNET_CIDR: '172.32.0.0/24' })), /RFC1918/);
  assert.throws(() => loadConfig(validEnv({ NETPULSE_INTERVAL_SECONDS: '10' })), /at least 15/);
});

test('normalizes endpoints and expands only usable subnet targets', () => {
  const config = loadConfig(validEnv());
  assert.equal(config.heartbeatUrl, 'https://netpulse.example/base/api/collectors/ingest/heartbeat');
  assert.equal(config.reportUrl, 'https://netpulse.example/base/api/collectors/ingest/report');
  assert.equal(config.intervalMs, 60_000);
  assert.deepEqual(config.subnet.targets, ['192.168.20.1', '192.168.20.2']);
  assert.equal(parseCidr('10.0.0.0/24').targets.length, 254);
  assert.deepEqual(parseCidr('10.0.0.0/31').targets, ['10.0.0.0', '10.0.0.1']);
  assert.deepEqual(parseCidr('10.0.0.1/32').targets, ['10.0.0.1']);
});

test('parses only finite plausible RTT values', () => {
  assert.equal(parsePingLatency('64 bytes from host: icmp_seq=1 ttl=64 time=1.25 ms'), 1.25);
  assert.equal(parsePingLatency('64 bytes from host: time<1 ms'), 0.5);
  assert.equal(parsePingLatency('time=Infinity ms'), null);
  assert.equal(parsePingLatency('time=60001 ms'), null);
  assert.equal(parsePingLatency('no RTT present'), null);
});

test('sends bounded observations and heartbeat through injected ping and HTTP', async () => {
  const config = loadConfig(validEnv({ NETPULSE_SCAN_RATE: '50' }));
  const calls = [];
  const collector = new SiteCollector({
    config,
    ping: async (ip) => ({ reachable: ip.endsWith('.1'), latencyMs: ip.endsWith('.1') ? 4.5 : null }),
    http: async (url, payload, token, options) => {
      calls.push({ url, payload, token, options });
    },
    sleep: async () => {},
    now: () => new Date('2026-11-02T10:00:00.000Z'),
  });

  await collector.runCycle();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, config.heartbeatUrl);
  assert.deepEqual(calls[0].payload, {
    agentVersion: '1.0.0',
    subnetCidr: '192.168.20.0/30',
    activeTargets: 1,
  });
  assert.equal(calls[0].token, 'test-token.123');
  assert.equal(calls[0].options.timeoutMs, 10_000);
  assert.equal(calls[1].url, config.reportUrl);
  assert.deepEqual(calls[1].payload.observations, [
    {
      ipAddress: '192.168.20.1',
      reachable: true,
      latencyMs: 4.5,
      packetLoss: 0,
      observedAt: '2026-11-02T10:00:00.000Z',
    },
    {
      ipAddress: '192.168.20.2',
      reachable: false,
      latencyMs: null,
      packetLoss: 100,
      observedAt: '2026-11-02T10:00:00.000Z',
    },
  ]);
  assert.equal(collector.reportQueue.length, 0);
});

test('retries with bounded exponential delay and retains a bounded report queue', async () => {
  const config = loadConfig(validEnv({ NETPULSE_SCAN_RATE: '50' }));
  const delays = [];
  const warnings = [];
  let failReports = true;
  const collector = new SiteCollector({
    config,
    ping: async () => ({ reachable: false, latencyMs: null }),
    http: async (url) => {
      if (url === config.reportUrl && failReports) {
        throw new Error('simulated outage');
      }
    },
    sleep: async (milliseconds) => delays.push(milliseconds),
    logger: { warn: (message) => warnings.push(message) },
  });

  for (let cycle = 0; cycle < 4; cycle += 1) {
    await collector.runCycle();
  }
  assert.equal(collector.reportQueue.length, MAX_REPORT_QUEUE);
  assert.equal(warnings.filter((message) => message.includes('dropping oldest')).length, 1);
  assert.ok(delays.includes(250));
  assert.ok(delays.includes(500));

  failReports = false;
  await collector.runCycle();
  assert.ok(collector.reportQueue.length < MAX_REPORT_QUEUE);
});
