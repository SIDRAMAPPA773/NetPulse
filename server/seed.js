const mongoose = require('mongoose');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const User = require('./models/User');
const Device = require('./models/Device');
const Setting = require('./models/Setting');

dotenv.config();

const seedData = async () => {
  try {
    await connectDB();
    const defaults = [
      { key: 'SIMULATION_MODE', value: true },
      { key: 'EMERGENCY_STOP', value: false },
      { key: 'LATENCY_WARNING', value: 100 },
      { key: 'LATENCY_CRITICAL', value: 250 },
      { key: 'PACKET_LOSS_WARNING', value: 5 },
      { key: 'PACKET_LOSS_CRITICAL', value: 15 },
    ];
    for (const setting of defaults) {
      await Setting.updateOne({ key: setting.key }, { $setOnInsert: { value: setting.value } }, { upsert: true });
    }

    const adminExists = await User.exists({ email: 'admin@college.edu' });
    if (!adminExists) {
      if (!process.env.ADMIN_INITIAL_PASSWORD) {
        throw new Error('Set ADMIN_INITIAL_PASSWORD to create the initial admin account');
      }
      await User.create({
        name: 'Admin User',
        email: 'admin@college.edu',
        password: process.env.ADMIN_INITIAL_PASSWORD,
        role: 'admin',
      });
    }

    const devices = [
      { name: 'Core Router', ipAddress: '192.168.1.1', type: 'router', location: 'Server Room', description: 'Main college router' },
      { name: 'Library Switch', ipAddress: '192.168.2.1', type: 'switch', location: 'Library', description: 'Switch for library systems' },
      { name: 'Lab 1 Switch', ipAddress: '192.168.3.1', type: 'switch', location: 'Computer Lab 1', description: 'CS Dept Lab 1' },
      { name: 'Database Server', ipAddress: '192.168.1.10', type: 'server', location: 'Server Room', description: 'Student records DB' },
      { name: 'Web Server', ipAddress: '192.168.1.11', type: 'server', location: 'Server Room', description: 'College website' },
      { name: 'Admin Block Switch', ipAddress: '192.168.4.1', type: 'switch', location: 'Administration Block', description: '' },
    ];

    for (const device of devices) {
      await Device.updateOne({ ipAddress: device.ipAddress }, { $setOnInsert: device }, { upsert: true });
    }

    console.log('Default settings and example devices are present; existing data was preserved');
  } catch (error) {
    console.error('Error seeding data', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

seedData();
