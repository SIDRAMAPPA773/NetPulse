import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { 
  Search, 
  Plus, 
  Server, 
  Trash2, 
  ChevronRight,
  Router,
  Wifi,
  MapPin,
  X,
  RefreshCw,
  Radar,
  Check,
  Printer,
  Radio,
  Laptop,
  Network,
  Sliders,
} from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';
import { AuthContext } from '../context/AuthContext';

const formatRate = (bitsPerSecond) => {
  if (bitsPerSecond === null || bitsPerSecond === undefined || !Number.isFinite(bitsPerSecond)) return 'Unavailable';
  if (bitsPerSecond >= 1_000_000_000) return `${(bitsPerSecond / 1_000_000_000).toFixed(2)} Gbit/s`;
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(2)} Mbit/s`;
  if (bitsPerSecond >= 1_000) return `${(bitsPerSecond / 1_000).toFixed(2)} kbit/s`;
  return `${bitsPerSecond.toFixed(0)} bit/s`;
};

const DISCOVERY_AUTHORIZATION_LABELS = {
  eligible_for_authorization: 'Eligible for authorization',
  eligible_for_auto_authorization: 'Eligible for automatic authorization',
  review_required: 'Review required',
  pending_approval: 'Pending approval',
  authorized: 'Authorized',
  disabled: 'Disabled',
  environment_restricted: 'Environment restricted',
  interface_disconnected: 'Interface disconnected',
  interface_policy_disabled: 'Interface policy disabled',
  excluded: 'Excluded',
};

const DISCOVERY_AUTHORIZATION_STYLES = {
  eligible_for_authorization: 'border-sky-200 bg-sky-50 text-sky-700',
  eligible_for_auto_authorization: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  review_required: 'border-violet-200 bg-violet-50 text-violet-700',
  pending_approval: 'border-amber-200 bg-amber-50 text-amber-700',
  authorized: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  disabled: 'border-slate-200 bg-slate-100 text-slate-600',
  environment_restricted: 'border-orange-200 bg-orange-50 text-orange-700',
  interface_disconnected: 'border-amber-200 bg-amber-50 text-amber-700',
  interface_policy_disabled: 'border-slate-200 bg-slate-100 text-slate-600',
  excluded: 'border-rose-200 bg-rose-50 text-rose-700',
};

const getDeviceIcon = (type) => {
  switch (type) {
    case 'router': return <Router className="w-4 h-4 text-sky-600" />;
    case 'switch': return <Network className="w-4 h-4 text-indigo-600" />;
    case 'server': return <Server className="w-4 h-4 text-emerald-600" />;
    case 'pc': return <Laptop className="w-4 h-4 text-slate-600" />;
    case 'printer': return <Printer className="w-4 h-4 text-amber-600" />;
    case 'ap': return <Radio className="w-4 h-4 text-purple-600" />;
    default: return <Wifi className="w-4 h-4 text-slate-500" />;
  }
};

const isInSubnet = (ipAddress, subnet) => {
  if (!subnet) return true;
  const [network, maskText] = subnet.split('/');
  if (maskText === undefined) return ipAddress.startsWith(subnet);
  const maskLength = Number(maskText);
  const toNumber = (address) => {
    const parts = address.split('.');
    if (parts.length !== 4 || parts.some(part => !/^\d+$/.test(part) || Number(part) > 255)) return null;
    return parts.reduce((value, part) => (value * 256) + Number(part), 0) >>> 0;
  };
  const ipValue = toNumber(ipAddress);
  const networkValue = toNumber(network);
  if (ipValue === null || networkValue === null || !Number.isInteger(maskLength) || maskLength < 0 || maskLength > 32) return false;
  const mask = maskLength === 0 ? 0 : (0xFFFFFFFF << (32 - maskLength)) >>> 0;
  return (ipValue & mask) === (networkValue & mask);
};

const Devices = () => {
  const { user } = useContext(AuthContext);
  const isAdmin = user?.role === 'admin';
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showOfflineDevices, setShowOfflineDevices] = useState(false);
  const [subnetFilter, setSubnetFilter] = useState('');
  const [alertSeverityFilter] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [page, setPage] = useState(1);
  
  // Add/Edit modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newDevice, setNewDevice] = useState({
    name: '',
    ipAddress: '',
    macAddress: '',
    hostname: '',
    vendor: '',
    type: 'router',
    location: '',
    description: '',
    operatingSystem: '',
    ipv6Address: '',
    monitoringMethod: 'icmp',
    pollingInterval: 30,
    snmpCommunity: '',
    snmpVersion: '2c',
    snmpInterfaceIndex: '',
    snmpSecurityLevel: 'noAuthNoPriv',
    snmpSecurityName: '',
    snmpAuthProtocol: 'sha',
    snmpAuthKey: '',
    snmpPrivProtocol: 'aes',
    snmpPrivKey: '',
    snmpContext: ''
  });

  // Auto-Discovery Scanner modal state
  const [showScanModal, setShowScanModal] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [showInterfacePreview, setShowInterfacePreview] = useState(false);
  const [networkInterfaces, setNetworkInterfaces] = useState([]);
  const [discoveryProgress, setDiscoveryProgress] = useState(null);
  const [selectedDiscoveryCidr, setSelectedDiscoveryCidr] = useState('');
  const [detectingInterfaces, setDetectingInterfaces] = useState(false);
  const [interfaceDetectionError, setInterfaceDetectionError] = useState('');
  const [selectedIps, setSelectedIps] = useState(new Set());
  const [enrollingBatch, setEnrollingBatch] = useState(false);

  // Multi-method discovery configuration
  const [scanPorts, setScanPorts] = useState([22, 53, 80, 443, 3389]);
  const [resolveDnsOption, setResolveDnsOption] = useState(true);
  const [checkServicesOption, setCheckServicesOption] = useState(true);

  const scanController = useRef(null);

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await api.get('/devices');
      setDevices(res.data);
    } catch (error) {
      console.error('Failed to fetch devices', error);
      setLoadError('Unable to load the device inventory. Check the connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();

    const socket = getSocket();
    const handleDeviceUpdated = (updatedDevice) => {
      setDevices(prev => prev.map(d => d._id === updatedDevice._id
        ? { ...d, ...updatedDevice }
        : d));
    };
    const handleMetricAdded = (metric) => {
      const deviceId = typeof metric.device === 'object' ? metric.device?._id : metric.device;
      setDevices(prev => prev.map(device => device._id === deviceId ? {
        ...device,
        latestMetric: metric,
        collectionStatus: metric.collectionStatus || 'unknown',
        collectionReason: metric.reasonUnavailable || null,
        recentLatency: [...(device.recentLatency || []), metric.latency].filter(Number.isFinite).slice(-10),
      } : device));
    };
    if (socket) {
      socket.on('deviceUpdated', handleDeviceUpdated);
      socket.on('metricAdded', handleMetricAdded);
    }

    return () => {
      scanController.current?.abort();
      if (socket) {
        socket.off('deviceUpdated', handleDeviceUpdated);
        socket.off('metricAdded', handleMetricAdded);
      }
    };
  }, [fetchDevices]);

  const handleCreateDevice = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = { ...newDevice };
      if (!payload.snmpInterfaceIndex) delete payload.snmpInterfaceIndex;
      if (payload.snmpVersion !== '3') {
        delete payload.snmpSecurityLevel;
        delete payload.snmpSecurityName;
        delete payload.snmpAuthProtocol;
        delete payload.snmpAuthKey;
        delete payload.snmpPrivProtocol;
        delete payload.snmpPrivKey;
        delete payload.snmpContext;
      }
      const res = await api.post('/devices', payload);
      setDevices(prev => [res.data, ...prev]);
      setShowAddModal(false);
      setNewDevice({
        name: '',
        ipAddress: '',
        macAddress: '',
        hostname: '',
        vendor: '',
        type: 'router',
        location: '',
        description: '',
        operatingSystem: '',
        ipv6Address: '',
        monitoringMethod: 'icmp',
        pollingInterval: 30,
        snmpCommunity: '',
        snmpVersion: '2c',
        snmpInterfaceIndex: '',
        snmpSecurityLevel: 'noAuthNoPriv',
        snmpSecurityName: '',
        snmpAuthProtocol: 'sha',
        snmpAuthKey: '',
        snmpPrivProtocol: 'aes',
        snmpPrivKey: '',
        snmpContext: ''
      });
    } catch (err) {
      console.error('Error adding device', err);
      alert(err.response?.data?.message || 'Error creating device');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteDevice = async (id, name) => {
    if (!window.confirm(`Are you sure you want to remove ${name} from monitoring?`)) return;
    try {
      await api.delete(`/devices/${id}`);
      setDevices(prev => prev.filter(d => d._id !== id));
    } catch (err) {
      console.error('Error deleting device', err);
      alert('Failed to remove device');
    }
  };

  const updateDeviceAuthorization = async (device, updates) => {
    try {
      const { data } = await api.put(`/devices/${device._id}`, updates);
      setDevices((current) => current.map((item) => item._id === device._id ? { ...item, ...data } : item));
    } catch (error) {
      alert(error.response?.data?.message || 'Unable to update device authorization.');
    }
  };

  const handleOpenDiscovery = async () => {
    setShowInterfacePreview(true);
    setDetectingInterfaces(true);
    setInterfaceDetectionError('');
    try {
      const { data } = await api.get('/devices/network-interfaces');
      setNetworkInterfaces(data.interfaces);
      setSelectedDiscoveryCidr(data.interfaces.find(item => item.discoveryApproved)?.discoveryCidr || '');
    } catch (error) {
      console.error('Network interface detection failed', error);
      setInterfaceDetectionError(error.response?.data?.message || 'Unable to detect network interfaces.');
    } finally {
      setDetectingInterfaces(false);
    }
  };

  const handleRegisterDetectedSubnet = async (networkInterface) => {
    setInterfaceDetectionError('');
    try {
      await api.post('/subnets', {
        name: `${networkInterface.name} (${networkInterface.discoveryCidr})`,
        cidr: networkInterface.discoveryCidr,
        description: `Detected interface submitted for administrator review: ${networkInterface.name}`,
        location: '',
        department: '',
      });
      await handleOpenDiscovery();
    } catch (error) {
      setInterfaceDetectionError(error.response?.data?.message || 'Unable to submit this subnet for approval.');
    }
  };

  const handleStartScan = async (cidr) => {
    if (!cidr) return;
    scanController.current?.abort();
    scanController.current = new AbortController();
    setShowInterfacePreview(false);
    setShowScanModal(true);
    setScanning(true);
    setScanResults(null);
    setDiscoveryProgress({ checkedHosts: 0, totalHosts: 0, respondingHosts: 0 });
    const socket = getSocket();
    const handleDiscoveryProgress = (progress) => {
      if (progress.cidr === cidr) setDiscoveryProgress(progress);
    };
    socket?.on('discoveryProgress', handleDiscoveryProgress);
    try {
      const res = await api.post('/devices/discover', { 
        cidr,
        ports: scanPorts,
        resolveDns: resolveDnsOption,
        checkServices: checkServicesOption,
      }, { signal: scanController.current.signal });
      setScanResults(res.data);
      setDiscoveryProgress(res.data);
      const unenrolled = new Set(
        res.data.devices.filter(d => !d.isEnrolled).map(d => d.ipAddress)
      );
      setSelectedIps(unenrolled);
    } catch (err) {
      if (err.code !== 'ERR_CANCELED') {
        console.error('Discovery failed', err);
        alert(err.response?.data?.message || 'Failed to run approved subnet discovery.');
      }
    } finally {
      socket?.off('discoveryProgress', handleDiscoveryProgress);
      scanController.current = null;
      setScanning(false);
    }
  };

  const toggleSelectIp = (ip) => {
    setSelectedIps(prev => {
      const next = new Set(prev);
      if (next.has(ip)) next.delete(ip);
      else next.add(ip);
      return next;
    });
  };

  const handleEnrollSelected = async () => {
    if (!scanResults || selectedIps.size === 0) return;
    setEnrollingBatch(true);
    try {
      const toEnroll = scanResults.devices.filter(d => selectedIps.has(d.ipAddress));
      await api.post('/devices/enroll-multiple', { devices: toEnroll });
      await fetchDevices();
      setShowScanModal(false);
      setSelectedIps(new Set());
    } catch (err) {
      console.error('Error batch enrolling devices', err);
      alert('Failed to enroll selected devices');
    } finally {
      setEnrollingBatch(false);
    }
  };

  const filteredDevices = devices.filter(device => {
    const matchesSearch = 
      (device.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (device.ipAddress || '').includes(search) ||
      (device.macAddress || '').toLowerCase().includes(search.toLowerCase()) ||
      (device.vendor || '').toLowerCase().includes(search.toLowerCase()) ||
      (device.location || '').toLowerCase().includes(search.toLowerCase());
    
    const matchesType = !typeFilter || device.type === typeFilter;
    const matchesStatus = !statusFilter
      ? (showOfflineDevices ? true : device.status !== 'DOWN')
      : device.status === statusFilter;
    const matchesSubnet = isInSubnet(device.ipAddress, subnetFilter);
    const matchesAlert = !alertSeverityFilter || Boolean(device.alertCounts?.[alertSeverityFilter]);

    return matchesSearch && matchesType && matchesStatus && matchesSubnet && matchesAlert;
  }).sort((left, right) => {
    if (sortBy === 'name') return left.name.localeCompare(right.name);
    if (sortBy === 'latency') return (right.latestMetric?.latency ?? -1) - (left.latestMetric?.latency ?? -1);
    if (sortBy === 'throughput') return ((right.latestMetric?.incomingTraffic || 0) + (right.latestMetric?.outgoingTraffic || 0)) -
      ((left.latestMetric?.incomingTraffic || 0) + (left.latestMetric?.outgoingTraffic || 0));
    if (sortBy === 'health') return (right.healthScore ?? -1) - (left.healthScore ?? -1);
    if (sortBy === 'availability') return (right.latestMetric?.availability ?? -1) - (left.latestMetric?.availability ?? -1);
    if (sortBy === 'lastSeen') return new Date(right.lastSeen || 0) - new Date(left.lastSeen || 0);
    return 0;
  });

  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(filteredDevices.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageDevices = filteredDevices.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const onlineCount = devices.filter(d => d.status === 'UP').length;
  const warningCount = devices.filter(d => d.status === 'WARNING').length;
  const offlineCount = devices.filter(d => d.status === 'DOWN').length;

  return (
    <div className="space-y-6 pb-12 w-full min-w-0">
      
      {/* Top Banner and Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            Campus Network Fleet
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Real-time multi-method discovery, passive host profiling, and hardware telemetry.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button 
            onClick={handleOpenDiscovery}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition-all cursor-pointer"
          >
            <Radar className="w-4 h-4 animate-pulse" />
            <span>Discover Subnet</span>
          </button>

          <button 
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Device</span>
          </button>
        </div>
      </div>

      {/* Fleet Stats Overview Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="glass-card-static rounded-xl p-3 border border-slate-200 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-600">Total Enrolled</span>
          <span className="text-sm font-bold font-mono text-slate-900">{devices.length}</span>
        </div>
        <div className="glass-card-static rounded-xl p-3 border border-slate-200 flex items-center justify-between">
          <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Online
          </span>
          <span className="text-sm font-bold font-mono text-emerald-700">{onlineCount}</span>
        </div>
        <div className="glass-card-static rounded-xl p-3 border border-slate-200 flex items-center justify-between">
          <span className="text-xs font-semibold text-amber-700 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> Degraded
          </span>
          <span className="text-sm font-bold font-mono text-amber-700">{warningCount}</span>
        </div>
        <div className="glass-card-static rounded-xl p-3 border border-slate-200 flex items-center justify-between">
          <span className="text-xs font-semibold text-rose-700 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500" /> Offline
          </span>
          <span className="text-sm font-bold font-mono text-rose-700">{offlineCount}</span>
        </div>
      </div>

      {/* Main Table & Filters */}
      <div className="glass-card-static rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        
        {/* Search & Filter Bar */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/50">
          <div className="relative flex-1 max-w-md">
            <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by name, IP, MAC, vendor, location..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-white border border-slate-300 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-medium shadow-2xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select 
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="bg-white border border-slate-300 text-slate-800 text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-blue-500 cursor-pointer shadow-2xs font-medium"
            >
              <option value="">All Types</option>
              <option value="router">Routers</option>
              <option value="switch">Switches</option>
              <option value="server">Servers</option>
              <option value="pc">Workstations</option>
              <option value="printer">Printers</option>
              <option value="ap">Access Points</option>
              <option value="other">Other / unidentified</option>
            </select>

            <select 
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="bg-white border border-slate-300 text-slate-800 text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-blue-500 cursor-pointer shadow-2xs font-medium"
            >
              <option value="">Online, warning & unknown</option>
              <option value="UP">Online (UP)</option>
              <option value="WARNING">Degraded (WARNING)</option>
              <option value="DOWN">Offline (DOWN)</option>
              <option value="UNKNOWN">Unknown</option>
            </select>

            <label className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={showOfflineDevices}
                onChange={event => setShowOfflineDevices(event.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Show offline
            </label>

            <input
              type="text"
              value={subnetFilter}
              onChange={event => setSubnetFilter(event.target.value)}
              placeholder="Subnet (CIDR)"
              aria-label="Filter by subnet"
              className="w-32 bg-white border border-slate-300 text-slate-800 text-xs rounded-xl px-3 py-2"
            />

            <select
              value={sortBy}
              onChange={event => setSortBy(event.target.value)}
              aria-label="Sort devices"
              className="bg-white border border-slate-300 text-slate-800 text-xs rounded-xl px-3 py-2 font-medium"
            >
              <option value="name">Name</option>
              <option value="health">Health Score</option>
              <option value="latency">Latency</option>
              <option value="throughput">Throughput</option>
              <option value="availability">Availability</option>
              <option value="lastSeen">Last seen</option>
            </select>

            <button 
              onClick={fetchDevices}
              title="Refresh Telemetry"
              className="p-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer shadow-2xs"
            >
              <RefreshCw className={clsx("w-4 h-4", loading && "animate-spin")} />
            </button>
          </div>
        </div>

        {/* Device Cards Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-4">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="h-52 rounded-2xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : loadError ? (
          <div className="py-16 text-center text-sm text-rose-700">
            <p>{loadError}</p>
            <button type="button" onClick={fetchDevices} className="mt-3 px-4 py-2 rounded-lg border border-rose-300 font-semibold cursor-pointer">Retry</button>
          </div>
        ) : filteredDevices.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-xs">
            <Server className="w-10 h-10 text-slate-400 mx-auto mb-3" />
            <p className="font-bold text-slate-700 text-sm">No matching network devices found</p>
            <p className="mt-1">Add a device or run multi-method discovery on an administrator-approved subnet.</p>
          </div>
        ) : (
          <div className="p-4 sm:p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {pageDevices.map(device => {
                const metric = device.latestMetric || {};
                const isUp = device.status === 'UP';
                const isDown = device.status === 'DOWN';
                const latencySamples = (device.recentLatency || []).filter(Number.isFinite);
                const maxLatency = Math.max(1, ...latencySamples);
                return (
                  <article key={device._id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs hover:border-slate-300 transition-all">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="w-10 h-10 shrink-0 rounded-xl bg-slate-50 flex items-center justify-center border border-slate-200">
                          {getDeviceIcon(device.type)}
                        </div>
                        <div className="min-w-0">
                          <h2 className="truncate text-sm font-bold text-slate-900">{device.name}</h2>
                          <div className="flex items-center gap-2 flex-wrap font-mono text-[11px] text-slate-500">
                            <span>{device.ipAddress}</span>
                            {device.macAddress && (
                              <span className="text-[10px] text-slate-400 bg-slate-100 px-1 rounded border border-slate-200">
                                {device.macAddress}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex flex-col items-end gap-1">
                        <span className={clsx(
                          'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase',
                          isUp ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            isDown ? 'bg-rose-50 text-rose-700 border-rose-200' :
                              'bg-amber-50 text-amber-700 border-amber-200'
                        )}>{device.status || 'UNKNOWN'}</span>
                        
                        {device.healthScore !== null && (
                          <span className={clsx(
                            'text-[10px] font-bold font-mono px-1.5 py-0.2 rounded border',
                            device.healthScore >= 80 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            device.healthScore >= 60 ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            'bg-rose-50 text-rose-700 border-rose-200'
                          )}>
                            Score: {device.healthScore}%
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Metadata tags */}
                    <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-slate-500 flex-wrap">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{device.location || 'Location unassigned'}</span>
                      <span className="capitalize">· {device.type}</span>
                      {device.vendor && device.vendor !== 'Unknown' && (
                        <span className="font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200">
                          {device.vendor}
                        </span>
                      )}
                      {device.reachabilityMethod && device.reachabilityMethod !== 'none' && (
                        <span className="font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.2 rounded border border-indigo-200 uppercase">
                          {device.reachabilityMethod}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 space-y-1 text-[10px] text-slate-500">
                      <p>
                        Subnet: <span className="font-semibold text-slate-700">{device.subnet?.name || device.subnet?.cidr || 'Not associated'}</span>
                        {device.subnet?.cidr && device.subnet?.name ? ` · ${device.subnet.cidr}` : ''}
                      </p>
                      <p>
                        Discovery source: <span className="font-semibold text-slate-700">{device.discoverySource || device.enrollmentSource || 'Manual'}</span>
                        {device.firstDiscoveredAt ? ` · First ${format(new Date(device.firstDiscoveredAt), 'MMM d, HH:mm')}` : ''}
                        {device.lastDiscoveredAt ? ` · Last ${format(new Date(device.lastDiscoveredAt), 'MMM d, HH:mm')}` : ''}
                      </p>
                      {!device.monitoringAuthorized && device.monitoringAuthorizationReason && (
                        <p className="text-amber-700">Monitoring blocked: {device.monitoringAuthorizationReason}</p>
                      )}
                    </div>

                    {/* Measured Telemetry Cards */}
                    <div className="mt-3.5 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-lg bg-slate-50 p-2">
                        <p className="text-[10px] uppercase text-slate-400 font-semibold">Latency</p>
                        <p className="mt-1 font-mono font-bold text-slate-800">{metric.latency == null ? '—' : `${metric.latency} ms`}</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2">
                        <p className="text-[10px] uppercase text-slate-400 font-semibold">Packet loss</p>
                        <p className="mt-1 font-mono font-bold text-slate-800">{metric.packetLoss == null ? '—' : `${metric.packetLoss}%`}</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2">
                        <p className="text-[10px] uppercase text-slate-400 font-semibold">RX / TX Rate</p>
                        <p className="mt-1 font-mono font-bold text-slate-800 truncate" title={`${formatRate(metric.incomingTraffic)} / ${formatRate(metric.outgoingTraffic)}`}>
                          {formatRate(metric.incomingTraffic)}
                        </p>
                      </div>
                    </div>

                    {/* Sparkline */}
                    <div className="mt-3 flex h-7 items-end gap-1" aria-label="Recent latency sparkline">
                      {latencySamples.length > 0 ? latencySamples.map((sample, index) => (
                        <span
                          key={`${device._id}-${index}`}
                          className="flex-1 rounded-t bg-sky-400"
                          style={{ height: `${Math.max(12, (sample / maxLatency) * 100)}%` }}
                        />
                      )) : <span className="text-[10px] text-slate-400">No latency history</span>}
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                      <span>Last seen: {device.lastSeen ? format(new Date(device.lastSeen), 'MMM d, HH:mm:ss') : 'Never'}</span>
                      <span className={device.activeAlertCount ? 'font-bold text-rose-700' : ''}>
                        {device.activeAlertCount || 0} alert{device.activeAlertCount === 1 ? '' : 's'}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                      <div className="flex flex-wrap gap-1">
                        {isAdmin && device.enrollmentStatus === 'pending' && (
                          <button
                            type="button"
                            onClick={() => updateDeviceAuthorization(device, { enrollmentStatus: 'approved' })}
                            className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] font-bold text-emerald-700"
                          >
                            Approve enrollment
                          </button>
                        )}
                        {isAdmin && device.enrollmentStatus !== 'pending' && (
                          <button
                            type="button"
                            onClick={() => updateDeviceAuthorization(device, { monitoringStatus: !device.monitoringStatus })}
                            className={clsx(
                              'rounded-lg border px-2 py-1.5 text-[10px] font-bold',
                              device.monitoringStatus
                                ? 'border-sky-200 bg-sky-50 text-sky-700'
                                : 'border-slate-200 bg-white text-slate-600',
                            )}
                          >
                            Monitoring {device.monitoringStatus ? 'on' : 'off'}
                          </button>
                        )}
                      </div>
                      <Link
                        to={`/devices/${device._id}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-[11px] font-bold text-sky-700 hover:bg-sky-100 transition-colors"
                      >
                        View details <ChevronRight className="h-3 w-3" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDeleteDevice(device._id, device.name)}
                        title="Remove device"
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:border-rose-200 hover:text-rose-600 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between text-xs text-slate-600">
                <span>{filteredDevices.length} matching devices · page {currentPage} of {totalPages}</span>
                <div className="flex gap-2">
                  <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40 cursor-pointer">Previous</button>
                  <button type="button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40 cursor-pointer">Next</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Network Interface Preview & Discovery Pre-flight Modal */}
      {showInterfacePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Administrator-Approved Subnet Discovery</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Only active, approved private subnets can be scanned. Registering an interface creates a pending subnet and never starts discovery.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={handleOpenDiscovery} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="Refresh interface authorization">
                  <RefreshCw className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => setShowInterfacePreview(false)} className="rounded-lg p-1 text-slate-400 hover:text-slate-700" aria-label="Close interface preview">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {detectingInterfaces ? (
              <div className="py-12 text-center text-sm text-slate-500">Reading local interface configuration…</div>
            ) : interfaceDetectionError ? (
              <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{interfaceDetectionError}</div>
            ) : networkInterfaces.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500">No network interfaces were detected.</div>
            ) : (
              <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">Available Interfaces & Approved Subnets</h4>
                {networkInterfaces.map(networkInterface => (
                  <label key={networkInterface.name} className={clsx(
                    'block rounded-xl border p-3.5 transition-colors',
                    networkInterface.discoveryApproved ? 'cursor-pointer border-sky-200 hover:bg-sky-50/50' : 'border-slate-200 bg-slate-50',
                  )}>
                    <div className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="discovery-cidr"
                        value={networkInterface.discoveryCidr || ''}
                        disabled={!networkInterface.discoveryApproved}
                        checked={selectedDiscoveryCidr === networkInterface.discoveryCidr}
                        onChange={() => setSelectedDiscoveryCidr(networkInterface.discoveryCidr)}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-slate-900 text-xs">{networkInterface.name}</span>
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] uppercase text-slate-600 font-semibold">{networkInterface.type}</span>
                          <span className="text-[10px] uppercase text-slate-500">Link: {networkInterface.status}</span>
                          <span className={clsx(
                            'rounded border px-2 py-0.5 text-[10px] font-bold uppercase',
                            DISCOVERY_AUTHORIZATION_STYLES[networkInterface.authorizationStatus] || DISCOVERY_AUTHORIZATION_STYLES.excluded,
                          )}>
                            {DISCOVERY_AUTHORIZATION_LABELS[networkInterface.authorizationStatus] || 'Unknown'}
                          </span>
                        </div>
                        <div className="mt-2 grid gap-1.5 text-xs text-slate-600 sm:grid-cols-2">
                          <p>IPv4: {networkInterface.ipv4.map(item => `${item.address} (${item.cidr || 'CIDR unavailable'})`).join(', ') || 'Unavailable'}</p>
                          <p>Default gateway: {networkInterface.defaultGateway || 'None'}</p>
                          {networkInterface.discoveryCidr && (
                            <p className="font-mono font-semibold text-sky-700">Target CIDR: {networkInterface.discoveryCidr} ({networkInterface.discoveryHostCount ?? 'unavailable'} hosts)</p>
                          )}
                          {networkInterface.authorizationReason && (
                            <p className="text-xs text-slate-500 sm:col-span-2">{networkInterface.authorizationReason}</p>
                          )}
                        </div>
                        {networkInterface.canRegisterSubnet && (
                          <button
                            type="button"
                            onClick={() => handleRegisterDetectedSubnet(networkInterface)}
                            className="mt-2 rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-[11px] font-bold text-sky-700 hover:bg-sky-50"
                          >
                            {networkInterface.authorizationStatus === 'review_required'
                              ? 'Submit for administrator review'
                              : 'Register subnet for approval'}
                          </button>
                        )}
                        {networkInterface.authorizationStatus === 'pending_approval' && (
                          <p className="mt-2 text-[11px] font-medium text-amber-700">Approve this subnet in Subnet Management, then refresh interface authorization.</p>
                        )}
                        {networkInterface.authorizationStatus === 'eligible_for_auto_authorization' && (
                          <p className="mt-2 text-[11px] font-medium text-cyan-700">The configured interface policy will authorize this network on the next synchronization; no scan will start.</p>
                        )}
                      </div>
                    </div>
                  </label>
                ))}

                {/* Discovery Method Options */}
                <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/70 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-sky-600" />
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wide">Multi-Method Reachability Parameters</h4>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700">
                      <input 
                        type="checkbox"
                        checked={resolveDnsOption}
                        onChange={e => setResolveDnsOption(e.target.checked)}
                        className="rounded text-blue-600 border-slate-300"
                      />
                      Reverse DNS Hostname Lookup (PTR)
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700">
                      <input 
                        type="checkbox"
                        checked={checkServicesOption}
                        onChange={e => setCheckServicesOption(e.target.checked)}
                        className="rounded text-blue-600 border-slate-300"
                      />
                      TCP Service Reachability Check
                    </label>
                  </div>

                  {checkServicesOption && (
                    <div className="pt-2 border-t border-slate-200 text-xs">
                      <p className="text-slate-500 font-medium mb-1.5">Permitted TCP Service Ports to Probe (Bounded Concurrency):</p>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { port: 22, name: 'SSH (22)' },
                          { port: 53, name: 'DNS (53)' },
                          { port: 80, name: 'HTTP (80)' },
                          { port: 443, name: 'HTTPS (443)' },
                          { port: 3389, name: 'RDP (3389)' },
                        ].map(service => {
                          const isChecked = scanPorts.includes(service.port);
                          return (
                            <button
                              key={service.port}
                              type="button"
                              onClick={() => {
                                if (isChecked) setScanPorts(scanPorts.filter(p => p !== service.port));
                                else setScanPorts([...scanPorts, service.port]);
                              }}
                              className={clsx(
                                "px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer",
                                isChecked 
                                  ? "bg-sky-50 text-sky-700 border-sky-300 shadow-2xs" 
                                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                              )}
                            >
                              {service.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button type="button" onClick={() => setShowInterfacePreview(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 cursor-pointer">
                Cancel
              </button>
              <button
                type="button"
                disabled={!selectedDiscoveryCidr || detectingInterfaces}
                onClick={() => handleStartScan(selectedDiscoveryCidr)}
                className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-5 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer shadow-sm transition-all"
              >
                Start Multi-Method Scan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Discovery Results Modal */}
      {showScanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-3xl p-6 space-y-4 max-h-[88vh] flex flex-col">
            
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                  <Radar className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Multi-Method Subnet Discovery</h3>
                  <p className="text-xs text-slate-500">Passive profiling, OS neighbour lookup, and TCP reachability verification.</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  scanController.current?.abort();
                  setShowScanModal(false);
                }}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {scanning ? (
              <div className="py-16 text-center space-y-3">
                <div className="w-10 h-10 rounded-full border-2 border-emerald-200 border-t-emerald-600 animate-spin mx-auto" />
                <p className="font-bold text-slate-800 text-sm">Probing the approved subnet...</p>
                <p className="text-xs text-slate-400">ICMP echo, permitted TCP service connect, and reverse DNS resolution in progress</p>
                {discoveryProgress?.totalHosts > 0 && (
                  <p className="text-xs font-mono text-slate-600">
                    {discoveryProgress.checkedHosts}/{discoveryProgress.totalHosts} hosts checked · {discoveryProgress.respondingHosts} responders found
                  </p>
                )}
              </div>
            ) : scanResults ? (
              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                  <div>
                    <span className="font-bold text-slate-700">Subnet Target:</span>{' '}
                    <span className="font-mono text-sky-700 font-bold">{scanResults.subnet}</span>
                  </div>
                  <div className="text-slate-600 font-medium">
                    Found <span className="font-bold text-emerald-700 font-mono">{scanResults.count}</span> active responders
                  </div>
                </div>

                <div className="space-y-2">
                  {scanResults.devices.map(d => {
                    const isSelected = selectedIps.has(d.ipAddress);
                    return (
                      <div 
                        key={d.ipAddress}
                        onClick={() => !d.isEnrolled && toggleSelectIp(d.ipAddress)}
                        className={clsx(
                          "p-3.5 rounded-xl border flex items-center justify-between transition-all",
                          d.isEnrolled 
                            ? "bg-slate-50/70 border-slate-200 opacity-60 cursor-not-allowed" 
                            : isSelected 
                            ? "bg-sky-50 border-sky-300 cursor-pointer shadow-2xs" 
                            : "bg-white border-slate-200 hover:border-slate-300 cursor-pointer"
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <input 
                            type="checkbox"
                            checked={isSelected}
                            disabled={d.isEnrolled}
                            onChange={() => toggleSelectIp(d.ipAddress)}
                            className="w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500 cursor-pointer"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-slate-900 text-xs truncate">{d.name}</span>
                              <span className="font-mono text-[11px] font-bold text-sky-700 px-1.5 py-0.2 rounded bg-sky-50 border border-sky-200">
                                {d.ipAddress}
                              </span>
                              {d.macAddress && (
                                <span className="font-mono text-[10px] text-slate-500 px-1.5 py-0.2 rounded bg-slate-100 border border-slate-200">
                                  {d.macAddress}
                                </span>
                              )}
                            </div>
                            
                            <div className="text-[11px] text-slate-500 font-medium mt-1 flex items-center gap-2 flex-wrap">
                              {d.vendor && d.vendor !== 'Unknown' && (
                                <span className="font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200 text-[10px]">
                                  {d.vendor}
                                </span>
                              )}
                              <span className="capitalize">Type: {d.type}</span>
                              {d.operatingSystem && d.operatingSystem !== 'Unknown' && (
                                <span>· OS: {d.operatingSystem}</span>
                              )}
                              {d.reachabilityMethod && (
                                <span className="uppercase font-bold text-emerald-700 text-[9px] bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                                  Method: {d.reachabilityMethod}
                                </span>
                              )}
                              {d.openPorts && d.openPorts.length > 0 && (
                                <span className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.2 rounded">
                                  Ports: {d.openPorts.join(', ')}
                                </span>
                              )}
                            </div>

                            {d.deviceId && (
                              <Link
                                to={`/devices/${d.deviceId}`}
                                onClick={(event) => event.stopPropagation()}
                                className="mt-1 inline-block text-[10px] font-semibold text-sky-700 underline"
                              >
                                View enrolled device
                              </Link>
                            )}
                          </div>
                        </div>

                        <div className="shrink-0 ml-3">
                          {d.isEnrolled ? (
                            <span className="text-[10px] font-bold text-slate-500 uppercase px-2 py-0.5 rounded bg-slate-200">
                              Enrolled
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-emerald-700 uppercase px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200">
                              Ready
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Footer Buttons */}
            {scanResults && !scanning && (
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between shrink-0">
                <button
                  type="button"
                  onClick={() => handleStartScan(scanResults.subnet)}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
                >
                  Rescan Subnet
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      scanController.current?.abort();
                      setShowScanModal(false);
                    }}
                    className="px-4 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-bold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={selectedIps.size === 0 || enrollingBatch}
                    onClick={handleEnrollSelected}
                    className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <Check className="w-4 h-4" />
                    {enrollingBatch ? 'Enrolling...' : `Enroll Selected (${selectedIps.size}) Nodes`}
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* Add Device Modal Dialog */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Server className="w-5 h-5 text-sky-600" />
                <h3 className="text-base font-bold text-slate-900">Enroll New Network Node</h3>
              </div>
              <button 
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateDevice} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Device Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Campus Core Gateway 01"
                  value={newDevice.name}
                  onChange={e => setNewDevice({ ...newDevice, name: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">IP Address</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 10.38.27.142"
                    value={newDevice.ipAddress}
                    onChange={e => setNewDevice({ ...newDevice, ipAddress: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 placeholder-slate-400 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Device Type</label>
                  <select
                    value={newDevice.type}
                    onChange={e => setNewDevice({ ...newDevice, type: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="router">Router</option>
                    <option value="switch">Switch</option>
                    <option value="server">Server</option>
                    <option value="pc">Workstation</option>
                    <option value="printer">Printer</option>
                    <option value="ap">Access Point</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">MAC Address (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. 00:11:22:33:44:55"
                    value={newDevice.macAddress}
                    onChange={e => setNewDevice({ ...newDevice, macAddress: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 placeholder-slate-400 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Vendor (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Cisco Systems"
                    value={newDevice.vendor}
                    onChange={e => setNewDevice({ ...newDevice, vendor: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Location</label>
                  <input
                    type="text"
                    placeholder="e.g. Server Room Rack 2"
                    value={newDevice.location}
                    onChange={e => setNewDevice({ ...newDevice, location: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Monitoring Protocol</label>
                  <select
                    value={newDevice.monitoringMethod}
                    onChange={e => setNewDevice({ ...newDevice, monitoringMethod: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="icmp">ICMP Ping Only</option>
                    <option value="snmp">ICMP + SNMP Telemetry</option>
                  </select>
                </div>
              </div>

              {/* SNMP Configuration Section */}
              {newDevice.monitoringMethod === 'snmp' && (
                <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-4 space-y-3">
                  <h4 className="font-bold text-sky-900 flex items-center gap-1.5">
                    <Sliders className="w-4 h-4 text-sky-700" />
                    SNMP Hardware & Interface Configuration
                  </h4>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-700 font-semibold mb-1">SNMP Version</label>
                      <select
                        value={newDevice.snmpVersion}
                        onChange={e => setNewDevice({ ...newDevice, snmpVersion: e.target.value })}
                        className="w-full px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-900"
                      >
                        <option value="1">SNMPv1</option>
                        <option value="2c">SNMPv2c</option>
                        <option value="3">SNMPv3 (Secure)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-slate-700 font-semibold mb-1">Interface Index (IF-MIB)</label>
                      <input
                        type="number"
                        min="1"
                        placeholder="e.g. 1, 2, or 3"
                        value={newDevice.snmpInterfaceIndex}
                        onChange={e => setNewDevice({ ...newDevice, snmpInterfaceIndex: e.target.value })}
                        className="w-full px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-900"
                      />
                    </div>
                  </div>

                  {newDevice.snmpVersion !== '3' ? (
                    <div>
                      <label className="block text-slate-700 font-semibold mb-1">Community String</label>
                      <input
                        type="password"
                        placeholder="e.g. public"
                        value={newDevice.snmpCommunity}
                        onChange={e => setNewDevice({ ...newDevice, snmpCommunity: e.target.value })}
                        className="w-full px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-900"
                      />
                    </div>
                  ) : (
                    <div className="space-y-2.5 pt-2 border-t border-sky-200/80">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-slate-700 font-semibold mb-1">Security Level</label>
                          <select
                            value={newDevice.snmpSecurityLevel}
                            onChange={e => setNewDevice({ ...newDevice, snmpSecurityLevel: e.target.value })}
                            className="w-full px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-900"
                          >
                            <option value="noAuthNoPriv">noAuthNoPriv</option>
                            <option value="authNoPriv">authNoPriv</option>
                            <option value="authPriv">authPriv (Encrypted)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-slate-700 font-semibold mb-1">Security User</label>
                          <input
                            type="text"
                            placeholder="Username"
                            value={newDevice.snmpSecurityName}
                            onChange={e => setNewDevice({ ...newDevice, snmpSecurityName: e.target.value })}
                            className="w-full px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-900"
                          />
                        </div>
                      </div>

                      {newDevice.snmpSecurityLevel !== 'noAuthNoPriv' && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-slate-700 font-semibold mb-1">Auth Protocol</label>
                            <select
                              value={newDevice.snmpAuthProtocol}
                              onChange={e => setNewDevice({ ...newDevice, snmpAuthProtocol: e.target.value })}
                              className="w-full px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-900"
                            >
                              <option value="sha">SHA</option>
                              <option value="sha256">SHA-256</option>
                              <option value="md5">MD5</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-slate-700 font-semibold mb-1">Auth Key</label>
                            <input
                              type="password"
                              placeholder="Auth passphrase"
                              value={newDevice.snmpAuthKey}
                              onChange={e => setNewDevice({ ...newDevice, snmpAuthKey: e.target.value })}
                              className="w-full px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-900"
                            />
                          </div>
                        </div>
                      )}

                      {newDevice.snmpSecurityLevel === 'authPriv' && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-slate-700 font-semibold mb-1">Privacy Protocol</label>
                            <select
                              value={newDevice.snmpPrivProtocol}
                              onChange={e => setNewDevice({ ...newDevice, snmpPrivProtocol: e.target.value })}
                              className="w-full px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-900"
                            >
                              <option value="aes">AES-128</option>
                              <option value="aes256b">AES-256</option>
                              <option value="des">DES</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-slate-700 font-semibold mb-1">Privacy Key</label>
                            <input
                              type="password"
                              placeholder="Privacy passphrase"
                              value={newDevice.snmpPrivKey}
                              onChange={e => setNewDevice({ ...newDevice, snmpPrivKey: e.target.value })}
                              className="w-full px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-900"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-slate-700 font-bold mb-1">Description / Notes</label>
                <input
                  type="text"
                  placeholder="e.g. Core fiber uplink node"
                  value={newDevice.description}
                  onChange={e => setNewDevice({ ...newDevice, description: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-xs transition-all cursor-pointer"
                >
                  {submitting ? 'Registering...' : 'Save & Monitor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default Devices;
