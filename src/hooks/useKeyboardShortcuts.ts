import { useEffect } from 'react';
import { useTabs } from './useTabs';

export function useKeyboardShortcuts() {
  const { tabs, activeTabId, activateTab, closeTab } = useTabs();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. Check if user is actively typing in a text field
      const activeEl = document.activeElement;
      const isTyping = activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        (activeEl as HTMLElement).isContentEditable
      );

      // Ctrl + W: Close Active Tab
      // Wait, we shouldn't intercept browser-level Ctrl+W in standard browsers,
      // but in Electron app, it is safe, and we should prevent default to avoid closing the whole window if they just want to close a tab!
      if (e.ctrlKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        e.stopPropagation();
        if (activeTabId) {
          closeTab(activeTabId);
        }
        return;
      }

      // Ctrl + Tab: Next Tab
      if (e.ctrlKey && !e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        if (tabs.length <= 1 || !activeTabId) return;
        const currentIndex = tabs.findIndex(t => t.id === activeTabId);
        const nextIndex = (currentIndex + 1) % tabs.length;
        activateTab(tabs[nextIndex].id);
        return;
      }

      // Ctrl + Shift + Tab: Previous Tab
      if (e.ctrlKey && e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        if (tabs.length <= 1 || !activeTabId) return;
        const currentIndex = tabs.findIndex(t => t.id === activeTabId);
        const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        activateTab(tabs[prevIndex].id);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [tabs, activeTabId, activateTab, closeTab]);
}
