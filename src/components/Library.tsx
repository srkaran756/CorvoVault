import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { FolderOpen, Folder, Link as LinkIcon, Video, FileText, Trash2, Globe, Plus, ChevronRight, ChevronDown, Search, Edit3, StickyNote, FileSearch } from 'lucide-react';
import { useOverscroll } from '../hooks/useOverscroll';
import { motion, AnimatePresence } from 'motion/react';
import { useTopics, useFolders, useMaterials } from '../hooks/useLocalData';
import { Material, Screen } from '../types';

import { ephemeral } from '../lib/ephemeral';
import { useAuth } from '../contexts/AuthContext';
import { useTabs } from '../hooks/useTabs';

import { LibraryCard } from './Vault/LibraryCard';
import { PreviewModal } from './Vault/PreviewModal';
import { PdfSearchPanel } from './Vault/PdfSearchPanel';

interface LibraryProps {
  onNavigate?: (screen: Screen, url?: string) => void;
  isActive?: boolean;
}

export default function Library({ onNavigate, isActive = true }: LibraryProps) {
  const { user } = useAuth();
  const { openTab, activeTabId } = useTabs();
  const { topics, addTopic, deleteTopic, renameTopic } = useTopics();

  const sidebarOverscrollRef = useOverscroll();
  const filesOverscrollRef = useOverscroll();
  const linksOverscrollRef = useOverscroll();
  const youtubesOverscrollRef = useOverscroll();
  const notesOverscrollRef = useOverscroll();

  // Initial state synchronously from storage
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(() =>
    user?.id ? ephemeral.getLibraryUIState(user.id).selectedTopicId : null
  );
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(() =>
    user?.id ? ephemeral.getLibraryUIState(user.id).selectedFolderId : null
  );
  // inputValue: tracks what the user sees in the input instantly (no lag)
  // searchQuery: debounced version used for actual filtering + localStorage save
  const [inputValue, setInputValue] = useState(() =>
    user?.id ? ephemeral.getLibraryUIState(user.id).searchQuery : ''
  );
  const [searchQuery, setSearchQuery] = useState(() =>
    user?.id ? ephemeral.getLibraryUIState(user.id).searchQuery : ''
  );

  // Debounce the filter query 150ms after the user stops typing.
  // This keeps the input responsive (inputValue) while deferring the
  // expensive filter pass + localStorage write until typing pauses.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchInput = useCallback((value: string) => {
    setInputValue(value);  // instant — no perceived lag on the input
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => setSearchQuery(value), 150);
  }, []);
  // Cleanup debounce on unmount
  useEffect(() => () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current); }, []);

  // ── UI State Management (Load/Save) ────────────────────────────────
  const prevUserIdRef = useRef<string | null>(user?.id || null);
  
  useEffect(() => {
    const onNavigateFromSearch = (e: Event) => {
      const ce = e as CustomEvent<{ topicId: string | null; folderId: string | null }>;
      if (!ce.detail) return;
      setSelectedTopicId(ce.detail.topicId);
      setSelectedFolderId(ce.detail.folderId);
    };
    window.addEventListener('corvovault:library-navigate', onNavigateFromSearch);
    return () => window.removeEventListener('corvovault:library-navigate', onNavigateFromSearch);
  }, []);

  useEffect(() => {
    if (!user?.id) return;

    // 1. If the profile changed, LOAD the new profile's saved state
    if (prevUserIdRef.current !== user.id) {
      const saved = ephemeral.getLibraryUIState(user.id);
      setSelectedTopicId(saved.selectedTopicId ?? null);
      setSelectedFolderId(saved.selectedFolderId ?? null);
      setInputValue(saved.searchQuery ?? '');
      setSearchQuery(saved.searchQuery ?? '');
      prevUserIdRef.current = user.id;
      return; // Exit here; don't save back the data we just updated
    }

    // 2. If the user is the same but the selection changed, SAVE it
    ephemeral.saveLibraryUIState(user.id, {
      selectedTopicId,
      selectedFolderId,
      searchQuery
    });
  }, [selectedTopicId, selectedFolderId, searchQuery, user?.id]);

  const { folders, addFolder, deleteFolder, renameFolder } = useFolders(selectedTopicId || undefined);
  const { materials, addMaterial, deleteMaterial } = useMaterials(selectedFolderId || undefined);

  const [previewMaterial, setPreviewMaterial] = useState<Material | null>(null);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderEditName, setFolderEditName] = useState('');

  const [isAddingTopic, setIsAddingTopic] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');
  const [addingFolderToTopicId, setAddingFolderToTopicId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [showPdfSearch, setShowPdfSearch] = useState(false);


  // Memoized filter — only recomputes when materials or searchQuery change,
  // not on unrelated state updates (editingTopicId, previewMaterial, etc.).
  const { filteredMaterials, files, links, youtubes, notes } = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const filtered = q
      ? materials.filter(m => m.title.toLowerCase().includes(q))
      : materials;
    return {
      filteredMaterials: filtered,
      files:    filtered.filter(m => m.boxType === 'file'),
      links:    filtered.filter(m => m.boxType === 'link'),
      youtubes: filtered.filter(m => m.boxType === 'youtube'),
      notes:    filtered.filter(m => m.boxType === 'note'),
    };
  }, [materials, searchQuery]);

  const [ingestionStatuses, setIngestionStatuses] = useState<Map<string, { status: string; progress: number }>>(new Map());

  // Listen to IPC progress updates from the background ingestion process
  useEffect(() => {
    const unsubscribe = window.electronAPI?.on('professor:ingestionProgress', (data: any) => {
      setIngestionStatuses(prev => {
        const next = new Map(prev);
        next.set(data.materialId, { status: data.status, progress: data.progress });
        return next;
      });
    });
    return () => unsubscribe?.();
  }, []);

  // Fetch initial ingestion statuses for all PDF materials in the list
  useEffect(() => {
    const loadStatuses = async () => {
      if (!window.electronAPI) return;
      const pdfFiles = files.filter(f => f.localPath && /\.pdf$/i.test(f.localPath));
      const nextMap = new Map(ingestionStatuses);
      let changed = false;
      for (const file of pdfFiles) {
        if (!nextMap.has(file.id)) {
          const status = await window.electronAPI.professorGetIngestionStatus(file.id);
          nextMap.set(file.id, {
            status,
            progress: (status === 'ready' || status === 'ready_for_llm_enrichment') ? 100 : 0
          });
          changed = true;
        }
      }
      if (changed) {
        setIngestionStatuses(nextMap);
      }
    };
    loadStatuses();
  }, [files]);

  // URL helpers are defined inside PreviewModal where they are actually used.

  const handleAddTopic = () => {
    setIsAddingTopic(true);
  };

  const confirmAddTopic = () => {
    if (newTopicName.trim()) addTopic(newTopicName.trim());
    setIsAddingTopic(false);
    setNewTopicName('');
  };

  const cancelAddTopic = () => {
    setIsAddingTopic(false);
    setNewTopicName('');
  };

  const handleAddFolder = (topicId: string) => {
    setAddingFolderToTopicId(topicId);
  };

  const confirmAddFolder = (topicId: string) => {
    if (newFolderName.trim()) addFolder(newFolderName.trim(), topicId);
    setAddingFolderToTopicId(null);
    setNewFolderName('');
  };

  const cancelAddFolder = () => {
    setAddingFolderToTopicId(null);
    setNewFolderName('');
  };

  const startRenameTopic = (id: string, currentName: string) => {
    setEditingTopicId(id);
    setEditName(currentName);
  };

  const confirmRenameTopic = () => {
    if (editingTopicId && editName.trim()) {
      renameTopic(editingTopicId, editName.trim());
    }
    setEditingTopicId(null);
    setEditName('');
  };

  const startRenameFolder = (id: string, currentName: string) => {
    setEditingFolderId(id);
    setFolderEditName(currentName);
  };

  const confirmRenameFolder = (id: string) => {
    if (editingFolderId === id && folderEditName.trim()) {
      renameFolder(id, folderEditName.trim());
    }
    setEditingFolderId(null);
    setFolderEditName('');
  };

  const openInBrowser = (url: string) => {
    if (onNavigate) {
      onNavigate('browser', url);
    }
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex bg-surface relative">
      {/* Sidebar: Topics & Folders */}
      <div className="w-72 border-r border-outline-variant/10 flex flex-col bg-surface-container-low">
        <div className="p-5 border-b border-outline-variant/10 flex justify-between items-center">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-outline/80">Knowledge Tree</h3>
          <button onClick={handleAddTopic} className="p-2 hover:bg-primary/10 text-primary rounded-lg transition-all" title="Add Topic">
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div ref={sidebarOverscrollRef} className="flex-1 overflow-y-auto p-3 space-y-1 no-scrollbar">
          {topics.length === 0 && !isAddingTopic && (
            <div className="p-6 text-center">
              <FolderOpen className="w-10 h-10 text-outline-variant mx-auto mb-3 opacity-30" />
              <p className="text-xs text-outline italic">No topics yet. Click + to create one, or go to Clip to save your first piece.</p>
            </div>
          )}

          {isAddingTopic && (
            <div className="flex items-center group mb-2">
              <input
                className="flex-1 px-3 py-2 bg-surface-container-lowest rounded-lg text-sm font-bold border border-primary focus:outline-none"
                value={newTopicName}
                onChange={e => setNewTopicName(e.target.value)}
                onBlur={confirmAddTopic}
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmAddTopic();
                  if (e.key === 'Escape') cancelAddTopic();
                }}
                autoFocus
                placeholder="Topic name..."
              />
            </div>
          )}

          {topics.map(topic => (
            <div key={topic.id} className="space-y-0.5">
              <div className="flex items-center group">
                {editingTopicId === topic.id ? (
                  <input
                    className="flex-1 px-3 py-2 bg-surface-container-lowest rounded-lg text-sm font-bold border border-primary focus:outline-none"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={confirmRenameTopic}
                    onKeyDown={e => e.key === 'Enter' && confirmRenameTopic()}
                    autoFocus
                  />
                ) : (
                  <button
                    onClick={() => setSelectedTopicId(selectedTopicId === topic.id ? null : topic.id)}
                    className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-all ${selectedTopicId === topic.id ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
                  >
                    {selectedTopicId === topic.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    <span className="truncate">{topic.name}</span>
                    <span className="ml-auto text-[9px] opacity-60">{topic.resourceCount || 0}</span>
                  </button>
                )}
                <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => startRenameTopic(topic.id, topic.name)} className="p-1 hover:bg-surface-container-high rounded text-outline" title="Rename">
                    <Edit3 className="w-3 h-3" />
                  </button>
                  <button onClick={() => { if (confirm(`Delete topic "${topic.name}" and all its contents?`)) deleteTopic(topic.id); }} className="p-1 hover:bg-red-50 text-red-400 rounded" title="Delete">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {selectedTopicId === topic.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="relative ml-4 pl-3 border-l border-outline-variant/20 space-y-0.5 overflow-hidden mt-1"
                  >
                    {folders.filter(f => f.topicId === topic.id).map(folder => (
                      <div key={folder.id} className="relative flex items-center group">
                        <div className="absolute -left-3 top-1/2 w-3 h-px bg-outline-variant/20" />
                        {editingFolderId === folder.id ? (
                          <input
                            className="flex-1 px-3 py-1.5 bg-surface-container-lowest rounded-lg text-xs font-bold border border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                            value={folderEditName}
                            onChange={e => setFolderEditName(e.target.value)}
                            onBlur={() => confirmRenameFolder(folder.id)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') confirmRenameFolder(folder.id);
                              if (e.key === 'Escape') {
                                setEditingFolderId(null);
                                setFolderEditName('');
                              }
                            }}
                            autoFocus
                          />
                        ) : (
                          <button
                            onClick={() => setSelectedFolderId(folder.id)}
                            className={`flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${selectedFolderId === folder.id ? 'text-accent bg-accent/8' : 'text-outline hover:text-on-surface hover:bg-surface-container-high'}`}
                          >
                            <Folder className="w-3 h-3 shrink-0" />
                            <span className="truncate">{folder.name}</span>
                          </button>
                        )}
                        <div className="flex opacity-0 group-hover:opacity-100 transition-all ml-1">
                          <button onClick={() => startRenameFolder(folder.id, folder.name)} className="p-1 hover:bg-surface-container-high text-outline rounded" title="Rename">
                            <Edit3 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => { if (confirm(`Delete folder "${folder.name}"?`)) deleteFolder(folder.id); }}
                            className="p-1 hover:bg-red-50 text-red-500 rounded transition-all"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}

                    {addingFolderToTopicId === topic.id ? (
                      <div className="relative mt-1">
                        <div className="absolute -left-3 top-1/2 w-3 h-px bg-outline-variant/20" />
                        <input
                          className="w-full px-3 py-1.5 bg-surface-container-lowest rounded-lg text-xs font-bold border border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                          value={newFolderName}
                          onChange={e => setNewFolderName(e.target.value)}
                          onBlur={() => confirmAddFolder(topic.id)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') confirmAddFolder(topic.id);
                            if (e.key === 'Escape') cancelAddFolder();
                          }}
                          autoFocus
                          placeholder="Folder name..."
                        />
                      </div>
                    ) : (
                      <div className="relative flex items-center mt-1">
                        <div className="absolute -left-3 top-1/2 w-3 h-px bg-outline-variant/20" />
                        <button onClick={() => handleAddFolder(topic.id)} className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold text-outline hover:text-primary transition-all border border-dashed border-outline-variant/30">
                          <Plus className="w-3 h-3" />
                          Add Folder
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="p-5 border-b border-outline-variant/10 flex items-center gap-4 bg-surface/50 backdrop-blur-md">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-outline w-4 h-4" />
            <input
              type="text"
              placeholder="Search in folder..."
              value={inputValue}
              onChange={(e) => handleSearchInput(e.target.value)}
              className="w-full bg-surface-container-low border-none rounded-full py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
            />
          </div>
          <div className="flex items-center gap-2 text-xs font-bold text-outline">
            <span className="px-3 py-1 bg-surface-container-high rounded-full">{filteredMaterials.length} Items</span>
          </div>
          <button
            onClick={() => setShowPdfSearch(s => !s)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
              showPdfSearch
                ? 'bg-primary text-on-primary shadow-lg'
                : 'bg-surface-container-high text-on-surface-variant hover:bg-primary/10 hover:text-primary'
            }`}
            title="Search the web for PDFs"
          >
            <FileSearch className="w-4 h-4" />
            Search Web for PDFs
          </button>
        </div>

        <div className="flex-1 p-6 overflow-hidden flex flex-col">
          {!selectedFolderId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-outline space-y-4">
              <div className="w-20 h-20 bg-surface-container-high rounded-3xl flex items-center justify-center">
                <FolderOpen className="w-10 h-10 opacity-20" />
              </div>
              <p className="font-bold tracking-tight">Select a folder to view your vault.</p>
              <p className="text-xs text-outline-variant">Choose a topic from the tree, then pick a folder.</p>
            </div>
          ) : filteredMaterials.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-outline space-y-4">
              <div className="w-20 h-20 bg-surface-container-high rounded-3xl flex items-center justify-center">
                <FileText className="w-10 h-10 opacity-20" />
              </div>
              <p className="font-bold tracking-tight">This folder is empty.</p>
              <p className="text-xs text-outline-variant">Go to Clip to add content to this folder.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 h-full min-h-0">
              {/* File Box */}
              {files.length > 0 && (
                <div ref={filesOverscrollRef} className="flex flex-col gap-3 h-full overflow-y-auto pr-2 no-scrollbar">
                  <div className="flex items-center gap-2 px-1">
                    <FileText className="text-amber-600 w-4 h-4" />
                    <h2 className="font-bold text-sm">Files ({files.length})</h2>
                  </div>
                  {files.map(m => (
                    <LibraryCard
                      key={m.id}
                      material={m}
                      onDelete={() => deleteMaterial(m.id)}
                      onOpen={() => openTab('document', m.title, m)}
                      onOpenInBrowser={() => openInBrowser(m.url)}
                      ingestionStatus={ingestionStatuses.get(m.id)}
                      isActive={activeTabId === `document-${m.id}`}
                    />
                  ))}
                </div>
              )}

              {/* Link Box */}
              {links.length > 0 && (
                <div ref={linksOverscrollRef} className="flex flex-col gap-3 h-full overflow-y-auto pr-2 no-scrollbar">
                  <div className="flex items-center gap-2 px-1">
                    <LinkIcon className="text-blue-600 w-4 h-4" />
                    <h2 className="font-bold text-sm">Links ({links.length})</h2>
                  </div>
                  {links.map(m => (
                    <LibraryCard key={m.id} material={m} onDelete={() => deleteMaterial(m.id)} onOpen={() => openTab('document', m.title, m)} onOpenInBrowser={() => openInBrowser(m.url)} isActive={activeTabId === `document-${m.id}`} />
                  ))}
                </div>
              )}

              {/* YouTube Box */}
              {youtubes.length > 0 && (
                <div ref={youtubesOverscrollRef} className="flex flex-col gap-3 h-full overflow-y-auto pr-2 no-scrollbar">
                  <div className="flex items-center gap-2 px-1">
                    <Video className="text-red-600 w-4 h-4" />
                    <h2 className="font-bold text-sm">YouTube ({youtubes.length})</h2>
                  </div>
                  {youtubes.map(m => (
                    <LibraryCard key={m.id} material={m} onDelete={() => deleteMaterial(m.id)} onOpen={() => openTab('document', m.title, m)} onOpenInBrowser={() => openInBrowser(m.url)} isActive={activeTabId === `document-${m.id}`} />
                  ))}
                </div>
              )}

              {/* Notes Box */}
              {notes.length > 0 && (
                <div ref={notesOverscrollRef} className="flex flex-col gap-3 h-full overflow-y-auto pr-2 no-scrollbar">
                  <div className="flex items-center gap-2 px-1">
                    <StickyNote className="text-yellow-600 w-4 h-4" />
                    <h2 className="font-bold text-sm">Notes ({notes.length})</h2>
                  </div>
                  {notes.map(m => (
                    <LibraryCard key={m.id} material={m} onDelete={() => deleteMaterial(m.id)} onOpen={() => openTab('note', m.title, m)} isActive={activeTabId === `note-${m.id}`} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Preview Modal */}
      <AnimatePresence>
        {previewMaterial && (
          <PreviewModal
            material={previewMaterial}
            isActive={isActive}
            onClose={() => setPreviewMaterial(null)}
            onOpenInBrowser={openInBrowser}
          />
        )}
      </AnimatePresence>

      {/* PDF Search Panel */}
      <AnimatePresence>
        {showPdfSearch && (
          <PdfSearchPanel
            onNavigate={onNavigate}
            addMaterial={addMaterial}
            topics={topics}
            folders={folders}
            selectedTopicId={selectedTopicId}
            selectedFolderId={selectedFolderId}
            onClose={() => setShowPdfSearch(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
