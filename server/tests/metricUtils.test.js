const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeStats,
  computeJitter,
  computeAvailability,
  computeThroughputBps,
  computePPS,
  computeCounterDelta,
} = require('../utils/metricUtils');
const { getAll, getByCat } = require('../config/metricsRegistry');

test('registry defines complete metadata for at least 25 metrics', () => {
  const metrics = getAll();
  assert.ok(metrics.length >= 25);
  for (const metric of metrics) {
    for (const field of ['id', 'name', 'category', 'level', 'source', 'formula', 'unit', 'timestamp', 'collectionMethod', 'applicability', 'limitations']) {
      assert.ok(metric[field], `${metric.id} is missing ${field}`);
    }
  }
  assert.ok(getByCat('traffic').length >= 1);
});

test('statistics and jitter use finite samples and return unavailable without samples', () => {
  assert.deepEqual(computeStats([]), { avg: null, min: null, max: null, stddev: null, count: 0 });
  assert.deepEqual(computeStats([10, 20, Number.NaN]), {
    avg: 15,
    min: 10,
    max: 20,
    stddev: 5,
    count: 2,
  });
  assert.equal(computeJitter([10, null, 20, 35]), 12.5);
  assert.equal(computeJitter([10]), null);
});

test('availability and rates reject missing, reset, and invalid samples', () => {
  assert.equal(computeAvailability(3, 4), 75);
  assert.equal(computeAvailability(5, 4), null);
  assert.equal(computeThroughputBps(100, 2), 400);
  assert.equal(computeThroughputBps(100, 0), null);
  assert.equal(computePPS(8, 2), 4);
  assert.equal(computePPS(-1, 2), null);
});

test('counter deltas distinguish normal increments, rollovers, and resets', () => {
  assert.equal(computeCounterDelta(100, 150, 2), 50);
  assert.equal(computeCounterDelta(0xFFFFFFF0, 0x10, 2, 32), 32);
  assert.equal(computeCounterDelta(500, 10, 2, 32), null);
  assert.equal(computeCounterDelta(10, 20, 0), null);
});
