import { app, ipcMain, shell, session, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { toLocalFilePath } from '../utils/pathUtils';

export function registerWebHandlers(getMainWindow: () => BrowserWindow | null, isDev: boolean) {
  // Open URL in external browser — validate to prevent file://, javascript:, etc.
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (typeof url !== 'string') return;
    let parsed: URL | null = null;
    try { parsed = new URL(url); } catch { /* plain local path */ }

    if (!parsed) {
      if (fs.existsSync(url)) {
        await shell.openPath(url);
      }
      return;
    }

    if (parsed.protocol === 'file:' || parsed.protocol === 'corvovault-file:') {
      const filePath = toLocalFilePath(url);
      if (fs.existsSync(filePath)) {
        await shell.openPath(filePath);
      }
      return;
    }

    const ALLOWED_PROTOCOLS = ['https:', 'http:', 'mailto:'];
    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
      console.warn(`[Security] Blocked shell.openExternal for protocol: ${parsed.protocol}`);
      return;
    }
    await shell.openExternal(url);
  });

  // Fetch YouTube oEmbed data
  ipcMain.handle('youtube:getInfo', async (_event, url: string) => {
    try {
      const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      if (!response.ok) throw new Error('Failed to fetch');
      return await response.json();
    } catch {
      return null;
    }
  });

  // Fetch page title from URL
  ipcMain.handle('url:getTitle', async (_event, url: string) => {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 CorvoVault/1.0' },
        signal: AbortSignal.timeout(10000),
      });
      const html = await response.text();
      const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      return match ? match[1].trim() : new URL(url).hostname;
    } catch {
      try { return new URL(url).hostname; } catch { return url; }
    }
  });

  // Clear browser session cache
  ipcMain.handle('browser:clearCache', async () => {
    try {
      // Clear the persist:browser partition session
      const browserSession = session.fromPartition('persist:browser');
      await browserSession.clearCache();
      await browserSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb'],
      });
      console.log('[Browser] Cache and storage cleared.');
      return { success: true };
    } catch (err: any) {
      console.error('[Browser] Failed to clear cache:', err);
      return { success: false, error: err.message };
    }
  });

  // Open DevTools for the webview (dev mode only)
  ipcMain.handle('browser:openDevTools', async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow || !isDev) return;
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  // Web PDF Search (DuckDuckGo HTML)
  ipcMain.handle('searxng:search', async (_event, query: string) => {
    const pdfQuery = `${query} filetype:pdf`;
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(pdfQuery);
    
    try {
      console.log(`[Web Search] Querying DuckDuckGo: ${url}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 CorvoVault/1.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from DuckDuckGo`);
      }
      
      const html = await response.text();
      const results = [];
      
      // Extract results using regex to avoid bringing in a DOM parser dependency
      const resultBlockRegex = /<h2 class="result__title">([\s\S]*?)<\/h2>[\s\S]*?<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/g;
      let match;
      
      while ((match = resultBlockRegex.exec(html)) !== null) {
        let titleHtml = match[1];
        let snippetHtml = match[2];
        
        const urlMatch = /href="([^"]+)"/.exec(titleHtml);
        if (!urlMatch) continue;
        
        let rawUrl = urlMatch[1];
        // DuckDuckGo obfuscates URLs via their redirector
        if (rawUrl.includes('uddg=')) {
          rawUrl = decodeURIComponent(rawUrl.split('uddg=')[1].split('&')[0]);
        } else if (rawUrl.startsWith('//')) {
          rawUrl = 'https:' + rawUrl;
        }
        
        const title = titleHtml.replace(/<[^>]+>/g, '').trim();
        const snippet = snippetHtml.replace(/<[^>]+>/g, '').trim();
        
        results.push({
          title: title || 'Untitled PDF',
          url: rawUrl,
          content: snippet,
          engine: 'DuckDuckGo',
          score: 1,
          publishedDate: null,
        });
      }
      
      console.log(`[Web Search] Found ${results.length} PDF results`);
      return { success: true, results, instance: 'DuckDuckGo' };
      
    } catch (err: any) {
      console.warn(`[Web Search] Failed: ${err.message}`);
      return { success: false, error: err.message || 'Unknown error', results: [] };
    }
  });

  // Download a PDF from URL and save to vault's local-files directory
  ipcMain.handle('pdf:downloadAndSave', async (_event, pdfUrl: string, fileName: string) => {
    const userDataPath = app.getPath('userData');
    const filesDir = path.join(userDataPath, 'local-files');
    if (!fs.existsSync(filesDir)) {
      fs.mkdirSync(filesDir, { recursive: true });
    }

    // Sanitize filename
    const safeName = fileName.replace(/[^a-zA-Z0-9_\-. ]/g, '_').substring(0, 120);
    const destPath = path.join(filesDir, `${Date.now()}_${safeName}`);

    return new Promise((resolve) => {
      const download = (url: string, redirectCount = 0) => {
        if (redirectCount > 5) {
          resolve({ success: false, error: 'Too many redirects' });
          return;
        }

        const proto = url.startsWith('https') ? https : http;

        const req = proto.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 CorvoVault/1.0',
            'Accept': 'application/pdf,*/*',
          },
          timeout: 30000,
        }, (res) => {
          // Handle redirects
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            req.destroy();
            download(res.headers.location, redirectCount + 1);
            return;
          }

          if (res.statusCode !== 200) {
            resolve({ success: false, error: `HTTP ${res.statusCode}` });
            return;
          }

          const fileStream = fs.createWriteStream(destPath);
          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            const stats = fs.statSync(destPath);
            resolve({
              success: true,
              localPath: destPath,
              fileName: safeName,
              size: stats.size,
            });
          });

          fileStream.on('error', (err) => {
            fs.unlink(destPath, () => {});
            resolve({ success: false, error: err.message });
          });
        });

        req.on('error', (err) => {
          resolve({ success: false, error: err.message });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, error: 'Download timed out after 30 seconds' });
        });
      };

      download(pdfUrl);
    });
  });
}
