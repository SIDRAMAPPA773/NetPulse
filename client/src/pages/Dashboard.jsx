import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell 
} from 'recharts';
import { 
  Activity, 
  Server, 
  AlertCircle, 
  CheckCircle, 
  Clock, 
  ArrowUpRight, 
  ArrowDownRight,
  ShieldCheck,
  Router,
  Wifi,
  ChevronRight,
  Zap
} from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';

const MetricCard = ({ title, value, unit, icon: Icon, colorTheme, subtitle, trend, trendGood }) => {
  const themes = {
    cyan: {
      border: 'border-slate-200 hover:border-sky-300',
      iconBg: 'bg-sky-50 text-sky-600 border border-sky-200/80',
      bar: 'bg-gradient-to-r from-sky-500 to-blue-600',
      badge: 'bg-sky-50 text-sky-700 border-sky-200',
    },
    emerald: {
      border: 'border-slate-200 hover:border-emerald-300',
      iconBg: 'bg-emerald-50 text-emerald-600 border border-emerald-200/80',
      bar: 'bg-gradient-to-r from-emerald-500 to-teal-500',
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    amber: {
      border: 'border-slate-200 hover:border-amber-300',
      iconBg: 'bg-amber-50 text-amber-600 border border-amber-200/80',
      bar: 'bg-gradient-to-r from-amber-500 to-orange-500',
      badge: 'bg-amber-50 text-amber-800 border-amber-200',
    },
    rose: {
      border: 'border-slate-200 hover:border-rose-300',
      iconBg: 'bg-rose-50 text-rose-600 border border-rose-200/80',
      bar: 'bg-gradient-to-r from-rose-500 to-red-600',
      badge: 'bg-rose-50 text-rose-700 border-rose-200',
    }
  };

  const currentTheme = themes[colorTheme] || themes.cyan;

  return (
    <div className={clsx(
      "glass-card rounded-2xl p-6 relative overflow-hidden flex flex-col justify-between transition-all duration-300 group",
      currentTheme.border
    )}>
      {/* Top row */}
      <div className="flex justify-between items-start mb-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</span>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight font-mono">{value}</span>
            {unit && <span className="text-sm font-semibold text-slate-500 font-sans">{unit}</span>}
          </div>
        </div>
        <div className={clsx("p-3 rounded-xl transition-transform duration-300 group-hover:scale-110", currentTheme.iconBg)}>
          <Icon className="w-6 h-6" />
        </div>
      </div>

      {/* Bottom details & trend */}
      <div className="flex items-center justify-between text-xs pt-3 border-t border-slate-100 mt-2">
        <span className="text-slate-500 font-medium">{subtitle}</span>
        {trend && (
          <span className={clsx("px-2 py-0.5 rounded-full border text-[11px] font-bold flex items-center gap-1", currentTheme.badge)}>
            {trendGood ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {trend}
          </span>
        )}
      </div>

      {/* Accent line */}
      <div className={clsx("absolute bottom-0 left-0 right-0 h-1", currentTheme.bar)} />
    </div>
  );
};

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-slate-200 p-3 rounded-xl shadow-xl text-xs space-y-1">
        <p className="text-slate-500 font-mono font-medium">{label}</p>
        <p className="text-sky-600 font-bold font-mono text-sm flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-sky-600" />
          Latency: {payload[0].value} ms
        </p>
        <p className="text-slate-500">Source: {payload[0].payload.measurementSource}</p>
      </div>
    );
  }
  return null;
};

