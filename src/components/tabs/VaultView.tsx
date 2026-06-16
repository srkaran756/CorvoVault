import React from 'react';
import Library from '../Library';
import { useTabs } from '../../hooks/useTabs';
import { TabType } from '../../contexts/TabContext';
import { Screen } from '../../types';

export default function VaultView({ isActive = true }: { isActive?: boolean }) {
  const { openTab } = useTabs();

  const handleNavigate = (screen: Screen, url?: string) => {
    const screenToTabMap: Record<Screen, TabType> = {
      dashboard: 'today',
      library: 'vault',
      capture: 'clip',
      browser: 'browser',
      settings: 'settings'
    };
    const tabType = screenToTabMap[screen] || 'vault';
    openTab(tabType, undefined, url ? { url } : undefined);
  };

  return (
    <div className="h-full">
      <Library onNavigate={handleNavigate} isActive={isActive} />
    </div>
  );
}
