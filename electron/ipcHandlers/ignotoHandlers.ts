/**
 * ignotoHandlers — IPC handlers for the Deep Ignoto privacy mode.
 *
 * Manages the lifecycle of ephemeral Electron sessions for Ignoto browser tabs:
 *  - `ignoto:startProxy`   → Start the local privacy proxy (singleton)
 *  - `ignoto:createSession` → Create a fresh temp: partition configured with:
 *       • Proxy routing through the local ignotoProxy
 *       • Header stripping via session.webRequest (covers HTTPS too)
 *       • Double-layer tracker blocking via webRequest URL patterns
 *       • Permission request blocking (camera, mic, geo, etc.)
 *  - `ignoto:destroySession` → Nuke all session data (cookies, cache, storage)
 *  - `ignoto:getStats`     → Return proxy statistics for the UI badge
 */

import { ipcMain, session } from 'electron';
import { ElectronBlocker } from '@ghostery/adblocker-electron';
import {
  startIgnotoProxy,
  getIgnotoProxyPort,
  getIgnotoProxyStats,
} from '../services/ignotoProxy';
import { registerSessionForDownloads } from './downloadHandler';

// ─── Header Stripping ─────────────────────────────────────────────────────────
// These are stripped at the Chromium layer via webRequest (covers HTTPS).
const STRIP_REQUEST_HEADERS_LOWER = [
  'x-forwarded-for', 'x-real-ip', 'via',
  'forwarded', 'client-ip', 'x-client-ip', 'x-cluster-client-ip',
  'x-request-id', 'proxy-connection',
  // Client Hints — high-entropy fingerprinting vectors
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
  'sec-ch-ua-platform-version', 'sec-ch-ua-arch', 'sec-ch-ua-bitness',
  'sec-ch-ua-full-version', 'sec-ch-ua-full-version-list', 'sec-ch-ua-model',
  'sec-ch-prefers-color-scheme', 'sec-ch-prefers-reduced-motion',
  'sec-ch-viewport-width', 'sec-ch-width', 'accept-language',
];

const SPOOF_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ─── Additional webRequest tracker blocklist (belt-and-suspenders) ─────────────
const BLOCKED_URL_PATTERNS = [
  '*://*.googlesyndication.com/*',
  '*://*.doubleclick.net/*',
  '*://*.google-analytics.com/*',
  '*://*.googletagmanager.com/*',
  '*://*.googleadservices.com/*',
  '*://*.hotjar.com/*',
  '*://*.fullstory.com/*',
  '*://*.logrocket.com/*',
  '*://*.smartlook.com/*',
  '*://*.clarity.ms/*',
  '*://*.segment.com/*',
  '*://*.segment.io/*',
  '*://*.mixpanel.com/*',
  '*://*.amplitude.com/*',
  '*://*.heapanalytics.com/*',
  '*://*.adnxs.com/*',
  '*://*.adsrvr.org/*',
  '*://*.outbrain.com/*',
  '*://*.taboola.com/*',
  '*://*.moatads.com/*',
  '*://*.sentry.io/*',
  '*://*.newrelic.com/*',
  '*://*.datadoghq.com/*',
  '*://*.optimizely.com/*',
  '*://connect.facebook.net/*',
];

// ─── Session registry ─────────────────────────────────────────────────────────
// Track active Ignoto partitions for safety validation
const activeIgnotoSessions = new Set<string>();

// Cached Ghostery blocker singleton to prevent multiple IPC handler registrations
let sharedAdBlocker: ElectronBlocker | null = null;

async function getSharedAdBlocker(): Promise<ElectronBlocker> {
  if (!sharedAdBlocker) {
    sharedAdBlocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
  }
  return sharedAdBlocker;
}

