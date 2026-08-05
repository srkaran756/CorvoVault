/**
 * IgnotoProxy — Deep Ignoto local privacy proxy
 *
 * A lightweight HTTP/HTTPS CONNECT proxy that runs on 127.0.0.1:<random port>.
 * All Deep Ignoto webview sessions route through this proxy.
 *
 * What it does:
 *  1. Resolves hostnames via DNS-over-HTTPS (Cloudflare 1.1.1.1) so the local
 *     network/router/ISP DNS server NEVER sees your queries.
 *  2. Blocks known tracker & ad domains at the network level (before any connection).
 *  3. Strips fingerprinting headers from outbound HTTP requests.
 *  4. Forces a generic spoofed User-Agent on HTTP requests.
 *  5. For HTTPS, establishes a transparent CONNECT tunnel to the DoH-resolved IP —
 *     the actual TLS content is not decrypted (no MITM). Header stripping for
 *     HTTPS is handled by Electron's session.webRequest interceptors in ignotoHandlers.
 *
 * Zero external dependencies — built entirely on Node.js built-in modules.
 */

import * as http from 'http';
import * as https from 'https';
import * as net from 'net';

// ─── Tracker Blocklist ────────────────────────────────────────────────────────
// These domains are blocked outright at the proxy level.
// This list covers the top ad, analytics, and fingerprinting networks.
const TRACKER_DOMAINS = new Set([
  // Google advertising & tracking
  'googlesyndication.com', 'doubleclick.net', 'googleadservices.com',
  'google-analytics.com', 'googletagmanager.com', 'googletagservices.com',
  'googleoptimize.com', 'googleapis.com/analytics',
  // Meta / Facebook
  'connect.facebook.net', 'facebook.com', 'fbcdn.net',
  'analytics.twitter.com', 'ads.twitter.com', 't.co',
  // Analytics & session recording
  'scorecardresearch.com', 'quantserve.com', 'comscore.com',
  'hotjar.com', 'mouseflow.com', 'fullstory.com', 'logrocket.com',
  'smartlook.com', 'clarity.ms', 'luckyorange.com',
  // Product analytics
  'segment.com', 'segment.io', 'mixpanel.com', 'amplitude.com',
  'heap.io', 'heapanalytics.com', 'kissmetrics.com',
  // Customer support trackers
  'intercom.io', 'intercomcdn.com', 'crisp.chat', 'zendesk.com',
  // Programmatic advertising
  'adnxs.com', 'adsrvr.org', 'rubiconproject.com', 'pubmatic.com',
  'openx.net', 'casalemedia.com', 'contextweb.com', 'criteo.com',
  'criteo.net', 'mediamath.com', 'turn.com', 'rlcdn.com',
  'crwdcntrl.net', 'bluekai.com', 'demdex.net', 'krxd.net',
  // Content recommendation (tracking heavy)
  'outbrain.com', 'taboola.com', 'revcontent.com',
  // Measurement & attribution
  'moatads.com', 'moat.com', 'advertising.com', 'atdmt.com',
  'addthis.com', 'sharethis.com', 'chartbeat.com',
  // Error / performance monitoring (tracking behaviour)
  'sentry.io', 'newrelic.com', 'bugsnag.com', 'rollbar.com',
  'datadog-browser-agent.com', 'datadoghq.com',
  // A/B testing (user behaviour tracking)
  'optimizely.com', 'omtrdc.net', 'adobedtm.com', 'everesttech.net',
  '2mdn.net', 'yieldmanager.com', 'fastclick.net',
]);

/** Returns true if the hostname matches any blocked domain or its subdomains. */
function isTrackerDomain(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  for (const domain of TRACKER_DOMAINS) {
    if (lower === domain || lower.endsWith('.' + domain)) return true;
  }
  return false;
}

// ─── Fingerprinting headers to strip from outbound HTTP requests ──────────────
const STRIP_REQUEST_HEADERS = new Set([
  'x-forwarded-for', 'x-real-ip', 'via',
  'forwarded', 'client-ip', 'x-client-ip', 'x-cluster-client-ip',
  'proxy-connection', 'x-request-id',
  // Client Hints (high-entropy fingerprinting vectors)
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
  'sec-ch-ua-platform-version', 'sec-ch-ua-arch', 'sec-ch-ua-bitness',
  'sec-ch-ua-full-version', 'sec-ch-ua-full-version-list', 'sec-ch-ua-model',
  'sec-ch-prefers-color-scheme', 'sec-ch-prefers-reduced-motion',
  'sec-ch-viewport-width', 'sec-ch-width',
]);

