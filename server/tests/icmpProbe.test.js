const test = require('node:test');
const assert = require('node:assert/strict');
const ping = require('ping');
const { probeIcmp, computeJitter } = require('../utils/icmpProbe');

test('ICMP aggregation reports bounded measured samples and loss', async () => {
  const originalProbe = ping.promise.probe;
  const replies = [
    { alive: true, time: '10.5' },
    { alive: false, time: 'unknown' },
    { alive: true, time: '20.5' },
  ];
  ping.promise.probe = async () => replies.shift();
  try {
    const result = await probeIcmp('192.0.2.1', { count: 3, timeout: 1 });
    assert.equal(result.reachable, true);
    assert.equal(result.probeCount, 3);
    assert.equal(result.packetLoss, 33.3);
    assert.equal(result.rttAvg, 15.5);
    assert.equal(result.rttMin, 10.5);
    assert.equal(result.rttMax, 20.5);
    assert.equal(result.availability, 66.7);
    assert.deepEqual(computeJitter(result.probes), { jitterAvg: 10, jitterMax: 10 });
  } finally {
    ping.promise.probe = originalProbe;
  }
});

test('ICMP probing stops before starting additional probes when cancelled', async () => {
  const originalProbe = ping.promise.probe;
  let probeCalls = 0;
  ping.promise.probe = async () => {
    probeCalls += 1;
    return { alive: true, time: '1' };
  };
  const controller = new AbortController();
  try {
    const result = await probeIcmp('192.0.2.2', {
      count: 5,
      signal: controller.signal,
      beforeProbe: async () => {
        controller.abort();
        return false;
      },
    });
    assert.equal(probeCalls, 0);
    assert.equal(result.cancelled, true);
    assert.equal(result.probeCount, 0);
    assert.equal(result.packetLoss, null);
    assert.equal(result.availability, null);
  } finally {
    ping.promise.probe = originalProbe;
  }
});
