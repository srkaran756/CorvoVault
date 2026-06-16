import React from 'react';
import Browser from '../Browser';
import { useTabs } from '../../hooks/useTabs';
import { useAuth } from '../../contexts/AuthContext';
import { TabType } from '../../contexts/TabContext';
import { Screen } from '../../types';

export default function BrowserView({ isActive = true }: { isActive?: boolean }) {
  const { user } = useAuth();
  const { openTab, tabs, activeTabId } = useTabs();

  const activeTab = tabs.find(t => t.id === activeTabId);
  const initialUrl = activeTab?.type === 'browser' ? activeTab?.data?.url : undefined;

  const handleNavigate = (screen: Screen, url?: string) => {
    const screenToTabMap: Record<Screen, TabType> = {
      dashboard: 'today',
      library: 'vault',
      capture: 'clip',
      browser: 'browser',
      settings: 'settings'
    };
    const tabType = screenToTabMap[screen] || 'browser';
    openTab(tabType, undefined, url ? { url } : undefined);
  };

  const key = user?.id || 'guest';

  return (
    <div className="h-full">
      <Browser key={key} initialUrl={initialUrl} onNavigate={handleNavigate} isActive={isActive} />
    </div>
  );
}
