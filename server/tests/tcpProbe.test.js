const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { probePort, probeServices, getServiceName } = require('../utils/tcpProbe');

class MockSocket extends EventEmitter {
  constructor(behavior = 'connect', delayMs = 5) {
    super();
    this.behavior = behavior;
    this.delayMs = delayMs;
  }

  setTimeout() {}
  destroy() {}

  connect(port, ip) {
    setTimeout(() => {
      if (this.behavior === 'connect') {
        this.emit('connect');
      } else if (this.behavior === 'refuse') {
        const err = new Error('Connection refused');
        err.code = 'ECONNREFUSED';
        this.emit('error', err);
      } else if (this.behavior === 'timeout') {
        this.emit('timeout');
      } else if (this.behavior === 'error') {
        this.emit('error', new Error('Network unreachable'));
      }
    }, this.delayMs);
  }
}

test('getServiceName maps standard ports and handles custom ports', () => {
  assert.equal(getServiceName(22), 'SSH');
  assert.equal(getServiceName(80), 'HTTP');
  assert.equal(getServiceName(443), 'HTTPS');
  assert.equal(getServiceName(53), 'DNS-TCP');
  assert.equal(getServiceName(3389), 'RDP');
  assert.equal(getServiceName(9999), 'TCP/9999');
});

test('probePort successfully identifies an open TCP port', async () => {
  const result = await probePort('127.0.0.1', 80, 1000, () => new MockSocket('connect'));
  assert.equal(result.open, true);
  assert.equal(result.status, 'OPEN');
  assert.equal(result.port, 80);
  assert.equal(result.service, 'HTTP');
  assert.ok(typeof result.responseTimeMs === 'number' && result.responseTimeMs >= 0);
});

test('probePort reports CLOSED for a refused port', async () => {
  const result = await probePort('127.0.0.1', 9999, 1000, () => new MockSocket('refuse'));
  assert.equal(result.open, false);
  assert.equal(result.status, 'CLOSED');
  assert.equal(result.responseTimeMs, null);
});

test('probePort reports TIMEOUT when port times out', async () => {
  const result = await probePort('127.0.0.1', 80, 1000, () => new MockSocket('timeout'));
  assert.equal(result.open, false);
  assert.equal(result.status, 'TIMEOUT');
});

test('probeServices tests multiple ports and bounds port count', async () => {
  const socketFactory = () => new MockSocket('connect');
  const res = await probeServices('127.0.0.1', [80, 443], { socketFactory });
  assert.equal(res.reachable, true);
  assert.deepEqual(res.openPorts, [80, 443]);
  assert.equal(res.testedPorts, 2);
});
