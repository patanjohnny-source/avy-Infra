import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  FlipHorizontal2,
  QrCode,
  RotateCcw,
  Search,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import type { AttendanceRecord, AttendanceStatus, Employee, Project, Tower } from '../types/avy';
import type { WorkspaceSession } from '../utils/authAccess';
import {
  type QuickScanSessionItem,
  applyUndoScanToSession,
  getRecentLoggedScans,
  resolveQuickScanInput,
  validateQuickScanCandidate,
} from '../utils/quickScanAttendance';

interface QuickScanAttendanceModalProps {
  open: boolean;
  onClose: () => void;
  session: WorkspaceSession | null;
  projects: Project[];
  towers: Tower[];
  employees: Employee[];
  attendance: AttendanceRecord[];
  defaultDate: string;
  defaultProjectId: string;
  defaultTowerId: string;
  onMarkAttendance: (input: {
    date: string;
    employeeId: string;
    projectId: string;
    towerId?: string;
    status: AttendanceStatus;
    overtimeHours: number;
    notes?: string;
  }) => Promise<void>;
  onUndoAttendanceScan?: (date: string, employeeId: string) => Promise<void>;
}

type BarcodeDetectorInstance = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

export function QuickScanAttendanceModal({
  open,
  onClose,
  session,
  projects,
  towers,
  employees,
  attendance,
  defaultDate,
  defaultProjectId,
  defaultTowerId,
  onMarkAttendance,
  onUndoAttendanceScan,
}: QuickScanAttendanceModalProps) {
  const [scanDate, setScanDate] = useState(defaultDate);
  const [scanProjectId, setScanProjectId] = useState(
    defaultProjectId === 'all' ? projects[0]?.id || '' : defaultProjectId
  );
  const [scanTowerId, setScanTowerId] = useState(defaultTowerId);
  const [scanStatus, setScanStatus] = useState<AttendanceStatus>('present');
  const [scanOtHours, setScanOtHours] = useState('0');
  const [manualInput, setManualInput] = useState('');
  const [crewFilter, setCrewFilter] = useState('');

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [cameraMessage, setCameraMessage] = useState('');
  const [sessionLogs, setSessionLogs] = useState<QuickScanSessionItem[]>([]);
  const [scannedEmployeeIds, setScannedEmployeeIds] = useState<string[]>([]);
  const [bannerStatus, setBannerStatus] = useState<{
    tone: 'ok' | 'warn' | 'err';
    text: string;
  } | null>(null);
  const [busyScan, setBusyScan] = useState(false);
  const [undoingLogId, setUndoingLogId] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLoopRef = useRef<number | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const lastDecodedRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });
  const scannedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    scannedIdsRef.current = new Set(scannedEmployeeIds);
  }, [scannedEmployeeIds]);

  const stopCamera = useCallback(() => {
    if (scanLoopRef.current !== null) {
      window.clearInterval(scanLoopRef.current);
      scanLoopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }
    setScanDate(defaultDate);
    setScanProjectId(defaultProjectId === 'all' ? projects[0]?.id || '' : defaultProjectId);
    setScanTowerId(defaultTowerId || 'all');
    setScanStatus('present');
    setScanOtHours('0');
    setManualInput('');
    setCrewFilter('');
    setSessionLogs([]);
    setScannedEmployeeIds([]);
    scannedIdsRef.current = new Set();
    setBannerStatus(null);
    setCameraMessage('');
    const t = setTimeout(() => manualInputRef.current?.focus(), 80);
    return () => {
      clearTimeout(t);
      stopCamera();
    };
  }, [open, defaultDate, defaultProjectId, defaultTowerId, projects, stopCamera]);

  const availableTowers = useMemo(
    () =>
      scanProjectId
        ? towers.filter((t) => t.projectId === scanProjectId)
        : towers,
    [towers, scanProjectId]
  );

  const dateAttendanceSet = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of attendance) {
      if (r.date === scanDate) map.set(r.employeeId, r);
    }
    return map;
  }, [attendance, scanDate]);

  const quickRoster = useMemo(() => {
    const q = crewFilter.trim().toLowerCase();
    return employees
      .filter((e) => e.status === 'active')
      .filter((e) => {
        if (!q) return true;
        return (
          e.fullName.toLowerCase().includes(q) ||
          e.empCode.toLowerCase().includes(q) ||
          e.role.toLowerCase().includes(q) ||
          e.phone.includes(q)
        );
      });
  }, [employees, crewFilter]);

  const processScanInput = useCallback(
    async (rawText: string) => {
      const cleaned = rawText.trim();
      if (!cleaned || busyScan) return;

      const match = resolveQuickScanInput(cleaned, employees);
      const timeLabel = new Date().toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      if (!match.ok || !match.employee) {
        const msg = match.reason || `No worker matched "${cleaned.slice(0, 40)}".`;
        setBannerStatus({ tone: 'err', text: msg });
        setSessionLogs((prev) => [
          {
            id: `scan_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            timestamp: timeLabel,
            scanDate,
            rawInput: cleaned,
            employeeName: 'Unrecognized Scan',
            status: scanStatus,
            outcome: 'blocked',
            message: msg,
          },
          ...prev,
        ]);
        return;
      }

      const emp = match.employee;

      const check = validateQuickScanCandidate({
        employee: emp,
        date: scanDate,
        session,
        existingAttendance: attendance,
        sessionLoggedIds: scannedIdsRef.current,
      });

      if (!check.canLog) {
        const isDup =
          check.issue === 'duplicate_in_session' || check.issue === 'already_marked_today';
        const reasonMsg = check.message || 'Scan blocked by attendance rules.';
        setBannerStatus({ tone: isDup ? 'warn' : 'err', text: reasonMsg });
        setSessionLogs((prev) => [
          {
            id: `scan_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            timestamp: timeLabel,
            scanDate,
            rawInput: cleaned,
            employeeId: emp.id,
            empCode: emp.empCode,
            employeeName: emp.fullName,
            role: emp.role,
            status: scanStatus,
            outcome: isDup ? 'duplicate' : 'blocked',
            message: reasonMsg,
          },
          ...prev,
        ]);
        return;
      }

      setBusyScan(true);
      try {
        const resolvedProjId = scanProjectId || emp.currentProjectId || projects[0]?.id || '';
        const resolvedTwrId =
          scanTowerId && scanTowerId !== 'all' ? scanTowerId : emp.currentTowerId || undefined;
        const ot = scanStatus === 'absent' ? 0 : Math.max(0, Math.min(16, Number(scanOtHours) || 0));

        await onMarkAttendance({
          date: scanDate,
          employeeId: emp.id,
          projectId: resolvedProjId,
          towerId: resolvedTwrId,
          status: scanStatus,
          overtimeHours: ot,
          notes: 'Quick Scan Attendance Session',
        });

        scannedIdsRef.current.add(emp.id);
        setScannedEmployeeIds((prev) => (prev.includes(emp.id) ? prev : [...prev, emp.id]));
        const statusText =
          scanStatus === 'present'
            ? 'Present'
            : scanStatus === 'half_day'
              ? 'Half Day'
              : 'Absent';
        const okMsg = `Logged ${statusText}${ot > 0 ? ` + ${ot}h OT` : ''} for ${emp.empCode} ${emp.fullName}`;
        setBannerStatus({ tone: 'ok', text: okMsg });
        setSessionLogs((prev) => [
          {
            id: `scan_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            timestamp: timeLabel,
            scanDate,
            rawInput: cleaned,
            employeeId: emp.id,
            empCode: emp.empCode,
            employeeName: emp.fullName,
            role: emp.role,
            status: scanStatus,
            overtimeHours: ot,
            outcome: 'logged',
            message: okMsg,
          },
          ...prev,
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to save attendance record.';
        setBannerStatus({ tone: 'err', text: msg });
        setSessionLogs((prev) => [
          {
            id: `scan_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            timestamp: timeLabel,
            scanDate,
            rawInput: cleaned,
            employeeId: emp.id,
            empCode: emp.empCode,
            employeeName: emp.fullName,
            role: emp.role,
            status: scanStatus,
            outcome: 'blocked',
            message: msg,
          },
          ...prev,
        ]);
      } finally {
        setBusyScan(false);
      }
    },
    [
      busyScan,
      employees,
      scanDate,
      scanProjectId,
      scanTowerId,
      scanStatus,
      scanOtHours,
      projects,
      session,
      attendance,
      onMarkAttendance,
    ]
  );

  const startCamera = useCallback(
    async (facing: 'environment' | 'user' = cameraFacing) => {
      stopCamera();
      setCameraMessage('');

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraMessage(
          'Live webcam access is not available in this browser or context. Use the QR / ID input box or Quick-Tap Roster below.'
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing } },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraActive(true);

        const DetectorCtor = (
          window as unknown as {
            BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorInstance;
          }
        ).BarcodeDetector;
        const detector = DetectorCtor ? new DetectorCtor({ formats: ['qr_code'] }) : null;

        scanLoopRef.current = window.setInterval(async () => {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (!video || !canvas || video.readyState < 2) return;

          const w = video.videoWidth || 640;
          const h = video.videoHeight || 480;
          if (w === 0 || h === 0) return;

          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(video, 0, 0, w, h);

          let detectedValue = '';
          if (detector) {
            try {
              const hits = await detector.detect(canvas);
              if (hits[0]?.rawValue) detectedValue = hits[0].rawValue;
            } catch {
              // Fall back to jsQR cleanly
            }
          }

          if (!detectedValue) {
            try {
              const imgData = ctx.getImageData(0, 0, w, h);
              const decoded = jsQR(imgData.data, w, h, { inversionAttempts: 'dontInvert' });
              if (decoded?.data) detectedValue = decoded.data;
            } catch {
              // Ignore frame decode noise
            }
          }

          if (detectedValue) {
            const now = Date.now();
            if (
              lastDecodedRef.current.value === detectedValue &&
              now - lastDecodedRef.current.at < 2500
            ) {
              return;
            }
            lastDecodedRef.current = { value: detectedValue, at: now };
            await processScanInput(detectedValue);
          }
        }, 220);
      } catch (err) {
        stopCamera();
        const reason =
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'Camera permission denied. Allow camera access or use the QR / Emp ID scanner box and Quick-Tap Roster below.'
            : 'No camera detected on this device. Use the QR / Emp ID scanner box (or handheld USB QR scanner) or Quick-Tap Roster below.';
        setCameraMessage(reason);
      }
    },
    [cameraFacing, stopCamera, processScanInput]
  );

  const handleUndoRecentScan = useCallback(
    async (item: QuickScanSessionItem) => {
      if (!item.employeeId || undoingLogId) return;
      setUndoingLogId(item.id);
      try {
        if (onUndoAttendanceScan) {
          await onUndoAttendanceScan(item.scanDate || scanDate, item.employeeId);
        }
        const applied = applyUndoScanToSession({
          logs: sessionLogs,
          scannedEmployeeIds,
          logId: item.id,
        });
        scannedIdsRef.current = new Set(applied.nextScannedEmployeeIds);
        setScannedEmployeeIds(applied.nextScannedEmployeeIds);
        setSessionLogs(applied.nextLogs);
        lastDecodedRef.current = { value: '', at: 0 };
        setBannerStatus({
          tone: 'warn',
          text: `Undone scan for ${item.empCode ? `${item.empCode} ` : ''}${item.employeeName}. Ready to re-scan.`,
        });
      } catch (err) {
        setBannerStatus({
          tone: 'err',
          text: err instanceof Error ? err.message : 'Unable to undo attendance scan.',
        });
      } finally {
        setUndoingLogId(null);
      }
    },
    [undoingLogId, onUndoAttendanceScan, scanDate, sessionLogs, scannedEmployeeIds]
  );

  if (!open) return null;

  const recentLoggedScans = getRecentLoggedScans(sessionLogs);
  const loggedCount = recentLoggedScans.length;
  const dupCount = sessionLogs.filter((l) => l.outcome === 'duplicate').length;
  const blockedCount = sessionLogs.filter((l) => l.outcome === 'blocked').length;
  const otherActivityLogs = sessionLogs.filter((l) => l.outcome !== 'logged');

  return (
    <div
      data-testid="quick-scan-attendance-modal"
      className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/60 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-scan-modal-title"
    >
      <div className="w-full max-w-5xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden max-h-[94vh] flex flex-col">
        {/* Header */}
        <header className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-md bg-orange-600/20 border border-orange-500/40 flex items-center justify-center shrink-0">
              <QrCode className="w-4 h-4 text-orange-300" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id="quick-scan-modal-title" className="text-sm sm:text-base font-semibold truncate">
                Quick Scan Attendance Session
              </h2>
              <p className="text-[11px] text-slate-300 truncate">
                Scan worker ID card QR codes continuously via camera, handheld scanner, or ID code — logs directly for {scanDate}.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            aria-label="Close Quick Scan Attendance modal"
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-md shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Session Controls Strip */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 shrink-0 text-xs">
          <div>
            <label htmlFor="qs-date" className="block text-[11px] font-medium text-slate-600 mb-1">
              Attendance Date
            </label>
            <input
              id="qs-date"
              type="date"
              value={scanDate}
              onChange={(e) => setScanDate(e.target.value)}
              className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded"
            />
          </div>
          <div>
            <label htmlFor="qs-project" className="block text-[11px] font-medium text-slate-600 mb-1">
              Project
            </label>
            <select
              id="qs-project"
              value={scanProjectId}
              onChange={(e) => {
                setScanProjectId(e.target.value);
                setScanTowerId('all');
              }}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="qs-tower" className="block text-[11px] font-medium text-slate-600 mb-1">
              Tower Override
            </label>
            <select
              id="qs-tower"
              value={scanTowerId}
              onChange={(e) => setScanTowerId(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded"
            >
              <option value="all">Worker&apos;s Assigned Tower</option>
              {availableTowers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="block text-[11px] font-medium text-slate-600 mb-1">
              Mark On Scan As
            </span>
            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  { id: 'present', label: 'Present', cls: 'bg-emerald-700 text-white border-emerald-700' },
                  { id: 'half_day', label: 'Half', cls: 'bg-amber-600 text-white border-amber-600' },
                  { id: 'absent', label: 'Absent', cls: 'bg-red-700 text-white border-red-700' },
                ] as const
              ).map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setScanStatus(st.id)}
                  className={`py-1.5 text-[11px] font-semibold rounded border ${
                    scanStatus === st.id
                      ? st.cls
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="qs-ot" className="block text-[11px] font-medium text-slate-600 mb-1">
              Default OT Hours
            </label>
            <input
              id="qs-ot"
              type="number"
              min="0"
              max="16"
              step="0.5"
              disabled={scanStatus === 'absent'}
              value={scanOtHours}
              onChange={(e) => setScanOtHours(e.target.value)}
              className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded disabled:bg-slate-100"
            />
          </div>
        </div>

        {/* Body Split */}
        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Camera + Instant Scanner Input + Quick-Tap Roster */}
          <div className="lg:col-span-7 space-y-4">
            {/* Live Camera Panel */}
            <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-950 text-white">
              <div className="px-3.5 py-2 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      cameraActive ? 'bg-emerald-400' : 'bg-slate-500'
                    }`}
                  />
                  <span className="font-semibold">
                    {cameraActive ? 'Camera QR Scanner Active' : 'Camera Scanner Standby'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {cameraActive && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = cameraFacing === 'environment' ? 'user' : 'environment';
                        setCameraFacing(next);
                        startCamera(next);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 rounded border border-slate-700"
                    >
                      <FlipHorizontal2 className="w-3 h-3" aria-hidden="true" />
                      <span>Flip</span>
                    </button>
                  )}
                  {cameraActive ? (
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-red-700 hover:bg-red-600 rounded"
                    >
                      <CameraOff className="w-3 h-3" aria-hidden="true" />
                      <span>Stop Camera</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startCamera(cameraFacing)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-orange-600 hover:bg-orange-500 rounded"
                    >
                      <Camera className="w-3 h-3" aria-hidden="true" />
                      <span>Start Camera Scan</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="relative flex items-center justify-center min-h-[180px] max-h-60 bg-slate-950">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className={`w-full max-h-60 object-cover ${cameraActive ? 'block' : 'hidden'}`}
                />
                <canvas ref={canvasRef} className="hidden" />
                {!cameraActive && (
                  <div className="p-5 text-center space-y-2 max-w-md">
                    <QrCode className="w-9 h-9 text-slate-500 mx-auto" aria-hidden="true" />
                    <p className="text-xs text-slate-300">
                      Click <strong>Start Camera Scan</strong> to read worker physical ID card QR codes continuously, or scan directly into the QR / Code input box below.
                    </p>
                  </div>
                )}
              </div>

              {cameraMessage && (
                <div className="px-3.5 py-2 text-[11px] bg-amber-950/90 text-amber-200 border-t border-amber-800/70">
                  {cameraMessage}
                </div>
              )}
            </div>

            {/* Instant QR / ID / Handheld Scanner Box */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!manualInput.trim()) return;
                await processScanInput(manualInput);
                setManualInput('');
                manualInputRef.current?.focus();
              }}
              className="p-3.5 bg-white border border-slate-200 rounded-lg space-y-2"
            >
              <label
                htmlFor="quick-scan-code-input"
                className="block text-xs font-semibold text-slate-800"
              >
                Scan QR Payload, Employee Code, or Phone (Camera / USB Scanner / Manual)
              </label>
              <div className="flex gap-2">
                <input
                  ref={manualInputRef}
                  id="quick-scan-code-input"
                  type="text"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder="e.g. AVY-001, ?qrToken=..., or 9876543210"
                  className="flex-1 px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
                />
                <button
                  type="submit"
                  disabled={!manualInput.trim() || busyScan}
                  className="px-4 py-2 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50 whitespace-nowrap"
                >
                  Log Scan
                </button>
              </div>
            </form>

            {bannerStatus && (
              <div
                role="status"
                className={`p-3 text-xs font-medium rounded-md border flex items-center gap-2 ${
                  bannerStatus.tone === 'ok'
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                    : bannerStatus.tone === 'warn'
                      ? 'bg-amber-50 text-amber-900 border-amber-200'
                      : 'bg-red-50 text-red-900 border-red-200'
                }`}
              >
                {bannerStatus.tone === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                ) : (
                  <XCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                )}
                <span>{bannerStatus.text}</span>
              </div>
            )}

            {/* Quick-Tap Scoped Crew Fallback */}
            <div className="border border-slate-200 rounded-lg p-3.5 space-y-2.5 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-800">
                  Quick-Tap Active Crew ({quickRoster.length})
                </span>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" aria-hidden="true" />
                  <input
                    type="text"
                    value={crewFilter}
                    onChange={(e) => setCrewFilter(e.target.value)}
                    placeholder="Filter crew..."
                    className="pl-7 pr-2.5 py-1 text-xs border border-slate-300 rounded w-44"
                  />
                </div>
              </div>
              <div className="max-h-44 overflow-y-auto divide-y divide-slate-100">
                {quickRoster.slice(0, 25).map((emp) => {
                  const rec = dateAttendanceSet.get(emp.id);
                  const scannedNow = scannedEmployeeIds.includes(emp.id);
                  return (
                    <div key={emp.id} className="py-1.5 flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <span className="font-mono font-semibold text-slate-900">{emp.empCode}</span>{' '}
                        <span className="font-medium text-slate-800">{emp.fullName}</span>
                        <span className="text-[11px] text-slate-500"> · {emp.role}</span>
                      </div>
                      {rec || scannedNow ? (
                        <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded shrink-0">
                          {rec?.status === 'half_day'
                            ? 'Half Day'
                            : rec?.status === 'absent'
                              ? 'Absent'
                              : 'Marked'}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => processScanInput(emp.empCode)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100 shrink-0"
                        >
                          <UserCheck className="w-3 h-3" aria-hidden="true" />
                          <span>Scan / Mark</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: Recent Scans (Undo-ready) & Session Feed */}
          <div className="lg:col-span-5 flex flex-col border border-slate-200 rounded-lg bg-slate-50 overflow-hidden">
            <div className="p-3.5 bg-white border-b border-slate-200 space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wide">
                  Recent Scans ({recentLoggedScans.length})
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setSessionLogs([]);
                    setScannedEmployeeIds([]);
                    scannedIdsRef.current = new Set();
                    setBannerStatus(null);
                  }}
                  className="text-[11px] text-slate-500 hover:text-slate-800 font-medium"
                >
                  Clear Log View
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded bg-emerald-50 border border-emerald-200">
                  <div className="text-[10px] text-emerald-800">Logged</div>
                  <div className="text-base font-mono font-bold text-emerald-900">{loggedCount}</div>
                </div>
                <div className="p-2 rounded bg-amber-50 border border-amber-200">
                  <div className="text-[10px] text-amber-800">Duplicates</div>
                  <div className="text-base font-mono font-bold text-amber-900">{dupCount}</div>
                </div>
                <div className="p-2 rounded bg-red-50 border border-red-200">
                  <div className="text-[10px] text-red-800">Blocked</div>
                  <div className="text-base font-mono font-bold text-red-900">{blockedCount}</div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3 max-h-[430px]">
              {/* Primary Recent Scans List with Instant Undo */}
              <div data-testid="quick-scan-recent-scans" className="space-y-2">
                {recentLoggedScans.length === 0 ? (
                  <div className="py-6 px-3 text-center text-xs text-slate-500 bg-white border border-dashed border-slate-200 rounded-md">
                    No active scans logged in this session yet. Each scanned worker appears here with an instant <strong>Undo</strong> button.
                  </div>
                ) : (
                  recentLoggedScans.map((item) => {
                    const statusLabel =
                      item.status === 'present'
                        ? 'Present'
                        : item.status === 'half_day'
                          ? 'Half Day'
                          : 'Absent';
                    return (
                      <div
                        key={item.id}
                        data-testid={`recent-scan-item-${item.employeeId}`}
                        className="p-2.5 rounded-md border border-emerald-200 bg-white flex items-center justify-between gap-2.5"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className="font-mono font-semibold text-slate-900 shrink-0">
                              {item.empCode}
                            </span>
                            <span className="font-semibold text-slate-900 truncate">
                              {item.employeeName}
                            </span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                            <span className="font-medium text-emerald-700">
                              {statusLabel}
                              {item.overtimeHours && item.overtimeHours > 0
                                ? ` + ${item.overtimeHours}h OT`
                                : ''}
                            </span>
                            {item.role && <span>· {item.role}</span>}
                            <span className="font-mono text-[10px] text-slate-400">
                              {item.timestamp}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          data-testid={`undo-scan-${item.employeeId}`}
                          disabled={undoingLogId === item.id}
                          onClick={() => {
                            void handleUndoRecentScan(item);
                          }}
                          aria-label={`Undo scan for ${item.empCode} ${item.employeeName}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 disabled:opacity-50 shrink-0"
                        >
                          <RotateCcw className="w-3 h-3" aria-hidden="true" />
                          <span>{undoingLogId === item.id ? 'Undoing...' : 'Undo'}</span>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Duplicate / Blocked / Undone Session Events */}
              {otherActivityLogs.length > 0 && (
                <div className="pt-2 border-t border-slate-200 space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Scan Alerts &amp; Reverted Entries ({otherActivityLogs.length})
                  </div>
                  {otherActivityLogs.slice(0, 12).map((item) => (
                    <div
                      key={item.id}
                      className={`p-2 rounded-md border text-[11px] bg-white ${
                        item.outcome === 'duplicate'
                          ? 'border-amber-200'
                          : item.outcome === 'undone'
                            ? 'border-slate-200'
                            : 'border-red-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-800 truncate">
                          {item.empCode ? `${item.empCode} · ` : ''}
                          {item.employeeName}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400 shrink-0">
                          {item.timestamp}
                        </span>
                      </div>
                      <p
                        className={`mt-0.5 ${
                          item.outcome === 'duplicate'
                            ? 'text-amber-800'
                            : item.outcome === 'undone'
                              ? 'text-slate-600'
                              : 'text-red-700'
                        }`}
                      >
                        {item.message}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="px-5 py-3 bg-white border-t border-slate-200 flex items-center justify-between gap-3 shrink-0 text-xs">
          <span className="text-slate-500">
            Session updates attendance live across Daily Attendance &amp; Payroll sheets.
          </span>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="px-4 py-1.5 font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
          >
            Done ({loggedCount} Logged)
          </button>
        </footer>
      </div>
    </div>
  );
}
