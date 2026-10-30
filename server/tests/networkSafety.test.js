const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getApprovedDiscoveryHosts,
  isTargetAllowed,
  parseAllowlist,
  createCooldownGuard,
} = require('../utils/networkSafety');
const { Semaphore, createRateLimiter } = require('../utils/safety');

test('discovery requires an exact administrator-approved bounded CIDR', () => {
  assert.equal(getApprovedDiscoveryHosts('192.168.10.0/24', []).error, 'NOT_ALLOWLISTED');
  assert.equal(getApprovedDiscoveryHosts('192.168.10.0/24', ['192.168.10.0/24']).hosts.length, 254);
  assert.equal(getApprovedDiscoveryHosts('192.168.10.0/24', ['192.168.0.0/16']).error, 'NOT_ALLOWLISTED');
  assert.equal(getApprovedDiscoveryHosts('10.0.0.0/8', ['10.0.0.0/8']).error, 'EXCEEDS_MAX');
  assert.equal(getApprovedDiscoveryHosts('192.168.10.1/24', ['192.168.10.0/24']).error, 'INVALID_CIDR');
});

test('monitoring target authorization supports explicit addresses and approved subnets', () => {
  const testDeviceAllowlist = parseAllowlist('10.38.27.142,10.38.27.191');
  assert.deepEqual(testDeviceAllowlist, ['10.38.27.142', '10.38.27.191']);
  assert.equal(isTargetAllowed('10.38.27.142', testDeviceAllowlist), true);
  assert.equal(isTargetAllowed('10.38.27.191', testDeviceAllowlist), true);
  assert.equal(isTargetAllowed('10.38.27.143', testDeviceAllowlist), false);
  assert.equal(isTargetAllowed('192.168.10.4', ['192.168.10.0/24']), true);
  assert.equal(isTargetAllowed('192.168.11.4', ['192.168.10.0/24']), false);
  assert.equal(isTargetAllowed('192.168.11.4', ['192.168.11.4']), true);
  assert.equal(isTargetAllowed('999.1.1.1', ['0.0.0.0/0']), false);
});

test('discovery guard prevents overlap and enforces a cooldown', () => {
  const guard = createCooldownGuard(1000);
  assert.deepEqual(guard.begin('192.168.10.0/24', 1000), { allowed: true });
  assert.deepEqual(guard.begin('192.168.10.0/24', 1500), { allowed: false, reason: 'already_running' });
  guard.end();
  assert.deepEqual(guard.begin('192.168.10.0/24', 1500), { allowed: false, reason: 'cooldown' });
  assert.deepEqual(guard.begin('192.168.10.0/24', 2000), { allowed: true });
});

test('semaphore enforces bounded concurrent work', async () => {
  const semaphore = new Semaphore(2);
  let running = 0;
  let maximumRunning = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    const release = await semaphore.acquire();
    running += 1;
    maximumRunning = Math.max(maximumRunning, running);
    await new Promise(resolve => setTimeout(resolve, 5));
    running -= 1;
    release();
  }));
  assert.equal(maximumRunning, 2);
});

test('global rate limiter spaces probe starts', async () => {
  const rateLimiter = createRateLimiter({ maxPerSecond: 20 });
  const starts = [];
  await Promise.all(Array.from({ length: 3 }, async () => {
    await rateLimiter.acquire();
    starts.push(Date.now());
  }));
  starts.sort((left, right) => left - right);
  assert.ok(starts[1] - starts[0] >= 40);
  assert.ok(starts[2] - starts[1] >= 40);
});
