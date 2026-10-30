const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateInterfaceRates } = require('../utils/windowsInterfaceCounters');

test('interface throughput uses byte-counter deltas and elapsed seconds', () => {
  const rates = calculateInterfaceRates(
    { observedAt: 1000, receivedBytes: '1000000', sentBytes: '2000000' },
    { observedAt: 11000, receivedBytes: '1125000', sentBytes: '2250000' },
  );

  assert.equal(rates.incomingThroughputBps, 100000);
  assert.equal(rates.outgoingThroughputBps, 200000);
  assert.equal(rates.elapsedSeconds, 10);
  assert.equal(rates.inboundReason, null);
  assert.equal(rates.outboundReason, null);
});

test('interface throughput rejects missing counters and invalid elapsed intervals', () => {
  const rates = calculateInterfaceRates(
    { observedAt: 1000, receivedBytes: null, sentBytes: '1000' },
    { observedAt: 1000, receivedBytes: '2000', sentBytes: '2000' },
  );

  assert.equal(rates.incomingThroughputBps, null);
  assert.equal(rates.outgoingThroughputBps, null);
  assert.equal(rates.elapsedSeconds, null);
  assert.match(rates.inboundReason, /interval/i);
});

test('counter reset makes that direction unavailable while retaining valid opposite direction', () => {
  const rates = calculateInterfaceRates(
    { observedAt: 1000, receivedBytes: '5000', sentBytes: '1000' },
    { observedAt: 3000, receivedBytes: '100', sentBytes: '1500' },
  );

  assert.equal(rates.incomingThroughputBps, null);
  assert.match(rates.inboundReason, /reset/i);
  assert.equal(rates.outgoingThroughputBps, 2000);
  assert.equal(rates.outboundReason, null);
});
