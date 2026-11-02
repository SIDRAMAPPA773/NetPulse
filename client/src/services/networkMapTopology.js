export function createTopologyNodes(devices) {
  return devices.map((device, index) => ({
    id: device._id,
    type: 'custom',
    position: {
      x: (index % 4) * 240,
      y: Math.floor(index / 4) * 180,
    },
    data: {
      label: device.name,
      ip: device.ipAddress,
      status: device.status,
      type: device.type,
      location: device.location,
      id: device._id,
    },
  }));
}
