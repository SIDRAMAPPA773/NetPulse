const test = require('node:test');
const assert = require('node:assert/strict');
const createCorsOrigin = require('../config/cors');

const isAllowed = (originCallback, origin) => new Promise((resolve, reject) => {
  originCallback(origin, (error, allowed) => {
    if (error) {
      reject(error);
      return;
    }
    resolve(allowed);
  });
});

test('allows only the configured local frontend origins', async () => {
  const originCallback = createCorsOrigin(
    'http://localhost:5173,http://127.0.0.1:5173',
    'development',
  );

  assert.equal(await isAllowed(originCallback, 'http://localhost:5173'), true);
  assert.equal(await isAllowed(originCallback, 'http://127.0.0.1:5173'), true);
  assert.equal(await isAllowed(originCallback, 'http://localhost:5174'), false);
  assert.equal(await isAllowed(originCallback, 'https://localhost:5173'), false);
});

test('uses local defaults only for development when no origin is configured', async () => {
  const developmentOrigin = createCorsOrigin(undefined, 'development');
  const productionOrigin = createCorsOrigin(undefined, 'production');

  assert.equal(await isAllowed(developmentOrigin, 'http://127.0.0.1:5173'), true);
  assert.equal(await isAllowed(productionOrigin, 'http://127.0.0.1:5173'), false);
  assert.equal(await isAllowed(productionOrigin, undefined), true);
});

test('rejects malformed or non-origin configuration', () => {
  assert.throws(() => createCorsOrigin('not a URL', 'development'), /Invalid CLIENT_ORIGIN/);
  assert.throws(
    () => createCorsOrigin('http://localhost:5173/path', 'development'),
    /without paths/,
  );
});
