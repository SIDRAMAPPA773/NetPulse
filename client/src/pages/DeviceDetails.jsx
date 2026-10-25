import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer
} from 'recharts';
import { 
  ArrowLeft, 
  Server, 
  Activity, 
  Clock, 
  MapPin, 
  Zap, 
  Cpu, 
  HardDrive, 
  AlertTriangle,
  CheckCircle,
  Router,
  Wifi,
  ShieldCheck,
  Radio
} from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';

const DeviceDetails = () => {
  const { id } = useParams();
  const [device, setDevice] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();

    const socket = getSocket();
    if (socket) {
      socket.on('deviceUpdated', (updatedDevice) => {
        if (updatedDevice._id === id) setDevice(updatedDevice);
      });
      socket.on('metricAdded', (newMetric) => {
        if (newMetric.device === id) {
          setMetrics(prev => [newMetric, ...prev].slice(0, 50));
        }
      });
    }

    return () => {
      if (socket) {
        socket.off('deviceUpdated');
        socket.off('metricAdded');
      }
    };
  }, [id]);

  const fetchData = async () => {
    try {
      const [deviceRes, metricsRes] = await Promise.all([
        api.get(`/devices/${id}`),
        api.get(`/devices/${id}/metrics`)
      ]);
      setDevice(deviceRes.data);
      setMetrics(metricsRes.data);
    } catch (error) {
      console.error('Error fetching device data', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3">
        <div className="w-10 h-10 rounded-full border-2 border-sky-200 border-t-sky-600 animate-spin" />
        <p className="text-xs text-slate-500 font-medium">Loading hardware telemetry...</p>
      </div>
    );
  }

  if (!device) {
    return (
      <div className="p-8 text-center text-rose-700 glass-card-static rounded-2xl border border-rose-200 bg-rose-50">
        <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-rose-600" />
        <p className="font-bold">Hardware node not found in registry.</p>
        <Link to="/devices" className="text-sky-600 underline text-xs mt-3 inline-block">Back to Fleet</Link>
      </div>
    );
  }

  const chartData = [...metrics].reverse().map(m => ({
    time: format(new Date(m.createdAt), 'HH:mm:ss'),
    latency: m.latency || 0,
    packetLoss: m.packetLoss || 0,
    cpu: m.cpuUtilization || 0,
    memory: m.memoryUtilization || 0
  }));

  const latestMetric = metrics[0] || {};
  const isUp = device.status === 'UP';
  const isDown = device.status === 'DOWN';

  return (
    <div className="space-y-6 pb-12">
      
      {/* Top Breadcrumb & Device Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link 
            to="/devices" 
            className="p-2.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 transition-colors shadow-2xs"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>

          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                {device.name}
              </h1>
              
              <span className={clsx(
                "px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase flex items-center gap-1.5 border",
                isUp ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                isDown ? "bg-rose-50 text-rose-700 border-rose-200" :
                "bg-amber-50 text-amber-700 border-amber-200"
              )}>
                <span className={clsx(
                  "w-1.5 h-1.5 rounded-full",
                  isUp ? "bg-emerald-500 animate-pulse" :
                  isDown ? "bg-rose-500" : "bg-amber-500"
                )} />
                {device.status}
              </span>
            </div>

            <div className="flex items-center gap-3 mt-1 text-xs">
              <span className="font-mono text-slate-800 font-bold px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
                {device.ipAddress}
              </span>
              <span className="text-slate-500 capitalize">{device.type}</span>
              <span className="text-slate-300">•</span>
              <span className="text-slate-500">{device.location || 'Server Rack'}</span>
            </div>
          </div>
        </div>

        {/* Polling badge */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-600 self-start sm:self-auto font-mono shadow-2xs">
          <Radio className="w-3.5 h-3.5 text-sky-600 animate-pulse" />
          <span>Polling: Every {device.pollingInterval || 10}s</span>
        </div>
      </div>

      {/* 4 Metric KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        
        <div className="glass-card rounded-2xl p-5 border border-slate-200 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-500 font-bold mb-2">
            <span>PING ROUNDTRIP</span>
            <Activity className="w-4 h-4 text-sky-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-extrabold text-slate-900 font-mono">{latestMetric.latency || 0}</span>
            <span className="text-xs text-slate-500 font-sans">ms</span>
          </div>
          <div className="mt-2 text-[11px] text-sky-700 font-semibold">
            {latestMetric.latency && latestMetric.latency < 50 ? 'Nominal response time' : 'Elevated response'}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-sky-500" />
        </div>

        <div className="glass-card rounded-2xl p-5 border border-slate-200 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-500 font-bold mb-2">
            <span>PACKET DROP RATE</span>
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-extrabold text-slate-900 font-mono">{latestMetric.packetLoss || 0}</span>
            <span className="text-xs text-slate-500 font-sans">%</span>
          </div>
          <div className="mt-2 text-[11px] text-emerald-700 font-semibold">
            {latestMetric.packetLoss === 0 ? 'Optimal (0 drops)' : 'Loss detected'}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-emerald-500" />
        </div>

        <div className="glass-card rounded-2xl p-5 border border-slate-200 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-500 font-bold mb-2">
            <span>CPU UTILIZATION</span>
            <Cpu className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-extrabold text-slate-900 font-mono">{latestMetric.cpuUtilization || 0}</span>
            <span className="text-xs text-slate-500 font-sans">%</span>
          </div>
          <div className="mt-2 text-[11px] text-indigo-700 font-semibold">
            Load capacity standard
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-500" />
        </div>

        <div className="glass-card rounded-2xl p-5 border border-slate-200 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-500 font-bold mb-2">
            <span>MEMORY USAGE</span>
            <HardDrive className="w-4 h-4 text-purple-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-extrabold text-slate-900 font-mono">{latestMetric.memoryUtilization || 0}</span>
            <span className="text-xs text-slate-500 font-sans">%</span>
          </div>
          <div className="mt-2 text-[11px] text-purple-700 font-semibold">
            Buffer headroom normal
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-purple-500" />
        </div>

      </div>

      {/* Charts & Hardware Specs Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Latency History Chart */}
        <div className="glass-card-static rounded-2xl p-6 border border-slate-200 lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Round-Trip Latency History</h2>
              <p className="text-xs text-slate-500">Streamed ICMP ping latency data points</p>
            </div>
            <span className="text-xs font-mono font-bold text-sky-700 px-2 py-0.5 rounded bg-sky-50 border border-sky-200">
              Live Feed
            </span>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorLatDev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0284c7" stopOpacity={0.25} />
                    <stop offset="90%" stopColor="#0284c7" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis dataKey="latency" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `${v}ms`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '0.75rem', fontSize: '12px', color: '#0f172a' }}
                />
                <Area type="monotone" dataKey="latency" stroke="#0284c7" strokeWidth={2.5} fillOpacity={1} fill="url(#colorLatDev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Hardware & SNMP Metadata Card */}
        <div className="glass-card-static rounded-2xl p-6 border border-slate-200 lg:col-span-4 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 mb-1">Node Specifications</h2>
            <p className="text-xs text-slate-500 mb-5">Hardware profile and monitoring metadata</p>

            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <span className="text-slate-500">Node Architecture</span>
                <span className="text-slate-900 font-bold capitalize flex items-center gap-1.5">
                  {device.type === 'router' ? <Router className="w-3.5 h-3.5 text-sky-600" /> : <Server className="w-3.5 h-3.5 text-sky-600" />}
                  {device.type}
                </span>
              </div>

              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <span className="text-slate-500">Probe Protocol</span>
                <span className="text-sky-700 font-mono font-bold uppercase">{device.monitoringMethod || 'ICMP Ping'}</span>
              </div>

              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <span className="text-slate-500">SNMP Community</span>
                <span className="text-slate-800 font-mono font-semibold">{device.snmpCommunity || 'public'}</span>
              </div>

              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <span className="text-slate-500">Rack / Facility</span>
                <span className="text-slate-900 font-medium">{device.location || 'Server Room'}</span>
              </div>

              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <span className="text-slate-500">Active Polling</span>
                <span className="text-emerald-700 font-bold">{device.monitoringStatus ? 'Enabled' : 'Paused'}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-500">Last Reachable</span>
                <span className="text-slate-800 font-mono">
                  {device.lastSeen ? format(new Date(device.lastSeen), 'HH:mm:ss') : 'N/A'}
                </span>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-slate-100 mt-6">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-500">
              <span className="font-bold text-slate-800 block mb-1">Probe Status:</span>
              Telemetry stream transmitting packets every 10 seconds via ICMP Echo Request.
            </div>
          </div>
        </div>

      </div>

    </div>
  );
};

export default DeviceDetails;
