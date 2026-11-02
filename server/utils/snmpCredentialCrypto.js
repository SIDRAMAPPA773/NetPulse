const crypto = require('node:crypto');

const PREFIX = 'enc:v1:';
const KEY_ENVIRONMENT_VARIABLE = 'SNMP_CREDENTIAL_ENCRYPTION_KEY';

function getEncryptionKey() {
  const encoded = process.env[KEY_ENVIRONMENT_VARIABLE];
  if (!encoded) {
    const error = new Error(`${KEY_ENVIRONMENT_VARIABLE} must be configured before storing encrypted SNMP credentials`);
    error.code = 'SNMP_CREDENTIAL_ENCRYPTION_KEY_MISSING';
    throw error;
  }

  const key = Buffer.from(encoded, 'base64');
  const canonical = key.toString('base64');
  if (key.length !== 32 || (encoded !== canonical && encoded !== canonical.replace(/=$/, ''))) {
    const error = new Error(`${KEY_ENVIRONMENT_VARIABLE} must be a base64-encoded 32-byte key`);
    error.code = 'SNMP_CREDENTIAL_ENCRYPTION_KEY_INVALID';
    throw error;
  }
  return key;
}

function isEncryptedCredential(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encryptCredential(value) {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') {
    const error = new Error('SNMP credentials must be strings');
    error.code = 'SNMP_CREDENTIAL_INVALID';
    throw error;
  }
  if (value.length === 0) return value;
  if (isEncryptedCredential(value)) {
    try {
      decryptCredential(value);
    } catch (error) {
      if (error.code === 'SNMP_CREDENTIAL_ENCRYPTION_KEY_MISSING'
        || error.code === 'SNMP_CREDENTIAL_ENCRYPTION_KEY_INVALID') {
        throw error;
      }
      const invalid = new Error('SNMP credential ciphertext is invalid');
      invalid.code = 'SNMP_CREDENTIAL_INVALID';
      throw invalid;
    }
    return value;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ciphertext.toString('hex')}`;
}

function decryptCredential(value) {
  if (typeof value !== 'string' || !value.startsWith('enc:')) return value;
  const match = /^enc:v1:([a-f\d]{24}):([a-f\d]{32}):([a-f\d]*)$/i.exec(value);
  if (!match) {
    const error = new Error('Stored SNMP credential has an unsupported or malformed encryption format');
    error.code = 'SNMP_CREDENTIAL_CIPHERTEXT_INVALID';
    throw error;
  }

  const [, ivHex, tagHex, ciphertextHex] = match;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    const error = new Error('Stored SNMP credential authentication failed');
    error.code = 'SNMP_CREDENTIAL_CIPHERTEXT_INVALID';
    throw error;
  }
}

module.exports = {
  KEY_ENVIRONMENT_VARIABLE,
  decryptCredential,
  encryptCredential,
  isEncryptedCredential,
};
