import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Search, X } from 'lucide-react';
import clsx from 'clsx';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { AuthContext } from '../context/AuthContext';

const EMPTY_FORM = {
  name: '',
  cidr: '',
  description: '',
  location: '',
  department: '',
  status: 'active',
  allowOverlap: false,
  overlapPermissionReason: '',
  autoEnroll: false,
  requireEnrollmentApproval: true,
  monitoringEnabled: false,
  discoveryScheduleEnabled: false,
  discoveryIntervalMinutes: 60,
};

function numberToIp(value) {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.');
}

function calculatePreview(cidr) {
  if (!cidr) return null;
  const match = cidr.match(/^((?:\d{1,3}\.){3}\d{1,3})\/(\d{1,2})$/);
  if (!match) return { error: 'Enter a canonical IPv4 CIDR, for example 192.168.50.0/24.' };
  const octets = match[1].split('.').map(Number);
  const prefix = Number(match[2]);
  if (octets.some((octet) => octet < 0 || octet > 255) || prefix < 1 || prefix > 32) {
    return { error: 'CIDR must use a valid IPv4 address and prefix from /1 to /32.' };
  }
  const address = octets.reduce((value, octet) => ((value * 256) + octet) >>> 0, 0);
  const mask = prefix === 32 ? 0xFFFFFFFF : (0xFFFFFFFF << (32 - prefix)) >>> 0;
  const network = (address & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const networkAddress = numberToIp(network);
  if (networkAddress !== match[1]) {
    return { error: `Use the canonical network address ${networkAddress}/${prefix}.` };
  }
  const totalAddressCount = 2 ** (32 - prefix);
  const usableHostCount = prefix === 32 ? 1 : prefix === 31 ? 2 : totalAddressCount - 2;
  if (usableHostCount > 256) return { error: 'Subnet exceeds the 256-usable-host limit.' };
  const first = prefix >= 31 ? network : network + 1;
  const last = prefix >= 31 ? broadcast : broadcast - 1;

  return {
    networkAddress,
    subnetMask: numberToIp(mask),
    broadcastAddress: numberToIp(broadcast),
    firstUsableIp: numberToIp(first),
    lastUsableIp: numberToIp(last),
    totalAddressCount,
    usableHostCount,
  };
}

const statusClass = (status) => status === 'approved'
  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
  : status === 'pending'
    ? 'border-amber-200 bg-amber-50 text-amber-700'
    : 'border-slate-200 bg-slate-100 text-slate-600';

const Subnets = () => {
  const { user } = useContext(AuthContext);
  const isAdmin = user?.role === 'admin';
  const [subnets, setSubnets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [search, setSearch] = useState('');
  const [approvalFilter, setApprovalFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSubnet, setEditingSubnet] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [discoverySubnetId, setDiscoverySubnetId] = useState(null);
  const [discoveryProgress, setDiscoveryProgress] = useState(null);
  const [discoveryResult, setDiscoveryResult] = useState(null);
  const [discoveryError, setDiscoveryError] = useState('');
  const [discoveryJobs, setDiscoveryJobs] = useState([]);
  const [discoveryResolveDns, setDiscoveryResolveDns] = useState(false);
  const [discoveryCheckServices, setDiscoveryCheckServices] = useState(false);
  const preview = useMemo(() => calculatePreview(form.cidr), [form.cidr]);

  const requestSubnets = useCallback(async () => {
    const { data } = await api.get('/subnets');
    return data;
  }, []);

  const fetchSubnets = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      setSubnets(await requestSubnets());
      setLoadError('');
    } catch (error) {
      console.error('Failed to load registered subnets', error);
      setLoadError(error.response?.data?.message || 'Unable to load registered subnets.');
    } finally {
      setLoading(false);
    }
  }, [requestSubnets]);

  useEffect(() => {
    let active = true;
    requestSubnets()
      .then((data) => {
        if (active) {
          setSubnets(data);
          setLoadError('');
        }
      })
      .catch((error) => {
        console.error('Failed to load registered subnets', error);
        if (active) setLoadError(error.response?.data?.message || 'Unable to load registered subnets.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [requestSubnets]);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    api.get('/devices/discovery/jobs')
      .then(({ data }) => { if (active) setDiscoveryJobs(data); })
      .catch((error) => console.error('Discovery history could not be loaded', error));
    return () => { active = false; };
  }, [isAdmin]);

  const openCreate = () => {
    setEditingSubnet(null);
    setForm(EMPTY_FORM);
    setActionError('');
    setModalOpen(true);
  };

  const openEdit = (subnet) => {
    setEditingSubnet(subnet);
    setForm({
      ...EMPTY_FORM,
      name: subnet.name,
      cidr: subnet.cidr,
      description: subnet.description || '',
      location: subnet.location || '',
      department: subnet.department || '',
      status: subnet.status,
      allowOverlap: false,
      overlapPermissionReason: '',
      autoEnroll: Boolean(subnet.autoEnroll),
      requireEnrollmentApproval: subnet.requireEnrollmentApproval !== false,
      monitoringEnabled: Boolean(subnet.monitoringEnabled),
      discoveryScheduleEnabled: Boolean(subnet.discoveryScheduleEnabled),
      discoveryIntervalMinutes: subnet.discoveryIntervalMinutes || 60,
    });
    setActionError('');
    setModalOpen(true);
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    setActionError('');
    const payload = {
      name: form.name,
      cidr: form.cidr,
      description: form.description,
      location: form.location,
      department: form.department,
      ...(editingSubnet ? {
        status: form.status,
        autoEnroll: form.autoEnroll,
        requireEnrollmentApproval: form.requireEnrollmentApproval,
        monitoringEnabled: form.monitoringEnabled,
        discoveryScheduleEnabled: form.discoveryScheduleEnabled,
        discoveryIntervalMinutes: Number(form.discoveryIntervalMinutes),
      } : {}),
      ...(form.allowOverlap ? {
        allowOverlap: true,
        overlapPermissionReason: form.overlapPermissionReason,
      } : {}),
    };
    try {
      if (editingSubnet) {
        await api.put(`/subnets/${editingSubnet._id}`, payload);
      } else {
        await api.post('/subnets', payload);
      }
      setModalOpen(false);
      await fetchSubnets(true);
    } catch (error) {
      setActionError(error.response?.data?.message || 'Unable to save subnet.');
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (id, action, confirmMessage) => {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setActionError('');
    try {
      if (action === 'approve' || action === 'disable') {
        await api.post(`/subnets/${id}/${action}`);
      } else {
        await api.delete(`/subnets/${id}`);
      }
      await fetchSubnets(true);
    } catch (error) {
      setActionError(error.response?.data?.message || `Unable to ${action} subnet.`);
    }
  };

  const startDiscovery = async (subnet) => {
    setDiscoverySubnetId(subnet._id);
    setDiscoveryProgress({ checkedHosts: 0, totalHosts: subnet.usableHostCount, respondingHosts: 0 });
    setDiscoveryResult(null);
    setDiscoveryError('');
    const socket = getSocket();
    const onProgress = (progress) => {
      if (progress.subnetId === subnet._id) setDiscoveryProgress(progress);
    };
    socket?.on('discoveryProgress', onProgress);
    try {
      const { data } = await api.post('/devices/discover', {
        subnetId: subnet._id,
        resolveDns: discoveryResolveDns,
        checkServices: discoveryCheckServices,
        ports: discoveryCheckServices ? [22, 53, 80, 443, 3389] : [],
      });
      setDiscoveryResult(data);
      const { data: jobs } = await api.get('/devices/discovery/jobs');
      setDiscoveryJobs(jobs);
      await fetchSubnets(true);
    } catch (error) {
      setDiscoveryError(error.response?.data?.message || 'Unable to discover this subnet.');
    } finally {
      socket?.off('discoveryProgress', onProgress);
      setDiscoverySubnetId(null);
    }
  };

  const cancelDiscovery = async () => {
    if (!discoveryProgress?.jobId) return;
    try {
      await api.post(`/devices/discovery/jobs/${discoveryProgress.jobId}/cancel`);
    } catch (error) {
      setDiscoveryError(error.response?.data?.message || 'Unable to cancel discovery.');
    }
  };

  const filteredSubnets = subnets.filter((subnet) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [
      subnet.name,
      subnet.cidr,
      subnet.location,
      subnet.department,
      subnet.description,
    ].some((value) => String(value || '').toLowerCase().includes(query));
    return matchesSearch
      && (!approvalFilter || subnet.approvalStatus === approvalFilter)
      && (!statusFilter || subnet.status === statusFilter);
  });

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">Subnet Management</h1>
          <p className="mt-1 text-xs text-slate-500">
            Manage authorized subnet discovery, enrollment policy, and monitoring schedules. Discovery requires an explicit action or enabled schedule.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => fetchSubnets(true)} className="rounded-xl border border-slate-300 bg-white p-2.5 text-slate-600 shadow-2xs" title="Refresh subnets">
            <RefreshCw className={clsx('h-4 w-4', loading && 'animate-spin')} />
          </button>
          {isAdmin && (
            <button type="button" onClick={openCreate} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700">
              <Plus className="h-4 w-4" /> Add Subnet
            </button>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-xs text-sky-900">
        Live discovery requires an active, approved private subnet and remains subject to emergency stop, host, rate, and concurrency limits. Network authorization mode and connected-interface scope are configured in Engine Settings. Interface synchronization authorizes eligible networks only; it never starts discovery or enables device monitoring.
      </div>
      {isAdmin && (
        <div className="flex flex-wrap gap-5 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={discoveryResolveDns} onChange={(event) => setDiscoveryResolveDns(event.target.checked)} />
            Optional bounded reverse-DNS lookup
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={discoveryCheckServices} onChange={(event) => setDiscoveryCheckServices(event.target.checked)} />
            Optional TCP checks (fixed approved service ports)
          </label>
        </div>
      )}
      {discoveryError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{discoveryError}</p>}

      {actionError && !modalOpen && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{actionError}</p>}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/50 p-4 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, CIDR, location or department" className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-slate-800" />
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={approvalFilter} onChange={(event) => setApprovalFilter(event.target.value)} aria-label="Filter by approval" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs">
              <option value="">All approval states</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by subnet status" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3 p-5"><div className="h-16 animate-pulse rounded-xl bg-slate-100" /><div className="h-16 animate-pulse rounded-xl bg-slate-100" /></div>
        ) : loadError ? (
          <div className="p-8 text-center text-sm text-rose-700">{loadError}<button type="button" onClick={() => fetchSubnets(true)} className="ml-3 underline">Retry</button></div>
        ) : filteredSubnets.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">{subnets.length ? 'No subnets match these filters.' : 'No subnets are registered yet.'}</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredSubnets.map((subnet) => {
              const latestJob = discoveryJobs.find((job) => String(job.subnet) === String(subnet._id));
              const visibleResults = discoveryResult?.subnetId === subnet._id
                ? discoveryResult.devices
                : latestJob?.results;
              return (
              <article key={subnet._id} className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-bold text-slate-900">{subnet.name}</h2>
                    <span className={clsx('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', statusClass(subnet.approvalStatus))}>{subnet.approvalStatus}</span>
                    <span className={clsx('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', subnet.status === 'active' ? statusClass('approved') : statusClass('disabled'))}>{subnet.status}</span>
                    {subnet.authorizationSource === 'interface_policy' && (
                      <span className={clsx('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', subnet.interfaceConnected ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700')}>
                        {subnet.interfaceConnected ? 'Connected interface policy' : 'Interface disconnected'}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-sm font-bold text-sky-800">{subnet.cidr}</p>
                  <div className="mt-2 grid gap-x-6 gap-y-1 text-xs text-slate-600 sm:grid-cols-2 xl:grid-cols-3">
                    <p>Network / mask: <span className="font-mono text-slate-800">{subnet.networkAddress} / {subnet.subnetMask}</span></p>
                    <p>Broadcast: <span className="font-mono text-slate-800">{subnet.broadcastAddress}</span></p>
                    <p>Usable range: <span className="font-mono text-slate-800">{subnet.firstUsableIp} – {subnet.lastUsableIp}</span></p>
                    <p>Addresses: <span className="font-semibold text-slate-800">{subnet.totalAddressCount}</span></p>
                    <p>Usable hosts: <span className="font-semibold text-slate-800">{subnet.usableHostCount}</span></p>
                    <p>{[subnet.location, subnet.department].filter(Boolean).join(' · ') || 'No location or department assigned'}</p>
                    <p>Last discovery: <span className="font-semibold text-slate-800">{subnet.lastDiscoveryAt ? new Date(subnet.lastDiscoveryAt).toLocaleString() : 'Never'}</span></p>
                    <p>Last responders: <span className="font-semibold text-slate-800">{subnet.lastDiscoveredDeviceCount || 0}</span></p>
                    <p>Registered devices: <span className="font-semibold text-slate-800">{subnet.registeredDeviceCount || 0}</span></p>
                    <p>Monitoring policy: <span className="font-semibold text-slate-800">{subnet.monitoringEnabled ? 'Enabled' : 'Disabled'}</span></p>
                    {subnet.authorizationSource === 'interface_policy' && <p>Interface scope: <span className="font-semibold text-slate-800">{subnet.interfaceName} · {subnet.interfaceType}</span></p>}
                    <p>Enrollment: <span className="font-semibold text-slate-800">{subnet.autoEnroll ? `Automatic${subnet.requireEnrollmentApproval ? ' (approval required)' : ''}` : 'Manual'}</span></p>
                    <p>Schedule: <span className="font-semibold text-slate-800">{subnet.discoveryScheduleEnabled ? `Every ${subnet.discoveryIntervalMinutes} min` : 'Disabled'}</span></p>
                  </div>
                  {subnet.description && <p className="mt-2 text-xs text-slate-500">{subnet.description}</p>}
                  {latestJob && (
                    <p className="mt-2 text-[10px] text-slate-500">
                      Latest job: {latestJob.status} · {latestJob.checkedHosts}/{latestJob.totalHosts} checked · {latestJob.respondingHosts} responders · {latestJob.trigger}
                    </p>
                  )}
                  {subnet.overlapPermitted && <p className="mt-1 text-xs text-amber-700">Overlap exception: {subnet.overlapPermissionReason}</p>}
                  <p className="mt-2 text-[10px] text-slate-400">
                    Created {subnet.createdAt ? new Date(subnet.createdAt).toLocaleString() : '—'}
                    {subnet.createdBy?.name ? ` by ${subnet.createdBy.name}` : ''}
                    {subnet.approvedAt ? ` · Approved ${new Date(subnet.approvedAt).toLocaleString()}${subnet.approvedBy?.name ? ` by ${subnet.approvedBy.name}` : ''}` : ''}
                  </p>
                </div>
                {isAdmin && (
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    {subnet.status === 'active' && subnet.approvalStatus === 'approved' && (
                      <button
                        type="button"
                        disabled={Boolean(discoverySubnetId)}
                        onClick={() => startDiscovery(subnet)}
                        className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 disabled:opacity-50"
                      >
                        {discoverySubnetId === subnet._id ? 'Discovering…' : 'Discover subnet'}
                      </button>
                    )}
                    {subnet.approvalStatus !== 'approved' && subnet.status === 'active' && (
                      <button type="button" onClick={() => runAction(subnet._id, 'approve')} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">Approve</button>
                    )}
                    <button type="button" onClick={() => openEdit(subnet)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Edit</button>
                    {subnet.status !== 'disabled' && (
                      <button type="button" onClick={() => runAction(subnet._id, 'disable', 'Disable this subnet? This will not start or stop an active discovery job.')} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">Disable</button>
                    )}
                    <button type="button" onClick={() => runAction(subnet._id, 'delete', 'Delete this registered subnet?')} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700">Delete</button>
                  </div>
                )}
                {discoverySubnetId === subnet._id && (
                  <div className="lg:col-span-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                    <div className="flex items-center justify-between gap-3">
                      <span>
                        Discovery {discoveryProgress?.status || 'running'}:
                        {' '}{discoveryProgress?.checkedHosts || 0}/{discoveryProgress?.totalHosts || subnet.usableHostCount} hosts checked,
                        {' '}{discoveryProgress?.respondingHosts || 0} responders
                      </span>
                      <button type="button" onClick={cancelDiscovery} disabled={!discoveryProgress?.jobId} className="rounded border border-rose-200 bg-white px-2 py-1 font-semibold text-rose-700 disabled:opacity-50">Cancel</button>
                    </div>
                    <progress className="mt-2 w-full" value={discoveryProgress?.checkedHosts || 0} max={discoveryProgress?.totalHosts || subnet.usableHostCount} />
                  </div>
                )}
                {discoveryResult?.subnetId === subnet._id && (
                  <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                    <p className="font-semibold">
                      Discovery {discoveryResult.status}: {discoveryResult.count} responder(s), {discoveryResult.enrolledCount} enrolled, {discoveryResult.pendingApprovalCount} awaiting approval, {discoveryResult.duplicateCount} duplicate(s).
                    </p>
                    {discoveryResult.devices?.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {discoveryResult.devices.map((device) => (
                          <li key={device.ipAddress} className="flex flex-wrap gap-x-2">
                            <span className="font-mono">{device.ipAddress}</span>
                            <span>{device.name}</span>
                            <span className="text-slate-500">Confidence: {device.identityConfidence || 'low'}</span>
                            <span className="text-slate-500">{device.isDuplicate ? `duplicate of ${device.duplicateDeviceId}` : device.isEnrolled ? device.enrollmentStatus : 'candidate'}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {visibleResults?.length > 0 && discoveryResult?.subnetId !== subnet._id && (
                      <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                        <p className="font-semibold">Last persisted discovery results ({visibleResults.length})</p>
                        <ul className="mt-2 space-y-1">
                          {visibleResults.slice(0, 20).map((device) => (
                            <li key={device.ipAddress} className="flex flex-wrap gap-x-2">
                              <span className="font-mono">{device.ipAddress}</span>
                              <span>{device.name}</span>
                              <span className="text-slate-500">Confidence: {device.identityConfidence || 'low'}</span>
                              <span className="text-slate-500">{device.isDuplicate ? `duplicate of ${device.duplicateDeviceId}` : device.isEnrolled ? device.enrollmentStatus : 'candidate'}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </article>
              );
            })}
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div role="dialog" aria-modal="true" aria-labelledby="subnet-form-title" className="max-h-[92vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 id="subnet-form-title" className="font-bold text-slate-900">{editingSubnet ? 'Edit subnet' : 'Register subnet'}</h2>
                <p className="mt-1 text-xs text-slate-500">New and CIDR-changed entries require separate approval.</p>
              </div>
              <button type="button" aria-label="Close dialog" onClick={() => setModalOpen(false)} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            {actionError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{actionError}</p>}
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs font-semibold text-slate-700">Subnet name
                  <input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" />
                </label>
                <label className="space-y-1 text-xs font-semibold text-slate-700">IPv4 CIDR
                  <input required value={form.cidr} onChange={(event) => setForm({ ...form, cidr: event.target.value.trim() })} placeholder="192.168.50.0/24" className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono font-normal" />
                </label>
                <label className="space-y-1 text-xs font-semibold text-slate-700">Location
                  <input maxLength={120} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" />
                </label>
                <label className="space-y-1 text-xs font-semibold text-slate-700">Department
                  <input maxLength={120} value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" />
                </label>
                <label className="space-y-1 text-xs font-semibold text-slate-700 sm:col-span-2">Description
                  <textarea maxLength={1000} rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" />
                </label>
                {editingSubnet && (
                  <label className="space-y-1 text-xs font-semibold text-slate-700">Subnet status
                    <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-normal">
                      <option value="active">Active</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </label>
                )}
                {editingSubnet && (
                  <>
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                      <input type="checkbox" checked={form.autoEnroll} onChange={(event) => setForm({ ...form, autoEnroll: event.target.checked })} />
                      Automatically enroll discovered devices
                    </label>
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                      <input type="checkbox" checked={form.requireEnrollmentApproval} disabled={!form.autoEnroll} onChange={(event) => setForm({ ...form, requireEnrollmentApproval: event.target.checked })} />
                      Require administrator approval before device monitoring
                    </label>
                    {editingSubnet.status === 'active' && editingSubnet.approvalStatus === 'approved' && (
                      <>
                        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                          <input type="checkbox" checked={form.monitoringEnabled} onChange={(event) => setForm({ ...form, monitoringEnabled: event.target.checked })} />
                          Enable monitoring authorization for this subnet
                        </label>
                        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                          <input type="checkbox" checked={form.discoveryScheduleEnabled} onChange={(event) => setForm({ ...form, discoveryScheduleEnabled: event.target.checked })} />
                          Enable scheduled discovery (does not run immediately)
                        </label>
                        {form.discoveryScheduleEnabled && (
                          <label className="space-y-1 text-xs font-semibold text-slate-700">
                            Discovery interval in minutes (15–10080)
                            <input type="number" min={15} max={10080} required value={form.discoveryIntervalMinutes} onChange={(event) => setForm({ ...form, discoveryIntervalMinutes: Number(event.target.value) })} className="w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" />
                          </label>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>

              {preview?.error ? (
                <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{preview.error}</p>
              ) : preview ? (
                <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
                  <h3 className="text-xs font-bold text-sky-900">CIDR calculation preview</h3>
                  <div className="mt-2 grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
                    <p>Network: <span className="font-mono font-semibold">{preview.networkAddress}</span></p>
                    <p>Subnet mask: <span className="font-mono font-semibold">{preview.subnetMask}</span></p>
                    <p>Broadcast: <span className="font-mono font-semibold">{preview.broadcastAddress}</span></p>
                    <p>Total addresses: <span className="font-semibold">{preview.totalAddressCount}</span></p>
                    <p>First usable: <span className="font-mono font-semibold">{preview.firstUsableIp}</span></p>
                    <p>Last usable: <span className="font-mono font-semibold">{preview.lastUsableIp}</span></p>
                    <p className="sm:col-span-2">Usable hosts: <span className="font-semibold">{preview.usableHostCount}</span></p>
                  </div>
                </div>
              ) : null}

              <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <input type="checkbox" checked={form.allowOverlap} onChange={(event) => setForm({ ...form, allowOverlap: event.target.checked })} className="mt-0.5 rounded border-amber-300" />
                <span>Explicitly permit an overlapping subnet registration. Use only when required and document the administrative reason.</span>
              </label>
              {form.allowOverlap && (
                <label className="block space-y-1 text-xs font-semibold text-slate-700">Overlap permission reason
                  <textarea required minLength={5} maxLength={500} value={form.overlapPermissionReason} onChange={(event) => setForm({ ...form, overlapPermissionReason: event.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" />
                </label>
              )}
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700">Cancel</button>
                <button type="submit" disabled={saving || !preview || Boolean(preview.error)} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Saving…' : editingSubnet ? 'Save changes' : 'Register pending subnet'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Subnets;
