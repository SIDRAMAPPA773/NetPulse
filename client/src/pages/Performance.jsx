import React, { useState, useEffect } from 'react';
import api from '../services/api';
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
import { Activity, ShieldAlert, Zap, TrendingUp, Clock, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';

const Performance = () => {
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('1h');

  useEffect(() => {
    fetchPerformance();
  }, [range]);

  const fetchPerformance = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/analytics/performance?range=${range}`);
      const formatted = res.data.map(m => ({
        time: format(new Date(m.createdAt), 'HH:mm'),
        latency: m.latency || 0,
        packetLoss: m.packetLoss || 0
      }));
      setMetrics(formatted.slice(-100));
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const latencies = metrics.map(m => m.latency).filter(l => l > 0);
  const avgLat = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 18;
  const maxLat = latencies.length ? Math.max(...latencies) : 32;
  const minLat = latencies.length ? Math.min(...latencies) : 12;
  const avgLoss = metrics.length ? (metrics.reduce((a, b) => a + (b.packetLoss || 0), 0) / metrics.length).toFixed(1) : 0;

  return (
    <div className="space-y-6 pb-12">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
            Performance & Health Telemetry
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Aggregated round-trip latency, historical spikes, and packet retention analysis
          </p>
        </div>

        {/* Range Buttons */}
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

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card rounded-2xl p-4 border border-slate-200">
          <span className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Average RTT</span>
          <div className="text-2xl font-extrabold font-mono text-slate-900 mt-1">{avgLat} <span className="text-xs font-sans text-slate-400">ms</span></div>
          <div className="text-[11px] text-sky-700 font-medium mt-1">Global median latency</div>
        </div>
        <div className="glass-card rounded-2xl p-4 border border-slate-200">
          <span className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Min Response</span>
          <div className="text-2xl font-extrabold font-mono text-emerald-700 mt-1">{minLat} <span className="text-xs font-sans text-slate-400">ms</span></div>
          <div className="text-[11px] text-emerald-700 font-medium mt-1">Best-case roundtrip</div>
        </div>
        <div className="glass-card rounded-2xl p-4 border border-slate-200">
          <span className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Peak Spike</span>
          <div className="text-2xl font-extrabold font-mono text-amber-700 mt-1">{maxLat} <span className="text-xs font-sans text-slate-400">ms</span></div>
          <div className="text-[11px] text-amber-700 font-medium mt-1">Observed peak value</div>
        </div>
        <div className="glass-card rounded-2xl p-4 border border-slate-200">
          <span className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Mean Packet Loss</span>
          <div className="text-2xl font-extrabold font-mono text-slate-900 mt-1">{avgLoss} <span className="text-xs font-sans text-slate-400">%</span></div>
          <div className="text-[11px] text-rose-700 font-medium mt-1">{avgLoss === '0.0' ? 'Zero loss detected' : 'Minor packet drops'}</div>
        </div>
      </div>

      {/* Charts Grid */}
      {loading ? (
        <div className="py-24 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
          <div className="w-8 h-8 rounded-full border-2 border-sky-200 border-t-sky-600 animate-spin" />
          <span>Crunching historical telemetry metrics...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          
          {/* Latency Stream Chart */}
          <div className="glass-card-static rounded-2xl p-6 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-sky-600" />
                  Aggregated Fleet Latency
                </h2>
                <p className="text-xs text-slate-500">Time-series mean latency curve</p>
              </div>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                Range: {range.toUpperCase()}
              </span>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metrics} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="perfLatGlow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0284c7" stopOpacity={0.25} />
                      <stop offset="90%" stopColor="#0284c7" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `${v}ms`} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '0.75rem', fontSize: '12px', color: '#0f172a' }}
                  />
                  <Area type="monotone" dataKey="latency" stroke="#0284c7" strokeWidth={2.5} fillOpacity={1} fill="url(#perfLatGlow)" />
                </AreaChart>
              </ResponsiveContainer>
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
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '0.75rem', fontSize: '12px', color: '#0f172a' }}
                  />
                  <Bar dataKey="packetLoss" fill="#e11d48" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>
      )}

    </div>
  );
};

export default Performance;
