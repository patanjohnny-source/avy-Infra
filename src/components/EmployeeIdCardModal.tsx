import React, { useEffect, useMemo, useState } from 'react';
import {
  Building,
  Check,
  Copy,
  Download,
  ExternalLink,
  IdCard,
  ImagePlus,
  Palette,
  Printer,
  RotateCcw,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { Employee, WhatsappMessagePayload } from '../types/avy';
import { isAdminSession } from '../utils/authAccess';
import { buildEmployeeIdCardPdfBlob, compressImageToDataUrl } from '../utils/idCardPdf';
import type { IdCardPrintSides } from '../utils/printLayout';
import {
  buildEmployeeQrPassData,
  buildEmployeeQrScanUrl,
  generateQrPngDataUrl,
} from '../utils/qrProfile';
import { PrintPreviewOverlay } from './PrintPreviewOverlay';
import { QrCodeSvg } from './QrCodeSvg';

interface EmployeeIdCardModalProps {
  employee: Employee | null;
  onClose: () => void;
  onOpenCompanySettings: () => void;
  onTriggerWhatsapp: (payload: WhatsappMessagePayload) => void;
  onPreviewQrProfile?: (scanUrl: string) => void;
}

const PRESET_THEMES = [
  {
    label: 'AVY Corporate',
    bgColor: '#ffffff',
    headerColor: '#0f172a',
    accentColor: '#c2410c',
    textColor: '#0f172a',
  },
  {
    label: 'Site Emerald',
    bgColor: '#f8fafc',
    headerColor: '#064e3b',
    accentColor: '#059669',
    textColor: '#0f172a',
  },
  {
    label: 'Cobalt Blue',
    bgColor: '#ffffff',
    headerColor: '#1e3a8a',
    accentColor: '#2563eb',
    textColor: '#0f172a',
  },
  {
    label: 'Warm Sandstone',
    bgColor: '#fffbeb',
    headerColor: '#451a03',
    accentColor: '#d97706',
    textColor: '#1c1917',
  },
];

export function EmployeeIdCardModal({
  employee,
  onClose,
  onOpenCompanySettings,
  onTriggerWhatsapp,
  onPreviewQrProfile,
}: EmployeeIdCardModalProps) {
  const {
    session,
    companyProfile,
    projects,
    towers,
    deployments,
    assignments,
    attendance,
    ensureEmployeeQrPass,
    updateCompanyProfile,
  } = useStore();

  const isAdmin = isAdminSession(session);

  const [shareNote, setShareNote] = useState('');
  const [liveScanUrl, setLiveScanUrl] = useState('');
  const [copiedQrLink, setCopiedQrLink] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);
  const [showPrintOverlay, setShowPrintOverlay] = useState(false);
  const [printSides, setPrintSides] = useState<IdCardPrintSides>('both');

  // Global Custom ID Card Background Editor (applies to every employee once saved)
  const [showBgEditor, setShowBgEditor] = useState(false);
  const [draftBgColor, setDraftBgColor] = useState(companyProfile.idCardBgColor || '#ffffff');
  const [draftHeaderColor, setDraftHeaderColor] = useState(
    companyProfile.idCardHeaderColor || '#0f172a'
  );
  const [draftAccentColor, setDraftAccentColor] = useState(
    companyProfile.idCardAccentColor || '#c2410c'
  );
  const [draftTextColor, setDraftTextColor] = useState(
    companyProfile.idCardTextColor || '#0f172a'
  );
  const [draftFrontBgUrl, setDraftFrontBgUrl] = useState(
    companyProfile.idCardFrontBgDataUrl || ''
  );
  const [draftBackBgUrl, setDraftBackBgUrl] = useState(
    companyProfile.idCardBackBgDataUrl || ''
  );
  const [draftBgOpacity, setDraftBgOpacity] = useState<number>(
    typeof companyProfile.idCardBgOpacity === 'number' ? companyProfile.idCardBgOpacity : 0.25
  );
  const [savingBg, setSavingBg] = useState(false);
  const [bgError, setBgError] = useState('');

  useEffect(() => {
    setDraftBgColor(companyProfile.idCardBgColor || '#ffffff');
    setDraftHeaderColor(companyProfile.idCardHeaderColor || '#0f172a');
    setDraftAccentColor(companyProfile.idCardAccentColor || '#c2410c');
    setDraftTextColor(companyProfile.idCardTextColor || '#0f172a');
    setDraftFrontBgUrl(companyProfile.idCardFrontBgDataUrl || '');
    setDraftBackBgUrl(companyProfile.idCardBackBgDataUrl || '');
    setDraftBgOpacity(
      typeof companyProfile.idCardBgOpacity === 'number' ? companyProfile.idCardBgOpacity : 0.25
    );
  }, [companyProfile, employee]);

  const fallbackScanUrl = useMemo(() => {
    if (!employee) return '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const passData = buildEmployeeQrPassData({
      employee,
      companyName: companyProfile.companyName || 'AVY INFRA',
      projects,
      towers,
      deployments,
      assignments,
      attendance,
    });
    return buildEmployeeQrScanUrl({
      origin,
      passData,
      qrToken: employee.qrToken,
    });
  }, [employee, companyProfile.companyName, projects, towers, deployments, assignments, attendance]);

  useEffect(() => {
    setShareNote('');
    setCopiedQrLink(false);
    setLiveScanUrl('');
    setShowPrintOverlay(false);
    setPrintSides('both');
    if (!employee) return;
    let active = true;
    void ensureEmployeeQrPass(employee.id).then((res) => {
      if (active && res.scanUrl) {
        setLiveScanUrl(res.scanUrl);
      }
    });
    return () => {
      active = false;
    };
  }, [employee, ensureEmployeeQrPass]);

  if (!employee) return null;

  // Live preview merges draft values when editor is open, otherwise uses companyProfile
  const activeBgColor = showBgEditor ? draftBgColor : companyProfile.idCardBgColor || '#ffffff';
  const activeHeaderColor = showBgEditor
    ? draftHeaderColor
    : companyProfile.idCardHeaderColor || '#0f172a';
  const activeAccentColor = showBgEditor
    ? draftAccentColor
    : companyProfile.idCardAccentColor || '#c2410c';
  const activeTextColor = showBgEditor
    ? draftTextColor
    : companyProfile.idCardTextColor || '#0f172a';
  const activeFrontBgUrl = showBgEditor
    ? draftFrontBgUrl
    : companyProfile.idCardFrontBgDataUrl || '';
  const activeBackBgUrl = showBgEditor
    ? draftBackBgUrl || draftFrontBgUrl
    : companyProfile.idCardBackBgDataUrl || companyProfile.idCardFrontBgDataUrl || '';
  const activeBgOpacity = showBgEditor
    ? draftBgOpacity
    : typeof companyProfile.idCardBgOpacity === 'number'
      ? companyProfile.idCardBgOpacity
      : 0.25;

  const previewCompanyProfile = {
    ...companyProfile,
    idCardBgColor: activeBgColor,
    idCardHeaderColor: activeHeaderColor,
    idCardAccentColor: activeAccentColor,
    idCardTextColor: activeTextColor,
    idCardFrontBgDataUrl: activeFrontBgUrl,
    idCardBackBgDataUrl: activeBackBgUrl,
    idCardBgOpacity: activeBgOpacity,
  };

  const scanUrl = liveScanUrl || fallbackScanUrl;

  const initials = employee.fullName
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const siteLabel = employee.currentProjectName
    ? `${employee.currentProjectName}${employee.currentTowerName ? ` · ${employee.currentTowerName}` : ''}`
    : 'All Active Sites';

  const handleUploadBgImage = async (
    side: 'front' | 'back' | 'both',
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBgError('');
    try {
      const compressed = await compressImageToDataUrl(file, 420, 660, 0.72);
      const bounded = compressed.slice(0, 115000);
      if (side === 'front' || side === 'both') setDraftFrontBgUrl(bounded);
      if (side === 'back' || side === 'both') setDraftBackBgUrl(bounded);
    } catch (err) {
      setBgError(err instanceof Error ? err.message : 'Failed to process background image.');
    }
  };

  const handleSaveGlobalBackground = async () => {
    setBgError('');
    setSavingBg(true);
    try {
      await updateCompanyProfile({
        idCardBgColor: draftBgColor,
        idCardHeaderColor: draftHeaderColor,
        idCardAccentColor: draftAccentColor,
        idCardTextColor: draftTextColor,
        idCardFrontBgDataUrl: draftFrontBgUrl,
        idCardBackBgDataUrl: draftBackBgUrl,
        idCardBgOpacity: draftBgOpacity,
      });
      setShareNote('Global vertical ID card background saved — now active for every employee!');
      setShowBgEditor(false);
    } catch (err) {
      setBgError(err instanceof Error ? err.message : 'Could not save ID card background.');
    } finally {
      setSavingBg(false);
    }
  };

  const handleResetDefaultBg = () => {
    setDraftBgColor('#ffffff');
    setDraftHeaderColor('#0f172a');
    setDraftAccentColor('#c2410c');
    setDraftTextColor('#0f172a');
    setDraftFrontBgUrl('');
    setDraftBackBgUrl('');
    setDraftBgOpacity(0.25);
  };

  const buildPdfWithQr = async (): Promise<{ blob: Blob; fileName: string; resolvedUrl: string }> => {
    const ensured = await ensureEmployeeQrPass(employee.id);
    const resolvedUrl = ensured.scanUrl || scanUrl;
    const qrPngDataUrl = await generateQrPngDataUrl(resolvedUrl, 240);
    const pdf = buildEmployeeIdCardPdfBlob(employee, previewCompanyProfile, qrPngDataUrl);
    return { ...pdf, resolvedUrl };
  };

  const triggerDownloadPdf = async (): Promise<{ blob: Blob; fileName: string; resolvedUrl: string }> => {
    setBusyPdf(true);
    try {
      const { blob, fileName, resolvedUrl } = await buildPdfWithQr();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return { blob, fileName, resolvedUrl };
    } finally {
      setBusyPdf(false);
    }
  };

  const handleOpenPrintPreview = async () => {
    setShareNote('');
    await ensureEmployeeQrPass(employee.id);
    setShowPrintOverlay(true);
  };

  const handleCopyQrLink = async () => {
    const ensured = await ensureEmployeeQrPass(employee.id);
    const targetUrl = ensured.scanUrl || scanUrl;
    setLiveScanUrl(targetUrl);
    try {
      await navigator.clipboard.writeText(targetUrl);
      setCopiedQrLink(true);
      setShareNote(`Copied QR site verification link for ${employee.empCode}.`);
      setTimeout(() => setCopiedQrLink(false), 2500);
    } catch {
      setShareNote(`QR scan link ready: ${targetUrl}`);
    }
  };

  const handlePreviewScannedProfile = async () => {
    const ensured = await ensureEmployeeQrPass(employee.id);
    const targetUrl = ensured.scanUrl || scanUrl;
    onClose();
    onPreviewQrProfile?.(targetUrl);
  };

  const handleSharePdfToMobile = async () => {
    setShareNote('');
    const { blob, fileName, resolvedUrl } = await buildPdfWithQr();
    const pdfFile = new File([blob], fileName, { type: 'application/pdf' });

    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
    };

    if (typeof nav.share === 'function' && (!nav.canShare || nav.canShare({ files: [pdfFile] }))) {
      try {
        await nav.share({
          title: `${companyProfile.companyName} ID Card — ${employee.fullName}`,
          text: `Official Vertical Employee ID Card (${employee.empCode}) for ${employee.fullName} — ${companyProfile.companyName}`,
          files: [pdfFile],
        });
        setShareNote('Vertical ID Card PDF shared via device share sheet.');
        return;
      } catch {
        // Fall through to download + WhatsApp
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);

    setShareNote(
      `Downloaded "${fileName}" (54×86mm Vertical Front & Back). Attach it in WhatsApp/Email below to send directly to ${employee.phone}.`
    );
    onTriggerWhatsapp({
      title: `Send Vertical ID Card PDF to ${employee.fullName} (${employee.phone})`,
      recipientName: `${employee.fullName} (${employee.empCode})`,
      recipientPhone: employee.phone,
      recipientEmail: employee.email || '',
      emailSubject: `${companyProfile.companyName} Official Employee ID Card — ${employee.empCode}`,
      message: [
        `*${companyProfile.companyName} — Official Staff ID Card (Vertical 54×86mm)*`,
        `Hello ${employee.fullName} (${employee.empCode}),`,
        `Your official Front & Back Vertical ID Card PDF (${fileName}) with scannable Site Verification QR has been generated.`,
        `Role: ${employee.role} | Site: ${siteLabel}`,
        `PF/UAN: ${employee.pfNumber || 'Pending'} | ESI: ${employee.esiNumber || 'Pending'}`,
        `Live Site QR Pass: ${resolvedUrl}`,
        `HR Helpline: ${companyProfile.hrContact}`,
      ].join('\n'),
    });
  };

  // Shared Vertical Front & Back Card JSX renderer (modal preview + exact 54x86mm CR80 print overlay)
  const renderVerticalFrontCard = (isPrintTarget: boolean) => (
    <div
      data-testid={isPrintTarget ? 'cr80-print-front' : 'id-card-front'}
      className={
        isPrintTarget
          ? 'id-card-cr80-page relative overflow-hidden flex flex-col justify-between border border-slate-300 shadow-lg rounded-md print:rounded-none print:shadow-none'
          : 'relative w-[270px] h-[430px] rounded-xl border border-slate-300 shadow-sm overflow-hidden flex flex-col justify-between'
      }
      style={{
        backgroundColor: activeBgColor,
        color: activeTextColor,
        width: isPrintTarget ? '54mm' : '270px',
        height: isPrintTarget ? '86mm' : '430px',
      }}
    >
      {activeFrontBgUrl && (
        <img
          src={activeFrontBgUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{ opacity: activeBgOpacity }}
        />
      )}

      {/* Header Band */}
      <div className="relative z-10 shrink-0">
        <div
          className={`text-white flex items-center justify-between gap-1.5 ${
            isPrintTarget ? 'px-2.5 py-1.5' : 'px-3.5 py-2.5 gap-2'
          }`}
          style={{ backgroundColor: activeHeaderColor }}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {companyProfile.logoDataUrl ? (
              <img
                src={companyProfile.logoDataUrl}
                alt={companyProfile.companyName}
                className={`${isPrintTarget ? 'w-5 h-5' : 'w-7 h-7'} rounded bg-white p-0.5 object-contain shrink-0`}
              />
            ) : (
              <div
                className={`${
                  isPrintTarget ? 'w-5 h-5 text-[8px]' : 'w-7 h-7 text-[10px]'
                } rounded text-white font-display font-bold flex items-center justify-center shrink-0`}
                style={{ backgroundColor: activeAccentColor }}
              >
                {companyProfile.companyName.slice(0, 3).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div
                className={`font-display font-bold tracking-tight truncate ${
                  isPrintTarget ? 'text-[9.5px]' : 'text-xs'
                }`}
              >
                {companyProfile.companyName}
              </div>
              <div
                className={`text-slate-200 truncate ${isPrintTarget ? 'text-[7px]' : 'text-[9px]'}`}
              >
                {companyProfile.tagline || 'Tile Laying & Stone Finishing'}
              </div>
            </div>
          </div>
          <span
            className={`font-mono font-semibold text-orange-200 tracking-wider shrink-0 ${
              isPrintTarget ? 'text-[6.5px]' : 'text-[8.5px]'
            }`}
          >
            STAFF ID
          </span>
        </div>
        <div className="h-1" style={{ backgroundColor: activeAccentColor }} />
      </div>

      {/* Vertical Centered Photo & Identity Body */}
      <div
        className={`relative z-10 flex-1 flex flex-col items-center text-center justify-start ${
          isPrintTarget ? 'px-2.5 py-2 gap-1.5' : 'px-4 py-3 gap-2.5'
        }`}
      >
        <div
          className={`${
            isPrintTarget ? 'w-16 h-20' : 'w-24 h-28'
          } rounded-lg border-2 bg-slate-50 overflow-hidden flex items-center justify-center shrink-0 shadow-xs`}
          style={{ borderColor: activeAccentColor }}
        >
          {employee.photoDataUrl ? (
            <img
              src={employee.photoDataUrl}
              alt={employee.fullName}
              className="w-full h-full object-cover"
            />
          ) : (
            <span
              className={`font-display font-bold text-slate-400 ${
                isPrintTarget ? 'text-base' : 'text-xl'
              }`}
            >
              {initials || 'ID'}
            </span>
          )}
        </div>

        <div className="w-full space-y-0.5">
          <div
            className={`font-display font-bold leading-tight truncate ${
              isPrintTarget ? 'text-xs' : 'text-base'
            }`}
            style={{ color: activeTextColor }}
          >
            {employee.fullName}
          </div>
          <div
            className={`font-mono font-bold uppercase tracking-wide ${
              isPrintTarget ? 'text-[8px]' : 'text-[11px]'
            }`}
            style={{ color: activeAccentColor }}
          >
            {employee.empCode} · {employee.role}
          </div>
        </div>

        <div
          className={`w-full border-t border-slate-300/70 text-left ${
            isPrintTarget ? 'pt-1.5 space-y-0.5 text-[8px]' : 'pt-2 space-y-1 text-[10.5px]'
          }`}
        >
          <div className="flex justify-between gap-2 font-mono tabular-nums">
            <span className="opacity-70">Mobile:</span>
            <span className="font-semibold">{employee.phone}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="opacity-70">Blood Group:</span>
            <strong className="text-red-700 font-bold">{employee.bloodGroup || 'N/A'}</strong>
          </div>
          <div className="flex justify-between gap-2 font-mono tabular-nums">
            <span className="opacity-70">Joined:</span>
            <span>{employee.joiningDate}</span>
          </div>
          <div className="flex justify-between gap-2" title={siteLabel}>
            <span className="opacity-70 shrink-0">Site:</span>
            <span className="font-semibold truncate text-right">{siteLabel}</span>
          </div>
        </div>
      </div>

      {/* Footer Band */}
      <div
        className={`relative z-10 text-white flex items-center justify-between font-mono shrink-0 ${
          isPrintTarget ? 'px-2.5 py-1.5 text-[7px]' : 'px-3.5 py-2 text-[9px]'
        }`}
        style={{ backgroundColor: activeHeaderColor }}
      >
        <span className="uppercase font-semibold">STATUS: {employee.status}</span>
        <span>HR: {companyProfile.hrContact}</span>
      </div>
    </div>
  );

  const renderVerticalBackCard = (isPrintTarget: boolean) => (
    <div
      data-testid={isPrintTarget ? 'cr80-print-back' : 'id-card-back'}
      className={
        isPrintTarget
          ? 'id-card-cr80-page relative overflow-hidden flex flex-col justify-between border border-slate-300 shadow-lg rounded-md print:rounded-none print:shadow-none'
          : 'relative w-[270px] h-[430px] rounded-xl border border-slate-300 shadow-sm overflow-hidden flex flex-col justify-between'
      }
      style={{
        backgroundColor: activeBgColor,
        color: activeTextColor,
        width: isPrintTarget ? '54mm' : '270px',
        height: isPrintTarget ? '86mm' : '430px',
      }}
    >
      {activeBackBgUrl && (
        <img
          src={activeBackBgUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{ opacity: activeBgOpacity }}
        />
      )}

      <div
        className={`relative z-10 text-white font-semibold tracking-wide uppercase text-center shrink-0 ${
          isPrintTarget ? 'px-2.5 py-1.5 text-[7.5px]' : 'px-3.5 py-2 text-[10px]'
        }`}
        style={{ backgroundColor: activeAccentColor }}
      >
        Statutory &amp; Site QR Pass
      </div>

      <div
        className={`relative z-10 flex-1 flex flex-col justify-between ${
          isPrintTarget ? 'px-2.5 py-1.5 gap-1' : 'px-3.5 py-2.5 gap-2'
        }`}
      >
        {/* Centered QR Verification Block */}
        <div className="flex justify-center pt-0.5">
          <div
            data-testid={isPrintTarget ? undefined : 'id-card-back-qr'}
            className={`flex flex-col items-center bg-white border border-slate-200 rounded-lg shadow-xs ${
              isPrintTarget ? 'p-1.5' : 'p-2'
            }`}
          >
            <QrCodeSvg
              value={scanUrl}
              size={isPrintTarget ? 68 : 92}
              ariaLabel={`QR verification code for ${employee.fullName}`}
            />
            <span
              className={`mt-0.5 font-mono font-bold uppercase tracking-wider text-slate-700 ${
                isPrintTarget ? 'text-[6px]' : 'text-[8px]'
              }`}
            >
              Scan Live Site Status
            </span>
          </div>
        </div>

        {/* Statutory Details */}
        <dl
          className={`grid gap-x-1.5 ${
            isPrintTarget
              ? 'grid-cols-[54px_1fr] gap-y-0.5 text-[7.5px]'
              : 'grid-cols-[74px_1fr] gap-y-1 text-[10px]'
          }`}
        >
          <dt className="font-medium opacity-75">Aadhaar:</dt>
          <dd className="font-mono font-medium truncate">
            {employee.aadharRef || 'Not recorded'}
          </dd>

          <dt className="font-medium opacity-75">PF / UAN:</dt>
          <dd className="font-mono font-medium truncate">
            {employee.pfNumber || 'Pending'}
          </dd>

          <dt className="font-medium opacity-75">ESI No:</dt>
          <dd className="font-mono font-medium truncate">
            {employee.esiNumber || 'Pending'}
          </dd>

          <dt className="font-medium opacity-75">Alt Mob:</dt>
          <dd className="font-mono font-medium truncate">
            {employee.alternatePhone || '—'}
          </dd>

          <dt className="font-medium opacity-75">Emergency:</dt>
          <dd className="truncate">{employee.emergencyContact || 'Not recorded'}</dd>
        </dl>

        {/* Company Office Address */}
        <div
          className={`border-t border-slate-300/70 space-y-0.5 ${
            isPrintTarget ? 'pt-1 text-[7.5px]' : 'pt-1.5 text-[9.5px]'
          }`}
        >
          <div className="font-semibold truncate">{companyProfile.companyName}</div>
          <div className="opacity-80 leading-snug line-clamp-2">{companyProfile.address}</div>
          <div
            className={`font-mono opacity-90 truncate ${isPrintTarget ? 'text-[7px]' : 'text-[9px]'}`}
          >
            HR: {companyProfile.hrContact}
            {companyProfile.hrEmail ? ` · ${companyProfile.hrEmail}` : ''}
          </div>
        </div>
      </div>

      <div
        className={`relative z-10 text-white flex items-center justify-between gap-2 shrink-0 ${
          isPrintTarget ? 'px-2.5 py-1.5 text-[6.5px]' : 'px-3 py-2 text-[8px]'
        }`}
        style={{ backgroundColor: activeHeaderColor }}
      >
        <span className="text-slate-200 shrink-0">Return to HR</span>
        <span className="font-semibold truncate min-w-0 text-right">
          {companyProfile.signatoryName || 'Authorized Signatory'}
        </span>
      </div>
    </div>
  );

  return (
    <>
      <PrintPreviewOverlay
        open={showPrintOverlay}
        mode="id_card_cr80"
        title={`ID Card Print Preview — ${employee.fullName} (${employee.empCode})`}
        subtitle={`${companyProfile.companyName} · Vertical CR80 Card (54mm × 86mm)`}
        onClose={() => setShowPrintOverlay(false)}
        onDownloadPdf={async () => {
          await triggerDownloadPdf();
        }}
        downloadPdfLabel="Download 54×86mm PDF"
        busyPdf={busyPdf}
        idCardSideControls={{
          sides: printSides,
          onChangeSides: setPrintSides,
        }}
        renderPrintContent={() => (
          <>
            {(printSides === 'both' || printSides === 'front') && renderVerticalFrontCard(true)}
            {(printSides === 'both' || printSides === 'back') && renderVerticalBackCard(true)}
          </>
        )}
      />
      <div
        className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="id-card-modal-title"
      >
        <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[94vh] flex flex-col">
          {/* Modal Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-slate-200 shrink-0">
            <div className="flex items-center gap-2.5">
              <IdCard className="w-5 h-5 text-orange-700" aria-hidden="true" />
              <div>
                <h2 id="id-card-modal-title" className="text-base font-semibold text-slate-900">
                  Vertical Staff ID Card (Front &amp; Back) — {employee.empCode}
                </h2>
                <p className="text-xs text-slate-500">
                  Portrait CR80 (54mm × 86mm) · Auto-prints exact ID Card size Front &amp; Back with Site QR Pass
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowBgEditor((v) => !v)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border whitespace-nowrap ${
                    showBgEditor
                      ? 'bg-orange-700 text-white border-orange-700'
                      : 'bg-orange-50 text-orange-800 border-orange-200 hover:bg-orange-100'
                  }`}
                >
                  <Palette className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Customize Card Background (All Staff)</span>
                </button>
              )}
              <button
                type="button"
                onClick={onOpenCompanySettings}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
              >
                <Building className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Company Details</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close ID card modal"
                className="p-2 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Scrollable Content Body */}
          <div className="p-6 overflow-y-auto bg-slate-100/70 space-y-5 flex-1">
            {/* Global Custom Background Editor Panel (Admin) */}
            {showBgEditor && isAdmin && (
              <section className="bg-white border border-orange-200 rounded-lg p-4 space-y-4 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Global Vertical ID Card Background Editor
                    </h3>
                    <p className="text-xs text-slate-500">
                      Customize colors or upload your own Front &amp; Back background design. Saving updates every employee&apos;s ID card automatically.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {PRESET_THEMES.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setDraftBgColor(preset.bgColor);
                          setDraftHeaderColor(preset.headerColor);
                          setDraftAccentColor(preset.accentColor);
                          setDraftTextColor(preset.textColor);
                        }}
                        className="px-2 py-1 text-[11px] font-medium bg-slate-50 border border-slate-200 rounded hover:bg-slate-100"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {bgError && (
                  <div className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded">
                    {bgError}
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <label className="block text-xs text-slate-700">
                    <span className="font-medium block mb-1">Card Base Color</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={draftBgColor}
                        onChange={(e) => setDraftBgColor(e.target.value)}
                        className="w-8 h-8 rounded border border-slate-300 cursor-pointer"
                      />
                      <span className="font-mono text-[11px] text-slate-600">{draftBgColor}</span>
                    </div>
                  </label>
                  <label className="block text-xs text-slate-700">
                    <span className="font-medium block mb-1">Header / Footer Band</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={draftHeaderColor}
                        onChange={(e) => setDraftHeaderColor(e.target.value)}
                        className="w-8 h-8 rounded border border-slate-300 cursor-pointer"
                      />
                      <span className="font-mono text-[11px] text-slate-600">{draftHeaderColor}</span>
                    </div>
                  </label>
                  <label className="block text-xs text-slate-700">
                    <span className="font-medium block mb-1">Accent Stripe / Role</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={draftAccentColor}
                        onChange={(e) => setDraftAccentColor(e.target.value)}
                        className="w-8 h-8 rounded border border-slate-300 cursor-pointer"
                      />
                      <span className="font-mono text-[11px] text-slate-600">{draftAccentColor}</span>
                    </div>
                  </label>
                  <label className="block text-xs text-slate-700">
                    <span className="font-medium block mb-1">Card Text Color</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={draftTextColor}
                        onChange={(e) => setDraftTextColor(e.target.value)}
                        className="w-8 h-8 rounded border border-slate-300 cursor-pointer"
                      />
                      <span className="font-mono text-[11px] text-slate-600">{draftTextColor}</span>
                    </div>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center pt-1">
                  <div className="space-y-1">
                    <span className="block text-xs font-medium text-slate-700">
                      Front Custom Background Image
                    </span>
                    <div className="flex items-center gap-2">
                      <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-300 rounded cursor-pointer hover:bg-slate-100">
                        <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{draftFrontBgUrl ? 'Change Front BG' : 'Upload Front BG'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleUploadBgImage('front', e)}
                          className="sr-only"
                        />
                      </label>
                      {draftFrontBgUrl && (
                        <button
                          type="button"
                          onClick={() => setDraftFrontBgUrl('')}
                          aria-label="Clear front background image"
                          className="p-1.5 text-red-700 border border-red-200 rounded hover:bg-red-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="block text-xs font-medium text-slate-700">
                      Back Custom Background Image
                    </span>
                    <div className="flex items-center gap-2">
                      <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-300 rounded cursor-pointer hover:bg-slate-100">
                        <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{draftBackBgUrl ? 'Change Back BG' : 'Upload Back BG'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleUploadBgImage('back', e)}
                          className="sr-only"
                        />
                      </label>
                      {draftBackBgUrl && (
                        <button
                          type="button"
                          onClick={() => setDraftBackBgUrl('')}
                          aria-label="Clear back background image"
                          className="p-1.5 text-red-700 border border-red-200 rounded hover:bg-red-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="id-bg-opacity" className="block text-xs font-medium text-slate-700 mb-1">
                      Image Visibility ({Math.round(draftBgOpacity * 100)}%)
                    </label>
                    <input
                      id="id-bg-opacity"
                      type="range"
                      min="0.05"
                      max="1"
                      step="0.05"
                      value={draftBgOpacity}
                      onChange={(e) => setDraftBgOpacity(Number(e.target.value))}
                      className="w-full accent-orange-700"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleResetDefaultBg}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Reset Default</span>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowBgEditor(false)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-300 rounded bg-white"
                    >
                      Close Editor
                    </button>
                    <button
                      type="button"
                      disabled={savingBg}
                      onClick={handleSaveGlobalBackground}
                      className="px-4 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded hover:bg-orange-800 disabled:opacity-50"
                    >
                      {savingBg ? 'Saving for Everyone...' : 'Apply & Save for All Employees'}
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* Vertical Front & Back Only Card Preview */}
            <div className="flex flex-wrap items-start justify-center gap-8 py-1">
              <div className="flex flex-col items-center">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Front Side (54mm × 86mm Vertical)
                </div>
                {renderVerticalFrontCard(false)}
              </div>

              <div className="flex flex-col items-center">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Back Side (54mm × 86mm Vertical)
                </div>
                {renderVerticalBackCard(false)}
              </div>
            </div>

            {shareNote && (
              <div className="p-3 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md">
                {shareNote}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 px-6 py-4 bg-white border-t border-slate-200 shrink-0">
            <div className="flex flex-wrap items-center gap-2">
              {onPreviewQrProfile && (
                <button
                  type="button"
                  onClick={handlePreviewScannedProfile}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded-md hover:bg-orange-100 whitespace-nowrap"
                >
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Preview Scanned Profile</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleCopyQrLink}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
              >
                {copiedQrLink ? (
                  <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                ) : (
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{copiedQrLink ? 'Copied QR Link' : 'Copy QR Link'}</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleOpenPrintPreview}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
              >
                <Printer className="w-4 h-4" aria-hidden="true" />
                <span>Print Preview (54×86mm)</span>
              </button>

              <button
                type="button"
                disabled={busyPdf}
                onClick={triggerDownloadPdf}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-slate-800 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 disabled:opacity-50 whitespace-nowrap"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                <span>{busyPdf ? 'Building...' : 'Download 54×86mm PDF'}</span>
              </button>

              <button
                type="button"
                disabled={busyPdf}
                onClick={handleSharePdfToMobile}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap"
              >
                <Share2 className="w-4 h-4" aria-hidden="true" />
                <span>Send PDF to {employee.phone}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
