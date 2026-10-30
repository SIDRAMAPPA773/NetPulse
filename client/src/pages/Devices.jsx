import React, { useState, useEffect, useRef, useCallback } from 'react';
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
} from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';

const formatRate = (bitsPerSecond) => {
  if (bitsPerSecond === null || bitsPerSecond === undefined || !Number.isFinite(bitsPerSecond)) return 'Unavailable';
  if (bitsPerSecond >= 1_000_000_000) return `${(bitsPerSecond / 1_000_000_000).toFixed(2)} Gbit/s`;
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(2)} Mbit/s`;
  if (bitsPerSecond >= 1_000) return `${(bitsPerSecond / 1_000).toFixed(2)} kbit/s`;
  return `${bitsPerSecond.toFixed(0)} bit/s`;
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
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [subnetFilter, setSubnetFilter] = useState('');
  const [alertSeverityFilter, setAlertSeverityFilter] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [page, setPage] = useState(1);
  
  // Add modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newDevice, setNewDevice] = useState({
    name: '',
    ipAddress: '',
    type: 'router',
    location: '',
    description: '',
    monitoringMethod: 'icmp',
    snmpCommunity: ''
  });

  // Auto-Discovery Scanner modal state
  const [showScanModal, setShowScanModal] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [selectedIps, setSelectedIps] = useState(new Set());
  const [enrollingBatch, setEnrollingBatch] = useState(false);
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
    if (socket) {
      socket.on('deviceUpdated', (updatedDevice) => {
        setDevices(prev => prev.map(d => d._id === updatedDevice._id
          ? { ...d, ...updatedDevice }
          : d));
      });
      socket.on('metricAdded', (metric) => {
        const deviceId = typeof metric.device === 'object' ? metric.device?._id : metric.device;
        setDevices(prev => prev.map(device => device._id === deviceId ? {
          ...device,
          latestMetric: metric,
          collectionStatus: metric.collectionStatus || 'unknown',
          collectionReason: metric.reasonUnavailable || null,
          recentLatency: [...(device.recentLatency || []), metric.latency].filter(Number.isFinite).slice(-10),
        } : device));
      });
    }

    return () => {
      scanController.current?.abort();
      if (socket) {
        socket.off('deviceUpdated');
        socket.off('metricAdded');
      }
    };
  }, [fetchDevices]);

  const handleCreateDevice = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.post('/devices', newDevice);
      setDevices(prev => [res.data, ...prev]);
      setShowAddModal(false);
      setNewDevice({
        name: '',
        ipAddress: '',
        type: 'router',
        location: '',
        description: '',
        monitoringMethod: 'icmp',
        snmpCommunity: ''
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

  // Run subnet discovery
  const handleStartScan = async () => {
    const cidr = window.prompt(
      'Enter the exact CIDR approved by your administrator. It must also appear in the server DISCOVERY_ALLOWLIST (maximum 256 hosts):'
    );
    if (!cidr) return;
    scanController.current?.abort();
    scanController.current = new AbortController();
    setShowScanModal(true);
    setScanning(true);
    try {
      const res = await api.post('/devices/discover', { cidr: cidr.trim() }, { signal: scanController.current.signal });
      setScanResults(res.data);
      // Preselect devices that are not yet enrolled
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
    } catch (err) {
      console.error('Error enrolling batch', err);
      alert('Failed to enroll selected devices');
    } finally {
      setEnrollingBatch(false);
    }
  };

  const filteredDevices = devices.filter(d => {
    const matchesSearch =
      String(d.name || '').toLowerCase().includes(search.toLowerCase()) ||
      String(d.ipAddress || '').includes(search) ||
      String(d.location || '').toLowerCase().includes(search.toLowerCase());

    const matchesType = !typeFilter || d.type === typeFilter;
    const matchesStatus = !statusFilter || d.status === statusFilter;
    const matchesSubnet = isInSubnet(d.ipAddress || '', subnetFilter.trim());
    const matchesSeverity = !alertSeverityFilter || (d.alertCounts?.[alertSeverityFilter] || 0) > 0;

    return matchesSearch && matchesType && matchesStatus && matchesSubnet && matchesSeverity;
  }).sort((left, right) => {
    if (sortBy === 'name') return String(left.name).localeCompare(String(right.name));
    const metric = (device) => device.latestMetric || {};
    let leftValue;
    let rightValue;
    if (sortBy === 'latency') {
      leftValue = metric(left).latency ?? Number.POSITIVE_INFINITY;
      rightValue = metric(right).latency ?? Number.POSITIVE_INFINITY;
    } else if (sortBy === 'throughput') {
      leftValue = (metric(left).incomingTraffic ?? -1) + (metric(left).outgoingTraffic ?? -1);
      rightValue = (metric(right).incomingTraffic ?? -1) + (metric(right).outgoingTraffic ?? -1);
    } else if (sortBy === 'availability') {
      leftValue = metric(left).availability ?? -1;
      rightValue = metric(right).availability ?? -1;
    } else {
      leftValue = left.lastSeen ? new Date(left.lastSeen).getTime() : 0;
      rightValue = right.lastSeen ? new Date(right.lastSeen).getTime() : 0;
    }
    return sortBy === 'latency' ? leftValue - rightValue : rightValue - leftValue;
  });
  const pageSize = 24;
  const totalPages = Math.max(1, Math.ceil(filteredDevices.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageDevices = filteredDevices.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const onlineCount = devices.filter(d => d.status === 'UP').length;
  const warningCount = devices.filter(d => d.status === 'WARNING').length;
  const offlineCount = devices.filter(d => d.status === 'DOWN').length;

  return (
    <div className="space-y-6 pb-12">
      
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
            Managed Hardware Fleet
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Monitored network inventory with explicitly labelled telemetry sources
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto flex-wrap">
          {/* Subnet Auto-Discover Button */}
          <button 
            onClick={handleStartScan}
            className="px-4 py-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 text-xs font-bold flex items-center gap-2 transition-all shadow-xs cursor-pointer"
          >
            <Radar className="w-4 h-4 text-emerald-600 animate-spin" style={{ animationDuration: '4s' }} /> 
            Discover Approved Subnet
          </button>

          {/* Add Device Button */}
          <button 
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 transition-all shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Add Network Node
          </button>
        </div>
      </div>

      {/* Mini Fleet Stats Pill Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="glass-card-static rounded-xl p-3 border border-slate-200 flex items-center justify-between">
          <span className="text-xs text-slate-500 font-semibold">Total Fleet</span>
          <span className="text-sm font-bold font-mono text-slate-900">{devices.length}</span>
        </div>
        <div className="glass-card-static rounded-xl p-3 border border-slate-200 flex items-center justify-between">
          <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Online
          </span>
          <span className="text-sm font-bold font-mono text-emerald-700">{onlineCount}</span>
        </div>
        <div className="glass-card-static rounded-xl p-3 border border-slate-200 flex items-center justify-between">
          <span className="text-xs text-amber-700 font-semibold flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            Warning
          </span>
          <span className="text-sm font-bold font-mono text-amber-700">{warningCount}</span>
        </div>
        <div className="glass-card-static rounded-xl p-3 border border-slate-200 flex items-center justify-between">
          <span className="text-xs text-rose-700 font-semibold flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            Offline
          </span>
          <span className="text-sm font-bold font-mono text-rose-700">{offlineCount}</span>
        </div>
      </div>

      {/* Main Glass Card Table & Filters */}
      <div className="glass-card-static rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        
        {/* Search & Filter Bar */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/50">
          <div className="relative flex-1 max-w-md">
            <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by name, IP, or location..."
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
              <option value="other">Other / unidentified</option>
            </select>

            <select 
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="bg-white border border-slate-300 text-slate-800 text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-blue-500 cursor-pointer shadow-2xs font-medium"
            >
              <option value="">All Statuses</option>
              <option value="UP">Online (UP)</option>
              <option value="WARNING">Degraded (WARNING)</option>
              <option value="DOWN">Offline (DOWN)</option>
              <option value="UNKNOWN">Unknown</option>
            </select>

            <input
              type="text"
              value={subnetFilter}
              onChange={event => setSubnetFilter(event.target.value)}
              placeholder="Subnet (CIDR or prefix)"
              aria-label="Filter by subnet"
              className="w-36 bg-white border border-slate-300 text-slate-800 text-xs rounded-xl px-3 py-2"
            />

            <select
              value={alertSeverityFilter}
              onChange={event => setAlertSeverityFilter(event.target.value)}
              aria-label="Filter by alert severity"
              className="bg-white border border-slate-300 text-slate-800 text-xs rounded-xl px-3 py-2"
            >
              <option value="">All Alert Severities</option>
              <option value="CRITICAL">Critical alert</option>
              <option value="HIGH">High alert</option>
              <option value="MEDIUM">Medium alert</option>
              <option value="LOW">Low alert</option>
            </select>

            <select
              value={sortBy}
              onChange={event => setSortBy(event.target.value)}
              aria-label="Sort devices"
              className="bg-white border border-slate-300 text-slate-800 text-xs rounded-xl px-3 py-2"
            >
              <option value="name">Name</option>
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

        {/* Device Table */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-4">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="h-52 rounded-2xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : loadError ? (
          <div className="py-16 text-center text-sm text-rose-700">
            <p>{loadError}</p>
            <button type="button" onClick={fetchDevices} className="mt-3 px-4 py-2 rounded-lg border border-rose-300 font-semibold">Retry</button>
          </div>
        ) : filteredDevices.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-xs">
            <Server className="w-10 h-10 text-slate-400 mx-auto mb-3" />
            <p className="font-bold text-slate-700 text-sm">No matching network devices found</p>
            <p className="mt-1">Add a device or run discovery for an administrator-approved subnet.</p>
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
                  <article key={device._id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="w-10 h-10 shrink-0 rounded-xl bg-slate-100 flex items-center justify-center text-sky-600 border border-slate-200">
                          {device.type === 'router' ? <Router className="w-4 h-4" /> :
                            device.type === 'server' ? <Server className="w-4 h-4" /> :
                              <Wifi className="w-4 h-4" />}
                        </div>
                        <div className="min-w-0">
                          <h2 className="truncate text-sm font-bold text-slate-900">{device.name}</h2>
                          <p className="font-mono text-[11px] text-slate-500">{device.ipAddress}</p>
                        </div>
                      </div>
                      <span className={clsx(
                        'shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold uppercase',
                        isUp ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                          isDown ? 'bg-rose-50 text-rose-700 border-rose-200' :
                            'bg-amber-50 text-amber-700 border-amber-200'
                      )}>{device.status || 'UNKNOWN'}</span>
                    </div>

                    <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
                      <MapPin className="h-3.5 w-3.5" />
                      <span className="truncate">{device.location || 'Location unavailable'}</span>
                      <span className="capitalize">· {device.type || 'Unclassified'}</span>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-lg bg-slate-50 p-2">
                        <p className="text-[10px] uppercase text-slate-400">Latency</p>
                        <p className="mt-1 font-mono font-bold text-slate-800">{metric.latency == null ? 'N/A' : `${metric.latency} ms`}</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2">
                        <p className="text-[10px] uppercase text-slate-400">Packet loss</p>
                        <p className="mt-1 font-mono font-bold text-slate-800">{metric.packetLoss == null ? 'N/A' : `${metric.packetLoss}%`}</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2">
                        <p className="text-[10px] uppercase text-slate-400">RX / TX</p>
                        <p className="mt-1 font-mono font-bold text-slate-800">{formatRate(metric.incomingTraffic)} / {formatRate(metric.outgoingTraffic)}</p>
                      </div>
                    </div>

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
                        {device.activeAlertCount || 0} active alert{device.activeAlertCount === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="mt-1 space-y-0.5 text-[10px] text-slate-500">
                      <p>
                        Collection: {device.collectionStatus || metric.collectionStatus || (device.latestMetric ? 'unknown' : 'no_measurements')}
                        {metric.measurementSource ? ` · ${metric.measurementSource}` : ''}
                        {metric.createdAt ? ` · ${format(new Date(metric.createdAt), 'MMM d, HH:mm:ss')}` : ''}
                      </p>
                      {device.collectionReason && (
                        <p className="break-words text-amber-700">{device.collectionReason}</p>
                      )}
                      {device.monitoringAuthorized === false && (
                        <p className="break-words text-amber-700">
                          Real monitoring is not allowlisted. Discovery approval does not authorize continuous monitoring.
                        </p>
                      )}
                      {device.monitoringAuthorized === undefined && (
                        <p className="break-words text-slate-500">Real monitoring authorization status unavailable.</p>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                      <Link
                        to={`/devices/${device._id}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-[11px] font-bold text-sky-700"
                      >
                        View details <ChevronRight className="h-3 w-3" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDeleteDevice(device._id, device.name)}
                        title="Remove device"
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:border-rose-200 hover:text-rose-600"
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
                  <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Previous</button>
                  <button type="button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Next</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Auto-Discovery Scanner Modal */}
      {showScanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl p-6 space-y-5 max-h-[85vh] flex flex-col">
            
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                  <Radar className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Administrator-Approved Subnet Discovery</h3>
                  <p className="text-xs text-slate-500">Only the exact CIDR allowed by server configuration is probed. Device identity is not inferred.</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  scanController.current?.abort();
                  setShowScanModal(false);
                }}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {scanning ? (
              <div className="py-16 text-center space-y-3">
                <div className="w-10 h-10 rounded-full border-2 border-emerald-200 border-t-emerald-600 animate-spin mx-auto" />
                <p className="font-bold text-slate-800 text-sm">Probing the approved subnet...</p>
                <p className="text-xs text-slate-400">Bounded ICMP probes only; no ARP sweep or port scan</p>
              </div>
            ) : scanResults ? (
              <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                  <div>
                    <span className="font-bold text-slate-700">Subnet Target:</span>{' '}
                    <span className="font-mono text-sky-700 font-bold">{scanResults.subnet}</span>
                  </div>
                  <div className="text-slate-500">
                    Found <span className="font-bold text-emerald-700 font-mono">{scanResults.count}</span> responding IP addresses
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
                          "p-3 rounded-xl border flex items-center justify-between transition-all",
                          d.isEnrolled 
                            ? "bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed" 
                            : isSelected 
                            ? "bg-sky-50 border-sky-300 cursor-pointer shadow-2xs" 
                            : "bg-white border-slate-200 hover:border-slate-300 cursor-pointer"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <input 
                            type="checkbox"
                            checked={isSelected}
                            disabled={d.isEnrolled}
                            onChange={() => toggleSelectIp(d.ipAddress)}
                            className="w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500 cursor-pointer"
                          />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 text-xs">{d.name}</span>
                              <span className="font-mono text-[11px] font-bold text-sky-700 px-1.5 py-0.2 rounded bg-sky-50 border border-sky-200">
                                {d.ipAddress}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5 flex items-center gap-2">
                              <span>Identity not verified</span>
                              <span>·</span>
                              <span>{d.location}</span>
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
                            {d.isEnrolled && (
                              <p className={`mt-1 break-words text-[10px] ${
                                d.monitoringAuthorized && d.monitoringStatus ? 'text-emerald-700' : 'text-amber-700'
                              }`}>
                                {!d.monitoringStatus
                                  ? 'Monitoring is paused.'
                                  : d.monitoringAuthorized
                                    ? 'Authorized for real monitoring.'
                                    : d.monitoringAuthorizationReason}
                                {' '}Discovery approval and enrollment do not grant monitoring authorization.
                              </p>
                            )}
                          </div>
                        </div>

                        <div>
                          {d.isEnrolled ? (
                            <span className="text-[10px] font-bold text-slate-500 uppercase px-2 py-0.5 rounded bg-slate-200">
                              Already Enrolled
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-emerald-700 uppercase px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200">
                              Ready to Enroll
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
                  onClick={handleStartScan}
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
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Server className="w-5 h-5 text-sky-600" />
                <h3 className="text-base font-bold text-slate-900">Enroll New Network Node</h3>
              </div>
              <button 
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
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
                  placeholder="e.g. Gateway Core Router 01"
                  value={newDevice.name}
                  onChange={e => setNewDevice({ ...newDevice, name: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">IP Address / Host</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 192.168.26.1 or 8.8.8.8"
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
                    className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-500"
                  >
                    <option value="router">Router</option>
                    <option value="switch">Switch</option>
                    <option value="server">Server</option>
                  </select>
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
                    className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-500"
                  >
                    <option value="icmp">ICMP Ping Only</option>
                    <option value="snmp">ICMP + SNMPv2</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Description / Notes</label>
                <input
                  type="text"
                  placeholder="e.g. Core fiber uplink gateway"
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
