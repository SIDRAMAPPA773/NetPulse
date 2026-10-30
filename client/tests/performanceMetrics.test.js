import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapPerformanceSamples,
  summarizePerformanceSamples,
} from '../src/services/performanceMetrics.js';

test('performance samples retain device identity and unavailable measurements', () => {
  const [sample] = mapPerformanceSamples(
    [{
      device: 'device-id',
      latency: null,
      packetLoss: null,
      collectionStatus: 'unsupported',
      createdAt: '2026-10-29T17:00:00.000Z',
    }],
    [{ _id: 'device-id', name: 'Gateway', ipAddress: '10.38.27.142' }],
  );

  assert.equal(sample.deviceId, 'device-id');
  assert.equal(sample.deviceName, 'Gateway');
  assert.equal(sample.ipAddress, '10.38.27.142');
  assert.equal(sample.latency, null);
  assert.equal(sample.packetLoss, null);
  assert.equal(sample.collectionStatus, 'unsupported');
});

test('performance summaries do not fabricate values when no measurement is available', () => {
  assert.deepEqual(summarizePerformanceSamples([
    { latency: null, packetLoss: null },
    { latency: undefined, packetLoss: undefined },
  ]), {
    averageLatency: null,
    minimumLatency: null,
    maximumLatency: null,
    averagePacketLoss: null,
  });
});