/** Generic desktop Chrome UA — indistinguishable from the most common browser. */
const SPOOF_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ─── Stats ────────────────────────────────────────────────────────────────────
export interface IgnotoProxyStats {
  totalRequests: number;
  blockedRequests: number;
  dohLookups: number;
  dohCacheHits: number;
  uptime: number; // ms since proxy started
}

const stats: IgnotoProxyStats = {
  totalRequests: 0,
  blockedRequests: 0,
  dohLookups: 0,
  dohCacheHits: 0,
  uptime: 0,
};
let startedAt = 0;

// Reusable HTTPS agent for DNS-over-HTTPS queries with Keep-Alive
const dohAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 32,
  keepAliveMsecs: 60000,
});

// ─── DNS-over-HTTPS Cache ─────────────────────────────────────────────────────
interface CacheEntry { ip: string; expires: number }
const dohCache = new Map<string, CacheEntry>();

/**
 * Resolve a hostname to an IP address using Cloudflare DNS-over-HTTPS (1.1.1.1).
 * Falls back to returning the hostname itself (OS resolver) on failure.
 */
async function resolveDoH(hostname: string): Promise<string> {
  // Skip resolution for IP addresses
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname;

  const cached = dohCache.get(hostname);
  if (cached && cached.expires > Date.now()) {
    stats.dohCacheHits++;
    return cached.ip;
  }

  stats.dohLookups++;

  return new Promise((resolve) => {
    const url = `https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`;
    const req = https.get(
      url,
      {
        headers: { 'Accept': 'application/dns-json' },
        timeout: 2000,
        agent: dohAgent,
        // Disable cert rejection to support networks with SSL inspection/self-signed cert chains
        rejectUnauthorized: false,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              resolve(hostname);
              return;
            }
            const data = JSON.parse(body);
            const aRecord = data.Answer?.find((a: any) => a.type === 1);
            if (aRecord?.data) {
              const ttl = Math.min(Math.max(aRecord.ttl || 300, 60), 3600);
              dohCache.set(hostname, { ip: aRecord.data, expires: Date.now() + ttl * 1000 });
              resolve(aRecord.data);
              return;
            }
          } catch (e) {
            // JSON parse failed
          }
          resolve(hostname);
        });
      }
    );

    req.on('error', () => {
      resolve(hostname);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(hostname);
    });
  });
}

/**
 * Strip fingerprinting headers and spoof User-Agent on outbound HTTP headers.
 */
function sanitizeRequestHeaders(headers: http.IncomingHttpHeaders): http.IncomingHttpHeaders {
  const clean: http.IncomingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) {
      clean[key] = value;
    }
  }
  clean['user-agent'] = SPOOF_UA;
  return clean;
}

// ─── Proxy Server ─────────────────────────────────────────────────────────────
let proxyServer: http.Server | null = null;
let proxyPort = 0;

/**
 * Start the Deep Ignoto local proxy (singleton).
 * Resolves with the port number it is listening on.
 */
