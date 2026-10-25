import React, { useState } from 'react';
import api from '../services/api';
import { Download, FileText, FileSpreadsheet, Printer } from 'lucide-react';
import clsx from 'clsx';

const Reports = () => {
  const [range, setRange] = useState('7d');
  const [reportType, setReportType] = useState('full');
  const [generating, setGenerating] = useState(false);

  const handleExportData = async (formatType) => {
    setGenerating(true);
    try {
      const [devicesRes, summaryRes, alertsRes] = await Promise.all([
        api.get('/devices'),
        api.get('/dashboard/summary'),
        api.get('/alerts')
      ]);

      const reportData = {
        generatedAt: new Date().toISOString(),
        networkOverview: summaryRes.data,
        devices: devicesRes.data,
        recentAlerts: alertsRes.data.slice(0, 20)
      };

      if (formatType === 'json') {
        const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pulsenet_audit_report_${Date.now()}.json`;
        a.click();
      } else {
        const headers = ['Name', 'IP Address', 'Type', 'Status', 'Location', 'Last Seen'];
        const rows = devicesRes.data.map(d => [
          `"${d.name}"`,
          `"${d.ipAddress}"`,
          `"${d.type}"`,
          `"${d.status}"`,
          `"${d.location || ''}"`,
          `"${d.lastSeen || ''}"`
        ]);
        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pulsenet_devices_inventory_${Date.now()}.csv`;
        a.click();
      }
    } catch (err) {
      console.error('Failed to export report', err);
    } finally {
      setGenerating(false);
    }
  };

  const sampleReports = [
    { name: 'Monthly Network SLA & Availability Report', date: 'October 2026', size: '2.4 MB', type: 'PDF' },
    { name: 'Critical Incident Post-Mortem & Alert Log', date: 'Last 7 Days', size: '1.1 MB', type: 'CSV' },
    { name: 'Bandwidth Peak Utilization & Capacity Plan', date: 'Q3 2026', size: '3.8 MB', type: 'PDF' },
  ];

  return (
    <div className="space-y-6 pb-12">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
            Audit Reports & Observability Logs
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Export executive summaries, historical SLA compliance, and device inventory logs
          </p>
        </div>

        <div className="flex gap-2 self-start sm:self-auto">
          <button 
            onClick={() => handleExportData('csv')}
            disabled={generating}
            className="px-4 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-2xs"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Export CSV
          </button>
          <button 
            onClick={() => handleExportData('json')}
            disabled={generating}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 transition-all shadow-sm cursor-pointer"
          >
            <Download className="w-4 h-4" /> Export JSON
          </button>
        </div>
      </div>

      {/* Generator Form Glass Card */}
      <div className="glass-card-static rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600">
            <Printer className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Generate Custom Observability Report</h2>
            <p className="text-xs text-slate-500">Configure time-range and metrics to synthesize compliance document</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block text-slate-700 font-bold mb-1.5">Evaluation Period</label>
            <select 
              value={range}
              onChange={e => setRange(e.target.value)}
              className="w-full bg-white border border-slate-300 text-slate-900 rounded-xl px-4 py-2.5 focus:outline-none focus:border-blue-500 cursor-pointer shadow-2xs font-medium"
            >
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days (Standard SLA)</option>
              <option value="30d">Last 30 Days (Monthly Audit)</option>
              <option value="90d">Last Quarter</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-700 font-bold mb-1.5">Report Scope</label>
            <select 
              value={reportType}
              onChange={e => setReportType(e.target.value)}
              className="w-full bg-white border border-slate-300 text-slate-900 rounded-xl px-4 py-2.5 focus:outline-none focus:border-blue-500 cursor-pointer shadow-2xs font-medium"
            >
              <option value="full">Comprehensive Full Audit (Availability + Alerts)</option>
              <option value="latency">Round-Trip Latency & Jitter Only</option>
              <option value="inventory">Asset Inventory & MAC Addressing</option>
            </select>
          </div>

          <div className="flex items-end">
            <button 
              onClick={() => handleExportData('csv')}
              disabled={generating}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-all shadow-sm cursor-pointer"
            >
              {generating ? 'Compiling Telemetry...' : 'Generate & Download'}
            </button>
          </div>
        </div>
      </div>

      {/* Pre-packaged Audit Reports */}
      <div className="glass-card-static rounded-2xl border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900">Archived Executive Reports</h3>
        </div>
        <div className="divide-y divide-slate-100 text-xs">
          {sampleReports.map((item, idx) => (
            <div key={idx} className="p-4 sm:px-6 flex items-center justify-between hover:bg-slate-50/80 transition-colors">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-sky-600" />
                <div>
                  <p className="font-bold text-slate-900">{item.name}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{item.date} • {item.size}</p>
                </div>
              </div>
              <button 
                onClick={() => handleExportData('csv')}
                className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-sky-700 border border-slate-300 text-[11px] font-bold transition-colors cursor-pointer shadow-2xs"
              >
                Download {item.type}
              </button>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};

export default Reports;
