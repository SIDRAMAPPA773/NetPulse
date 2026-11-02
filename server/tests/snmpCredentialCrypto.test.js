const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decryptCredential,
  encryptCredential,
  isEncryptedCredential,
} = require('../utils/snmpCredentialCrypto');

const originalKey = process.env.SNMP_CREDENTIAL_ENCRYPTION_KEY;

test.after(() => {
  if (originalKey === undefined) delete process.env.SNMP_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.SNMP_CREDENTIAL_ENCRYPTION_KEY = originalKey;
});

test('SNMP credentials encrypt at rest and decrypt only with the configured key', () => {
  process.env.SNMP_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  const encrypted = encryptCredential('private-community');

  assert.ok(isEncryptedCredential(encrypted));
  assert.notEqual(encrypted, 'private-community');
  assert.equal(decryptCredential(encrypted), 'private-community');
  assert.equal(encryptCredential(encrypted), encrypted);
});

test('legacy plaintext credentials remain readable during staged migration', () => {
  assert.equal(decryptCredential('legacy-community'), 'legacy-community');
});

test('encryption rejects missing and invalid keys instead of storing plaintext', () => {
  delete process.env.SNMP_CREDENTIAL_ENCRYPTION_KEY;
  assert.throws(
    () => encryptCredential('private-community'),
    { code: 'SNMP_CREDENTIAL_ENCRYPTION_KEY_MISSING' },
  );

  process.env.SNMP_CREDENTIAL_ENCRYPTION_KEY = 'too-short';
  assert.throws(
    () => encryptCredential('private-community'),
    { code: 'SNMP_CREDENTIAL_ENCRYPTION_KEY_INVALID' },
  );
  assert.throws(
    () => encryptCredential({ secret: 'private-community' }),
    { code: 'SNMP_CREDENTIAL_INVALID' },
  );
});

test('ciphertext tampering fails authentication', () => {
  process.env.SNMP_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  const encrypted = encryptCredential('auth-key');
  const tampered = `${encrypted.slice(0, -2)}00`;

  assert.throws(() => decryptCredential(tampered));
});
