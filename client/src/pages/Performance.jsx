import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { getSocket } from '../services/socket';
import {
  getDeviceId,
  mapPerformanceSamples,
  summarizePerformanceSamples,
} from '../services/performanceMetrics';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  BarChart, 
  Bar 
} from 'recharts';
import { Activity, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';

const Performance = () => {
  const [samples, setSamples] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [range, setRange] = useState('1h');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  useEffect(() => {
    let active = true;
    api.get('/devices')
      .then(({ data }) => {
        if (active) setDevices(data);
      })
      .catch(error => {
        console.error('Failed to load devices for performance view', error);
        if (active) setLoadError('Unable to load device inventory for performance status.');
      });

    const socket = getSocket();
    if (socket) {
      socket.on('deviceUpdated', updatedDevice => {
        setDevices(previous => previous.map(device => device._id === updatedDevice._id
          ? { ...device, ...updatedDevice }
          : device));
      });
      socket.on('metricAdded', metric => {
        const deviceId = getDeviceId(metric.device);
        setDevices(previous => previous.map(device => device._id === deviceId ? {
          ...device,
          latestMetric: metric,
          collectionStatus: metric.collectionStatus || 'unknown',
          collectionReason: metric.reasonUnavailable || null,
        } : device));
        if (selectedDeviceId && selectedDeviceId !== deviceId) return;
        const cutoff = Date.now() - ({
          '1h': 60 * 60 * 1000,
          '6h': 6 * 60 * 60 * 1000,
          '24h': 24 * 60 * 60 * 1000,
          '7d': 7 * 24 * 60 * 60 * 1000,
        }[range]);
        if (new Date(metric.createdAt).getTime() < cutoff) return;
        setSamples(previous => [
          ...previous.filter(sample => sample._id !== metric._id),
          metric,
        ].sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt)).slice(-500));
      });
    }

    return () => {
      active = false;
      if (socket) {
        socket.off('deviceUpdated');
        socket.off('metricAdded');
      }
    };
  }, [range, selectedDeviceId]);

  useEffect(() => {
    let active = true;
    const fetchPerformance = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams({ range });
      if (selectedDeviceId) params.set('device', selectedDeviceId);
      const res = await api.get(`/analytics/performance?${params.toString()}`);
      if (active) setSamples(res.data);
    } catch (error) {
      console.error('Failed to load performance telemetry', error);
      if (active) {
        setSamples([]);
        setLoadError('Unable to load performance telemetry. Check the connection and try again.');
      }
    } finally {
      if (active) setLoading(false);
    }
    };
    fetchPerformance();
    return () => {
      active = false;
    };
  }, [range, selectedDeviceId]);

  const metrics = mapPerformanceSamples(samples, devices).map(sample => ({
    ...sample,
    time: format(new Date(sample.createdAt), range === '1h' ? 'HH:mm:ss' : 'MMM d HH:mm'),
  }));
  const summary = summarizePerformanceSamples(metrics);
  const chartMetrics = metrics.slice(-100);

  return (
    <div className="space-y-6 pb-12">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
            Performance & Health Telemetry
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Saved RTT and packet-loss samples with device identity and measurement source
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="performance-device">Filter by device</label>
          <select
            id="performance-device"
            value={selectedDeviceId}
            onChange={event => setSelectedDeviceId(event.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
          >
            <option value="">All enrolled devices</option>
            {devices.map(device => (
              <option key={device._id} value={device._id}>{device.name} ({device.ipAddress})</option>
            ))}
          </select>
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200 self-start sm:self-auto">
            {[
              { id: '1h', label: '1 Hour' },
              { id: '6h', label: '6 Hours' },
              { id: '24h', label: '24 Hours' },
              { id: '7d', label: '7 Days' },
            ].map(item => (
              <button
                key={item.id}
                onClick={() => setRange(item.id)}
                className={clsx(
                  "px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer",
                  range === item.id
                    ? "bg-white text-sky-700 shadow-xs border border-slate-200/80"
                    : "text-slate-500 hover:text-slate-900"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card rounded-2xl p-4 border border-slate-200">
          <span className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Average RTT</span>
          <div className="text-2xl font-extrabold font-mono text-slate-900 mt-1">{summary.averageLatency ?? 'Unavailable'}{summary.averageLatency !== null && <span className="text-xs font-sans text-slate-400"> ms</span>}</div>
          <div className="text-[11px] text-sky-700 font-medium mt-1">Average of available RTT samples</div>
        </div>
        <div className="glass-card rounded-2xl p-4 border border-slate-200">
          <span className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Min Response</span>
          <div className="text-2xl font-extrabold font-mono text-emerald-700 mt-1">{summary.minimumLatency ?? 'Unavailable'}{summary.minimumLatency !== null && <span className="text-xs font-sans text-slate-400"> ms</span>}</div>
          <div className="text-[11px] text-emerald-700 font-medium mt-1">Best-case roundtrip</div>
        </div>
        <div className="glass-card rounded-2xl p-4 border border-slate-200">
          <span className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Peak Spike</span>
          <div className="text-2xl font-extrabold font-mono text-amber-700 mt-1">{summary.maximumLatency ?? 'Unavailable'}{summary.maximumLatency !== null && <span className="text-xs font-sans text-slate-400"> ms</span>}</div>
          <div className="text-[11px] text-amber-700 font-medium mt-1">Observed peak value</div>
        </div>
        <div className="glass-card rounded-2xl p-4 border border-slate-200">
          <span className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Mean Packet Loss</span>
          <div className="text-2xl font-extrabold font-mono text-slate-900 mt-1">{summary.averagePacketLoss ?? 'Unavailable'}{summary.averagePacketLoss !== null && <span className="text-xs font-sans text-slate-400">%</span>}</div>
          <div className="text-[11px] text-rose-700 font-medium mt-1">{summary.averagePacketLoss === null ? 'No packet-loss samples' : 'Average of available probe samples'}</div>
        </div>
      </div>

      {/* Charts Grid */}
      {loading ? (
        <div className="py-24 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
          <div className="w-8 h-8 rounded-full border-2 border-sky-200 border-t-sky-600 animate-spin" />
          <span>Crunching historical telemetry metrics...</span>
        </div>
      ) : loadError ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{loadError}</div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          
          {/* Latency Stream Chart */}
          <div className="glass-card-static rounded-2xl p-6 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-sky-600" />
                  {selectedDeviceId ? 'Device Latency' : 'Fleet Latency Samples'}
                </h2>
                <p className="text-xs text-slate-500">RTT measurements; simulation-labelled samples remain identified as simulated</p>
              </div>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                Range: {range.toUpperCase()}
              </span>
            </div>

            <div className="h-72 w-full">
              {chartMetrics.some(metric => metric.latency !== null) ? <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartMetrics} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="perfLatGlow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0284c7" stopOpacity={0.25} />
                      <stop offset="90%" stopColor="#0284c7" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} minTickGap={32} interval="preserveStartEnd" />
                  <YAxis width={55} stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => `${v}ms`} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '0.75rem', fontSize: '12px', color: '#0f172a' }}
                    formatter={(value, name, item) => [
                      value == null ? 'Unavailable' : `${value} ms`,
                      `${item.payload.ipAddress} · ${item.payload.measurementSource || 'unknown source'} · ${name}`,
                    ]}
                  />
                  <Area type="monotone" dataKey="latency" stroke="#0284c7" strokeWidth={2.5} fillOpacity={1} fill="url(#perfLatGlow)" />
                </AreaChart>
              </ResponsiveContainer> : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  No latency measurements are available in this range.
                </div>
              )}
            </div>
          </div>

          {/* Packet Loss Bar Chart */}
          <div className="glass-card-static rounded-2xl p-6 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-600" />
                  Packet Loss & Drop Rates
                </h2>
                <p className="text-xs text-slate-500">Percentage dropped packets per probe sample</p>
              </div>
            </div>

            <div className="h-64 w-full">
              {chartMetrics.some(metric => metric.packetLoss !== null) ? <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartMetrics} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} minTickGap={32} interval="preserveStartEnd" />
                  <YAxis width={55} stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '0.75rem', fontSize: '12px', color: '#0f172a' }}
                    formatter={(value, name, item) => [
                      value == null ? 'Unavailable' : `${value}%`,
                      `${item.payload.ipAddress} · ${item.payload.measurementSource || 'unknown source'} · ${name}`,
                    ]}
                  />
                  <Bar dataKey="packetLoss" fill="#e11d48" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer> : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  No packet-loss measurements are available in this range.
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      <section className="glass-card-static overflow-hidden rounded-2xl border border-slate-200">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-slate-900">Enrolled device collection status</h2>
          <p className="mt-1 text-xs text-slate-500">
            Devices remain listed even when monitoring is paused, authorization is missing, or no measurement has been recorded.
          </p>
        </div>
        {devices.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No enrolled devices are available.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Device / IP</th>
                  <th className="px-4 py-3">Device status</th>
                  <th className="px-4 py-3">Collection</th>
                  <th className="px-4 py-3">RTT</th>
                  <th className="px-4 py-3">Packet loss</th>
                  <th className="px-4 py-3">Last successful measurement</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {devices.map(device => {
                  const metric = device.latestMetric || {};
                  return (
                    <tr key={device._id} className={selectedDeviceId === device._id ? 'bg-sky-50/60' : 'bg-white'}>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-800">{device.name}</div>
                        <div className="mt-0.5 font-mono text-slate-500">{device.ipAddress}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-700">{device.status || 'UNKNOWN'}</div>
                        <div className="mt-0.5 text-slate-500">{device.monitoringStatus ? 'Polling enabled' : 'Polling paused'}</div>
                      </td>
                      <td className="max-w-xs px-4 py-3">
                        <div className="font-semibold text-slate-700">{device.collectionStatus || 'no_measurements'}</div>
                        <div className="mt-0.5 break-words text-amber-700">
                          {device.monitoringAuthorized === false
                            ? device.monitoringAuthorizationReason || 'Not authorized for real monitoring'
                            : device.monitoringAuthorized === true
                              ? device.collectionReason || metric.measurementSource || 'No measurement source'
                              : device.collectionReason || 'Monitoring authorization status unavailable'}
                        </div>
                        {metric.createdAt && (
                          <div className="mt-1 text-slate-500">
                            Last collection: {format(new Date(metric.createdAt), 'MMM d, yyyy HH:mm:ss')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono">{metric.latency == null ? 'Unavailable' : `${metric.latency} ms`}</td>
                      <td className="px-4 py-3 font-mono">{metric.packetLoss == null ? 'Unavailable' : `${metric.packetLoss}%`}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {device.latestSuccessfulMeasurement
                          ? format(new Date(device.latestSuccessfulMeasurement.createdAt), 'MMM d, yyyy HH:mm:ss')
                          : 'None recorded'}
                        {device.latestSuccessfulMeasurement?.measurementSource && (
                          <div className="mt-0.5">{device.latestSuccessfulMeasurement.measurementSource}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setSelectedDeviceId(selectedDeviceId === device._id ? '' : device._id)}
                            className="font-semibold text-sky-700 underline"
                          >
                            {selectedDeviceId === device._id ? 'Clear filter' : 'View samples'}
                          </button>
                          <Link to={`/devices/${device._id}`} className="font-semibold text-slate-600 underline">Details</Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  );
};

export default Performance;
