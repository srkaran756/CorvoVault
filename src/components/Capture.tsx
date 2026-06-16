import React, { useState, useRef, useCallback } from 'react';
import { CloudUpload, Folder, Link as LinkIcon, Paperclip, Loader2, Sparkles, CheckCircle2, AlertCircle, FileUp, X, Film, FileText, StickyNote } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTopics, useFolders, useMaterials, useUserStats } from '../hooks/useLocalData';
import { useAuth } from '../contexts/AuthContext';
import { Screen } from '../types';

interface CaptureProps {
  onNavigate?: (screen: Screen, url?: string) => void;
}

export default function Capture({ onNavigate }: CaptureProps) {
  const { topics, addTopic } = useTopics();
  const [selectedTopicId, setSelectedTopicId] = useState('');
  const { folders, addFolder } = useFolders(selectedTopicId);
  const { addMaterial } = useMaterials();
  const { stats, updateStats } = useUserStats();
  const { settings } = useAuth();

  const [newTopicName, setNewTopicName] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [inputContent, setInputContent] = useState('');
  const [processing, setProcessing] = useState(false);
  const [statusLog, setStatusLog] = useState<Array<{ text: string; type: 'info' | 'success' | 'error' }>>([]);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Array<{ name: string; path: string; size: number }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredFolders = folders.filter(f => f.topicId === selectedTopicId);

  const addStatus = (text: string, type: 'info' | 'success' | 'error' = 'info') => {
    setStatusLog(prev => [...prev, { text, type }]);
  };

  const handleAddTopic = async (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newTopicName.trim()) {
      const created = await addTopic(newTopicName.trim());
      if (created) setSelectedTopicId(created.id);
      setNewTopicName('');
      addStatus(`Topic "${newTopicName.trim()}" created`, 'success');
    }
  };

  const handleAddFolder = async () => {
    if (!selectedTopicId) {
      addStatus('Please select a topic first', 'error');
      return;
    }
    if (!newFolderName.trim()) {
      addStatus('Folder name cannot be empty', 'error');
      return;
    }
    const created = await addFolder(newFolderName.trim(), selectedTopicId);
    if (created) setSelectedFolderId(created.id);
    setNewFolderName('');
    addStatus(`Folder "${newFolderName.trim()}" created`, 'success');
  };

  const handleFolderKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAddFolder();
  };

  // File handling via Electron
  const handleFileSelect = async () => {
    if (window.electronAPI) {
      const result = await window.electronAPI.openFileDialog();
      if (!result.canceled && result.filePaths.length > 0) {
        const files = result.filePaths.map(fp => ({
          name: fp.split(/[\\/]/).pop() || fp,
          path: fp,
          size: 0,
        }));
        setSelectedFiles(prev => [...prev, ...files]);
        addStatus(`${files.length} file(s) selected`, 'info');
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleBrowserFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const fileInfos = files.map(f => ({
      name: f.name,
      path: URL.createObjectURL(f),
      size: f.size,
    }));
    setSelectedFiles(prev => [...prev, ...fileInfos]);
    addStatus(`${files.length} file(s) selected`, 'info');
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const fileInfos = files.map(f => ({
        name: f.name,
        path: (f as any).path || URL.createObjectURL(f),
        size: f.size,
      }));
      setSelectedFiles(prev => [...prev, ...fileInfos]);
      addStatus(`${files.length} file(s) dropped`, 'info');
    }
    // Also check for dropped text/URLs
    const text = e.dataTransfer.getData('text/plain');
    if (text && !files.length) {
      setInputContent(prev => prev ? prev + '\n' + text : text);
    }
  }, []);

  const classifyItem = (item: string): 'youtube' | 'link' | 'file' | 'note' => {
    if (item.includes('youtube.com') || item.includes('youtu.be')) return 'youtube';
    if (item.startsWith('http://') || item.startsWith('https://')) return 'link';
    const exts = ['.pdf', '.mp4', '.mkv', '.mov', '.m4v', '.avi', '.jpg', '.jpeg', '.png', '.zip', '.docx', '.pptx'];
    if (exts.some(ext => item.toLowerCase().endsWith(ext))) return 'file';
    return 'note';
  };

  const getYouTubeId = (url: string): string => {
    if (url.includes('v=')) return url.split('v=')[1].split('&')[0];
    if (url.includes('youtu.be/')) return url.split('youtu.be/')[1].split('?')[0];
    return '';
  };

  const processBag = async () => {
    if (!selectedFolderId || !selectedTopicId) {
      addStatus('Please select a topic and folder first', 'error');
      return;
    }
    if (!inputContent.trim() && selectedFiles.length === 0) {
      addStatus('Please add some content (URLs, text, or files)', 'error');
      return;
    }

    setProcessing(true);
    setStatusLog([]);
    addStatus('Initializing capture algorithm...');

    // Process text content
    const lines = inputContent.split('\n').filter(l => l.trim());
    let processed = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      const type = classifyItem(trimmed);

      addStatus(`Classifying: ${trimmed.substring(0, 60)}... → ${type}`);

      try {
        let title = trimmed;
        let thumbUrl = '';

        if (type === 'youtube') {
          const videoId = getYouTubeId(trimmed);
          thumbUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
          // Try to get title via Electron IPC
          if (window.electronAPI) {
            const info = await window.electronAPI.getYouTubeInfo(trimmed);
            if (info) title = info.title;
          }
        } else if (type === 'link') {
          if (window.electronAPI) {
            title = await window.electronAPI.getUrlTitle(trimmed);
          } else {
            try { title = new URL(trimmed).hostname; } catch { title = trimmed; }
          }
        }

        const newMaterial = await addMaterial({
          title,
          url: trimmed,
          boxType: type,
          folderId: selectedFolderId,
          topicId: selectedTopicId,
          thumbUrl,
        });

        // Auto-select the material to show it immediately
        if (newMaterial) {
          // In the future we can navigate to the material
        }

        addStatus(`✓ Saved: ${title}`, 'success');
        processed++;
      } catch (error: any) {
        addStatus(`✗ Failed: ${error.message}`, 'error');
      }
    }

    // Process files
    for (const file of selectedFiles) {
      addStatus(`Processing file: ${file.name}...`);
      try {
        let localPath = file.path;
        let fileSize = file.size;
        let fileSizeBytes = 0;
        let fileHash: string | undefined;

        if (window.electronAPI && !file.path.startsWith('blob:')) {
          const result = await window.electronAPI.copyFileToLocal(file.path);
          localPath = result.localPath;

          // Get real file size and hash in parallel (spec Section 5.3)
          const [realSize, hash] = await Promise.all([
            window.electronAPI.getFileSize(result.localPath),
            window.electronAPI.hashFile(result.localPath),
          ]);
          fileSizeBytes = realSize;
          fileSize = realSize;
          fileHash = hash ?? undefined;
        }

        const newMaterial = await addMaterial({
          title: file.name,
          url: localPath,
          localPath,
          boxType: 'file',
          folderId: selectedFolderId,
          topicId: selectedTopicId,
          fileSizeBytes,
          fileHash,
          storageStatus: 'active',
          metadata: {
            size: (fileSizeBytes && fileSizeBytes > 0)
              ? (fileSizeBytes > 1024 * 1024
                  ? `${(fileSizeBytes / (1024 * 1024)).toFixed(1)} MB`
                  : `${(fileSizeBytes / 1024).toFixed(1)} KB`)
              : (fileSize && typeof fileSize === 'number' && !isNaN(fileSize) && fileSize > 0)
                ? (fileSize > 1024 * 1024
                    ? `${(fileSize / (1024 * 1024)).toFixed(1)} MB`
                    : `${(fileSize / 1024).toFixed(1)} KB`)
                : undefined,
            fileType: file.name.split('.').pop()?.toUpperCase() || 'FILE',
          },
        });

        addStatus(`✓ File saved: ${file.name}`, 'success');
        processed++;
      } catch (error: any) {
        const msg: string = error?.message ?? String(error);
        if (msg.startsWith('DISK_SPACE_ERROR:')) {
          const [, freeMB, needsMB] = msg.split(':');
          addStatus(
            `✗ Not enough disk space for "${file.name}". Free: ${freeMB} MB, needs ~${needsMB} MB. Free up space and try again.`,
            'error'
          );
        } else {
          addStatus(`✗ File error: ${msg}`, 'error');
        }
      }
    }

    // Update stats
    if (stats) {
      updateStats({
        aiTokenUsage: stats.aiTokenUsage + (processed * 100),
        lastFolderId: selectedFolderId,
      });
    }

    addStatus(`Complete — ${processed} item(s) clipped to vault.`, 'success');
    setInputContent('');
    setSelectedFiles([]);
    setProcessing(false);
  };

  return (
    <div className="max-w-5xl mx-auto w-full py-10 px-6 space-y-8">
      {/* Topic & Folder Creation */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-surface-container-lowest p-8 rounded-xl shadow-sm space-y-4 border border-outline-variant/10">
          <label className="block text-[13px] font-bold uppercase tracking-widest text-on-surface-variant font-headline">Topics</label>
          <input 
            className="w-full text-xl font-headline font-bold border-b border-outline-variant/30 focus:border-primary pb-2 bg-transparent p-0 focus:ring-0 focus:outline-none placeholder:text-outline-variant text-on-surface" 
            placeholder="Type name + Enter to create" 
            type="text"
            value={newTopicName}
            onChange={(e) => setNewTopicName(e.target.value)}
            onKeyDown={handleAddTopic}
          />
          <div className="flex flex-wrap gap-2 mt-2">
            {topics.map(t => (
              <button 
                key={t.id}
                onClick={() => { setSelectedTopicId(t.id); setSelectedFolderId(''); }}
                className={`px-3.5 py-2.5 rounded-full text-xs font-bold transition-all cursor-pointer ${selectedTopicId === t.id ? 'bg-primary text-on-primary shadow-md' : 'bg-surface-container-low text-outline hover:bg-surface-container-high'}`}
              >
                {t.name}
              </button>
            ))}
            {topics.length === 0 && <p className="text-[13px] text-outline italic">No topics yet. Create one above.</p>}
          </div>
        </div>
        <div className="bg-surface-container-lowest p-8 rounded-xl shadow-sm space-y-4 border border-outline-variant/10">
          <label className="block text-[13px] font-bold uppercase tracking-widest text-on-surface-variant font-headline">Folders</label>
          <div className="flex items-center gap-3 bg-surface-container-low p-4 rounded-xl border border-outline/25 focus-within:border-primary">
            <Folder className="text-primary w-5 h-5 shrink-0" />
            <input 
              className="bg-transparent border-none w-full text-sm font-semibold focus:ring-0 focus:outline-none text-on-surface"
              placeholder={selectedTopicId ? "Folder name + Enter" : "Select a topic first"}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={handleFolderKeyDown}
              disabled={!selectedTopicId}
            />
            <button 
              onClick={handleAddFolder} 
              disabled={!selectedTopicId}
              className="px-3.5 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary font-bold text-xs shrink-0 rounded-lg transition-colors cursor-pointer disabled:opacity-30"
            >
              ADD
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {filteredFolders.map(f => (
              <button 
                key={f.id}
                onClick={() => setSelectedFolderId(f.id)}
                className={`px-3.5 py-2.5 rounded-full text-xs font-bold transition-all cursor-pointer ${selectedFolderId === f.id ? 'bg-tertiary text-on-tertiary shadow-md' : 'bg-surface-container-low text-outline hover:bg-surface-container-high'}`}
              >
                {f.name}
              </button>
            ))}
            {selectedTopicId && filteredFolders.length === 0 && <p className="text-[13px] text-outline italic">No folders. Create one above.</p>}
          </div>
        </div>
      </section>

      {/* The Carry Bag — Drop Zone */}
      <section className="flex-grow flex flex-col">
        <div 
          className={`relative flex-grow flex flex-col group rounded-xl transition-all ${dragOver ? 'ring-2 ring-primary ring-offset-2' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <div className={`absolute inset-0 rounded-xl transition-all ${dragOver ? 'bg-primary/15' : 'bg-primary/5 group-hover:bg-primary/[0.08]'}`}></div>
          <div className="relative z-10 flex-grow flex flex-col p-1 rounded-xl border-2 border-dashed border-primary/20">
            <div className="flex-grow flex flex-col items-center justify-center p-8 text-center">
              <motion.div 
                whileHover={{ scale: 1.1 }}
                className="w-16 h-16 mb-4 bg-on-primary-container/20 text-primary rounded-full flex items-center justify-center shadow-lg"
              >
                <CloudUpload className="w-8 h-8" />
              </motion.div>
              <h2 className="text-2xl font-headline font-extrabold text-primary mb-1">Clip It</h2>
              <p className="text-on-surface-variant text-sm max-w-md mx-auto mb-6">
                Paste a YouTube link, drop a PDF, voice note, or webpage. Clip it before it disappears.
              </p>
              
              <div className="w-full max-w-2xl bg-surface-container-lowest/80 backdrop-blur-md rounded-xl p-4 shadow-lg border border-outline-variant/15 focus-within:border-primary/55 transition-colors">
                <textarea 
                  className="w-full h-28 bg-transparent border-none focus:ring-0 focus:outline-none text-on-surface placeholder:text-outline resize-none text-sm" 
                  placeholder="https://youtube.com/watch?v=...&#10;https://arxiv.org/abs/2301.00001&#10;My research notes on quantum computing..."
                  value={inputContent}
                  onChange={(e) => setInputContent(e.target.value)}
                />
                
                {/* Selected files */}
                {selectedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-outline-variant/10">
                    {selectedFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-surface-container-high rounded-lg text-xs">
                        <FileText className="w-3 h-3 text-primary" />
                        <span className="font-bold truncate max-w-[120px]">{f.name}</span>
                        <button onClick={() => removeFile(i)} className="text-outline hover:text-red-500 cursor-pointer">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-between items-center mt-2 pt-2 border-t border-outline-variant/10">
                  <div className="flex gap-2">
                    <button 
                      onClick={handleFileSelect}
                      className="py-2.5 px-4 bg-surface-container-high hover:bg-surface-container rounded-lg transition-all text-on-surface-variant flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                    >
                      <FileUp className="w-4 h-4 text-primary" />
                      <span>Files</span>
                    </button>
                    <input 
                      ref={fileInputRef}
                      type="file" 
                      multiple 
                      className="hidden" 
                      onChange={handleBrowserFileChange}
                    />
                  </div>
                  <span className="text-[13px] font-bold text-outline-variant uppercase tracking-tighter">
                    {selectedFiles.length > 0 ? `${selectedFiles.length} file(s)` : 'Drop files here'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pipeline & Action */}
      <section className="flex flex-col md:flex-row gap-8 items-start">
        <div className="flex-grow bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/15 w-full min-h-[180px]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[13px] font-bold uppercase tracking-widest text-primary flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${processing ? 'bg-tertiary animate-pulse' : 'bg-outline-variant'}`}></span>
              Pipeline Log
            </h3>
            <span className="text-[13px] text-outline">{statusLog.length} events</span>
          </div>
          <div className="space-y-1.5 max-h-40 overflow-y-auto no-scrollbar">
            <AnimatePresence>
              {statusLog.map((s, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`flex items-center gap-3 p-2 rounded-lg border-l-2 ${
                    s.type === 'success' ? 'bg-green-50 border-green-500' :
                    s.type === 'error' ? 'bg-red-50 border-red-500' :
                    'bg-surface-container-low border-primary'
                  }`}
                >
                  {s.type === 'success' ? <CheckCircle2 className="w-3 h-3 text-green-600 shrink-0" /> :
                   s.type === 'error' ? <AlertCircle className="w-3 h-3 text-red-600 shrink-0" /> :
                   <Sparkles className="w-3 h-3 text-primary shrink-0" />}
                  <p className="text-[13px] font-bold truncate">{s.text}</p>
                </motion.div>
              ))}
            </AnimatePresence>
            {statusLog.length === 0 && <p className="text-xs text-outline italic">Ready to clip...</p>}
          </div>
        </div>

        <div className="shrink-0 w-full md:w-auto">
          <button 
            onClick={processBag}
            disabled={processing}
            className="w-full md:w-64 py-5 px-8 rounded-full bg-gradient-to-br from-primary to-primary-container text-on-primary font-headline font-extrabold text-lg flex items-center justify-center gap-3 shadow-xl hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
          >
            <span>{processing ? 'Clipping...' : 'Save to Vault'}</span>
            {processing ? <Loader2 className="w-6 h-6 animate-spin" /> : <Sparkles className="w-6 h-6" />}
          </button>
        </div>
      </section>
    </div>
  );
}
