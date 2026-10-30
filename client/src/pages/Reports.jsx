import React, { useState } from 'react';
import api from '../services/api';
import { Download, FileText, FileSpreadsheet, Printer } from 'lucide-react';
import { toCsv } from '../services/csvExport';

const Reports = () => {
  const [range, setRange] = useState('7d');
  const [reportType, setReportType] = useState('full');
  const [generating, setGenerating] = useState(false);
  const [exportError, setExportError] = useState('');

  const handleExportData = async (formatType, scope = reportType) => {
    setGenerating(true);
    setExportError('');
    try {
      const [devicesRes, summaryRes, alertsRes, metricsRes] = await Promise.all([
        api.get('/devices'),
        api.get('/dashboard/summary'),
        api.get('/alerts'),
        api.get('/analytics/performance', { params: { range } })
      ]);

      const durationMs = { '24h': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000, '30d': 30 * 24 * 60 * 60 * 1000 }[range];
      const since = Date.now() - durationMs;
      const recentAlerts = alertsRes.data
        .filter(alert => new Date(alert.lastOccurredAt || alert.createdAt).getTime() >= since)
        .slice(0, 100);
      const devicesById = new Map(devicesRes.data.map(device => [device._id, device]));
      const observations = metricsRes.data.map(metric => {
        const device = devicesById.get(String(metric.device?._id || metric.device));
        return {
          ...metric,
          deviceName: device?.name || null,
          deviceIpAddress: device?.ipAddress || null,
        };
      });
      const fullReport = {
        generatedAt: new Date().toISOString(),
        range,
        scope,
        networkOverview: summaryRes.data,
        devices: devicesRes.data,
        observations,
        recentAlerts
      };
      const reportData = scope === 'inventory'
        ? { generatedAt: fullReport.generatedAt, range, devices: devicesRes.data }
        : scope === 'latency'
          ? {
            generatedAt: fullReport.generatedAt,
            range,
            observations: observations.filter(metric => metric.latency !== null && metric.latency !== undefined),
          }
          : fullReport;

      if (formatType === 'json') {
        const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `netpulse_${scope}_${range}_${Date.now()}.json`;
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const headers = ['Record Type', 'Timestamp', 'Device', 'IP Address', 'Status', 'Severity', 'Measurement Source', 'Latency (ms)', 'Packet Loss (%)', 'Inbound (bit/s)', 'Outbound (bit/s)', 'Details'];
        const rows = scope === 'inventory'
          ? devicesRes.data.map(device => [
            'Device',
            device.lastSeen || '',
            device.name,
            device.ipAddress,
            device.status,
            '',
            device.latestMetric?.measurementSource || '',
            device.latestMetric?.latency,
            device.latestMetric?.packetLoss,
            device.latestMetric?.incomingTraffic,
            device.latestMetric?.outgoingTraffic,
            JSON.stringify({ type: device.type, location: device.location, activeAlertCount: device.activeAlertCount }),
          ])
          : scope === 'latency'
            ? reportData.observations.map(metric => {
              return [
                'Metric',
                metric.createdAt,
                metric.deviceName || 'Unknown device',
                metric.deviceIpAddress || '',
                metric.status,
                '',
                metric.measurementSource,
                metric.latency,
                metric.packetLoss,
                metric.incomingThroughputBps,
                metric.outgoingThroughputBps,
                metric.reasonUnavailable,
              ];
            })
            : [
              ['Overview', fullReport.generatedAt, '', '', '', '', fullReport.networkOverview.measurementSource, fullReport.networkOverview.avgLatency, fullReport.networkOverview.avgPacketLoss, '', '', JSON.stringify(fullReport.networkOverview)],
              ...observations.map(metric => {
                return [
                  'Metric',
                  metric.createdAt,
                  metric.deviceName || 'Unknown device',
                  metric.deviceIpAddress || '',
                  metric.status,
                  '',
                  metric.measurementSource,
                  metric.latency,
                  metric.packetLoss,
                  metric.incomingThroughputBps,
                  metric.outgoingThroughputBps,
                  metric.reasonUnavailable,
                ];
              }),
              ...recentAlerts.map(alert => [
                'Alert',
                alert.lastOccurredAt || alert.createdAt,
                alert.device?.name || 'Unknown device',
                alert.device?.ipAddress || '',
                alert.status,
                alert.severity,
                '',
                '',
                '',
                '',
                '',
                alert.message,
              ]),
            ];
        const csvContent = toCsv(headers, rows);
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `netpulse_${scope}_${range}_${Date.now()}.csv`;
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (err) {
      console.error('Failed to export report', err);
      setExportError('Unable to generate the export. Check your connection and try again.');
    } finally {
      setGenerating(false);
    }
  };

  const exportTemplates = [
    { name: 'Device inventory and latest observations', scope: 'inventory', format: 'csv' },
    { name: 'Stored telemetry and incident snapshot', scope: 'full', format: 'json' },
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
            Export authenticated inventory, bounded stored telemetry, and incident snapshots; unavailable values remain empty
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
            <p className="text-xs text-slate-500">Export data currently stored by NetPulse. These reports do not certify an SLA.</p>
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
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-700 font-bold mb-1.5">Report Scope</label>
            <select 
              value={reportType}
              onChange={e => setReportType(e.target.value)}
              className="w-full bg-white border border-slate-300 text-slate-900 rounded-xl px-4 py-2.5 focus:outline-none focus:border-blue-500 cursor-pointer shadow-2xs font-medium"
            >
              <option value="full">Summary, observations, and recent alerts</option>
              <option value="latency">Stored latency observations</option>
              <option value="inventory">Device inventory and latest values</option>
            </select>
          </div>

          <div className="flex items-end">
            <button 
              onClick={() => handleExportData('csv')}
              disabled={generating}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-all shadow-sm cursor-pointer"
            >
              {generating ? 'Preparing export...' : 'Generate & Download'}
            </button>
          </div>
        </div>
        {exportError && <p role="alert" className="text-xs font-semibold text-rose-700">{exportError}</p>}
      </div>

      {/* Available export templates */}
      <div className="glass-card-static rounded-2xl border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900">Available on-demand exports</h3>
        </div>
        <div className="divide-y divide-slate-100 text-xs">
          {exportTemplates.map(item => (
            <div key={item.scope} className="p-4 sm:px-6 flex items-center justify-between hover:bg-slate-50/80 transition-colors">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-sky-600" />
                <div>
                  <p className="font-bold text-slate-900">{item.name}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Generated on demand · Selected range: {range}</p>
                </div>
              </div>
              <button 
                onClick={() => handleExportData(item.format, item.scope)}
                disabled={generating}
                className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-sky-700 border border-slate-300 text-[11px] font-bold transition-colors cursor-pointer shadow-2xs"
              >
                Download {item.format.toUpperCase()}
              </button>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};

export default Reports;
