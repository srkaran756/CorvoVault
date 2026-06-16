import React from 'react';
import { History, FileText, ChevronRight, ChevronLeft, BarChart3, Database, Info, Calendar, Clock, Sparkles } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useUserStats, useMaterialCounts } from '../../hooks/useLocalData';
import { useTabs } from '../../hooks/useTabs';
import { ephemeral } from '../../lib/ephemeral';
import { useOverscroll } from '../../hooks/useOverscroll';

export default function RightPanel() {
  const { user } = useAuth();
  const { stats } = useUserStats();
  const counts = useMaterialCounts();
  const { tabs, activeTabId, rightPanelOpen, toggleRightPanel, openTab } = useTabs();
  const overscrollRef = useOverscroll();

  const activeTab = tabs.find(t => t.id === activeTabId);

  // Get recent activities from storage
  const recentActivities = user ? ephemeral.getActivities(user.id).slice(0, 5) : [];

  const handleJumpBack = () => {
    if (stats?.lastFolderId) {
      openTab('vault', 'Vault');
      // Dispatch library navigation event to open last folder
      window.dispatchEvent(
        new CustomEvent('corvovault:library-navigate', {
          detail: { topicId: null, folderId: stats.lastFolderId },
        })
      );
    } else {
      openTab('clip', 'Clip');
    }
  };

  const formatTime = (minutes: number) => {
    const totalSeconds = Math.round(minutes * 60);
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    const parts = [];
    if (hrs > 0) parts.push(`${hrs}h`);
    if (mins > 0 || hrs > 0) parts.push(`${mins}m`);
    parts.push(`${secs}s`);
    return parts.join(' ');
  };

  // Render contextual content
  const renderContextualContent = () => {
    if (!activeTab) return null;

    switch (activeTab.type) {
      case 'today':
        return (
          <div className="space-y-6">
            {/* Resume Activity Card */}
            <div 
              onClick={handleJumpBack}
              className="bg-surface-container-low/50 hover:bg-surface-container-low p-4 rounded-xl border border-outline-variant/15 transition-all cursor-pointer group"
            >
              <span className="text-[9px] font-bold text-primary tracking-wider uppercase mb-1 block">Resume Activity</span>
              <h3 className="text-sm font-bold font-headline leading-tight group-hover:text-primary transition-colors">
                {stats?.lastFolderId ? 'Open last build folder' : 'Start a new build'}
              </h3>
              <p className="text-[10px] text-on-surface-variant mt-2 flex items-center justify-between">
                <span>Jump back into workspace</span>
                <ChevronRight className="w-3.5 h-3.5 text-primary group-hover:translate-x-0.5 transition-transform" />
              </p>
            </div>

            {/* Recent Clips Log */}
            <div className="space-y-3">
              <h4 className="text-[10px] font-black uppercase tracking-wider text-outline flex items-center gap-1.5 font-headline">
                <History className="w-3.5 h-3.5" />
                Recent Clips &amp; Connections
              </h4>
              <div className="bg-surface-container-lowest/60 rounded-xl border border-outline-variant/10 divide-y divide-outline-variant/5 overflow-hidden">
                {recentActivities.length > 0 ? recentActivities.map((activity) => (
                  <div key={activity.id} className="p-3 flex items-start gap-3 hover:bg-surface-container-low transition-colors cursor-pointer group">
                    <div className="w-8 h-8 rounded-lg bg-primary-container/20 flex items-center justify-center shrink-0 mt-0.5">
                      <FileText className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate group-hover:text-primary transition-colors leading-snug">{activity.title}</p>
                      <p className="text-[9px] text-outline mt-0.5">
                        {new Date(activity.time).toLocaleDateString()} · {new Date(activity.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                )) : (
                  <div className="p-6 text-center text-outline text-[10px] italic leading-relaxed">
                    Clip materials to list them here.
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case 'vault':
        return (
          <div className="space-y-5">
            <h4 className="text-[10px] font-black uppercase tracking-wider text-outline flex items-center gap-1.5 font-headline">
              <Database className="w-3.5 h-3.5" />
              Vault Statistics
            </h4>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-surface-container-low/60 p-3 rounded-xl border border-outline-variant/10">
                <span className="text-[9px] font-bold text-outline uppercase block">Files</span>
                <span className="text-lg font-black text-primary font-headline">{counts.files}</span>
              </div>
              <div className="bg-surface-container-low/60 p-3 rounded-xl border border-outline-variant/10">
                <span className="text-[9px] font-bold text-outline uppercase block">Links</span>
                <span className="text-lg font-black text-primary font-headline">{counts.links}</span>
              </div>
              <div className="bg-surface-container-low/60 p-3 rounded-xl border border-outline-variant/10">
                <span className="text-[9px] font-bold text-outline uppercase block">YouTube</span>
                <span className="text-lg font-black text-primary font-headline">{counts.youtubes}</span>
              </div>
              <div className="bg-surface-container-low/60 p-3 rounded-xl border border-outline-variant/10">
                <span className="text-[9px] font-bold text-outline uppercase block">Notes</span>
                <span className="text-lg font-black text-primary font-headline">{counts.notes}</span>
              </div>
            </div>
            <div className="bg-primary/5 p-4 rounded-xl border border-primary/10">
              <span className="text-[9px] font-bold text-primary uppercase tracking-wider block mb-1">Sanctuary Health</span>
              <p className="text-[10px] text-on-surface-variant leading-relaxed">
                All records are archived in local SQLite database. Toggle Settings to run security audit &amp; integrity validations.
              </p>
            </div>
          </div>
        );

      case 'document':
      case 'note':
        // Dynamic file/note tabs metadata
        const material = activeTab.data;
        if (!material) {
          return (
            <div className="p-6 text-center text-outline text-[10px] italic">
              No metadata loaded
            </div>
          );
        }
        const domain = (() => {
          try {
            return new URL(material.url).hostname;
          } catch {
            return null;
          }
        })();
        return (
          <div className="space-y-4">
            <h4 className="text-[10px] font-black uppercase tracking-wider text-outline flex items-center gap-1.5 font-headline">
              <Info className="w-3.5 h-3.5" />
              Document Properties
            </h4>
            <div className="bg-surface-container-low/40 p-4 rounded-xl border border-outline-variant/10 space-y-3">
              <div>
                <span className="text-[8px] font-bold text-outline uppercase block">Type</span>
                <span className="text-xs font-bold text-primary uppercase">{material.boxType}</span>
              </div>
              <div>
                <span className="text-[8px] font-bold text-outline uppercase block">Created At</span>
                <span className="text-xs font-bold text-on-surface flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-outline" />
                  {new Date(material.createdAt).toLocaleDateString()}
                </span>
              </div>
              {material.fileSizeBytes ? (
                <div>
                  <span className="text-[8px] font-bold text-outline uppercase block">File Size</span>
                  <span className="text-xs font-bold text-on-surface">
                    {(material.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB
                  </span>
                </div>
              ) : material.metadata?.size ? (
                <div>
                  <span className="text-[8px] font-bold text-outline uppercase block">File Size</span>
                  <span className="text-xs font-bold text-on-surface">{material.metadata.size}</span>
                </div>
              ) : null}
              {domain && (
                <div>
                  <span className="text-[8px] font-bold text-outline uppercase block">Domain Source</span>
                  <span className="text-xs font-bold text-on-surface truncate block">{domain}</span>
                </div>
              )}
              {material.fileHash && (
                <div>
                  <span className="text-[8px] font-bold text-outline uppercase block">SHA-256 Digest</span>
                  <span className="text-[9px] font-mono text-outline block break-all leading-tight">
                    {material.fileHash}
                  </span>
                </div>
              )}
            </div>
            {material.metadata?.summary && (
              <div className="bg-surface-container-low/20 p-4 rounded-xl border border-outline-variant/10">
                <span className="text-[8px] font-bold text-outline uppercase block mb-1">AI Abstract</span>
                <p className="text-[10px] text-on-surface-variant italic leading-relaxed">
                  "{material.metadata.summary}"
                </p>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div 
      className={`h-full border-l border-outline-variant/10 bg-surface flex transition-all duration-200 ease-out select-none right-panel shrink-0 z-30 ${
        rightPanelOpen ? 'w-72' : 'w-0 overflow-hidden border-l-0'
      }`}
    >
      {rightPanelOpen && (
        <div ref={overscrollRef} className="w-72 flex flex-col p-4 gap-4 overflow-y-auto no-scrollbar h-full">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-outline-variant/10 pb-2.5 shrink-0">
            <span className="text-xs font-black uppercase tracking-wider text-on-surface font-headline">
              Workspace Inspector
            </span>
            <button 
              onClick={toggleRightPanel}
              className="p-1 rounded-md hover:bg-surface-container-low text-outline-variant hover:text-primary transition-colors outline-none"
              title="Collapse Inspector"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Dynamic Content */}
          <div className="flex-1">
            {renderContextualContent()}
          </div>
        </div>
      )}
    </div>
  );
}
