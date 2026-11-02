import test from 'node:test';
import assert from 'node:assert/strict';
import { createTopologyNodes } from '../src/services/networkMapTopology.js';

test('topology nodes include all devices without inventing links', () => {
  const nodes = createTopologyNodes([
    { _id: 'router', name: 'Router', ipAddress: '10.10.1.1', type: 'router', status: 'UP' },
    { _id: 'workstation', name: 'Workstation', ipAddress: '10.10.1.2', type: 'pc', status: 'UNKNOWN' },
  ]);

  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].id, 'router');
  assert.equal(nodes[1].id, 'workstation');
  assert.deepEqual(nodes.map((node) => node.data.id), ['router', 'workstation']);
});
