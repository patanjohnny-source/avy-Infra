import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Window {
    __avyDeferredInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

export interface PlatformDetectionResult {
  isAndroid: boolean;
  isIOS: boolean;
  isMobile: boolean;
  isStandalone: boolean;
  isAndroidWebView: boolean;
  isInIframe: boolean;
}

export function detectPlatformState(
  userAgent: string,
  standaloneMatch: boolean,
  navigatorStandalone?: boolean,
  inIframe?: boolean
): PlatformDetectionResult {
  const ua = (userAgent || '').toLowerCase();
  const isAndroid = /android/.test(ua);
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isMobile = isAndroid || isIOS || /mobile/.test(ua);
  const isStandalone = Boolean(standaloneMatch || navigatorStandalone === true);
  const isAndroidWebView =
    isAndroid &&
    (/;\s*wv\b/.test(ua) ||
      /fbav|fban|instagram|whatsapp|line\/|micromessenger|gsa\//.test(ua) ||
      (/version\/\d+/.test(ua) && /chrome\//.test(ua)));
  return {
    isAndroid,
    isIOS,
    isMobile,
    isStandalone,
    isAndroidWebView,
    isInIframe: Boolean(inIframe),
  };
}

export function buildAndroidChromeIntentUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return null;
    }
    const scheme = parsed.protocol.replace(':', '');
    return `intent://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}#Intent;scheme=${scheme};package=com.android.chrome;end`;
  } catch {
    return null;
  }
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() =>
    typeof window !== 'undefined' ? window.__avyDeferredInstallPrompt || null : null
  );
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isAndroidWebView, setIsAndroidWebView] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);
  const [swActive, setSwActive] = useState(false);

  useEffect(() => {
    const standaloneMatch =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches;
    const navStandalone =
      typeof window !== 'undefined'
        ? (window.navigator as unknown as { standalone?: boolean }).standalone
        : false;
    let inIframe = false;
    try {
      inIframe = typeof window !== 'undefined' && window.self !== window.top;
    } catch {
      inIframe = true;
    }
    const ua = typeof window !== 'undefined' ? window.navigator.userAgent : '';
    const detected = detectPlatformState(ua, standaloneMatch, navStandalone, inIframe);

    setIsInstalled(detected.isStandalone);
    setIsIOS(detected.isIOS);
    setIsAndroid(detected.isAndroid);
    setIsMobile(detected.isMobile);
    setIsAndroidWebView(detected.isAndroidWebView);
    setIsInIframe(detected.isInIframe);

    if (typeof window !== 'undefined' && window.__avyDeferredInstallPrompt) {
      setDeferredPrompt(window.__avyDeferredInstallPrompt);
    }

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => {
          setSwActive(regs.some((r) => Boolean(r.active || r.installing || r.waiting)));
        })
        .catch(() => {});
    }

    const syncFromGlobal = () => {
      setDeferredPrompt(window.__avyDeferredInstallPrompt || null);
    };

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      window.__avyDeferredInstallPrompt = e as BeforeInstallPromptEvent;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      window.__avyDeferredInstallPrompt = null;
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('avy-pwa-prompt-ready', syncFromGlobal);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('avy-pwa-installed', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('avy-pwa-prompt-ready', syncFromGlobal);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('avy-pwa-installed', handleAppInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    const promptEvent =
      deferredPrompt ||
      (typeof window !== 'undefined' ? window.__avyDeferredInstallPrompt || null : null);
    if (!promptEvent) return false;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === 'accepted') {
      window.__avyDeferredInstallPrompt = null;
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  }, [deferredPrompt]);

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    isAndroid,
    isMobile,
    isAndroidWebView,
    isInIframe,
    swActive,
    install,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
