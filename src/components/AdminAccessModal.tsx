import React, { useEffect, useState } from 'react';
import { HardHat, KeyRound, ShieldCheck, Users, X } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import {
  DEFAULT_ADMIN_EDIT_PIN,
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  DEFAULT_USER_PIN,
  resolveEmployeeLoginPin,
  resolveSupervisorTowerIds,
} from '../utils/authAccess';

interface AdminAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AdminAccessModal({ isOpen, onClose }: AdminAccessModalProps) {
  const {
    companyProfile,
    projects,
    towers,
    employees,
    updateCompanyProfile,
    updateEmployee,
  } = useStore();

  const [adminUsername, setAdminUsername] = useState(DEFAULT_ADMIN_USERNAME);
  const [adminPassword, setAdminPassword] = useState(DEFAULT_ADMIN_PASSWORD);
  const [adminEditPin, setAdminEditPin] = useState(DEFAULT_ADMIN_EDIT_PIN);
  const [supCanEdit, setSupCanEdit] = useState(false);

  const [supTowerDrafts, setSupTowerDrafts] = useState<Record<string, string[]>>({});
  const [pinDrafts, setPinDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setAdminUsername(companyProfile.adminUsername || DEFAULT_ADMIN_USERNAME);
    setAdminPassword(companyProfile.adminPassword || DEFAULT_ADMIN_PASSWORD);
    setAdminEditPin(companyProfile.adminEditPin || DEFAULT_ADMIN_EDIT_PIN);
    setSupCanEdit(Boolean(companyProfile.supervisorCanEditAttendance));

    const twrMap: Record<string, string[]> = {};
    const pinMap: Record<string, string> = {};
    for (const emp of employees) {
      pinMap[emp.id] = resolveEmployeeLoginPin(emp);
      if (emp.role === 'Supervisor' || (emp.assignedTowerIds && emp.assignedTowerIds.length > 0)) {
        twrMap[emp.id] = resolveSupervisorTowerIds(emp, towers);
      }
    }
    setSupTowerDrafts(twrMap);
    setPinDrafts(pinMap);
    setSavedMsg('');
  }, [isOpen, companyProfile, employees, towers]);

  if (!isOpen) return null;

  const supervisors = employees.filter(
    (e) => e.role === 'Supervisor' || (e.assignedTowerIds && e.assignedTowerIds.length > 0)
  );

  const toggleSupervisorTower = (empId: string, towerId: string) => {
    setSupTowerDrafts((prev) => {
      const current = prev[empId] || [];
      const next = current.includes(towerId)
        ? current.filter((id) => id !== towerId)
        : [...current, towerId];
      return { ...prev, [empId]: next };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedMsg('');
    try {
      await updateCompanyProfile({
        adminUsername: adminUsername.trim() || DEFAULT_ADMIN_USERNAME,
        adminPassword: adminPassword.trim() || DEFAULT_ADMIN_PASSWORD,
        adminEditPin: adminEditPin.trim() || DEFAULT_ADMIN_EDIT_PIN,
        supervisorCanEditAttendance: supCanEdit,
      });

      for (const emp of employees) {
        const nextPin = (pinDrafts[emp.id] || DEFAULT_USER_PIN).trim();
        const prevPin = resolveEmployeeLoginPin(emp);
        const nextTowers = supTowerDrafts[emp.id];
        const prevTowers = emp.assignedTowerIds || [];

        const towersChanged =
          Array.isArray(nextTowers) &&
          (nextTowers.length !== prevTowers.length ||
            nextTowers.some((id, idx) => prevTowers[idx] !== id));

        if (nextPin !== prevPin || towersChanged) {
          await updateEmployee(emp.id, {
            loginPin: nextPin,
            ...(Array.isArray(nextTowers) ? { assignedTowerIds: nextTowers } : {}),
          });
        }
      }

      setSavedMsg('Saved Admin credentials, Supervisor tower scope, attendance lock & user PINs.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="role-access-title"
    >
      <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-orange-700" aria-hidden="true" />
            <div>
              <h2 id="role-access-title" className="text-base font-semibold text-slate-900">
                Role Access, Supervisor Towers &amp; Login PINs
              </h2>
              <p className="text-xs text-slate-500">
                Manage Admin password, Attendance Edit Override PIN, Supervisor assigned towers, and Employee PINs.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close role access modal"
            className="p-2 text-slate-500 hover:text-slate-900 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-6 overflow-y-auto flex-1">
          {savedMsg && (
            <div className="p-3 text-xs font-medium text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md">
              {savedMsg}
            </div>
          )}

          {/* Admin Credentials & Attendance Lock Policy */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
              <KeyRound className="w-4 h-4 text-orange-700" aria-hidden="true" />
              <span>Admin Login &amp; Attendance Edit Lock Policy</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="acc-admin-user" className="block text-xs font-medium text-slate-700 mb-1">
                  Admin Username
                </label>
                <input
                  id="acc-admin-user"
                  type="text"
                  required
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm font-mono bg-white border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="acc-admin-pass" className="block text-xs font-medium text-slate-700 mb-1">
                  Admin Password
                </label>
                <input
                  id="acc-admin-pass"
                  type="text"
                  required
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm font-mono bg-white border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="acc-edit-pin" className="block text-xs font-medium text-slate-700 mb-1">
                  Attendance Edit Override PIN
                </label>
                <input
                  id="acc-edit-pin"
                  type="text"
                  required
                  value={adminEditPin}
                  onChange={(e) => setAdminEditPin(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm font-mono bg-white border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={supCanEdit}
                onChange={(e) => setSupCanEdit(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-orange-700 focus:ring-orange-600"
              />
              <span>
                <strong>Allow Supervisors to use &ldquo;Edit Attendance&rdquo; without Admin PIN</strong>{' '}
                (When unchecked, once a Supervisor marks attendance it locks and requires the Admin Edit PIN above to edit.)
              </span>
            </label>
          </div>

          {/* Supervisor Tower Assignments */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
              <HardHat className="w-4 h-4 text-amber-700" aria-hidden="true" />
              <span>Supervisor Assigned Towers ({supervisors.length})</span>
            </div>
            {supervisors.length === 0 ? (
              <div className="p-4 text-xs text-slate-500 border border-slate-200 rounded-md">
                Add an employee with role &ldquo;Supervisor&rdquo; in Workforce &amp; IDs to assign towers.
              </div>
            ) : (
              <div className="space-y-3">
                {supervisors.map((sup) => {
                  const selectedTowers = supTowerDrafts[sup.id] || [];
                  return (
                    <div key={sup.id} className="p-3.5 border border-slate-200 rounded-md space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-semibold text-sm text-slate-900">{sup.fullName}</span>{' '}
                          <span className="text-xs font-mono text-orange-700">({sup.empCode})</span>
                        </div>
                        <div className="text-xs text-slate-500 font-mono">
                          Assigned: {selectedTowers.length} tower(s)
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {towers.map((twr) => {
                          const proj = projects.find((p) => p.id === twr.projectId);
                          const checked = selectedTowers.includes(twr.id);
                          return (
                            <label
                              key={twr.id}
                              className={`inline-flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border cursor-pointer ${
                                checked
                                  ? 'bg-orange-50 border-orange-500 text-slate-900 font-medium'
                                  : 'bg-white border-slate-200 text-slate-600'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleSupervisorTower(sup.id, twr.id)}
                                className="rounded border-slate-300 text-orange-700"
                              />
                              <span>
                                {proj?.name ? `${proj.name} / ` : ''}
                                {twr.name}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Employee & Supervisor Login PINs */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
              <Users className="w-4 h-4 text-slate-700" aria-hidden="true" />
              <span>Supervisor &amp; Employee Login PINs</span>
            </div>
            <div className="border border-slate-200 rounded-md overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <th className="py-2 px-3">Employee ID</th>
                    <th className="py-2 px-3">Name &amp; Role</th>
                    <th className="py-2 px-3">Assigned Tower</th>
                    <th className="py-2 px-3 text-right">Login PIN</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {employees.map((emp) => (
                    <tr key={emp.id}>
                      <td className="py-2 px-3 font-mono font-semibold text-slate-800">
                        {emp.empCode}
                      </td>
                      <td className="py-2 px-3">
                        <span className="font-medium text-slate-900">{emp.fullName}</span>{' '}
                        <span className="text-slate-500">({emp.role})</span>
                      </td>
                      <td className="py-2 px-3 text-slate-600">
                        {emp.currentTowerName || 'Unassigned'}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <input
                          type="text"
                          aria-label={`Login PIN for ${emp.fullName}`}
                          value={pinDrafts[emp.id] || DEFAULT_USER_PIN}
                          onChange={(e) =>
                            setPinDrafts((prev) => ({ ...prev, [emp.id]: e.target.value }))
                          }
                          className="w-24 px-2 py-1 text-right font-mono border border-slate-300 rounded"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Access Settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
