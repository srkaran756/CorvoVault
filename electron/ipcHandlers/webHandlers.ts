import { app, ipcMain, shell, session, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { toLocalFilePath } from '../utils/pathUtils';
import { decryptBuffer } from '../utils/cryptoUtils';

export function registerWebHandlers(db: Database.Database, getMainWindow: () => BrowserWindow | null, isDev: boolean) {
  // Open URL in external browser — validate to prevent file://, javascript:, etc.
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (typeof url !== 'string') return;
    let parsed: URL | null = null;
    try { parsed = new URL(url); } catch { /* plain local path */ }

    if (!parsed || parsed.protocol === 'file:' || parsed.protocol === 'corvovault-file:') {
      const filePath = parsed ? toLocalFilePath(url) : url;
      if (fs.existsSync(filePath)) {
        // If it is in local-files directory, it is encrypted! We must decrypt it to a temp file first.
        if (filePath.includes('local-files') && !filePath.includes('.trash')) {
          try {
            console.log(`[OpenExternal] Decrypting local file for external viewing: ${filePath}`);
            const data = fs.readFileSync(filePath);
            const decrypted = decryptBuffer(data);
            
            const tempDir = path.join(app.getPath('temp'), 'corvovault-temp');
            if (!fs.existsSync(tempDir)) {
              fs.mkdirSync(tempDir, { recursive: true });
            }
            
            const tempPath = path.join(tempDir, `open_${Date.now()}_${path.basename(filePath)}`);
            fs.writeFileSync(tempPath, decrypted);
            
            console.log(`[OpenExternal] Launching external app on decrypted temp file: ${tempPath}`);
            await shell.openPath(tempPath);
            
            // Optionally try to delete after some time, but we leave it to OS temp cleaning to prevent file locking errors
            return;
          } catch (err) {
            console.error('[OpenExternal] Failed to decrypt and open file externally, trying direct:', err);
          }
        }
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

  // Web Image Search (DuckDuckGo Image Scraping + Openverse & Wikimedia Fallbacks)
  ipcMain.handle('web:searchImages', async (_event, query: string) => {
    if (!query || !query.trim()) return { success: true, images: [] };

    try {
      console.log(`[Web Image Search] Searching images for: ${query}`);
      let results: Array<{ url: string; thumbnail: string; title: string }> = [];

      // 1. DuckDuckGo Image Web Search
      try {
        const tokenUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
        const tokenRes = await fetch(tokenUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        const html = await tokenRes.text();

        const vqdMatch = /vqd=['"]?([^'"&]+)/.exec(html) || /vqd=([\d-]+)/.exec(html);
        const vqd = vqdMatch ? vqdMatch[1] : (tokenRes.headers.get('x-vqd-4') || tokenRes.headers.get('x-vqd-3') || '');

        if (vqd) {
          const imgUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,`;
          const imgRes = await fetch(imgUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Referer': 'https://duckduckgo.com/',
            },
          });

          if (imgRes.ok) {
            const data = await imgRes.json();
            if (data && Array.isArray(data.results)) {
              results = data.results
                .map((item: any) => ({
                  url: item.image,
                  thumbnail: item.thumbnail || item.image,
                  title: item.title || '',
                }))
                .filter((item: any) => item.url && typeof item.url === 'string');
            }
          }
        }
      } catch (ddgErr: any) {
        console.warn(`[Web Image Search] DuckDuckGo fetch failed: ${ddgErr.message}`);
      }

      // 2. Fallback/Supplemental: Openverse API
      if (results.length < 8) {
        try {
          const ovUrl = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=20`;
          const ovRes = await fetch(ovUrl);
          if (ovRes.ok) {
            const ovData = await ovRes.json();
            if (ovData && Array.isArray(ovData.results)) {
              const ovResults = ovData.results.map((item: any) => ({
                url: item.url,
                thumbnail: item.thumbnail || item.url,
                title: item.title || '',
              }));
              results = [...results, ...ovResults];
            }
          }
        } catch (ovErr: any) {
          console.warn(`[Web Image Search] Openverse fallback failed: ${ovErr.message}`);
        }
      }

      // 3. Fallback/Supplemental: Wikimedia Commons API
      if (results.length < 5) {
        try {
          const wikiUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&prop=imageinfo&iiprop=url&format=json&origin=*`;
          const wikiRes = await fetch(wikiUrl);
          if (wikiRes.ok) {
            const wikiData = await wikiRes.json();
            if (wikiData?.query?.pages) {
              const wikiResults = Object.values(wikiData.query.pages)
                .map((p: any) => {
                  const u = p.imageinfo?.[0]?.url;
                  return u ? { url: u, thumbnail: u, title: p.title || '' } : null;
                })
                .filter(Boolean) as Array<{ url: string; thumbnail: string; title: string }>;
              results = [...results, ...wikiResults];
            }
          }
        } catch (wikiErr: any) {
          console.warn(`[Web Image Search] Wikimedia fallback failed: ${wikiErr.message}`);
        }
      }

      // Deduplicate results by URL
      const uniqueResultsMap = new Map<string, { url: string; thumbnail: string; title: string }>();
      results.forEach(item => {
        if (!uniqueResultsMap.has(item.url)) {
          uniqueResultsMap.set(item.url, item);
        }
      });

      const finalResults = Array.from(uniqueResultsMap.values());
      console.log(`[Web Image Search] Returning ${finalResults.length} images for query: "${query}"`);
      return { success: true, images: finalResults };
    } catch (err: any) {
      console.error(`[Web Image Search] Failed completely: ${err.message}`);
      return { success: false, images: [], error: err.message };
    }
  });

  // Get PDF page count dynamically from a URL using range requests via pdfjs-dist
  let pdfjsLibPromise: any = null;
  async function getPdfjsLib() {
    if (!pdfjsLibPromise) {
      pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
    }
    return pdfjsLibPromise;
  }

  ipcMain.handle('pdf:getPageCount', async (_event, url: string) => {
    let doc: any = null;
    let loadingTask: any = null;
    try {
      const pdfjsLib = await getPdfjsLib();
      loadingTask = pdfjsLib.getDocument({
        url,
        disableRange: false,
        verbosity: 0
      });

      // Suppress unhandled promise rejections in Node.js
      loadingTask.promise.catch(() => {});

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Timeout'));
        }, 5000);
      });

      doc = await Promise.race([loadingTask.promise, timeoutPromise]);
      const pageCount = doc.numPages;
      return { success: true, pageCount };
    } catch (err: any) {
      return { success: false, error: err.message };
    } finally {
      if (doc) {
        try {
          await doc.destroy();
        } catch {}
      }
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
            let nextUrl = res.headers.location;
            try {
              nextUrl = new URL(nextUrl, url).toString();
            } catch {}
            download(nextUrl, redirectCount + 1);
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

  // Log a browser history entry
  ipcMain.handle('browser:addHistoryEntry', async (_event, url: string, title: string) => {
    try {
      const row = db.prepare('SELECT id FROM profiles WHERE current = 1 LIMIT 1').get() as { id: string } | undefined;
      if (!row) return { success: false, error: 'No active profile found' };
      const profileId = row.id;
      const id = crypto.randomUUID();
      db.prepare(
        'INSERT INTO browser_history (id, profile_id, title, url, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(id, profileId, title || url, url, Date.now());
      return { success: true };
    } catch (err: any) {
      console.error('[Browser] Failed to add history entry:', err);
      return { success: false, error: err.message };
    }
  });

  // Get browser history (sorted descending by time)
  ipcMain.handle('browser:getHistory', async () => {
    try {
      const row = db.prepare('SELECT id FROM profiles WHERE current = 1 LIMIT 1').get() as { id: string } | undefined;
      if (!row) return [];
      const profileId = row.id;
      return db.prepare(
        'SELECT id, title, url, created_at as createdAt FROM browser_history WHERE profile_id = ? ORDER BY created_at DESC LIMIT 200'
      ).all(profileId);
    } catch (err: any) {
      console.error('[Browser] Failed to get history:', err);
      return [];
    }
  });

  // Delete a single history item by ID
  ipcMain.handle('browser:deleteHistoryEntry', async (_event, id: string) => {
    try {
      db.prepare('DELETE FROM browser_history WHERE id = ?').run(id);
      return { success: true };
    } catch (err: any) {
      console.error('[Browser] Failed to delete history entry:', err);
      return { success: false, error: err.message };
    }
  });

  // Clear all history for the current profile
  ipcMain.handle('browser:clearHistory', async () => {
    try {
      const row = db.prepare('SELECT id FROM profiles WHERE current = 1 LIMIT 1').get() as { id: string } | undefined;
      if (!row) return { success: false, error: 'No active profile found' };
      db.prepare('DELETE FROM browser_history WHERE profile_id = ?').run(row.id);
      return { success: true };
    } catch (err: any) {
      console.error('[Browser] Failed to clear history:', err);
      return { success: false, error: err.message };
    }
  });

  // Fetch browsing session details (cookies, cache size)
  ipcMain.handle('browser:getBrowsingData', async () => {
    try {
      const browserSession = session.fromPartition('persist:browser');
      const cookies = await browserSession.cookies.get({});
      let cacheSize = 0;
      try {
        cacheSize = await browserSession.getCacheSize();
      } catch (e) {
        console.warn('[Browser] Failed to fetch cache size:', e);
      }
      return {
        success: true,
        cookies: cookies.map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          expirationDate: c.expirationDate
        })),
        cacheSize
      };
    } catch (err: any) {
      console.error('[Browser] Failed to get browsing data:', err);
      return { success: false, error: err.message, cookies: [], cacheSize: 0 };
    }
  });

  // Trigger a download inside the browser session
  ipcMain.handle('browser:downloadUrl', async (_event, url: string) => {
    try {
      const browserSession = session.fromPartition('persist:browser');
      browserSession.downloadURL(url);
      return { success: true };
    } catch (err: any) {
      console.error('[Browser] Failed to download URL:', err);
      return { success: false, error: err.message };
    }
  });
}
