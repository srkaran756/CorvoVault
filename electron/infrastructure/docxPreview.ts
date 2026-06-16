import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { toLocalFilePath } from '../utils/pathUtils';


let conversionQueue = Promise.resolve();

export function enqueueDocxConversion(filePath: string): Promise<Record<string, unknown>> {
  return new Promise(resolve => {
    conversionQueue = conversionQueue.then(async () => {
      try {
        const result = (await performDocxConversion(filePath)) as Record<string, unknown>;
        resolve(result);
      } catch (err: any) {
        resolve({
          success: false,
          errorType: 'CONVERSION_FAILED',
          errorMessage: err.message,
        });
      }
    });
  });
}

async function performDocxConversion(filePath: string) {
  filePath = toLocalFilePath(filePath);

  const possiblePaths = [
    path.join(app.getAppPath(), 'resources/pandoc/pandoc.exe'),
    path.join(path.dirname(app.getPath('exe')), 'resources/pandoc/pandoc.exe'),
    path.join(process.resourcesPath, 'pandoc/pandoc.exe'),
    path.join(app.getAppPath(), '../resources/pandoc/pandoc.exe'),
  ];

  let pandocPath = possiblePaths[0];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      pandocPath = p;
      break;
    }
  }

  if (!fs.existsSync(pandocPath)) {
    console.error(`[DOCX Preview] Pandoc not found. Checked: ${possiblePaths.join(', ')}`);
    return {
      success: false,
      errorType: 'PANDOC_NOT_FOUND',
      errorMessage: 'The built-in document converter could not be found.',
    };
  }

  if (!fs.existsSync(filePath)) {
    console.error(`[DOCX Preview] File not found: ${filePath}`);
    return {
      success: false,
      errorType: 'FILE_NOT_FOUND',
      errorMessage: 'The file does not exist at the specified path.',
    };
  }

  const userDataPath = app.getPath('userData');
  const previewsDir = path.join(userDataPath, 'previews');
  if (!fs.existsSync(previewsDir)) {
    fs.mkdirSync(previewsDir, { recursive: true });
  }

  const stat = fs.statSync(filePath);
  const cacheKey = crypto
    .createHash('md5')
    .update(`${filePath}|${stat.mtimeMs}`)
    .digest('hex');
  const cachedPdf = path.join(previewsDir, `${cacheKey}.pdf`);

  if (fs.existsSync(cachedPdf)) {
    console.log(`[DOCX Preview] Cache hit: ${cachedPdf}`);
    return { success: true, path: cachedPdf };
  }

  const tempHtmlPath = path.join(previewsDir, `tmp_${cacheKey}.html`);

  try {
    console.log(`[DOCX Preview] Running: pandoc ${filePath}`);

    const commonOptions = {
      timeout: 30000,
      windowsHide: true,
    } as const;

    await new Promise<void>((resolve, reject) => {
      execFile(
        pandocPath,
        [filePath, '-t', 'html', '-s', '--embed-resources', '--metadata', 'pagetitle=Document Preview', '-o', tempHtmlPath],
        commonOptions,
        (err, _stdout, stderr) => {
          if (err) {
            const stderrStr = String(stderr || err.message || '');
            if (/Unknown option|unrecognized option|--embed-resources/i.test(stderrStr)) {
              execFile(
                pandocPath,
                [filePath, '-t', 'html', '-s', '-o', tempHtmlPath],
                commonOptions,
                (err2, _stdout2, stderr2) => {
                  if (err2) {
                    reject(new Error(stderr2 || err2.message));
                  } else {
                    resolve();
                  }
                }
              );
            } else {
              reject(new Error(stderrStr));
            }
          } else {
            resolve();
          }
        }
      );
    });
  } catch (execErr: any) {

    console.error('[DOCX Preview] Pandoc error:', execErr.message);
    try { fs.unlinkSync(tempHtmlPath); } catch { /* empty */ }

    const errMsg = execErr.stderr || execErr.message || '';
    if (errMsg.includes('encrypted') || errMsg.includes('password')) {
      return {
        success: false,
        errorType: 'PASSWORD_PROTECTED',
        errorMessage: 'Cannot preview password-protected documents.',
      };
    }

    return {
      success: false,
      errorType: 'CONVERSION_FAILED',
      errorMessage: `Pandoc failed: ${errMsg}`,
    };
  }

  return new Promise(resolve => {
    let offscreenWin: BrowserWindow | null = new BrowserWindow({
      show: false,
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const timeout = setTimeout(() => {
      if (offscreenWin) {
        offscreenWin.destroy();
        offscreenWin = null;
      }
      resolve({
        success: false,
        errorType: 'CONVERSION_TIMEOUT',
        errorMessage: 'PDF generation timed out after 15 seconds.',
      });
    }, 15000);

    offscreenWin.webContents.on('did-finish-load', async () => {
      try {
        await offscreenWin!.webContents.executeJavaScript(`
          Promise.all([
            document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve(),
            Promise.all(Array.from(document.images || []).map((img) => {
              if (img.complete) return Promise.resolve();
              return new Promise((resolve) => {
                img.addEventListener('load', resolve, { once: true });
                img.addEventListener('error', resolve, { once: true });
              });
            }))
          ])
        `);

        const pdfBuffer = await offscreenWin!.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4',
          margins: { marginType: 'default' },
        });

        fs.writeFileSync(cachedPdf, pdfBuffer);
        console.log(`[DOCX Preview] Success: ${cachedPdf}`);

        try { fs.unlinkSync(tempHtmlPath); } catch { /* empty */ }
        clearTimeout(timeout);
        resolve({ success: true, path: cachedPdf });
      } catch (pdfErr: any) {
        console.error('[DOCX Preview] PDF generation error:', pdfErr);
        clearTimeout(timeout);
        resolve({
          success: false,
          errorType: 'PDF_GENERATION_FAILED',
          errorMessage: 'Failed to generate PDF from HTML.',
        });
      } finally {
        if (offscreenWin) {
          offscreenWin.destroy();
          offscreenWin = null;
        }
      }
    });

    offscreenWin.webContents.on('did-fail-load', (_e, code, desc) => {
      console.error('[DOCX Preview] HTML load failed:', code, desc);
      try { fs.unlinkSync(tempHtmlPath); } catch { /* empty */ }
      clearTimeout(timeout);
      if (offscreenWin) {
        offscreenWin.destroy();
        offscreenWin = null;
      }
      resolve({
        success: false,
        errorType: 'HTML_LOAD_FAILED',
        errorMessage: `Failed to load HTML for PDF conversion: ${desc}`,
      });
    });

    offscreenWin.loadFile(tempHtmlPath).catch(e => {
      console.error('[DOCX Preview] loadFile threw:', e);
    });
  });
}