const Dashboard = () => {
  const [summary, setSummary] = useState(null);
  const [devices, setDevices] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [latencyData, setLatencyData] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('1h');

  const fetchDashboardData = useCallback(async () => {
    try {
      const [summaryRes, devicesRes, alertsRes] = await Promise.all([
        api.get('/dashboard/summary'),
        api.get('/devices'),
        api.get('/alerts')
      ]);
      setSummary(summaryRes.data);
      setDevices(devicesRes.data);
      setAlerts(alertsRes.data.slice(0, 6));
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();

    const socket = getSocket();
    if (socket) {
      socket.on('deviceUpdated', (device) => {
        setDevices(prev => prev.map(d => d._id === device._id ? device : d));
        fetchDashboardData();
      });
      socket.on('newAlert', (alert) => {
        setAlerts(prev => [alert, ...prev].slice(0, 6));
      });
    }

    return () => {
      if (socket) {
        socket.off('deviceUpdated');
        socket.off('newAlert');
      }
    };
  }, [fetchDashboardData]);

  useEffect(() => {
    let active = true;
    api.get(`/analytics/performance?range=${timeRange}`)
      .then(({ data }) => {
        if (!active) return;
        const points = data
          .filter(metric => metric.latency !== null && metric.latency !== undefined)
          .slice(-24)
          .map(metric => ({
            time: format(new Date(metric.createdAt), 'MMM d HH:mm'),
            latency: metric.latency,
            measurementSource: metric.measurementSource || 'unknown',
          }));
        setLatencyData(points);
      })
      .catch(error => {
        console.error('Error fetching latency history:', error);
        if (active) setLatencyData([]);
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });

    return () => {
      active = false;
    };
  }, [timeRange]);

  if (!summary) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="relative">
          <div className="w-12 h-12 rounded-full border-2 border-sky-200 border-t-sky-600 animate-spin" />
          <Zap className="w-5 h-5 text-sky-600 absolute inset-0 m-auto" />
        </div>
        <p className="text-slate-500 text-sm font-medium tracking-wide">Connecting to Telemetry Feed...</p>
      </div>
    );
  }

  const hasHealthInputs = summary.avgPacketLoss !== null && summary.avgLatency !== null;
  const healthScore = hasHealthInputs ? Math.max(0, Math.min(100, Math.round(
    100 - (summary.offlineDevices * 10) - (summary.avgPacketLoss * 2) - (summary.avgLatency > 80 ? 15 : 0)
  ))) : null;
  const healthGrade = healthScore === null ? 'NO DATA' : healthScore >= 90 ? 'OPTIMAL' : healthScore >= 75 ? 'DEGRADED' : 'CRITICAL';
  const healthColor = healthScore === null ? '#94a3b8' : healthScore >= 90 ? '#059669' : healthScore >= 75 ? '#d97706' : '#e11d48';

  return (
    <div className="space-y-8 pb-12">
      
      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <MetricCard
          title="Monitored Fleet"
          value={summary.totalDevices}
          unit="Nodes"
          subtitle={`${summary.monitoringDevices} with polling enabled`}
          icon={Server}
          colorTheme="cyan"
          trend={`${Math.round((summary.monitoringDevices / Math.max(1, summary.totalDevices)) * 100)}% enabled`}
          trendGood={summary.monitoringDevices === summary.totalDevices}
        />
        <MetricCard
          title="Nodes Reachable"
          value={summary.reachableDevices}
          unit={`/ ${summary.totalDevices}`}
          subtitle={`${summary.offlineDevices} offline, ${summary.unknownDevices} unknown`}
          icon={CheckCircle}
          colorTheme="emerald"
          trend={`${Math.round((summary.reachableDevices / Math.max(1, summary.totalDevices)) * 100)}% reachable`}
          trendGood={summary.offlineDevices === 0}
        />
        <MetricCard
          title="Average Latency"
          value={summary.avgLatency ?? 'Unavailable'}
          unit={summary.avgLatency === null ? '' : 'ms'}
          subtitle="Mean round-trip time"
          icon={Activity}
          colorTheme="amber"
          trend={summary.avgLatency === null ? 'No sample' : summary.avgLatency < 50 ? 'Sub-50ms' : 'Elevated'}
          trendGood={summary.avgLatency !== null && summary.avgLatency < 50}
        />
        <MetricCard
          title="Packet Drop Rate"
          value={summary.avgPacketLoss ?? 'Unavailable'}
          unit={summary.avgPacketLoss === null ? '' : '%'}
          subtitle="Mean over latest valid observations"
          icon={AlertCircle}
          colorTheme={summary.avgPacketLoss !== null && summary.avgPacketLoss > 2 ? 'rose' : 'emerald'}
          trend={summary.avgPacketLoss === null ? 'No sample' : summary.avgPacketLoss === 0 ? 'No loss observed' : 'Loss detected'}
          trendGood={summary.avgPacketLoss !== null && summary.avgPacketLoss === 0}
        />
      </div>

      {/* Middle Row: Health Gauge + Latency Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Network Health Index Gauge */}
        <div className="glass-card-static rounded-2xl p-6 lg:col-span-4 flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-sky-600" />
                Network Health Index
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">Heuristic indicator, not an SLA</p>
            </div>
            <span className={clsx(
              "px-2.5 py-1 text-[11px] font-bold tracking-wider uppercase rounded-full border",
              healthScore === null ? "bg-slate-50 text-slate-600 border-slate-200" :
              healthScore >= 90 ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
              healthScore >= 75 ? "bg-amber-50 text-amber-800 border-amber-200" :
              "bg-rose-50 text-rose-700 border-rose-200"
            )}>
              {healthGrade}
            </span>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
            Formula: 100 − 10 × offline devices − 2 × average packet loss − 15 when latency exceeds 80 ms, clamped to 0–100. Unknown devices are excluded.
          </p>

          {/* Donut Gauge */}
          <div className="relative w-48 h-48 mx-auto my-4 flex items-center justify-center">
            {healthScore !== null && (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[{ value: healthScore }, { value: 100 - healthScore }]}
                    cx="50%"
                    cy="50%"
                    innerRadius={68}
                    outerRadius={84}
                    startAngle={90}
                    endAngle={-270}
                    dataKey="value"
                    stroke="none"
                  >
                    <Cell fill={healthColor} />
                    <Cell fill="#f1f5f9" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            )}
            
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-3xl font-black text-slate-900 font-mono tracking-tight">{healthScore ?? 'N/A'}</span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">SCORE / 100</span>
            </div>
          </div>

          {/* Diagnostic Sub-metrics */}
          <div className="space-y-2.5 pt-4 border-t border-slate-100 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">Reachable in last poll</span>
              <span className="text-slate-700 font-mono font-bold">{summary.reachableDevices} / {summary.totalDevices}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">Measurement source</span>
              <span className="text-sky-700 font-mono font-bold uppercase">{summary.measurementSource}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">Offline / unknown nodes</span>
              <span className={clsx("font-mono font-bold", summary.offlineDevices > 0 ? "text-rose-600" : "text-slate-700")}>
                {summary.offlineDevices} / {summary.unknownDevices}
              </span>
            </div>
          </div>
        </div>

        {/* Live Latency Telemetry Chart */}
        <div className="glass-card-static rounded-2xl p-6 lg:col-span-8 flex flex-col justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
            <div>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-600"></span>
                </span>
                <h2 className="text-base font-bold text-slate-900">Observed Round-Trip Latency</h2>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Stored observations; source is available in the tooltip</p>
            </div>

            {/* Range Pills */}
            <div className="flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200 self-start sm:self-auto">
              {['1h', '6h', '24h', '7d'].map(r => (
                <button
                  key={r}
                  onClick={() => {
                    if (timeRange !== r) {
                      setHistoryLoading(true);
                      setTimeRange(r);
                    }
                  }}
                  className={clsx(
                    "px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer",
                    timeRange === r
                      ? "bg-white text-sky-700 shadow-xs border border-slate-200/80"
                      : "text-slate-500 hover:text-slate-900"
                  )}
                >
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="h-64 w-full">
            {!historyLoading && latencyData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">No latency observations in this time range.</div>
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={latencyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="latencyGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0284c7" stopOpacity={0.25} />
                    <stop offset="90%" stopColor="#0284c7" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis 
                  dataKey="time" 
                  stroke="#94a3b8" 
                  fontSize={11} 
                  tickLine={false} 
                  axisLine={false} 
                  dy={8}
                />
                <YAxis 
                  stroke="#94a3b8" 
                  fontSize={11} 
                  tickLine={false} 
                  axisLine={false} 
                  tickFormatter={(v) => `${v}ms`} 
                />
                <Tooltip content={<CustomTooltip />} />
                <Area 
                  type="monotone" 
                  dataKey="latency" 
                  connectNulls={false}
                  stroke="#0284c7" 
                  strokeWidth={2.5} 
                  fillOpacity={1} 
                  fill="url(#latencyGlow)" 
                />
              </AreaChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>

      </div>

      {/* Bottom Row: Live Node Fleet & Incident Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Device Fleet Status Table */}
        <div className="glass-card-static rounded-2xl border border-slate-200 lg:col-span-8 overflow-hidden flex flex-col justify-between">
          <div className="p-5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Server className="w-5 h-5 text-sky-600" />
              <div>
                <h2 className="text-base font-bold text-slate-900">Live Node Telemetry</h2>
                <p className="text-xs text-slate-500">Active interfaces and hardware nodes</p>
              </div>
            </div>
            <Link 
              to="/devices" 
              className="text-xs font-bold text-sky-600 hover:text-sky-700 flex items-center gap-1 group"
            >
              All Assets ({devices.length}) 
              <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-[11px] font-bold uppercase tracking-wider border-b border-slate-200">
                  <th className="px-5 py-3.5">Device Name</th>
                  <th className="px-5 py-3.5">IP Address</th>
                  <th className="px-5 py-3.5">Type</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5">Last Seen</th>
                  <th className="px-5 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {devices.slice(0, 6).map(device => {
                  const isUp = device.status === 'UP';
                  const isDown = device.status === 'DOWN';

                  return (
                    <tr key={device._id} className="hover:bg-slate-50/80 transition-colors group">
                      <td className="px-5 py-3.5 font-bold text-slate-900">
                        <div className="flex items-center gap-2.5">
                          <div className={clsx(
                            "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border",
                            isUp ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                            isDown ? "bg-rose-50 text-rose-700 border-rose-200" :
                            "bg-amber-50 text-amber-700 border-amber-200"
                          )}>
                            {device.type === 'router' ? <Router className="w-3.5 h-3.5" /> :
                             device.type === 'server' ? <Server className="w-3.5 h-3.5" /> :
                             <Wifi className="w-3.5 h-3.5" />}
                          </div>
                          <span>{device.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 font-mono">
                        <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-800 text-[11px] font-semibold">
                          {device.ipAddress}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-slate-600 capitalize font-medium">{device.type}</td>
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
                      <td className="px-5 py-3.5 text-slate-500 font-mono text-[11px]">
                        {device.lastSeen ? format(new Date(device.lastSeen), 'HH:mm:ss') : 'N/A'}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <Link 
                          to={`/devices/${device._id}`}
                          className="px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-[11px] font-bold transition-all"
                        >
                          Telemetry
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Live Incident Stream */}
        <div className="glass-card-static rounded-2xl border border-slate-200 lg:col-span-4 flex flex-col justify-between overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-rose-600" />
              <div>
                <h2 className="text-base font-bold text-slate-900">Incident Stream</h2>
                <p className="text-xs text-slate-500">Live trigger alerts</p>
              </div>
            </div>
            <Link to="/alerts" className="text-xs text-sky-600 hover:text-sky-700 font-bold">
              View Log
            </Link>
          </div>

          <div className="p-4 flex-1 overflow-y-auto space-y-2.5">
            {alerts.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                <ShieldCheck className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                No active critical incidents.
              </div>
            ) : (
              alerts.map(alert => (
                <div 
                  key={alert._id} 
                  className={clsx(
                    "p-3 rounded-xl border text-xs transition-all",
                    alert.severity === 'CRITICAL' ? "bg-rose-50/70 border-rose-200 text-slate-800" :
                    alert.severity === 'HIGH' ? "bg-amber-50/70 border-amber-200 text-slate-800" :
                    "bg-slate-50 border-slate-200 text-slate-800"
                  )}
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className={clsx(
                      "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border",
                      alert.severity === 'CRITICAL' ? "bg-rose-100 text-rose-800 border-rose-200" :
                      alert.severity === 'HIGH' ? "bg-amber-100 text-amber-800 border-amber-200" :
                      "bg-sky-100 text-sky-800 border-sky-200"
                    )}>
                      {alert.severity}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {format(new Date(alert.createdAt), 'HH:mm:ss')}
                    </span>
                  </div>
                  <p className="font-bold text-slate-900 text-xs mt-1">{alert.message}</p>
                  <p className="text-[11px] text-slate-500 font-medium mt-0.5">{alert.device?.name || 'Network Node'}</p>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

    </div>
  );
};

export default Dashboard;
