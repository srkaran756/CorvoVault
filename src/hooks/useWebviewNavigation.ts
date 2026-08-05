import { useEffect, useCallback, useRef } from 'react';
import { useTabs } from './useTabs';

/**
 * useWebviewNavigation
 *
 * Attaches `new-window` and `will-navigate` event listeners to an Electron
 * <webview> element so that:
 *   - Links that fire target="_blank" / window.open() open in the app's
 *     built-in Browser tab instead of spawning a new OS window.
 *   - Downloads / unsupported file types are delegated to the OS shell.
 *
 * Usage:
 *   const webviewRef = useWebviewNavigation();
 *   <webview ref={webviewRef} src="..." />
 */
export function useWebviewNavigation() {
  const { openTab } = useTabs();
  const webviewRef = useRef<any>(null);

  // Stable handler — reads openTab from stable context reference
  const handleNewWindow = useCallback((e: any) => {
    const url: string = e.url || e.detail?.url;
    if (!url) return;

    // Delegate download/unsupported file types to the OS shell
    if (/\.(docx?|odt|rtf|pptx?|xlsx?|zip|rar|tar|gz|exe|msi)$/i.test(url)) {
      if (window.electronAPI) {
        window.electronAPI.openExternal(url);
      } else {
        window.open(url, '_blank');
      }
      return;
    }

    // Open all other links in the in-app Browser tab
    openTab('browser', undefined, { url });
  }, [openTab]);

  const handleWillNavigate = useCallback((e: any) => {
    const url: string = e.url;
    if (/\.(docx?|odt|rtf|pptx?|xlsx?|zip|rar|tar|gz|exe|msi)$/i.test(url)) {
      e.preventDefault();
      if (window.electronAPI) {
        window.electronAPI.openExternal(url);
      } else {
        window.open(url, '_blank');
      }
    }
  }, []);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    // Attach after the element is ready in the DOM
    const attach = () => {
      webview.addEventListener('new-window', handleNewWindow);
      webview.addEventListener('will-navigate', handleWillNavigate);
    };

    // Some Electron versions require waiting for 'dom-ready'
    if (webview.shadowRoot || webview.src) {
      // Already has a src — try attaching immediately, then again on dom-ready
      attach();
      webview.addEventListener('dom-ready', attach, { once: true });
    } else {
      webview.addEventListener('dom-ready', attach, { once: true });
    }

    return () => {
      try {
        webview.removeEventListener('new-window', handleNewWindow);
        webview.removeEventListener('will-navigate', handleWillNavigate);
      } catch {
        // webview may have been destroyed already
      }
    };
  }, [handleNewWindow, handleWillNavigate]);

  return webviewRef;
}
