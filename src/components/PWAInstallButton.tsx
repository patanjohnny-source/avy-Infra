import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Monitor,
  Smartphone,
  WifiOff,
  X,
} from 'lucide-react';
import {
  buildAndroidChromeIntentUrl,
  useOnlineStatus,
  usePWAInstall,
} from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'topbar' | 'sidebar' | 'login' | 'compact';
  onOpenCallback?: () => void;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'topbar',
  onOpenCallback,
}) => {
  const {
    isInstallable,
    isInstalled,
    isIOS,
    isAndroid,
    isAndroidWebView,
    isInIframe,
    swActive,
    install,
  } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [installing, setInstalling] = useState(false);

  const appUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/` : '';
  const chromeIntentUrl = buildAndroidChromeIntentUrl(appUrl);
  const isSecure =
    typeof window !== 'undefined' &&
    (window.isSecureContext ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1');

  useEffect(() => {
    if (!showGuideModal || !appUrl) return;
    let active = true;
    QRCode.toDataURL(appUrl, {
      width: 220,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [showGuideModal, appUrl]);

  const handlePrimaryClick = async () => {
    onOpenCallback?.();
    if (isInstallable) {
      setInstalling(true);
      try {
        const accepted = await install();
        if (accepted) return;
      } finally {
        setInstalling(false);
      }
    }
    setShowGuideModal(true);
  };

  const handleCopyLink = async () => {
    if (!appUrl || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failures in restricted iframes
    }
  };

  // Suppress ambient install CTA when already running as an installed standalone PWA
  if (isInstalled && variant !== 'login') {
    return null;
  }

  const buttonLabel = isInstallable
    ? 'Install Android App'
    : isIOS
      ? 'Install on iPhone'
      : 'Android App';

  const triggerClass =
    variant === 'sidebar'
      ? 'w-full flex items-center gap-3 px-3 py-2 text-xs font-medium text-orange-300 bg-slate-800/70 border border-slate-700 rounded-md hover:bg-slate-800 hover:text-white transition-colors whitespace-nowrap'
      : variant === 'login'
        ? 'inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 transition-colors whitespace-nowrap'
        : 'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-orange-800 bg-orange-50 border border-orange-200 rounded-md hover:bg-orange-100 whitespace-nowrap';

  return (
    <>
      <button
        type="button"
        data-testid={`pwa-install-btn-${variant}`}
        onClick={handlePrimaryClick}
        disabled={installing}
        aria-label={buttonLabel}
        className={triggerClass}
      >
        {isInstallable ? (
          <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <Smartphone className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        )}
        <span className={variant === 'topbar' ? 'hidden md:inline' : ''}>{buttonLabel}</span>
      </button>

      {showGuideModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="android-app-modal-title"
          data-testid="android-app-install-modal"
        >
          <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-orange-700 flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5 text-white" aria-hidden="true" />
                </div>
                <div>
                  <h3 id="android-app-modal-title" className="text-base font-semibold">
                    AVY INFRA — Web &amp; Android Mobile App
                  </h3>
                  <p className="text-xs text-slate-300">
                    Install directly on Android phones with offline support &amp; real-time sync
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                aria-label="Close Android app install modal"
                className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
              {/* Native 1-tap install banner when available */}
              {isInstallable && (
                <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between gap-3">
                  <div className="text-xs text-emerald-900 dark:text-emerald-200">
                    <div className="font-semibold">Ready for 1-Tap Installation</div>
                    <div>Install AVY INFRA to your Android home screen &amp; app drawer.</div>
                  </div>
                  <button
                    type="button"
                    onClick={install}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-md hover:bg-emerald-800 shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Install Now</span>
                  </button>
                </div>
              )}

              {/* Embedded iframe or Android In-App WebView warning (prevents silent install block) */}
              {(isInIframe || isAndroidWebView) && !isInstallable && (
                <div
                  data-testid="pwa-open-chrome-banner"
                  className="p-3.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 space-y-2.5"
                >
                  <div className="flex items-start gap-2 text-xs text-amber-950 dark:text-amber-200">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <div className="font-semibold">
                        {isAndroidWebView
                          ? 'In-App Browser Detected (WhatsApp / WebView)'
                          : 'Preview Frame Detected — Open Directly in Chrome to Install'}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed">
                        Android cannot trigger app installation inside a preview frame or WhatsApp/in-app browser. Open this app directly in <strong>Google Chrome</strong> first, then tap <strong>Install App</strong>.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {isAndroid && chromeIntentUrl && (
                      <a
                        href={chromeIntentUrl}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800"
                      >
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Open in Google Chrome</span>
                      </a>
                    )}
                    <a
                      href={appUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-900 bg-white border border-amber-300 rounded-md hover:bg-amber-100"
                    >
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Open Full Browser Tab</span>
                    </a>
                  </div>
                </div>
              )}

              {/* Live PWA Install Readiness Strip */}
              <div
                data-testid="pwa-readiness-checklist"
                className="grid grid-cols-3 gap-2 text-[11px]"
              >
                <div className="px-2.5 py-2 rounded-md border border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
                  <CheckCircle2
                    className={`w-3.5 h-3.5 shrink-0 ${isSecure ? 'text-emerald-600' : 'text-amber-600'}`}
                    aria-hidden="true"
                  />
                  <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                    {isSecure ? 'HTTPS Ready' : 'Needs HTTPS'}
                  </span>
                </div>
                <div className="px-2.5 py-2 rounded-md border border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
                  <CheckCircle2
                    className={`w-3.5 h-3.5 shrink-0 ${swActive ? 'text-emerald-600' : 'text-amber-600'}`}
                    aria-hidden="true"
                  />
                  <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                    {swActive ? 'Offline SW Active' : 'SW Registering'}
                  </span>
                </div>
                <div className="px-2.5 py-2 rounded-md border border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
                  <CheckCircle2
                    className={`w-3.5 h-3.5 shrink-0 ${isInstalled || isInstallable ? 'text-emerald-600' : 'text-slate-400'}`}
                    aria-hidden="true"
                  />
                  <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                    {isInstalled ? 'Installed' : isInstallable ? '1-Tap Ready' : 'Chrome Menu'}
                  </span>
                </div>
              </div>

              {/* Mode overview */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-white">
                    <Monitor className="w-4 h-4 text-orange-700" aria-hidden="true" />
                    <span>Desktop &amp; Office Web</span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                    Full multi-column matrices, printable A4 payroll statements, quotations, and bulk Excel/PDF exports.
                  </p>
                </div>
                <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-white">
                    <Smartphone className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                    <span>Android Mobile App</span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                    Standalone launcher icon, mobile bottom navigation bar, camera QR attendance scan, and offline cache.
                  </p>
                </div>
              </div>

              {/* QR Code to open on Android phone */}
              <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center gap-4">
                <div className="w-32 h-32 rounded-lg border border-slate-200 bg-white p-1.5 flex items-center justify-center shrink-0">
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="QR code to open AVY INFRA on Android phone"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <span className="text-[11px] text-slate-400">Generating QR...</span>
                  )}
                </div>
                <div className="space-y-2 min-w-0 flex-1 text-center sm:text-left">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">
                    Scan with Your Android Phone Camera
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                    Open the <strong>Shared App URL</strong> directly in <strong>Google Chrome</strong> on Android (not inside WhatsApp browser), sign in if prompted, then tap <strong>Install app</strong>.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      aria-label="App Web & Mobile URL"
                      value={appUrl}
                      className="flex-1 min-w-0 px-2.5 py-1.5 text-[11px] font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-700 dark:text-slate-200"
                    />
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-slate-900 text-white rounded hover:bg-slate-800 shrink-0"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Platform-specific install steps */}
              {isIOS ? (
                <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 space-y-1">
                  <div className="font-semibold">Install on iPhone / iPad (Safari):</div>
                  <ol className="list-decimal list-inside space-y-1 text-[11px]">
                    <li>
                      Tap the <strong>Share</strong> icon in Safari&apos;s toolbar.
                    </li>
                    <li>
                      Scroll down and tap <strong>Add to Home Screen</strong>.
                    </li>
                    <li>
                      Tap <strong>Add</strong> to launch AVY INFRA full-screen.
                    </li>
                  </ol>
                </div>
              ) : (
                <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 space-y-1">
                  <div className="font-semibold">
                    {isAndroid ? 'Install on This Android Device:' : 'Install on Android Phone (Chrome):'}
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-[11px]">
                    <li>
                      Open this link directly in <strong>Google Chrome</strong> on Android (if opened via WhatsApp, tap <strong>⋮</strong> &rarr; <strong>Open in Chrome</strong>).
                    </li>
                    <li>
                      Tap <strong>Install Android App</strong> in the app header, or Chrome&apos;s <strong>⋮</strong> menu &rarr; <strong>Add to Home screen</strong> &rarr; <strong>Install</strong>.
                    </li>
                    <li>
                      Wait a few seconds for Android to add the <strong>AVY INFRA</strong> app icon to your home screen and app drawer.
                    </li>
                  </ol>
                </div>
              )}
            </div>

            <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700 flex justify-end">
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-100"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      data-testid="pwa-offline-indicator"
      className="fixed bottom-16 lg:bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>Offline Mode — Cached site &amp; crew data active</span>
    </div>
  );
};
