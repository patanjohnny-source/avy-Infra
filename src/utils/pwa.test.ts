import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAndroidChromeIntentUrl,
  detectPlatformState,
} from '../hooks/usePWAInstall.ts';

test('detectPlatformState identifies Android Chrome, WebView, iframe, and standalone PWA mode', () => {
  const androidChrome = detectPlatformState(
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
    false,
    false,
    false
  );
  assert.equal(androidChrome.isAndroid, true);
  assert.equal(androidChrome.isIOS, false);
  assert.equal(androidChrome.isMobile, true);
  assert.equal(androidChrome.isStandalone, false);
  assert.equal(androidChrome.isAndroidWebView, false);
  assert.equal(androidChrome.isInIframe, false);

  const androidWebView = detectPlatformState(
    'Mozilla/5.0 (Linux; Android 13; SM-A546E; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36',
    false,
    false,
    true
  );
  assert.equal(androidWebView.isAndroid, true);
  assert.equal(androidWebView.isAndroidWebView, true);
  assert.equal(androidWebView.isInIframe, true);

  const installedAndroid = detectPlatformState(
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36',
    true,
    false,
    false
  );
  assert.equal(installedAndroid.isAndroid, true);
  assert.equal(installedAndroid.isStandalone, true);
});

test('detectPlatformState identifies iOS Safari and Desktop web cleanly', () => {
  const iosSafari = detectPlatformState(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
    false,
    true,
    false
  );
  assert.equal(iosSafari.isIOS, true);
  assert.equal(iosSafari.isAndroid, false);
  assert.equal(iosSafari.isStandalone, true);

  const desktopWeb = detectPlatformState(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
    false,
    false,
    false
  );
  assert.equal(desktopWeb.isAndroid, false);
  assert.equal(desktopWeb.isIOS, false);
  assert.equal(desktopWeb.isMobile, false);
  assert.equal(desktopWeb.isStandalone, false);
});

test('buildAndroidChromeIntentUrl generates intent link for HTTPS hosted URLs and skips localhost', () => {
  assert.equal(
    buildAndroidChromeIntentUrl('https://ais-pre-example.run.app/'),
    'intent://ais-pre-example.run.app/#Intent;scheme=https;package=com.android.chrome;end'
  );
  assert.equal(buildAndroidChromeIntentUrl('http://localhost:3000/'), null);
});
