import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { 
  Search, 
  Plus, 
  Server, 
  Trash2, 
  CheckCircle, 
  AlertTriangle, 
  XCircle, 
  ChevronRight,
  Router,
  Wifi,
  MapPin,
  X,
  Filter,
  RefreshCw,
  Activity
} from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';

const Devices = () => {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newDevice, setNewDevice] = useState({
    name: '',
    ipAddress: '',
    type: 'router',
    location: '',
    description: '',
    monitoringMethod: 'icmp',
    snmpCommunity: 'public'
  });

  useEffect(() => {
    fetchDevices();

    const socket = getSocket();
    if (socket) {
      socket.on('deviceUpdated', (updatedDevice) => {
        setDevices(prev => prev.map(d => d._id === updatedDevice._id ? updatedDevice : d));
      });
    }

    return () => {
      if (socket) socket.off('deviceUpdated');
    };
  }, []);

  const fetchDevices = async () => {
    setLoading(true);
    try {
      const res = await api.get('/devices');
      setDevices(res.data);
    } catch (error) {
      console.error('Failed to fetch devices', error);
    } finally {
      setLoading(false);
    }
  };

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
        snmpCommunity: 'public'
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

  const filteredDevices = devices.filter(d => {
    const matchesSearch = 
      d.name.toLowerCase().includes(search.toLowerCase()) || 
      d.ipAddress.includes(search) ||
      (d.location && d.location.toLowerCase().includes(search.toLowerCase()));

    const matchesType = !typeFilter || d.type === typeFilter;
    const matchesStatus = !statusFilter || d.status === statusFilter;

    return matchesSearch && matchesType && matchesStatus;
  });

  const onlineCount = devices.filter(d => d.status === 'UP').length;
  const warningCount = devices.filter(d => d.status === 'WARNING').length;
  const offlineCount = devices.filter(d => d.status === 'DOWN').length;

  return (
    <div className="space-y-6 pb-12">
      
      {/* Top Header & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
            Managed Hardware Fleet
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Real-time ping telemetry, network nodes, and core routing inventory
          </p>
        </div>

        <button 
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 transition-all shadow-sm cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" /> Add Network Node
        </button>
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
          <div className="py-20 text-center text-xs text-slate-400">Loading device registry...</div>
        ) : filteredDevices.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-xs">
            <Server className="w-10 h-10 text-slate-400 mx-auto mb-3" />
            <p className="font-bold text-slate-700 text-sm">No matching network devices found</p>
            <p className="mt-1">Try modifying your search or click "Add Network Node" above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-[11px] font-bold uppercase tracking-wider border-b border-slate-200">
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5">Device Identifier</th>
                  <th className="px-5 py-3.5">Network IP</th>
                  <th className="px-5 py-3.5">Hardware Role</th>
                  <th className="px-5 py-3.5">Physical Location</th>
                  <th className="px-5 py-3.5">Telemetry Ping</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredDevices.map(device => {
                  const isUp = device.status === 'UP';
                  const isDown = device.status === 'DOWN';

                  return (
                    <tr key={device._id} className="hover:bg-slate-50/80 transition-colors group">
                      <td className="px-5 py-3.5">
                        <span className={clsx(
                          "px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase flex items-center w-fit gap-1.5 border",
                          isUp ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                          isDown ? "bg-rose-50 text-rose-700 border-rose-200" :
                          "bg-amber-50 text-amber-700 border-amber-200"
                        )}>
                          <span className={clsx(
                            "w-1.5 h-1.5 rounded-full",
                            isUp ? "bg-emerald-500 animate-pulse" :
                            isDown ? "bg-rose-500 animate-pulse" : "bg-amber-500"
                          )} />
                          {device.status}
                        </span>
                      </td>

                      <td className="px-5 py-3.5 font-bold text-slate-900">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-sky-600 border border-slate-200">
                            {device.type === 'router' ? <Router className="w-3.5 h-3.5" /> :
                             device.type === 'server' ? <Server className="w-3.5 h-3.5" /> :
                             <Wifi className="w-3.5 h-3.5" />}
                          </div>
                          <div>
                            <span>{device.name}</span>
                            {device.description && (
                              <p className="text-[10px] text-slate-400 font-normal">{device.description}</p>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-3.5 font-mono">
                        <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-800 font-bold text-[11px]">
                          {device.ipAddress}
                        </span>
                      </td>

                      <td className="px-5 py-3.5 text-slate-600 capitalize font-medium">
                        {device.type}
                      </td>

                      <td className="px-5 py-3.5 text-slate-500">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{device.location || 'Server Rack A'}</span>
                        </div>
                      </td>

                      <td className="px-5 py-3.5 font-mono text-slate-500 text-[11px]">
                        {device.lastSeen ? format(new Date(device.lastSeen), 'MMM d, HH:mm:ss') : 'Never'}
                      </td>

                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link 
                            to={`/devices/${device._id}`}
                            className="px-3 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-[11px] font-bold transition-all inline-flex items-center gap-1"
                          >
                            Details <ChevronRight className="w-3 h-3" />
                          </Link>
                          
                          <button
                            onClick={() => handleDeleteDevice(device._id, device.name)}
                            title="Delete Node"
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200 hover:border-rose-200 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
                    placeholder="e.g. 192.168.1.1 or 8.8.8.8"
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
