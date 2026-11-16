const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { validateTarget, probeHttp } = require('../utils/httpProbe');

test('validateTarget rejects credentials and non-http schemes', () => {
  assert.equal(validateTarget('ftp://127.0.0.1/file').valid, false);
  assert.equal(validateTarget('http://user:pass@127.0.0.1/').valid, false);
  assert.equal(validateTarget('http://127.0.0.1/').valid, true);
});

test('probeHttp records response metadata without reading the response body', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(204);
    res.end('ignored');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const result = await probeHttp(`http://127.0.0.1:${port}/health`, { method: 'HEAD', timeoutMs: 1000 });
  await new Promise((resolve) => server.close(resolve));

  assert.equal(result.status, 'RESPONDED');
  assert.equal(result.available, true);
  assert.equal(result.statusCode, 204);
  assert.equal(result.method, 'HEAD');
  assert.equal(typeof result.responseTimeMs, 'number');
});

test('probeHttp blocks redirects outside the approved host set', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(302, { location: 'http://example.invalid/private' });
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const result = await probeHttp(`http://127.0.0.1:${port}/redirect`, {
    timeoutMs: 1000,
    allowedHosts: ['127.0.0.1'],
  });
  await new Promise((resolve) => server.close(resolve));

  assert.equal(result.status, 'INVALID_REDIRECT');
  assert.equal(result.available, false);
});

test('probeHttp rejects an initial target outside the approved host set', async () => {
  const result = await probeHttp('http://example.invalid/health', {
    allowedHosts: ['127.0.0.1'],
  });
  assert.equal(result.status, 'UNAUTHORIZED_TARGET');
  assert.equal(result.responseTimeMs, null);
});
