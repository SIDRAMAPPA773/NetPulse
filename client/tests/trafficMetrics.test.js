import test from 'node:test';
import assert from 'node:assert/strict';
import { mapTrafficRecords, summarizeTraffic } from '../src/services/trafficMetrics.js';

test('traffic records retain device, interface, source, and real RX/TX values', () => {
  const traffic = mapTrafficRecords([{
    _id: 'device-id',
    interfaceId: 'windows:Wi-Fi',
    measurementSource: 'real',
    source: 'windows-interface-counters',
    sourceProtocol: 'windows-netadapter',
    unit: 'bit/s',
    avgIncoming: 2_000_000,
    avgOutgoing: 1_000_000,
    sampleCount: 2,
  }], [{ _id: 'device-id', name: 'Laptop' }]);

  assert.equal(traffic[0].name, 'Laptop · windows:Wi-Fi (real · windows-netadapter)');
  assert.equal(traffic[0].Incoming, 2);
  assert.equal(traffic[0].Outgoing, 1);
  assert.equal(traffic[0].source, 'windows-interface-counters');
  assert.equal(summarizeTraffic(traffic).busiestInterface.total, 3);
});

test('empty throughput data has no busiest node or fabricated totals', () => {
  const summary = summarizeTraffic([]);
  assert.equal(summary.hasThroughputData, false);
  assert.equal(summary.meanIncoming, null);
  assert.equal(summary.meanOutgoing, null);
  assert.equal(summary.busiestInterface, null);
});

test('traffic data with unavailable direction keeps that value unavailable', () => {
  const traffic = mapTrafficRecords([{
    _id: 'device-id',
    measurementSource: 'real',
    avgIncoming: 1_000_000,
    avgOutgoing: null,
  }], []);

  assert.equal(traffic[0].Incoming, 1);
  assert.equal(traffic[0].Outgoing, null);
  assert.equal(summarizeTraffic(traffic).meanOutgoing, null);
});
