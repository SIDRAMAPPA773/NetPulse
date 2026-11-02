const test = require('node:test');
const assert = require('node:assert/strict');
const { authorizeMonitoringDevice, findSubnetForIp } = require('../utils/subnetAuthorization');

const approved = {
  _id: 'approved-id',
  name: 'Approved campus range',
  cidr: '10.20.0.0/24',
  status: 'active',
  approvalStatus: 'approved',
  monitoringEnabled: true,
};

test('monitoring authorization requires explicit device and approved-subnet enablement plus migration allowlist', () => {
  const device = {
    ipAddress: '10.20.0.10',
    enrollmentStatus: 'approved',
    monitoringStatus: true,
  };
  assert.equal(authorizeMonitoringDevice(device, [approved], ['10.20.0.0/24']).authorized, true);
  assert.equal(authorizeMonitoringDevice(device, [approved], []).code, 'MIGRATION_ALLOWLIST_BLOCKED');
  assert.equal(authorizeMonitoringDevice(device, [approved], ['10.20.0.10']).authorized, true);
  assert.equal(authorizeMonitoringDevice({ ...device, monitoringStatus: false }, [approved], ['10.20.0.0/24']).code, 'MONITORING_DISABLED');
  assert.equal(authorizeMonitoringDevice({ ...device, enrollmentStatus: 'pending' }, [approved], ['10.20.0.0/24']).code, 'ENROLLMENT_PENDING');
});

test('application-managed monitoring uses approved subnet records without target environment entries', () => {
  const device = {
    ipAddress: '10.20.0.10',
    enrollmentStatus: 'approved',
    monitoringStatus: true,
  };
  assert.equal(
    authorizeMonitoringDevice(device, [approved], [], { authorizationMode: 'application_managed' }).authorized,
    true,
  );
  assert.equal(
    authorizeMonitoringDevice(
      { ...device, monitoringStatus: false },
      [approved],
      [],
      { authorizationMode: 'application_managed' },
    ).code,
    'MONITORING_DISABLED',
  );
  assert.equal(
    authorizeMonitoringDevice(device, [], [], { authorizationMode: 'application_managed' }).code,
    'SUBNET_NOT_APPROVED',
  );
});

test('disabling automatic interface authorization immediately blocks policy-owned subnets', () => {
  const interfaceSubnet = {
    ...approved,
    authorizationSource: 'interface_policy',
    interfaceConnected: true,
    lastInterfaceSeenAt: new Date(),
  };
  const device = {
    ipAddress: '10.20.0.10',
    enrollmentStatus: 'approved',
    monitoringStatus: true,
  };
  assert.equal(
    authorizeMonitoringDevice(device, [interfaceSubnet], [], { authorizationMode: 'application_managed' }).code,
    'INTERFACE_POLICY_DISABLED',
  );
  assert.equal(
    authorizeMonitoringDevice(device, [interfaceSubnet], [], {
      authorizationMode: 'application_managed',
      autoAuthorizeInterfaces: true,
    }).authorized,
    true,
  );
});

test('pending, disabled, and unregistered ranges never authorize monitoring', () => {
  const device = { ipAddress: '10.20.0.10', enrollmentStatus: 'approved', monitoringStatus: true };
  const pending = { ...approved, approvalStatus: 'pending' };
  const disabled = { ...approved, status: 'disabled' };
  assert.equal(authorizeMonitoringDevice(device, [pending], ['10.20.0.0/24']).code, 'SUBNET_NOT_APPROVED');
  assert.equal(authorizeMonitoringDevice(device, [disabled], ['10.20.0.0/24']).code, 'SUBNET_NOT_APPROVED');
  assert.equal(authorizeMonitoringDevice({ ...device, ipAddress: '10.21.0.10' }, [approved], ['10.21.0.0/24']).code, 'SUBNET_NOT_APPROVED');
});

test('nested authorized ranges resolve to the most specific active approved subnet', () => {
  const nested = {
    ...approved,
    _id: 'nested-id',
    name: 'Monitoring disabled nested range',
    cidr: '10.20.0.0/25',
    monitoringEnabled: false,
  };
  assert.equal(findSubnetForIp('10.20.0.10', [approved, nested])._id, nested._id);
  assert.equal(
    authorizeMonitoringDevice(
      { ipAddress: '10.20.0.10', enrollmentStatus: 'approved', monitoringStatus: true },
      [approved, nested],
      ['10.20.0.0/24'],
    ).code,
    'SUBNET_MONITORING_DISABLED',
  );
});
