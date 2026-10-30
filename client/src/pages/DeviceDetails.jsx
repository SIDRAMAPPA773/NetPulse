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
  Cpu, 
  HardDrive, 
  AlertTriangle,
  Router,
  ShieldCheck,
  Radio
} from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';

const formatBitRate = (value) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unavailable';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} Gbit/s`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} Mbit/s`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)} kbit/s`;
  return `${value.toFixed(0)} bit/s`;
};

const formatTimestamp = (value) => {
  if (!value) return 'None recorded';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unavailable';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(date);
};

const DeviceDetails = () => {
  const { id } = useParams();
  const [device, setDevice] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [latestCollection, setLatestCollection] = useState(null);
  const [latestSuccessfulMeasurement, setLatestSuccessfulMeasurement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [range, setRange] = useState('1h');

  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      try {
        const [deviceRes, metricsRes, alertsRes] = await Promise.all([
          api.get(`/devices/${id}`),
          api.get(`/devices/${id}/metrics?range=${range}`),
          api.get(`/alerts?device=${id}`)
        ]);
        if (!active) return;
        setDevice(deviceRes.data);
        setMetrics(metricsRes.data);
        setAlerts(alertsRes.data);
        setLatestCollection(deviceRes.data.latestCollection);
        setLatestSuccessfulMeasurement(deviceRes.data.latestSuccessfulMeasurement);
        setLoadError('');
      } catch (error) {
        if (active) {
          console.error('Error fetching device data', error);
          setLoadError('Unable to load device telemetry. Check the connection and try again.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchData();

    const socket = getSocket();
    if (socket) {
      socket.on('deviceUpdated', (updatedDevice) => {
        if (updatedDevice._id === id) setDevice(updatedDevice);
      });
      socket.on('metricAdded', (newMetric) => {
        if (newMetric.device === id) {
          setMetrics(prev => [newMetric, ...prev].slice(0, 50));
          setLatestCollection(newMetric);
          if (newMetric.availabilityStatus === 'available') {
            setLatestSuccessfulMeasurement({
              createdAt: newMetric.createdAt,
              measurementSource: newMetric.measurementSource,
              monitoringMode: newMetric.monitoringMode,
            });
          }
        }
      });
      socket.on('newAlert', (newAlert) => {
        if (newAlert.device?._id === id) setAlerts(prev => [newAlert, ...prev].slice(0, 100));
      });
    }

    return () => {
      active = false;
      if (socket) {
        socket.off('deviceUpdated');
        socket.off('metricAdded');
        socket.off('newAlert');
      }
    };
  }, [id, range]);

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
        <p className="font-bold">{loadError || 'Hardware node not found in registry.'}</p>
        <Link to="/devices" className="text-sky-600 underline text-xs mt-3 inline-block">Back to Fleet</Link>
      </div>
    );
  }

  const chartData = [...metrics].reverse().map(m => ({
    time: format(new Date(m.createdAt), range === '1h' ? 'HH:mm:ss' : 'MMM d HH:mm'),
    latency: m.latency ?? null,
    packetLoss: m.packetLoss ?? null,
    cpu: m.cpuUtilization ?? null,
    memory: m.memoryUtilization ?? null
  }));

  const latestMetric = latestCollection || metrics[0] || {};
  const latestDerived = latestMetric.derived || {};
  const isUp = device.status === 'UP';
  const isDown = device.status === 'DOWN';
  const isAllowlistBlocked = latestMetric.reasonUnavailable === 'Target is not in MONITORING_TARGET_ALLOWLIST';
  const latestSuccessfulSample = latestSuccessfulMeasurement
    || metrics.find(metric => metric.availabilityStatus === 'available');
  const lastSuccessfulAt = latestSuccessfulSample?.createdAt;
  const isLastSuccessfulMeasurementStale = lastSuccessfulAt
    && latestMetric.createdAt
    && new Date(latestMetric.createdAt).getTime() > new Date(lastSuccessfulAt).getTime();
  const collectionExplanation = isAllowlistBlocked
    ? 'No ICMP probe was run because this target is not authorized by MONITORING_TARGET_ALLOWLIST. This is an authorization block, not evidence that the device is unreachable.'
    : latestMetric.collectionStatus === 'timeout' || latestMetric.collectionStatus === 'unreachable'
      ? 'The latest authorized ICMP poll did not receive a response.'
      : latestMetric.reasonUnavailable || (latestMetric.collectionStatus === 'unsupported'
        ? 'The latest telemetry collection is unsupported.'
        : latestMetric.collectionStatus === 'error'
          ? 'The latest telemetry collection failed with an error.'
          : null);

  return (
    <div className="w-full min-w-0 space-y-6 pb-12">
      
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
              <span className="text-slate-500">{device.location || 'Location unavailable'}</span>
            </div>
          </div>
        </div>

        {/* Polling badge */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-600 self-start sm:self-auto font-mono shadow-2xs">
          <Radio className="w-3.5 h-3.5 text-sky-600 animate-pulse" />
          <span>Polling: Every {device.pollingInterval || 10}s</span>
        </div>
      </div>

      {latestMetric.createdAt && (
        <section
          className={`w-full min-w-0 rounded-2xl border p-4 ${
            isAllowlistBlocked
              ? 'border-amber-200 bg-amber-50'
              : latestMetric.availabilityStatus === 'unavailable'
                ? 'border-rose-200 bg-rose-50'
                : 'border-slate-200 bg-white'
          }`}
          role="status"
        >
          <h2 className="text-sm font-bold text-slate-900">Monitoring and data freshness</h2>
          {collectionExplanation && (
            <p className="mt-1 break-words text-sm text-slate-700">{collectionExplanation}</p>
          )}
          <div className="mt-3 grid min-w-0 gap-2 text-xs text-slate-600 sm:grid-cols-2">
            <p className="min-w-0 break-words">
              Latest collection: {latestMetric.measurementSource || 'unknown'} ({latestMetric.collectionStatus || 'unknown'}) at {formatTimestamp(latestMetric.createdAt)}.
            </p>
            <p className="min-w-0 break-words">
              Last successful measurement: {formatTimestamp(lastSuccessfulAt)}
              {latestSuccessfulSample?.measurementSource ? ` (${latestSuccessfulSample.measurementSource})` : ''}
              {isLastSuccessfulMeasurementStale ? ' — stale; newer successful telemetry has not been recorded' : ''}.
            </p>
          </div>
          {Object.keys(latestMetric.derived?.unavailableMetrics || {}).length > 0 && (
            <ul className="mt-3 grid min-w-0 gap-2 text-xs text-slate-600 sm:grid-cols-2">
              {Object.entries(latestMetric.derived.unavailableMetrics).map(([metric, reason]) => (
                <li key={metric} className="min-w-0 break-words">
                  <span className="font-semibold">{metric}:</span> {reason}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* 4 Metric KPI Cards */}
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        
        <div className="glass-card min-w-0 rounded-2xl p-5 border border-slate-200 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-500 font-bold mb-2">
            <span>PING ROUNDTRIP</span>
            <Activity className="w-4 h-4 text-sky-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-extrabold text-slate-900 font-mono">{latestMetric.latency ?? 'Unavailable'}</span>
            {latestMetric.latency !== null && latestMetric.latency !== undefined && <span className="text-xs text-slate-500 font-sans">ms</span>}
          </div>
          <div className="mt-2 text-[11px] text-sky-700 font-semibold">
            {latestMetric.latency === null || latestMetric.latency === undefined
              ? 'No successful RTT sample'
              : latestMetric.latency < 50 ? 'Nominal response time' : 'Elevated response'}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-sky-500" />
        </div>

        <div className="glass-card min-w-0 rounded-2xl p-5 border border-slate-200 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-500 font-bold mb-2">
            <span>PACKET DROP RATE</span>
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-extrabold text-slate-900 font-mono">{latestMetric.packetLoss ?? 'Unavailable'}</span>
            {latestMetric.packetLoss !== null && latestMetric.packetLoss !== undefined && <span className="text-xs text-slate-500 font-sans">%</span>}
          </div>
          <div className="mt-2 text-[11px] text-emerald-700 font-semibold">
            {latestMetric.packetLoss === null || latestMetric.packetLoss === undefined
              ? 'No probe result available'
              : latestMetric.packetLoss === 0 ? 'No loss observed in this probe window' : 'Loss detected'}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-emerald-500" />
        </div>

        <div className="glass-card min-w-0 rounded-2xl p-5 border border-slate-200 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-500 font-bold mb-2">
            <span>CPU UTILIZATION</span>
            <Cpu className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-extrabold text-slate-900 font-mono">{latestMetric.cpuUtilization ?? 'Unavailable'}</span>
            {latestMetric.cpuUtilization !== null && latestMetric.cpuUtilization !== undefined && <span className="text-xs text-slate-500 font-sans">%</span>}
          </div>
          <div className="mt-2 text-[11px] text-indigo-700 font-semibold">
            Only available with a supported SNMP MIB or authorized agent
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-500" />
        </div>

        <div className="glass-card min-w-0 rounded-2xl p-5 border border-slate-200 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-500 font-bold mb-2">
            <span>MEMORY USAGE</span>
            <HardDrive className="w-4 h-4 text-purple-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-extrabold text-slate-900 font-mono">{latestMetric.memoryUtilization ?? 'Unavailable'}</span>
            {latestMetric.memoryUtilization !== null && latestMetric.memoryUtilization !== undefined && <span className="text-xs text-slate-500 font-sans">%</span>}
          </div>
          <div className="mt-2 text-[11px] text-purple-700 font-semibold">
            Only available with a supported SNMP MIB or authorized agent
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-purple-500" />
        </div>

      </div>

      <section className="glass-card-static rounded-2xl border border-slate-200 p-5">
        <h2 className="text-base font-bold text-slate-900">Interface and uptime telemetry</h2>
        <p className="mt-1 text-xs text-slate-500">Interface-specific values require supported SNMP counters and a configured interface index.</p>
        <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['Inbound throughput', formatBitRate(latestMetric.incomingThroughputBps)],
            ['Outbound throughput', formatBitRate(latestMetric.outgoingThroughputBps)],
            ['Device uptime', latestDerived.deviceUptimeSeconds == null ? 'Unavailable' : `${(latestDerived.deviceUptimeSeconds / 3600).toFixed(1)} hours`],
            ['Interface', latestMetric.interfaceId || 'Unavailable'],
            ['Inbound errors', latestDerived.inboundInterfaceErrors ?? 'Unavailable'],
            ['Outbound errors', latestDerived.outboundInterfaceErrors ?? 'Unavailable'],
            ['Inbound drops', latestDerived.inboundDroppedPackets ?? 'Unavailable'],
            ['Outbound drops', latestDerived.outboundDroppedPackets ?? 'Unavailable'],
            ['Inbound utilization', latestDerived.inboundInterfaceUtilizationPercent == null ? 'Unavailable' : `${latestDerived.inboundInterfaceUtilizationPercent.toFixed(2)}%`],
            ['Outbound utilization', latestDerived.outboundInterfaceUtilizationPercent == null ? 'Unavailable' : `${latestDerived.outboundInterfaceUtilizationPercent.toFixed(2)}%`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-slate-50 p-3">
              <p className="break-words text-[10px] font-semibold uppercase text-slate-400">{label}</p>
              <p className="mt-1 break-words font-mono text-xs font-bold text-slate-800">{value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Charts & Hardware Specs Grid */}
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-2">
        
        {/* Latency History Chart */}
        <div className="glass-card-static min-w-0 rounded-2xl p-6 border border-slate-200 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Round-Trip Latency History</h2>
              <p className="text-xs text-slate-500">Streamed ICMP ping latency data points</p>
            </div>
            <select
              value={range}
              onChange={(event) => setRange(event.target.value)}
              className="text-xs font-mono font-bold text-sky-700 px-2 py-1 rounded bg-sky-50 border border-sky-200"
              aria-label="Telemetry history range"
            >
              <option value="1h">1 hour</option>
              <option value="6h">6 hours</option>
              <option value="24h">24 hours</option>
              <option value="7d">7 days</option>
            </select>
          </div>

          <div className="h-72 min-w-0 w-full">
            {chartData.some(point => point.latency !== null) ? <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorLatDev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0284c7" stopOpacity={0.25} />
                    <stop offset="90%" stopColor="#0284c7" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} minTickGap={32} interval="preserveStartEnd" />
                <YAxis dataKey="latency" width={55} stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => `${v}ms`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '0.75rem', fontSize: '12px', color: '#0f172a' }}
                />
                <Area type="monotone" dataKey="latency" connectNulls={false} stroke="#0284c7" strokeWidth={2.5} fillOpacity={1} fill="url(#colorLatDev)" />
              </AreaChart>
            </ResponsiveContainer> : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                No latency observations in this time range.
              </div>
            )}
          </div>
        </div>

        {/* Hardware & SNMP Metadata Card */}
        <div className="glass-card-static min-w-0 rounded-2xl p-6 border border-slate-200 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 mb-1">Node Specifications</h2>
            <p className="text-xs text-slate-500 mb-5">Hardware profile and monitoring metadata</p>

            <div className="space-y-4 text-xs">
              <div className="flex min-w-0 items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <span className="text-slate-500">Node Architecture</span>
                <span className="min-w-0 break-words text-right text-slate-900 font-bold capitalize flex items-center gap-1.5">
                  {device.type === 'router' ? <Router className="w-3.5 h-3.5 text-sky-600" /> : <Server className="w-3.5 h-3.5 text-sky-600" />}
                  {device.type}
                </span>
              </div>

              <div className="flex min-w-0 items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <span className="text-slate-500">Probe Protocol</span>
                <span className="min-w-0 break-words text-right text-sky-700 font-mono font-bold uppercase">{device.monitoringMethod || 'ICMP Ping'}</span>
              </div>

              <div className="flex min-w-0 items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <span className="text-slate-500">SNMP Community</span>
                <span className="min-w-0 break-words text-right text-slate-800 font-mono font-semibold">Protected on server</span>
              </div>

              <div className="flex min-w-0 items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <span className="text-slate-500">Rack / Facility</span>
                <span className="min-w-0 break-words text-right text-slate-900 font-medium">{device.location || 'Location unavailable'}</span>
              </div>

              <div className="flex min-w-0 items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <span className="text-slate-500">Active Polling</span>
                <span className="min-w-0 break-words text-right text-emerald-700 font-bold">{device.monitoringStatus ? 'Enabled' : 'Paused'}</span>
              </div>

              <div className="flex min-w-0 items-center justify-between gap-3">
                <span className="text-slate-500">Last Reachable</span>
                <span className="min-w-0 break-words text-right text-slate-800 font-mono">
                  {device.lastSeen ? formatTimestamp(device.lastSeen) : 'N/A'}
                </span>
              </div>
            </div>
          </div>

        </div>
      </div>

      <section className="glass-card-static w-full min-w-0 rounded-2xl border border-slate-200 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Alert and incident history</h2>
              <p className="text-xs text-slate-500">Most recent 100 incidents for this device</p>
            </div>
            <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700">
              {alerts.filter(alert => alert.status !== 'RESOLVED').length} active
            </span>
          </div>
          {alerts.length === 0 ? (
            <p className="mt-4 text-xs text-slate-500">No incidents recorded for the device.</p>
          ) : (
            <div className="mt-4 divide-y divide-slate-100">
              {alerts.map(alert => (
                <div key={alert._id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-xs font-semibold text-slate-800">{alert.message}</p>
                    <p className="text-[10px] text-slate-500">
                      First: {format(new Date(alert.firstOccurredAt || alert.createdAt), 'MMM d, HH:mm:ss')}
                      {alert.occurrenceCount > 1 ? ` · ${alert.occurrenceCount} occurrences` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-[10px] font-bold uppercase">
                    <span className="text-rose-700">{alert.severity}</span>
                    <span className={alert.status === 'RESOLVED' ? 'text-emerald-700' : 'text-amber-700'}>{alert.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
      </section>

    </div>
  );
};

export default DeviceDetails;
