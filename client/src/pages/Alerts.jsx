import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  ShieldAlert, 
  ShieldCheck, 
  AlertOctagon,
  Filter,
  RefreshCw
} from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';

const Alerts = () => {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    fetchAlerts();

    const socket = getSocket();
    if (socket) {
      socket.on('newAlert', (alert) => {
        setAlerts(prev => [alert, ...prev]);
      });
    }

    return () => {
      if (socket) socket.off('newAlert');
    };
  }, []);

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const res = await api.get('/alerts');
      setAlerts(res.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const updateAlertStatus = async (id, status) => {
    try {
      await api.put(`/alerts/${id}`, { status });
      setAlerts(prev => prev.map(a => a._id === id ? { ...a, status } : a));
    } catch (error) {
      console.error(error);
    }
  };

  const filteredAlerts = alerts.filter(a => {
    const matchesSev = !severityFilter || a.severity === severityFilter;
    const matchesStatus = !statusFilter || a.status === statusFilter;
    return matchesSev && matchesStatus;
  });

  const criticalCount = alerts.filter(a => a.severity === 'CRITICAL' && a.status === 'ACTIVE').length;
  const activeCount = alerts.filter(a => a.status === 'ACTIVE').length;
  const resolvedCount = alerts.filter(a => a.status === 'RESOLVED').length;

  return (
    <div className="space-y-6 pb-12">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
            Incident Response & Alerts Center
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Real-time critical alarms, latency thresholds, and incident resolution tracking
          </p>
        </div>

        <button 
          onClick={fetchAlerts}
          className="p-2.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer self-start sm:self-auto shadow-2xs"
          title="Refresh Alerts"
        >
          <RefreshCw className={clsx("w-4 h-4", loading && "animate-spin")} />
        </button>
      </div>

      {/* KPI Stats Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-card rounded-2xl p-4 border border-slate-200 flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Active Critical</span>
            <div className="text-2xl font-extrabold text-rose-600 font-mono mt-0.5">{criticalCount}</div>
          </div>
          <AlertOctagon className="w-7 h-7 text-rose-500/80" />
        </div>

        <div className="glass-card rounded-2xl p-4 border border-slate-200 flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Total Active Warnings</span>
            <div className="text-2xl font-extrabold text-amber-600 font-mono mt-0.5">{activeCount}</div>
          </div>
          <AlertTriangle className="w-7 h-7 text-amber-500/80" />
        </div>

        <div className="glass-card rounded-2xl p-4 border border-slate-200 flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Resolved Incidents</span>
            <div className="text-2xl font-extrabold text-emerald-600 font-mono mt-0.5">{resolvedCount}</div>
          </div>
          <CheckCircle className="w-7 h-7 text-emerald-500/80" />
        </div>
      </div>

      {/* Main Glass Table */}
      <div className="glass-card-static rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        
        {/* Filter Toolbar */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-500 mr-1 flex items-center gap-1">
              <Filter className="w-3.5 h-3.5" /> Severity:
            </span>
            {['', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(sev => (
              <button
                key={sev}
                onClick={() => setSeverityFilter(sev)}
                className={clsx(
                  "px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
                  severityFilter === sev
                    ? "bg-white text-sky-700 shadow-xs border border-slate-300"
                    : "bg-transparent text-slate-600 hover:text-slate-900 border border-transparent"
                )}
              >
                {sev || 'All Severities'}
              </button>
            ))}
          </div>

          <select 
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-white border border-slate-300 text-slate-800 text-xs rounded-xl px-3 py-1.5 focus:outline-none focus:border-blue-500 cursor-pointer shadow-2xs font-medium"
          >
            <option value="">All Statuses</option>
            <option value="ACTIVE">Active Only</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="RESOLVED">Resolved Only</option>
          </select>
        </div>

        {/* Table Content */}
        {loading ? (
          <div className="py-24 text-center text-xs text-slate-400">Loading incident queue...</div>
        ) : filteredAlerts.length === 0 ? (
          <div className="py-20 text-center text-xs text-slate-500">
            <ShieldCheck className="w-10 h-10 text-emerald-500 mx-auto mb-2 opacity-80" />
            <p className="font-bold text-slate-700 text-sm">No incidents match criteria</p>
            <p className="mt-1">All telemetry checks are reporting healthy statuses.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-[11px] font-bold uppercase tracking-wider border-b border-slate-200">
                  <th className="px-5 py-3.5">Severity Level</th>
                  <th className="px-5 py-3.5">Hardware Target</th>
                  <th className="px-5 py-3.5">Alarm Message</th>
                  <th className="px-5 py-3.5">Trigger Timestamp</th>
                  <th className="px-5 py-3.5">Lifecycle Status</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredAlerts.map(alert => (
                  <tr key={alert._id} className="hover:bg-slate-50/80 transition-colors">
                    
                    <td className="px-5 py-3.5">
                      <span className={clsx(
                        "px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase border flex items-center w-fit gap-1.5",
                        alert.severity === 'CRITICAL' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                        alert.severity === 'HIGH' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                        'bg-sky-50 text-sky-700 border-sky-200'
                      )}>
                        <span className={clsx(
                          "w-1.5 h-1.5 rounded-full",
                          alert.severity === 'CRITICAL' ? 'bg-rose-500 animate-pulse' :
                          alert.severity === 'HIGH' ? 'bg-amber-500' : 'bg-sky-500'
                        )} />
                        {alert.severity}
                      </span>
                    </td>

                    <td className="px-5 py-3.5 font-bold text-slate-900">
                      {alert.device?.name || 'Network Gateway'}
                    </td>

                    <td className="px-5 py-3.5 text-slate-700 font-medium">
                      {alert.message}
                    </td>

                    <td className="px-5 py-3.5 text-slate-500 font-mono text-[11px]">
                      {format(new Date(alert.createdAt), 'MMM d, HH:mm:ss')}
                    </td>

                    <td className="px-5 py-3.5 font-bold">
                      <span className={clsx(
                        "text-[11px] font-mono",
                        alert.status === 'RESOLVED' ? 'text-emerald-700' :
                        alert.status === 'ACKNOWLEDGED' ? 'text-sky-700' : 'text-amber-700'
                      )}>
                        {alert.status}
                      </span>
                    </td>

                    <td className="px-5 py-3.5 text-right space-x-2">
                      {alert.status !== 'RESOLVED' && (
                        <>
                          {alert.status === 'ACTIVE' && (
                            <button 
                              onClick={() => updateAlertStatus(alert._id, 'ACKNOWLEDGED')}
                              className="px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-[11px] font-bold transition-all cursor-pointer"
                            >
                              Ack
                            </button>
                          )}
                          <button 
                            onClick={() => updateAlertStatus(alert._id, 'RESOLVED')}
                            className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[11px] font-bold transition-all cursor-pointer"
                          >
                            Resolve
                          </button>
                        </>
                      )}
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </div>

    </div>
  );
};

export default Alerts;
