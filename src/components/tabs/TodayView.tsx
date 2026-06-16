import React from 'react';
import Dashboard from '../Dashboard';
import { useTabs } from '../../hooks/useTabs';
import { TabType } from '../../contexts/TabContext';
import { Screen } from '../../types';
import { useOverscroll } from '../../hooks/useOverscroll';

export default function TodayView() {
  const { openTab } = useTabs();
  const overscrollRef = useOverscroll();

  const handleNavigate = (screen: Screen, url?: string) => {
    const screenToTabMap: Record<Screen, TabType> = {
      dashboard: 'today',
      library: 'vault',
      capture: 'clip',
      browser: 'browser',
      settings: 'settings'
    };
    const tabType = screenToTabMap[screen] || 'today';
    openTab(tabType, undefined, url ? { url } : undefined);
  };

  return (
    <div ref={overscrollRef} className="h-full overflow-y-auto no-scrollbar">
      <Dashboard onNavigate={handleNavigate} />
    </div>
  );
}
