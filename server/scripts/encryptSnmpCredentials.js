require('dotenv').config();
const mongoose = require('mongoose');
const Device = require('../models/Device');
const { decryptCredential, encryptCredential } = require('../utils/snmpCredentialCrypto');

const CREDENTIAL_FIELDS = ['snmpCommunity', 'snmpAuthKey', 'snmpPrivKey'];

async function encryptExistingCredentials() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI must be configured');
  encryptCredential('configuration-check');

  await mongoose.connect(process.env.MONGO_URI);
  let updatedDevices = 0;
  let skippedDevices = 0;

  try {
    const cursor = Device.collection.find({});
    for await (const device of cursor) {
      const filter = { _id: device._id };
      const updates = {};
      for (const field of CREDENTIAL_FIELDS) {
        const value = device[field];
        if (value === undefined || value === null || value === '') continue;
        if (typeof value !== 'string') {
          throw new Error(`Unexpected value type in SNMP credential field ${field}`);
        }
        if (value.startsWith('enc:v1:')) {
          decryptCredential(value);
          continue;
        }
        if (value.startsWith('enc:')) {
          throw new Error(`Unsupported encrypted credential format encountered in field ${field}`);
        }
        filter[field] = value;
        updates[field] = encryptCredential(value);
      }

      if (Object.keys(updates).length === 0) continue;
      const result = await Device.collection.updateOne(filter, { $set: updates });
      if (result.modifiedCount === 1) updatedDevices += 1;
      else skippedDevices += 1;
    }
  } finally {
    await mongoose.disconnect();
  }

  return { updatedDevices, skippedDevices };
}

if (require.main === module) {
  encryptExistingCredentials()
    .then(({ updatedDevices, skippedDevices }) => {
      console.log(`Encrypted SNMP credentials for ${updatedDevices} device(s); ${skippedDevices} changed during migration.`);
    })
    .catch((error) => {
      console.error(`SNMP credential migration failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { encryptExistingCredentials };
