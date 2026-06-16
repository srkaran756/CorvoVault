import { useState, useEffect } from 'react';
import { FileText, ExternalLink } from 'lucide-react';

interface DocxPreviewProps {
  filePath: string;
}

export function DocxPreview({ filePath }: DocxPreviewProps) {
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'error';
    pdfPath?: string;
    errorMessage?: string;
    errorType?: string;
  }>({ status: 'loading' });

  const getFileSrc = (p: string | undefined | null) => {
    if (!p) return '';
    if (p.startsWith('corvovault-file://') || p.startsWith('file://') || p.startsWith('http') || p.startsWith('blob:')) {
      return p;
    }
    if (window.electronAPI) {
      const normalized = String(p).replace(/\\/g, '/');
      if (/^[A-Za-z]:\//.test(normalized)) {
        return `corvovault-file:///${normalized}`;
      }
      if (normalized.startsWith('/')) {
        return `corvovault-file://${normalized}`;
      }
      return `corvovault-file:///${normalized}`;
    }
    return p;
  };

  useEffect(() => {
    let cancelled = false;

    async function convert() {
      setState({ status: 'loading' });

      if (!window.electronAPI?.convertDocxToHtml) {
        setState({
          status: 'error',
          errorMessage: 'Document preview is only available in the desktop app.',
          errorType: 'NOT_ELECTRON',
        });
        return;
      }

      try {
        const result = await window.electronAPI.convertDocxToHtml(filePath);
        if (cancelled) return;

        if (result.success && result.path) {
          setState({ status: 'ready', pdfPath: result.path });
        } else {
          setState({
            status: 'error',
            errorType: result.errorType || 'CONVERSION_FAILED',
            errorMessage: result.errorMessage || 'Unknown conversion error',
          });
        }
      } catch (err: any) {
        // Fallback for unexpected IPC errors
        if (!cancelled) {
          setState({
            status: 'error',
            errorType: 'CONVERSION_FAILED',
            errorMessage: err?.message || 'An unexpected error occurred.',
          });
        }
      }
    }

    convert();
    return () => { cancelled = true; };
  }, [filePath]);

  if (state.status === 'loading') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center space-y-6">
        {/* Animated spinner */}
        <div className="relative">
          <div className="w-16 h-16 border-4 border-primary/20 rounded-full" />
          <div className="absolute inset-0 w-16 h-16 border-4 border-transparent border-t-primary rounded-full animate-spin" />
        </div>
        <div className="text-center space-y-2">
          <p className="text-lg font-bold text-on-surface">Converting Document…</p>
          <p className="text-sm text-outline">Rendering high-fidelity PDF preview</p>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-on-surface-variant space-y-6 p-8">
        {state.errorType === 'PANDOC_NOT_FOUND' ? (
          <>
            <div className="w-20 h-20 bg-amber-50 rounded-3xl flex items-center justify-center">
              <FileText className="w-10 h-10 text-amber-600" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-xl font-bold text-on-surface">Converter Missing</p>
              <p className="text-sm text-outline max-w-md">
                The built-in document converter could not be found. Please restart the app or ensure the installation is not corrupted.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  if (window.electronAPI) window.electronAPI.openExternal(filePath);
                  else window.open(filePath, '_blank');
                }}
                className="bg-surface-container-high text-on-surface px-6 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-all"
              >
                <ExternalLink className="w-4 h-4" />
                Open Externally
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="w-20 h-20 bg-red-50 rounded-3xl flex items-center justify-center">
              <FileText className="w-10 h-10 text-red-500" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-xl font-bold text-on-surface">Preview Failed</p>
              <p className="text-sm text-outline max-w-md">
                {state.errorType === 'CONVERSION_TIMEOUT'
                  ? 'The document took too long to convert. Try a smaller file.'
                  : 'Something went wrong while converting this document.'}
              </p>
            </div>
            <button
              onClick={() => {
                if (window.electronAPI) window.electronAPI.openExternal(filePath);
                else window.open(filePath, '_blank');
              }}
              className="bg-primary text-on-primary px-8 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-all"
            >
              <ExternalLink className="w-5 h-5" />
              Open in Default App
            </button>
          </>
        )}
      </div>
    );
  }

  // Ready — render the PDF
  if (state.pdfPath) {
    return window.electronAPI ? (
      <webview src={getFileSrc(state.pdfPath)} className="w-full h-full" />
    ) : (
      <iframe src={state.pdfPath} className="w-full h-full border-none" />
    );
  }

  return null;
}