export function registerIgnotoHandlers(): void {
  // ── Start the local proxy (singleton) ───────────────────────────────────────
  ipcMain.handle('ignoto:startProxy', async () => {
    try {
      const port = await startIgnotoProxy();
      return { success: true, port };
    } catch (err: any) {
      console.error('[Ignoto] Failed to start proxy:', err);
      return { success: false, error: err.message };
    }
  });

  // ── Create ephemeral Ignoto session for a tab ────────────────────────────────
  ipcMain.handle('ignoto:createSession', async (_event, tabId: string) => {
    try {
      // Ensure proxy is running
      let port = getIgnotoProxyPort();
      if (!port) {
        port = await startIgnotoProxy();
      }

      const partition = `temp:ignoto-${tabId}`;
      const sess = session.fromPartition(partition);

      // Intercept downloads for dynamic Ignoto sessions
      registerSessionForDownloads(sess);

      // 1. Route ALL traffic through the local privacy proxy
      //    This ensures DNS queries go via DoH, not the local resolver
      await sess.setProxy({
        proxyRules: `http://127.0.0.1:${port}`,
        proxyBypassRules: '<local>',  // Don't proxy loopback
      });

      // 2. Strip fingerprinting headers on ALL requests (includes HTTPS —
      //    this fires before Chromium encrypts the request)
      sess.webRequest.onBeforeSendHeaders(
        { urls: ['<all_urls>'] },
        (details, callback) => {
          const headers: Record<string, string> = {};

          // Determine first-party vs cross-site to protect Referer/Origin while preserving CORS
          let isFirstParty = false;
          let refUrl = details.referrer || '';
          
          for (const [key, value] of Object.entries(details.requestHeaders)) {
            if (key.toLowerCase() === 'referer') {
              refUrl = value as string;
            }
          }

          try {
            const reqHost = new URL(details.url).hostname;
            if (refUrl) {
              const refHost = new URL(refUrl).hostname;
              // Check if hosts match or one is a subdomain of another
              isFirstParty = reqHost === refHost || reqHost.endsWith('.' + refHost) || refHost.endsWith('.' + reqHost);
            } else {
              isFirstParty = true;
            }
          } catch (e) {
            isFirstParty = true;
          }

          for (const [key, value] of Object.entries(details.requestHeaders)) {
            const keyLower = key.toLowerCase();
            
            if (keyLower === 'referer') {
              if (isFirstParty) {
                headers[key] = value as string;
              } else {
                // For cross-site requests, downgrade referer to origin-only for privacy
                try {
                  const parsed = new URL(value as string);
                  headers[key] = `${parsed.protocol}//${parsed.host}/`;
                } catch {
                  // Fallback: exclude if URL is malformed
                }
              }
            } else if (keyLower === 'origin') {
              // Always preserve origin header to keep CORS requests functional
              headers[key] = value as string;
            } else if (!STRIP_REQUEST_HEADERS_LOWER.includes(keyLower)) {
              headers[key] = value as string;
            }
          }

          // Overwrite UA with generic spoofed value
          headers['User-Agent'] = SPOOF_UA;
          // Force accept-language to generic English
          headers['Accept-Language'] = 'en-US,en;q=0.9';
          callback({ requestHeaders: headers });
        }
      );

      // 3. Double-layer tracker blocking via webRequest (belt-and-suspenders)
      sess.webRequest.onBeforeRequest(
        { urls: BLOCKED_URL_PATTERNS },
        (_details, callback) => {
          callback({ cancel: true });
        }
      );

      // 4. Strip server fingerprinting from response headers
      sess.webRequest.onHeadersReceived(
        { urls: ['<all_urls>'] },
        (details, callback) => {
          const headers = { ...details.responseHeaders };
          // Remove server technology headers that fingerprint the stack
          for (const h of ['x-powered-by', 'server', 'X-Powered-By', 'Server', 'x-generator', 'X-Generator']) {
            delete headers[h];
          }
          callback({ responseHeaders: headers });
        }
      );

      // 5. Deny ALL permission requests in Ignoto sessions (camera, mic, geo, etc.)
      sess.setPermissionRequestHandler((_wc, _perm, callback) => callback(false));

      // 6. Enable the Ghostery ad-blocker on this session too
      try {
        const blocker = await getSharedAdBlocker();
        try {
          ipcMain.removeHandler('@ghostery/adblocker/inject-cosmetic-filters');
          ipcMain.removeHandler('@ghostery/adblocker/is-mutation-observer-enabled');
        } catch (e) {}
        blocker.enableBlockingInSession(sess);
      } catch (e) {
        // Non-fatal: proxy + webRequest blocklists still protect
        console.warn('[Ignoto] Could not attach ElectronBlocker to session:', e);
      }

      activeIgnotoSessions.add(partition);
      console.log(`[Ignoto] ✓ Session created: ${partition} → proxy :${port}`);
      return { success: true, partition, port };
    } catch (err: any) {
      console.error('[Ignoto] Failed to create session:', err);
      return { success: false, error: err.message };
    }
  });

  // ── Destroy an Ignoto session (called on tab close) ──────────────────────────
  ipcMain.handle('ignoto:destroySession', async (_event, partition: string) => {
    try {
      // Safety: only destroy partitions we created
      if (!partition.startsWith('temp:ignoto-')) {
        return { success: false, error: 'Invalid Ignoto partition name' };
      }

      const sess = session.fromPartition(partition);

      // Wipe everything — no trace left
      await sess.clearCache();
      await sess.clearStorageData({
        storages: [
          'cookies', 'localstorage', 'indexdb', 'websql',
          'shadercache', 'serviceworkers', 'cachestorage',
        ],
      });
      // Reset proxy to prevent any dangling config
      await sess.setProxy({ proxyRules: '' });

      activeIgnotoSessions.delete(partition);
      console.log(`[Ignoto] ✓ Session destroyed & data wiped: ${partition}`);
      return { success: true };
    } catch (err: any) {
      console.error('[Ignoto] Failed to destroy session:', err);
      return { success: false, error: err.message };
    }
  });

  // ── Get proxy statistics for the UI ─────────────────────────────────────────
  ipcMain.handle('ignoto:getStats', () => {
    try {
      const s = getIgnotoProxyStats();
      return {
        success: true,
        stats: s,
        port: getIgnotoProxyPort(),
        activeSessions: activeIgnotoSessions.size,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}