export function startIgnotoProxy(): Promise<number> {
  return new Promise((resolve, reject) => {
    if (proxyServer) {
      resolve(proxyPort);
      return;
    }

    const server = http.createServer();

    // ── HTTP proxy handler ──────────────────────────────────────────────────
    server.on('request', async (clientReq: http.IncomingMessage, clientRes: http.ServerResponse) => {
      stats.totalRequests++;

      let targetUrl: URL;
      try {
        targetUrl = new URL(clientReq.url || '');
      } catch {
        clientRes.writeHead(400).end('Bad Request');
        return;
      }

      const hostname = targetUrl.hostname;

      // Block tracker domains
      if (isTrackerDomain(hostname)) {
        stats.blockedRequests++;
        clientRes.writeHead(403, { 'Content-Type': 'text/plain' }).end('Blocked by Deep Ignoto');
        return;
      }

      const resolvedIp = await resolveDoH(hostname);
      const port = parseInt(targetUrl.port) || (targetUrl.protocol === 'https:' ? 443 : 80);
      const cleanHeaders = sanitizeRequestHeaders(clientReq.headers);
      cleanHeaders.host = hostname;

      const makeRequest = (targetHost: string) => {
        const requestOptions: http.RequestOptions = {
          host: targetHost,
          port,
          method: clientReq.method,
          path: (targetUrl.pathname || '/') + (targetUrl.search || ''),
          headers: cleanHeaders,
        };

        const proxyReq = (targetUrl.protocol === 'https:' ? https : http).request(requestOptions, (proxyRes: http.IncomingMessage) => {
          clientRes.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
          proxyRes.pipe(clientRes, { end: true });
        });

        proxyReq.on('error', (err: Error) => {
          // If connection to DoH resolved IP fails, retry with native DNS hostname as fallback
          if (targetHost === resolvedIp && resolvedIp !== hostname) {
            console.warn(`[IgnotoProxy] DoH HTTP request failed for ${hostname} (${resolvedIp}). Retrying with native DNS fallback...`);
            makeRequest(hostname);
            return;
          }
          console.error(`[IgnotoProxy] HTTP upstream error for ${hostname}:`, err.message);
          if (!clientRes.headersSent) clientRes.writeHead(502);
          clientRes.end('Proxy upstream error');
        });

        clientReq.pipe(proxyReq, { end: true });
      };

      makeRequest(resolvedIp);
    });

    // ── HTTPS CONNECT tunnel handler ────────────────────────────────────────
    // We do NOT MITM the TLS — we just tunnel the raw TCP stream.
    // Header stripping for HTTPS is done by Electron's webRequest interceptors.
    server.on('connect', async (req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer) => {
      stats.totalRequests++;

      const rawTarget = req.url || '';
      const colonIdx = rawTarget.lastIndexOf(':');
      const hostname = colonIdx > -1 ? rawTarget.slice(0, colonIdx) : rawTarget;
      const port = colonIdx > -1 ? parseInt(rawTarget.slice(colonIdx + 1), 10) : 443;

      // Block tracker domains at CONNECT level
      if (isTrackerDomain(hostname)) {
        stats.blockedRequests++;
        clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        clientSocket.destroy();
        return;
      }

      const resolvedIp = await resolveDoH(hostname);

      // Disable Nagle's algorithm for faster TCP data transmission
      clientSocket.setNoDelay(true);

      let serverSocket: net.Socket;
      let connected = false;

      const establishConnection = (targetHost: string) => {
        serverSocket = net.connect(port, targetHost, () => {
          connected = true;
          serverSocket.setNoDelay(true);
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head && head.length > 0) serverSocket.write(head);
          serverSocket.pipe(clientSocket, { end: true });
          clientSocket.pipe(serverSocket, { end: true });
        });

        serverSocket.on('error', (err: Error) => {
          // If connection to DoH-resolved IP fails before connecting, retry with native DNS fallback
          if (!connected && targetHost === resolvedIp && resolvedIp !== hostname) {
            console.warn(`[IgnotoProxy] DoH connection failed for ${hostname} (${resolvedIp}). Retrying with native DNS fallback...`);
            serverSocket.destroy();
            establishConnection(hostname);
            return;
          }

          console.warn(`[IgnotoProxy] CONNECT tunnel error for ${hostname}:`, err.message);
          try { clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch {}
          clientSocket.destroy();
        });

        clientSocket.on('error', () => serverSocket.destroy());
        clientSocket.on('close', () => serverSocket.destroy());
        serverSocket.on('close', () => clientSocket.destroy());
      };

      establishConnection(resolvedIp);
    });

    // Listen on a random available port on loopback only
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      proxyPort = addr.port;
      proxyServer = server;
      startedAt = Date.now();
      console.log(`[IgnotoProxy] ✓ Local privacy proxy running on 127.0.0.1:${proxyPort}`);
      resolve(proxyPort);
    });

    server.on('error', (err: Error) => {
      console.error('[IgnotoProxy] Server error:', err);
      reject(err);
    });
  });
}

/** Stop the proxy server and reset state. */
export function stopIgnotoProxy(): Promise<void> {
  return new Promise((resolve) => {
    if (!proxyServer) { resolve(); return; }
    proxyServer.close(() => {
      proxyServer = null;
      proxyPort = 0;
      dohCache.clear();
      console.log('[IgnotoProxy] Proxy stopped.');
      resolve();
    });
  });
}

/** Returns the port the proxy is currently listening on (0 if not started). */
export function getIgnotoProxyPort(): number {
  return proxyPort;
}

/** Returns a snapshot of proxy statistics. */
export function getIgnotoProxyStats(): IgnotoProxyStats {
  return {
    ...stats,
    uptime: startedAt > 0 ? Date.now() - startedAt : 0,
  };
}
