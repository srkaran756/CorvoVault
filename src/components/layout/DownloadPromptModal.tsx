import React, { useState, useEffect } from 'react';
import { Download, Database, ExternalLink, X, FolderOpen } from 'lucide-react';
import { motion } from 'motion/react';

interface DownloadPromptModalProps {
  filename: string;
  totalBytes: number;
  profileId: string;
  activeCourse?: any;
  onResolve: (
    choice: 'vault' | 'outside' | 'cancel',
    destination?: { topicId: string; folderId: string }
  ) => void;
}

export default function DownloadPromptModal({
  filename,
  totalBytes,
  profileId,
  activeCourse,
  onResolve
}: DownloadPromptModalProps) {
  const sizeMB = (totalBytes / (1024 * 1024)).toFixed(2);

  const [topics, setTopics] = useState<any[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  
  // Destination mode: 'default' (Downloads topic/folder) or 'custom' (select folder)
  const [destMode, setDestMode] = useState<'default' | 'custom'>('default');
  const [selectedTopicId, setSelectedTopicId] = useState<string>('');
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');

  useEffect(() => {
    if (window.electronAPI && profileId) {
      Promise.all([
        window.electronAPI.invoke('topics:getAll', profileId),
        window.electronAPI.invoke('folders:getAllByProfile', profileId)
      ]).then(([tList, fList]) => {
        setTopics(tList || []);
        setFolders(fList || []);

        if (activeCourse && tList && fList) {
          const vaultTopic = tList.find((t: any) => t.name === 'Course Vault');
          if (vaultTopic) {
            const courseFolder = fList.find((f: any) => f.name === activeCourse.provider && f.topicId === vaultTopic.id);
            if (courseFolder) {
              setDestMode('custom');
              setSelectedTopicId(vaultTopic.id);
              setSelectedFolderId(courseFolder.id);
              return;
            }
          }
        }

        if (tList && tList.length > 0) {
          setSelectedTopicId(tList[0].id);
        }
      });
    }
  }, [profileId, activeCourse]);

  const filteredFolders = folders.filter((f) => f.topicId === selectedTopicId);

  useEffect(() => {
    if (filteredFolders.length > 0) {
      // Auto-select first folder in this topic if current selected folder is not in filtered list
      if (!filteredFolders.some(f => f.id === selectedFolderId)) {
        setSelectedFolderId(filteredFolders[0].id);
      }
    } else {
      setSelectedFolderId('');
    }
  }, [selectedTopicId, filteredFolders, selectedFolderId]);

  const handleSaveToVault = () => {
    if (destMode === 'custom' && selectedTopicId && selectedFolderId) {
      onResolve('vault', { topicId: selectedTopicId, folderId: selectedFolderId });
    } else {
      onResolve('vault'); // Default saves to "Downloads"
    }
  };

  const isSaveDisabled = destMode === 'custom' && (!selectedTopicId || !selectedFolderId);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-8 bg-on-surface/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-surface-container-lowest p-6 rounded-2xl shadow-2xl max-w-md w-full space-y-5 text-on-surface border border-outline-variant/10 font-body"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-outline-variant/10 pb-3">
          <div className="flex items-center gap-2 text-primary">
            <Download className="w-5 h-5 animate-bounce" style={{ animationDuration: '2s' }} />
            <h3 className="font-bold text-lg font-headline">Download Request</h3>
          </div>
          <button 
            onClick={() => onResolve('cancel')} 
            className="p-1 hover:bg-surface-container-high rounded-full transition-colors text-outline"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3 bg-surface-container-low p-4 rounded-xl border border-outline-variant/10">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-outline uppercase tracking-widest block">File Name</span>
            <span className="text-sm font-bold break-all block">{filename}</span>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-outline uppercase tracking-widest block">File Size</span>
            <span className="text-sm font-bold block">{sizeMB} MB</span>
          </div>
        </div>

        {/* Destination Mode Selector */}
        <div className="space-y-3">
          <span className="text-[10px] font-bold text-outline uppercase tracking-widest block">Vault Destination</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDestMode('default')}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all border ${destMode === 'default' ? 'bg-primary/10 text-primary border-primary' : 'bg-surface-container-low border-outline-variant/20 hover:bg-surface-container-high text-on-surface-variant'}`}
            >
              Default (Downloads Folder)
            </button>
            <button
              type="button"
              onClick={() => setDestMode('custom')}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all border ${destMode === 'custom' ? 'bg-primary/10 text-primary border-primary' : 'bg-surface-container-low border-outline-variant/20 hover:bg-surface-container-high text-on-surface-variant'}`}
            >
              Select Library Folder
            </button>
          </div>

          {destMode === 'custom' && (
            <div className="space-y-3 p-3 rounded-xl bg-surface-container-low border border-outline-variant/10 animate-fadeIn">
              <div>
                <label className="text-[9px] font-bold text-outline uppercase tracking-widest block mb-1">Topic</label>
                {topics.length === 0 ? (
                  <p className="text-xs text-outline italic">No topics found. Please create a topic first.</p>
                ) : (
                  <select
                    value={selectedTopicId}
                    onChange={(e) => {
                      setSelectedTopicId(e.target.value);
                      setSelectedFolderId('');
                    }}
                    className="w-full bg-surface-container-lowest rounded-lg p-2.5 text-xs font-bold border border-outline-variant/20 focus:outline-none focus:border-primary text-on-surface"
                  >
                    {topics.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="text-[9px] font-bold text-outline uppercase tracking-widest block mb-1">Folder</label>
                {filteredFolders.length === 0 ? (
                  <p className="text-xs text-outline italic">No folders found in this topic.</p>
                ) : (
                  <select
                    value={selectedFolderId}
                    onChange={(e) => setSelectedFolderId(e.target.value)}
                    className="w-full bg-surface-container-lowest rounded-lg p-2.5 text-xs font-bold border border-outline-variant/20 focus:outline-none focus:border-primary text-on-surface"
                  >
                    {filteredFolders.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <button
            onClick={handleSaveToVault}
            disabled={isSaveDisabled}
            className="w-full py-3 bg-primary text-on-primary rounded-xl text-sm font-bold hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-30 disabled:pointer-events-none"
          >
            <Database className="w-4 h-4" />
            Save to Vault
          </button>
          
          <button
            onClick={() => onResolve('outside')}
            className="w-full py-3 bg-surface-container-high hover:bg-surface-container-highest rounded-xl text-sm font-bold active:scale-[0.99] transition-all flex items-center justify-center gap-2 text-on-surface"
          >
            <ExternalLink className="w-4 h-4 text-outline" />
            Save Outside (Download Directory)
          </button>

          <button
            onClick={() => onResolve('cancel')}
            className="w-full py-2 text-xs font-bold text-outline hover:text-on-surface transition-colors mt-1"
          >
            Cancel Download
          </button>
        </div>
      </motion.div>
    </div>
  );
}
