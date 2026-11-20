import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import {
  ArrowLeft,
  Building2,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Layers,
  MapPin,
  QrCode,
  ShieldCheck,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { getTodayIso } from '../data/seedData';
import { db } from '../lib/firebase';
import type { QrPassRecord } from '../types/avy';
import { formatDurationBreakdown } from '../utils/operations';
import { parseQrScanParams, resolveScannedQrProfile } from '../utils/qrProfile';
import { getWorkStatusBadgeClass, getWorkStatusLabel } from '../utils/tileZones';

interface QrScannedProfileViewProps {
  search: string;
  onExitScanView: () => void;
}

const ATTENDANCE_LABELS: Record<string, { label: string; style: string }> = {
  present: {
    label: 'Present Today',
    style: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  half_day: {
    label: 'Half Day Today',
    style: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  absent: {
    label: 'Absent Today',
    style: 'bg-red-50 text-red-800 border-red-200',
  },
  unmarked: {
    label: 'Attendance Pending',
    style: 'bg-slate-100 text-slate-700 border-slate-200',
  },
};

export function QrScannedProfileView({
  search,
  onExitScanView,
}: QrScannedProfileViewProps) {
  const { companyProfile, projects, towers, employees, deployments, assignments, attendance } =
    useStore();

  const scanParams = useMemo(() => parseQrScanParams(search), [search]);
  const [remoteQrPass, setRemoteQrPass] = useState<QrPassRecord | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(Boolean(scanParams.qrToken));

  useEffect(() => {
    let active = true;
    if (!scanParams.qrToken || scanParams.qrToken.length < 16) {
      setRemoteQrPass(null);
      setLoadingRemote(false);
      return;
    }

    setLoadingRemote(true);
    getDoc(doc(db, 'qr_passes', scanParams.qrToken))
      .then((snap) => {
        if (!active) return;
        if (snap.exists()) {
          const raw = snap.data() as Omit<QrPassRecord, 'id'>;
          setRemoteQrPass({
            ...raw,
            id: snap.id,
          });
        } else {
          setRemoteQrPass(null);
        }
      })
      .catch(() => {
        if (active) setRemoteQrPass(null);
      })
      .finally(() => {
        if (active) setLoadingRemote(false);
      });

    return () => {
      active = false;
    };
  }, [scanParams.qrToken]);

  const liveWorkspace = useMemo(
    () => ({
      companyProfile,
      projects,
      towers,
      flats: [],
      employees,
      employeeDocuments: [],
      deployments,
      assignments,
      attendance,
      advances: [],
      expenses: [],
      settlements: [],
      dailySiteLogs: [],
      billingDocuments: [],
      companyDocuments: [],
    }),
    [companyProfile, projects, towers, employees, deployments, assignments, attendance]
  );

  const resolved = useMemo(
    () =>
      resolveScannedQrProfile({
        scanParams,
        liveWorkspace,
        remoteQrPass,
        todayIso: getTodayIso(),
      }),
    [scanParams, liveWorkspace, remoteQrPass]
  );

  const profile = resolved.profile;

  if (!profile && loadingRemote) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg p-6 text-center space-y-2">
          <QrCode className="w-8 h-8 text-orange-700 mx-auto" aria-hidden="true" />
          <h1 className="text-base font-semibold text-slate-900">
            Loading Workforce Site Pass
          </h1>
          <p className="text-xs text-slate-500">
            Fetching current site deployment and active work status...
          </p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg p-6 text-center space-y-4">
          <QrCode className="w-9 h-9 text-slate-400 mx-auto" aria-hidden="true" />
          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-slate-900">
              Workforce QR Pass Not Found
            </h1>
            <p className="text-sm text-slate-600">
              This QR code could not be matched to an active employee site verification record.
            </p>
          </div>
          <button
            type="button"
            onClick={onExitScanView}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>Open Staff Portal</span>
          </button>
        </div>
      </div>
    );
  }

  const initials = profile.fullName
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const attMeta = ATTENDANCE_LABELS[profile.todayAttendanceStatus] || ATTENDANCE_LABELS.unmarked;
  const deploymentDuration = formatDurationBreakdown(profile.deployedSince, getTodayIso());

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col">
      {/* Top Verification Bar */}
      <header className="bg-slate-900 text-white border-b border-slate-800 px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded bg-orange-700 text-white font-display font-bold text-xs flex items-center justify-center shrink-0">
            {profile.companyName.slice(0, 3).toUpperCase()}
          </div>
          <span className="font-display font-bold text-sm sm:text-base tracking-tight truncate">
            {profile.companyName}
          </span>
          <span className="text-slate-600 hidden sm:inline" aria-hidden="true">/</span>
          <span className="text-xs text-slate-300 hidden sm:inline truncate">
            Read-Only Workforce Verification Pass
          </span>
        </div>

        <button
          type="button"
          onClick={onExitScanView}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-md hover:bg-slate-700 whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Back to Portal</span>
        </button>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
        {/* Identity Header Card */}
        <section
          aria-labelledby="qr-employee-name"
          className="bg-white border border-slate-200 rounded-lg overflow-hidden"
        >
          <div className="h-1.5 bg-orange-700" />
          <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-16 h-20 rounded-md border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center shrink-0">
                {profile.photoDataUrl ? (
                  <img
                    src={profile.photoDataUrl}
                    alt={profile.fullName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="font-display font-bold text-xl text-slate-400">
                    {initials || 'ID'}
                  </span>
                )}
              </div>

              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-mono">
                  <span className="font-semibold text-orange-700">{profile.empCode}</span>
                  <span className="text-slate-300" aria-hidden="true">·</span>
                  <span className="font-medium text-slate-700">{profile.role}</span>
                  <span className="text-slate-300" aria-hidden="true">·</span>
                  <span
                    className={
                      profile.status === 'active'
                        ? 'font-semibold text-emerald-700'
                        : 'font-semibold text-slate-500'
                    }
                  >
                    {profile.status === 'active' ? 'Active on Roster' : 'Inactive'}
                  </span>
                </div>

                <h1
                  id="qr-employee-name"
                  className="text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight truncate"
                >
                  {profile.fullName}
                </h1>

                <div className="text-xs text-slate-500 font-mono tabular-nums flex flex-wrap items-center gap-x-2">
                  <span>Joined: {profile.joiningDate || '—'}</span>
                  <span aria-hidden="true">·</span>
                  <span>Read-Only Verification</span>
                </div>
              </div>
            </div>

            <div className="flex sm:flex-col items-start sm:items-end justify-between gap-2 shrink-0">
              <div
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-md ${attMeta.style}`}
              >
                <CalendarCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{attMeta.label}</span>
              </div>
              <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                Date: {profile.todayAttendanceDate || getTodayIso()}
              </div>
            </div>
          </div>
        </section>

        {/* Current Site Deployment */}
        <section
          aria-labelledby="qr-deployment-heading"
          className="bg-white border border-slate-200 rounded-lg p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-orange-700 shrink-0" aria-hidden="true" />
              <h2 id="qr-deployment-heading" className="text-base font-semibold text-slate-900">
                Current Site Deployment
              </h2>
            </div>
            <span className="text-xs font-mono text-slate-500 tabular-nums whitespace-nowrap shrink-0">
              {profile.deployedSince ? `Since ${profile.deployedSince}` : 'Current Assignment'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md">
              <div className="text-[11px] font-medium text-slate-500">Assigned Project</div>
              <div className="mt-1 text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                <span>{profile.currentProjectName || 'Unassigned'}</span>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md">
              <div className="text-[11px] font-medium text-slate-500">Assigned Tower / Block</div>
              <div className="mt-1 text-sm font-semibold text-orange-800">
                {profile.currentTowerName || 'All / Pending'}
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md">
              <div className="text-[11px] font-medium text-slate-500">Site Tenure</div>
              <div className="mt-1 text-sm font-mono tabular-nums font-semibold text-slate-900">
                {profile.deployedSince ? deploymentDuration.label : '—'}
              </div>
            </div>
          </div>

          {profile.recentDeployments.length > 0 && (
            <div className="pt-2">
              <div className="text-xs font-semibold text-slate-700 mb-2">
                Recent Site Deployment Log
              </div>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-md">
                {profile.recentDeployments.map((dep, idx) => (
                  <div
                    key={`${dep.projectName}-${dep.towerName}-${dep.assignedDate}-${idx}`}
                    className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="font-medium text-slate-900">
                      {dep.projectName} · <span className="text-orange-800">{dep.towerName}</span>
                    </div>
                    <div className="font-mono tabular-nums text-slate-500">
                      {dep.assignedDate}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Active Work Status */}
        <section
          aria-labelledby="qr-work-heading"
          className="bg-white border border-slate-200 rounded-lg p-5 sm:p-6 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-orange-700 shrink-0" aria-hidden="true" />
              <h2 id="qr-work-heading" className="text-base font-semibold text-slate-900">
                Active Work Status
              </h2>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono tabular-nums text-slate-600">
              <span>
                {profile.activeAssignments.length}{' '}
                {profile.activeAssignments.length === 1 ? 'Active Task' : 'Active Tasks'}
              </span>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                {profile.completedZonesCount}{' '}
                {profile.completedZonesCount === 1 ? 'Zone Completed' : 'Zones Completed'}
              </span>
            </div>
          </div>

          {profile.activeAssignments.length === 0 ? (
            <div className="py-6 px-4 text-center bg-slate-50 border border-slate-200 rounded-md space-y-1">
              <div className="text-sm font-medium text-slate-800">
                No Active Flat or Zone Work Currently Open
              </div>
              <p className="text-xs text-slate-500">
                Employee is marked {profile.status} at{' '}
                {profile.currentProjectName || 'site'} with {profile.completedZonesCount} completed tile zones recorded.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-md overflow-hidden">
              {profile.activeAssignments.map((item, idx) => (
                <div
                  key={`${item.unitNumber}-${item.zoneLabel}-${idx}`}
                  className="p-3.5 sm:px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-slate-900">
                      <span>Flat {item.unitNumber}</span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="text-orange-800">{item.zoneLabel}</span>
                    </div>
                    <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-2">
                      <span>
                        {item.projectName} · {item.towerName}
                      </span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        Started {item.assignedDate}
                      </span>
                      {item.targetSqft > 0 && (
                        <>
                          <span className="text-slate-300" aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {item.targetSqft} sq.ft
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border whitespace-nowrap ${getWorkStatusBadgeClass(
                        item.status
                      )}`}
                    >
                      <Clock className="w-3 h-3" aria-hidden="true" />
                      <span>{getWorkStatusLabel(item.status)}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Footer Read-Only Notice */}
        <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 pt-1 pb-6">
          <div className="inline-flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-slate-400" aria-hidden="true" />
            <span>
              Official read-only workforce verification view · Payroll &amp; personal ID numbers hidden
            </span>
          </div>
          <span className="font-mono tabular-nums">
            {resolved.source === 'live_workspace'
              ? 'Live Workspace View'
              : resolved.source === 'cloud_pass'
                ? 'Synced Cloud Pass'
                : 'Badge QR Verification'}
          </span>
        </footer>
      </main>
    </div>
  );
}
