import { useState, useEffect } from 'react';

export interface OutlineItem {
  title: string;
  dest: any;
  items: OutlineItem[];
}

const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const WORKER_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

function loadPdfJsScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).pdfjsLib) {
      resolve();
      return;
    }

    // Resolve local asset URLs relative to the current document so that
    // `file:` and packaged Electron apps find them correctly.
    const localPdfUrl = (() => {
      try {
        return new URL('pdf.min.js', window.location.href).href;
      } catch {
        return '/pdf.min.js';
      }
    })();
    const localWorkerUrl = (() => {
      try {
        return new URL('pdf.worker.min.js', window.location.href).href;
      } catch {
        return '/pdf.worker.min.js';
      }
    })();

    const tryLoad = (src: string, workerSrc: string | null, onFail?: () => void) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => {
        const lib = (window as any).pdfjsLib;
        if (lib) {
          // Prefer the provided worker location (local), fall back to CDN worker.
          lib.GlobalWorkerOptions.workerSrc = workerSrc || WORKER_CDN;
          resolve();
        } else if (onFail) {
          onFail();
        } else {
          reject(new Error('pdfjsLib undefined after load'));
        }
      };
      script.onerror = () => {
        if (onFail) onFail();
        else reject(new Error('Failed to load PDF.js from all sources'));
      };
      document.head.appendChild(script);
    };

    // Try bundled local files first (works in dev & packaged Electron). If
    // that fails, fall back to the CDN copy.
    tryLoad(localPdfUrl, localWorkerUrl, () => {
      tryLoad(PDFJS_CDN, WORKER_CDN, () => {
        reject(new Error('Failed to load PDF.js from local and CDN'));
      });
    });
  });
}

export function usePdfDocument(activePdfPath: string, getFileSrc: (path: string | undefined | null) => string) {
  const [pdfjsLoaded, setPdfjsLoaded] = useState(false);
  const [pdfjsError, setPdfjsError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [outline, setOutline] = useState<OutlineItem[]>([]);

  // 1. Load PDF.js engine
  useEffect(() => {
    loadPdfJsScript()
      .then(() => setPdfjsLoaded(true))
      .catch((err) => setPdfjsError(err.message || 'Failed to load PDF engine'));
  }, []);

  // 2. Load PDF document when PDF.js is loaded and path changes
  useEffect(() => {
    if (!pdfjsLoaded) return;
    setLoadingDoc(true);
    setPdfjsError(null);
    setPdfDoc(null);
    setNumPages(0);
    setOutline([]);

    if (!activePdfPath) {
      setPdfjsError('No document path was provided.');
      setLoadingDoc(false);
      return;
    }

    let cancelled = false;
    let loadedDoc: any = null;

    const load = async () => {
      const pdfjsLib = (window as any).pdfjsLib;
      const fileUrl = getFileSrc(activePdfPath);

      try {
        let doc: any;

        // Electron: read file as base64 bytes (avoids CSP issues)
        if ((window as any).electronAPI && !/^(https?:|blob:)/i.test(activePdfPath)) {
          try {
            const exists = await (window as any).electronAPI.fileExists(activePdfPath);
            if (exists) {
              let b64 = await (window as any).electronAPI.readFileBase64(activePdfPath);
              if (b64) {
                if (b64.includes(';base64,')) b64 = b64.split(';base64,')[1];
                const binary = atob(b64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                doc = await pdfjsLib.getDocument({ data: bytes }).promise;
              }
            }
          } catch (e) {
            console.warn('Base64 read failed, falling back to URL', e);
          }
        }

        // Fallback: URL fetch (works for corvovault-file:// protocol too)
        if (!doc) {
          doc = await pdfjsLib.getDocument({ url: fileUrl }).promise;
        }

        if (cancelled) {
          await doc.destroy?.();
          return;
        }

        loadedDoc = doc;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setLoadingDoc(false);

        try {
          const outlineData = await doc.getOutline();
          if (outlineData) setOutline(outlineData);
        } catch {
          /* no outline */
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error('PDF load error:', err);
        setPdfjsError(err.message || 'Error loading PDF. Confirm the file exists and is not corrupted.');
        setLoadingDoc(false);
      }
    };

    load();
    return () => {
      cancelled = true;
      loadedDoc?.destroy?.();
    };
  }, [pdfjsLoaded, activePdfPath, getFileSrc]);

  return {
    pdfjsLoaded,
    pdfjsError,
    pdfDoc,
    numPages,
    loadingDoc,
    outline,
  };
}
