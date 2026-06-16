import React from 'react';
import Capture from '../Capture';
import { useTabs } from '../../hooks/useTabs';
import { TabType } from '../../contexts/TabContext';
import { Screen } from '../../types';
import { useOverscroll } from '../../hooks/useOverscroll';

export default function ClipView() {
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
    const tabType = screenToTabMap[screen] || 'clip';
    openTab(tabType, undefined, url ? { url } : undefined);
  };

  return (
    <div ref={overscrollRef} className="h-full overflow-y-auto no-scrollbar">
      <Capture onNavigate={handleNavigate} />
    </div>
  );
}
