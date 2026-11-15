const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTracerouteOutput } = require('../utils/tracerouteProbe');

test('parseTracerouteOutput keeps non-responsive hops distinct from destination reachability', () => {
  const hops = parseTracerouteOutput([
    '  1    10.0.0.1     1 ms',
    '  2    *        *        *',
    '  3    10.0.0.2     8 ms',
  ].join('\n'));

  assert.equal(hops.length, 3);
  assert.equal(hops[1].responding, false);
  assert.equal(hops[2].responding, true);
  assert.equal(hops[2].responseTimeMs, 8);
});
