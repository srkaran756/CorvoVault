import React from 'react';
import { Database, Landmark, FileText } from 'lucide-react';
import { useTabs } from '../../hooks/useTabs';

export default function StatusBar() {
  const { tabs, activeTabId, rightPanelOpen, toggleRightPanel } = useTabs();
  
  const activeTab = tabs.find(t => t.id === activeTabId);
  const activeLabel = activeTab ? activeTab.title : 'Workspace';

  return (
    <footer className="w-full h-[24px] bg-surface-container-low/70 border-t border-outline-variant/10 flex items-center justify-between px-4 select-none shrink-0 z-40 text-[10px] text-outline/80 font-bold uppercase tracking-wider">
      {/* Left: Active Tab Name & Status */}
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1 text-primary">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
          {activeLabel}
        </span>
        <span className="text-outline/40">|</span>
        <span className="flex items-center gap-1">
          <Database className="w-3 h-3 text-outline/60" />
          SQLite Local Vault
        </span>
      </div>

      {/* Right: Toggle Right Panel button */}
      <div className="flex items-center gap-2">
        <span>Sync Status: Cloud Sync Off</span>
        <span className="text-outline/40">|</span>
        <button 
          onClick={toggleRightPanel}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded border transition-colors outline-none hover:bg-surface-container-high ${
            rightPanelOpen 
              ? 'border-primary/20 text-primary' 
              : 'border-outline-variant/30 text-outline hover:text-on-surface'
          }`}
          title={rightPanelOpen ? "Close Inspector Panel" : "Open Inspector Panel"}
        >
          <Landmark className="w-3 h-3" />
          <span>Inspector</span>
        </button>
      </div>
    </footer>
  );
}
