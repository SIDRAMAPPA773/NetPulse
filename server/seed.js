const mongoose = require('mongoose');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const User = require('./models/User');
const Device = require('./models/Device');
const Metric = require('./models/Metric');
const Alert = require('./models/Alert');
const Setting = require('./models/Setting');

dotenv.config();

const seedData = async () => {
  try {
    await connectDB();
    
    await User.deleteMany();
    await Device.deleteMany();
    await Metric.deleteMany();
    await Alert.deleteMany();
    await Setting.deleteMany();

    console.log('Data cleared');

    await Setting.insertMany([
      { key: 'SIMULATION_MODE', value: true },
      { key: 'LATENCY_WARNING', value: 100 },
      { key: 'LATENCY_CRITICAL', value: 250 },
      { key: 'PACKET_LOSS_WARNING', value: 5 },
      { key: 'PACKET_LOSS_CRITICAL', value: 15 },
    ]);

    await User.create({
      name: 'Admin User',
      email: 'admin@college.edu',
      password: 'password123',
      role: 'admin'
    });

    const devices = [
      { name: 'Core Router', ipAddress: '192.168.1.1', type: 'router', location: 'Server Room', description: 'Main college router' },
      { name: 'Library Switch', ipAddress: '192.168.2.1', type: 'switch', location: 'Library', description: 'Switch for library systems' },
      { name: 'Lab 1 Switch', ipAddress: '192.168.3.1', type: 'switch', location: 'Computer Lab 1', description: 'CS Dept Lab 1' },
      { name: 'Database Server', ipAddress: '192.168.1.10', type: 'server', location: 'Server Room', description: 'Student records DB' },
      { name: 'Web Server', ipAddress: '192.168.1.11', type: 'server', location: 'Server Room', description: 'College website' },
      { name: 'Admin Block Switch', ipAddress: '192.168.4.1', type: 'switch', location: 'Administration Block', description: '' },
    ];

    await Device.insertMany(devices);

    console.log('Data seeded successfully');
    process.exit();
  } catch (error) {
    console.error('Error seeding data', error);
    process.exit(1);
  }
};

seedData();
