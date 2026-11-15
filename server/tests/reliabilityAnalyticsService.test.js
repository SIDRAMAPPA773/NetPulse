const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateReliability } = require('../services/reliabilityAnalyticsService');

test('calculateReliability calculates completed downtime and availability', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date('2026-01-01T01:00:00Z');
  const result = calculateReliability([
    { status: 'UP', at: '2026-01-01T00:00:00Z' },
    { status: 'DOWN', at: '2026-01-01T00:10:00Z' },
    { status: 'UP', at: '2026-01-01T00:20:00Z' },
  ], { start, end });

  assert.equal(result.outageCount, 1);
  assert.equal(result.completedOutageCount, 1);
  assert.equal(result.downtimeMs, 10 * 60 * 1000);
  assert.equal(result.availabilityPercent, 83.33);
  assert.equal(result.mttrMs, 10 * 60 * 1000);
});

test('calculateReliability does not invent MTBF without repeated failures', () => {
  const result = calculateReliability([
    { status: 'UP', at: '2026-01-01T00:00:00Z' },
    { status: 'DOWN', at: '2026-01-01T00:10:00Z' },
  ], {
    start: '2026-01-01T00:00:00Z',
    end: '2026-01-01T01:00:00Z',
  });
  assert.equal(result.mtbfMs, null);
});
