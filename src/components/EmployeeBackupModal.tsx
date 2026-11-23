import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  Download,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { Employee, EmployeeRole, RemovedEmployeeBackup } from '../types/avy';
import {
  buildEmployeeBackupExportPayload,
  filterRemovedEmployeeBackups,
  parseEmployeeBackupJson,
} from '../utils/employeeBackup';
import { formatINR } from '../utils/payroll';

const ROLES: EmployeeRole[] = [
  'Mason',
  'Helper',
  'Material Shifting',
  'Supervisor',
  'Engineer',
];

export function triggerJsonBackupDownload(filename: string, jsonText: string): void {
  const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface RemoveEmployeeConfirmModalProps {
  employee: Employee | null;
  documentsCount: number;
  attendanceCount: number;
  totalAdvances: number;
  netPayable: number;
  onCancel: () => void;
  onConfirm: (input: { removalReason: string; downloadJson: boolean }) => Promise<void>;
}

export function RemoveEmployeeConfirmModal({
  employee,
  documentsCount,
  attendanceCount,
  totalAdvances,
  netPayable,
  onCancel,
  onConfirm,
}: RemoveEmployeeConfirmModalProps) {
  const [removalReason, setRemovalReason] = useState('');
  const [downloadJson, setDownloadJson] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (employee) {
      setRemovalReason('');
      setDownloadJson(true);
      setSubmitting(false);
      setError('');
    }
  }, [employee?.id]);

  if (!employee) return null;

  const initials = employee.fullName
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await onConfirm({ removalReason: removalReason.trim(), downloadJson });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove employee and save backup.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-emp-backup-title"
    >
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-700" aria-hidden="true" />
            <h2 id="remove-emp-backup-title" className="text-base font-semibold text-slate-900">
              Remove User &amp; Save Backup
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            aria-label="Close remove worker confirmation"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded">
              {error}
            </div>
          )}

          {/* Worker Snapshot Card */}
          <div className="flex items-center gap-3.5 p-3.5 bg-slate-50 border border-slate-200 rounded-md">
            <div className="w-12 h-14 rounded border border-slate-300 bg-white overflow-hidden flex items-center justify-center shrink-0">
              {employee.photoDataUrl ? (
                <img
                  src={employee.photoDataUrl}
                  alt={employee.fullName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="font-mono font-bold text-sm text-slate-500">{initials}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-xs font-semibold text-orange-700">
                {employee.empCode} · {employee.role}
              </div>
              <div className="text-sm font-semibold text-slate-900 truncate">
                {employee.fullName}
              </div>
              <div className="text-xs text-slate-600 truncate">
                Mob: {employee.phone}
                {employee.currentProjectName
                  ? ` · ${employee.currentProjectName}${employee.currentTowerName ? ` (${employee.currentTowerName})` : ''}`
                  : ''}
              </div>
            </div>
          </div>

          {/* Summary Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-2.5 bg-white border border-slate-200 rounded">
              <div className="text-[11px] text-slate-500">Attendance</div>
              <div className="font-mono font-semibold text-slate-900">{attendanceCount} days</div>
            </div>
            <div className="p-2.5 bg-white border border-slate-200 rounded">
              <div className="text-[11px] text-slate-500">Documents</div>
              <div className="font-mono font-semibold text-slate-900">{documentsCount} files</div>
            </div>
            <div className="p-2.5 bg-white border border-slate-200 rounded">
              <div className="text-[11px] text-slate-500">Advances</div>
              <div className="font-mono font-semibold text-red-700">{formatINR(totalAdvances)}</div>
            </div>
            <div className="p-2.5 bg-white border border-slate-200 rounded">
              <div className="text-[11px] text-slate-500">Net Payable</div>
              <div className="font-mono font-semibold text-emerald-800">{formatINR(netPayable)}</div>
            </div>
          </div>

          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-950 space-y-1">
            <div className="font-semibold">Automatic Backup &amp; History Protection</div>
            <p className="text-emerald-900">
              A full backup snapshot (profile, photo, Aadhaar/PF/ESI IDs, uploaded documents, and skill tags) will be saved to{' '}
              <strong>Removed Backups</strong> so you can restore this worker anytime. Existing attendance, advance, and settlement ledgers stay preserved.
            </p>
          </div>

          <div>
            <label htmlFor="remove-worker-reason" className="block text-xs font-medium text-slate-700 mb-1">
              Removal Reason (Optional)
            </label>
            <input
              id="remove-worker-reason"
              type="text"
              maxLength={300}
              value={removalReason}
              onChange={(e) => setRemovalReason(e.target.value)}
              placeholder="e.g. Project completed, left site, contract closed"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={downloadJson}
              onChange={(e) => setDownloadJson(e.target.checked)}
              className="rounded border-slate-300 text-orange-700"
            />
            <span>Also download a portable .json backup file to this device</span>
          </label>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              disabled={submitting}
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="confirm-remove-worker-backup-btn"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-red-700 rounded-md hover:bg-red-800 disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
              <span>{submitting ? 'Backing up & Removing...' : 'Remove User & Save Backup'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface RemovedEmployeeBackupsModalProps {
  isOpen: boolean;
  backups: RemovedEmployeeBackup[];
  companyName: string;
  ownerId: string;
  onClose: () => void;
  onRestore: (
    backupOrId: string | RemovedEmployeeBackup
  ) => Promise<{ employee: Employee; codeReassigned: boolean }>;
  onDeleteForever: (backupId: string) => Promise<void>;
}

export function RemovedEmployeeBackupsModal({
  isOpen,
  backups,
  companyName,
  ownerId,
  onClose,
  onRestore,
  onDeleteForever,
}: RemovedEmployeeBackupsModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'All' | EmployeeRole>('All');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setRoleFilter('All');
      setConfirmDeleteId(null);
      setStatusMessage('');
      setErrorMessage('');
    }
  }, [isOpen]);

  const filtered = useMemo(
    () => filterRemovedEmployeeBackups(backups, searchQuery, roleFilter),
    [backups, searchQuery, roleFilter]
  );

  if (!isOpen) return null;

  const handleExportAll = () => {
    if (backups.length === 0) return;
    const { filename, json } = buildEmployeeBackupExportPayload({
      backups,
      companyName,
    });
    triggerJsonBackupDownload(filename, json);
    setErrorMessage('');
    setStatusMessage(`Exported ${backups.length} worker backup(s) to ${filename}.`);
  };

  const handleExportSingle = (backup: RemovedEmployeeBackup) => {
    const { filename, json } = buildEmployeeBackupExportPayload({
      backups: [backup],
      companyName,
    });
    triggerJsonBackupDownload(filename, json);
    setErrorMessage('');
    setStatusMessage(`Downloaded backup JSON for ${backup.fullName} (${backup.empCode}).`);
  };

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorMessage('');
    setStatusMessage('');
    try {
      const text = await file.text();
      const parsed = parseEmployeeBackupJson(text, ownerId);
      if (!parsed.ok) {
        setErrorMessage(parsed.error);
        return;
      }
      let restoredCount = 0;
      for (const item of parsed.backups) {
        await onRestore(item);
        restoredCount += 1;
      }
      setStatusMessage(
        `Imported and restored ${restoredCount} worker profile${restoredCount === 1 ? '' : 's'} into Workforce & IDs.`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to import JSON backup.');
    }
  };

  const handleRestoreItem = async (backup: RemovedEmployeeBackup) => {
    setErrorMessage('');
    setStatusMessage('');
    setBusyId(backup.id);
    try {
      const res = await onRestore(backup.id);
      setStatusMessage(
        res.codeReassigned
          ? `Restored ${res.employee.fullName} with new ID ${res.employee.empCode} (original code ${backup.empCode} was already in use).`
          : `Restored ${res.employee.fullName} (${res.employee.empCode}) back to Workforce & IDs.`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not restore worker backup.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteConfirm = async (backup: RemovedEmployeeBackup) => {
    setErrorMessage('');
    setStatusMessage('');
    setBusyId(backup.id);
    try {
      await onDeleteForever(backup.id);
      setConfirmDeleteId(null);
      setStatusMessage(`Permanently removed backup for ${backup.fullName} (${backup.empCode}).`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to delete backup permanently.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="removed-backups-vault-title"
    >
      <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2.5">
            <Archive className="w-5 h-5 text-orange-700" aria-hidden="true" />
            <div>
              <h2 id="removed-backups-vault-title" className="text-base font-semibold text-slate-900">
                Removed Worker Backups Vault ({backups.length})
              </h2>
              <p className="text-xs text-slate-500">
                Every removed worker is automatically backed up here. Restore anytime or download/import .json files.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer">
              <Upload className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
              <span>Import JSON Backup</span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleImportJson}
                className="sr-only"
              />
            </label>
            <button
              type="button"
              onClick={handleExportAll}
              disabled={backups.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-900 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
              <span>Export All JSON</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close removed backups vault"
              className="p-2 text-slate-500 hover:text-slate-900 rounded-md"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between shrink-0">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
            <input
              type="text"
              aria-label="Search removed worker backups"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name, ID, phone, Aadhaar, PF/ESI, skill, or reason..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-md"
            />
          </div>
          <select
            aria-label="Filter removed backups by role"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as 'All' | EmployeeRole)}
            className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-md"
          >
            <option value="All">All Roles ({backups.length})</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="p-6 space-y-3 overflow-y-auto flex-1">
          {statusMessage && (
            <div className="p-3 text-xs font-medium text-emerald-900 bg-emerald-50 border border-emerald-200 rounded flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
              <span>{statusMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded">
              {errorMessage}
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="py-12 text-center border border-dashed border-slate-200 rounded-lg space-y-2">
              <Archive className="w-8 h-8 text-slate-300 mx-auto" aria-hidden="true" />
              <div className="text-sm font-medium text-slate-700">
                {backups.length === 0
                  ? 'No removed worker backups stored yet'
                  : 'No backups match your search filters'}
              </div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Whenever you remove a worker from Workforce &amp; IDs, a complete recoverable snapshot appears here automatically. You can also import a previously saved .json backup above.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((backup) => {
                const snap = backup.employeeSnapshot;
                const isBusy = busyId === backup.id;
                const isConfirmingDelete = confirmDeleteId === backup.id;
                const initials = backup.fullName
                  .split(' ')
                  .map((p) => p[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase();

                return (
                  <div
                    key={backup.id}
                    data-testid={`backup-card-${backup.empCode}`}
                    className="p-4 border border-slate-200 rounded-lg bg-white space-y-3"
                  >
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-11 h-14 rounded border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center shrink-0">
                          {snap?.photoDataUrl ? (
                            <img
                              src={snap.photoDataUrl}
                              alt={backup.fullName}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="font-mono text-xs font-bold text-slate-500">
                              {initials}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 space-y-0.5">
                          <div className="font-mono text-xs font-semibold text-orange-700">
                            {backup.empCode} · {backup.role}
                          </div>
                          <div className="text-sm font-semibold text-slate-900">
                            {backup.fullName}
                          </div>
                          <div className="text-xs text-slate-600 flex flex-wrap gap-x-2 gap-y-0.5">
                            <span className="font-mono">Mob: {backup.phone}</span>
                            {snap?.currentProjectName && (
                              <span>
                                · Last Site: {snap.currentProjectName}
                                {snap.currentTowerName ? ` (${snap.currentTowerName})` : ''}
                              </span>
                            )}
                            <span>· Removed: {backup.removedAt.slice(0, 10)}</span>
                            <span>· By: {backup.removedByName}</span>
                          </div>
                          {backup.removalReason && (
                            <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded px-2 py-1 mt-1 inline-block">
                              Reason: {backup.removalReason}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleRestoreItem(backup)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap"
                        >
                          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{isBusy ? 'Restoring...' : 'Restore to Workforce'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleExportSingle(backup)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap"
                        >
                          <Download className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Download JSON</span>
                        </button>
                        {isConfirmingDelete ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleDeleteConfirm(backup)}
                              className="px-2.5 py-1.5 text-xs font-semibold text-white bg-red-700 rounded hover:bg-red-800"
                            >
                              Confirm Delete
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded hover:bg-slate-200"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setConfirmDeleteId(backup.id)}
                            aria-label={`Delete backup for ${backup.fullName} permanently`}
                            className="p-1.5 text-slate-500 hover:text-red-700 bg-slate-50 border border-slate-200 rounded hover:bg-red-50"
                            title="Delete backup permanently"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-slate-100 text-[11px]">
                      <div>
                        <span className="text-slate-500">Attendance:</span>{' '}
                        <strong className="font-mono text-slate-900">
                          {backup.summary.attendanceCount}d ({backup.summary.presentDays}P)
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-500">Docs Archived:</span>{' '}
                        <strong className="font-mono text-slate-900">
                          {backup.documents.length}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-500">Daily Rate:</span>{' '}
                        <strong className="font-mono text-slate-900">
                          {formatINR(snap?.dailyRate || 0)}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-500">Advances:</span>{' '}
                        <strong className="font-mono text-red-700">
                          {formatINR(backup.summary.totalAdvances)}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-500">Net Payable:</span>{' '}
                        <strong className="font-mono text-emerald-800">
                          {formatINR(backup.summary.netPayable)}
                        </strong>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
