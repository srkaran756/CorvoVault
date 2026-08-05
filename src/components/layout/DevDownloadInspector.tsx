import React, { useState, useEffect, useRef } from 'react';
import { Terminal, X, Trash2, Database, ExternalLink, ChevronDown, ChevronUp, CheckCircle2, AlertCircle, Play, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface LogEntry {
  step: string;
  message: string;
  status: 'pending' | 'running' | 'success' | 'warn' | 'error';
  timestamp: number;
  details?: any;
}

interface DevDownload {
  downloadId: string;
  filename: string;
  totalBytes: number;
  receivedBytes: number;
  percent: number;
  status: 'pending' | 'running' | 'success' | 'warn' | 'error';
  isVault: boolean;
  savePath?: string;
  logs: LogEntry[];
  startTime: number;
}

export default function DevDownloadInspector() {
  const [downloads, setDownloads] = useState<Record<string, DevDownload>>({});
  const [isOpen, setIsOpen] = useState(false);
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);
  const [expandedJsonIdx, setExpandedJsonIdx] = useState<string | null>(null); // "downloadId-logIndex"
  const logsEndRef = useRef<Record<string, HTMLDivElement | null>>({});
  const [isDev, setIsDev] = useState(false);

  useEffect(() => {
    const isDevUrl = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
    setIsDev(isDevUrl);
    if (isDevUrl) {
      console.log('[DevDownloadInspector] Mounted in development environment.');
    }
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;

    const unsub = window.electronAPI.on('download:dev-log', (payload: any) => {
      const { downloadId, timestamp, step, message, status, details } = payload;

      setDownloads((prev) => {
        const existing = prev[downloadId];
        const newLog: LogEntry = { step, message, status, timestamp, details };

        let filename = existing?.filename || '';
        let totalBytes = existing?.totalBytes || 0;
        let receivedBytes = existing?.receivedBytes || 0;
        let percent = existing?.percent || 0;
        let isVault = existing?.isVault || false;
        let savePath = existing?.savePath || undefined;
        let overallStatus = existing?.status || 'pending';
        const startTime = existing?.startTime || timestamp;

        // Parse details for helper stats
        if (step === 'will-download' && details) {
          filename = details.filename || filename;
          totalBytes = details.totalBytes || totalBytes;
        }
        if (step === 'resolve-options' && details) {
          isVault = details.choice === 'vault';
        }
        if (step === 'setup-path' && details) {
          savePath = details.path || savePath;
          isVault = details.isVault ?? isVault;
        }
        if (step === 'downloading' && details) {
          receivedBytes = details.receivedBytes ?? receivedBytes;
          totalBytes = details.totalBytes ?? totalBytes;
          percent = details.percent ?? percent;
        }

        // Set overall status based on latest steps
        if (status === 'error') {
          overallStatus = 'error';
        } else if (status === 'success' && step === 'download-done' && !isVault) {
          overallStatus = 'success';
        } else if (status === 'success' && step === 'vault-ingestion') {
          overallStatus = 'success';
        } else if (status === 'warn' && (step === 'cancel' || step === 'setup-path')) {
          overallStatus = 'warn'; // Cancelled/Warn
        } else if (overallStatus !== 'error' && overallStatus !== 'success') {
          overallStatus = 'running';
        }

        const updatedLogs = existing ? [...existing.logs, newLog] : [newLog];

        // Auto-expand trace for new downloads
        if (!existing) {
          setExpandedTraceId(downloadId);
        }

        return {
          ...prev,
          [downloadId]: {
            downloadId,
            filename,
            totalBytes,
            receivedBytes,
            percent,
            status: overallStatus,
            isVault,
            savePath,
            logs: updatedLogs,
            startTime,
          },
        };
      });
    });

    return () => {
      if (unsub) unsub();
    };
  }, []);

  // Scroll to bottom of terminal when logs change
  useEffect(() => {
    if (expandedTraceId && logsEndRef.current[expandedTraceId]) {
      logsEndRef.current[expandedTraceId]?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [downloads, expandedTraceId]);

  const activeCount = Object.values(downloads).filter(d => d.status === 'running' || d.status === 'pending').length;
  const list = Object.values(downloads).sort((a, b) => b.startTime - a.startTime);

  const clearLogs = () => {
    setDownloads({});
    setExpandedTraceId(null);
    setExpandedJsonIdx(null);
  };

  const getStatusColor = (status: DevDownload['status']) => {
    switch (status) {
      case 'success': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
      case 'error': return 'text-red-500 bg-red-500/10 border-red-500/20';
      case 'warn': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      case 'pending': return 'text-cyan-500 bg-cyan-500/10 border-cyan-500/20';
      default: return 'text-purple-500 bg-purple-500/10 border-purple-500/20';
    }
  };

  const getStepIcon = (status: LogEntry['status']) => {
    switch (status) {
      case 'success': return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
      case 'error': return <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
      case 'warn': return <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
      case 'pending': return <Play className="w-3.5 h-3.5 text-cyan-400 shrink-0 animate-pulse" />;
      default: return <Info className="w-3.5 h-3.5 text-purple-400 shrink-0" />;
    }
  };

  if (!isDev) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[999999] font-body">
      {/* Floating Toggle Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-4 py-3 bg-zinc-900 border border-zinc-700 hover:border-cyan-500/50 rounded-full shadow-2xl text-zinc-100 transition-all active:scale-95 group relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          <Terminal className="w-4 h-4 text-cyan-400 animate-pulse" />
          <span className="text-xs font-bold font-headline tracking-wide uppercase">Dev Download Monitor</span>
          {activeCount > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500 text-[10px] font-extrabold text-zinc-950 animate-bounce">
              {activeCount}
            </span>
          )}
        </button>
      )}

      {/* Expanded Live Logs Console */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.95 }}
            className="w-[480px] max-h-[640px] flex flex-col bg-zinc-950/95 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-md"
          >
            {/* Console Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-zinc-900/50 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-cyan-400" />
                <h4 className="text-xs font-bold font-headline text-zinc-200 tracking-wide uppercase">Dev Download Inspector</h4>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              </div>
              <div className="flex items-center gap-1">
                {list.length > 0 && (
                  <button
                    onClick={clearLogs}
                    title="Clear Trace Logs"
                    className="p-1.5 hover:bg-zinc-800/80 rounded-lg transition-colors text-zinc-400 hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 hover:bg-zinc-800/80 rounded-lg transition-colors text-zinc-400 hover:text-zinc-100"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Downloads Queue */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[500px]">
              {list.length === 0 ? (
                <div className="h-40 flex flex-col items-center justify-center text-center p-6 border border-dashed border-zinc-800 rounded-xl bg-zinc-900/20 text-zinc-500">
                  <Terminal className="w-8 h-8 text-zinc-700 mb-2" />
                  <p className="text-xs font-bold">No intercepted downloads in this session</p>
                  <p className="text-[10px] mt-1">Start a file download inside the app or browser to trace the transaction flow in real time.</p>
                </div>
              ) : (
                list.map((dl) => {
                  const isExpanded = expandedTraceId === dl.downloadId;
                  const totalMB = dl.totalBytes > 0 ? (dl.totalBytes / (1024 * 1024)).toFixed(2) : '?';
                  const receivedMB = (dl.receivedBytes / (1024 * 1024)).toFixed(2);
                  const isDone = dl.status === 'success' || dl.status === 'error' || dl.status === 'warn';

                  return (
                    <div
                      key={dl.downloadId}
                      className="border border-zinc-800 rounded-xl bg-zinc-900/40 overflow-hidden shadow-sm"
                    >
                      {/* Download Header Card */}
                      <div className="p-3 flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0 space-y-1">
                          <span className="text-xs font-bold text-zinc-100 break-all block">{dl.filename || 'Initializing Download...'}</span>
                          <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-bold text-zinc-400 uppercase">
                            <span className={`px-1.5 py-0.5 rounded border text-[8px] tracking-wider ${getStatusColor(dl.status)}`}>
                              {dl.status}
                            </span>
                            {dl.totalBytes > 0 && (
                              <span>• {totalMB} MB</span>
                            )}
                            {dl.savePath && (
                              <span className="flex items-center gap-0.5 text-zinc-500 normal-case font-medium">
                                {dl.isVault ? <Database className="w-2.5 h-2.5 text-cyan-500 shrink-0" /> : <ExternalLink className="w-2.5 h-2.5 text-zinc-500 shrink-0" />}
                                <span className="truncate max-w-[200px]">{dl.savePath}</span>
                              </span>
                            )}
                          </div>
                        </div>

                        <button
                          onClick={() => setExpandedTraceId(isExpanded ? null : dl.downloadId)}
                          className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 transition-colors"
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>

                      {/* Progress Bar (active download) */}
                      {dl.status === 'running' && dl.totalBytes > 0 && (
                        <div className="px-3 pb-3 space-y-1">
                          <div className="w-full bg-zinc-800 h-1 rounded-full overflow-hidden">
                            <div className="bg-cyan-500 h-1 rounded-full transition-all duration-300" style={{ width: `${dl.percent}%` }} />
                          </div>
                          <div className="flex justify-between text-[9px] font-bold text-zinc-500">
                            <span>{dl.percent}%</span>
                            <span>{receivedMB} / {totalMB} MB</span>
                          </div>
                        </div>
                      )}

                      {/* Expandable Trace Timeline Panel */}
                      {isExpanded && (
                        <div className="bg-zinc-950 border-t border-zinc-800/80 p-3 font-mono text-[10px] space-y-2">
                          <div className="flex justify-between items-center text-[9px] font-bold text-zinc-500 uppercase pb-1 border-b border-zinc-900">
                            <span>Behind the Scenes Trace</span>
                            <span>Download ID: {dl.downloadId.substring(0, 8)}...</span>
                          </div>

                          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                            {dl.logs.map((log, idx) => {
                              const relTime = ((log.timestamp - dl.startTime) / 1000).toFixed(2);
                              const detailsKey = `${dl.downloadId}-${idx}`;
                              const detailsExpanded = expandedJsonIdx === detailsKey;

                              return (
                                <div key={idx} className="flex items-start gap-2 group/line">
                                  <span className="text-[9px] text-zinc-600 font-bold shrink-0 w-8">+{relTime}s</span>
                                  <div className="shrink-0 pt-0.5">
                                    {getStepIcon(log.status)}
                                  </div>
                                  <div className="flex-1 space-y-1">
                                    <div className="flex items-start justify-between gap-1">
                                      <p className={`leading-relaxed ${log.status === 'error' ? 'text-red-400' : log.status === 'warn' ? 'text-amber-400' : 'text-zinc-300'}`}>
                                        <span className="text-[9px] font-bold text-zinc-500 mr-1 uppercase">[{log.step}]</span>
                                        {log.message}
                                      </p>
                                      {log.details && (
                                        <button
                                          onClick={() => setExpandedJsonIdx(detailsExpanded ? null : detailsKey)}
                                          className="text-[9px] text-cyan-500/80 hover:text-cyan-400 font-bold opacity-0 group-hover/line:opacity-100 transition-opacity shrink-0 uppercase underline decoration-dotted"
                                        >
                                          {detailsExpanded ? 'Hide' : 'Inspect'}
                                        </button>
                                      )}
                                    </div>

                                    {/* Expanded Details JSON viewer */}
                                    {log.details && detailsExpanded && (
                                      <pre className="bg-zinc-900 border border-zinc-800 p-2 rounded text-[9px] overflow-x-auto text-zinc-400 leading-tight max-w-full">
                                        {JSON.stringify(log.details, null, 2)}
                                      </pre>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                            <div ref={(el) => { logsEndRef.current[dl.downloadId] = el; }} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            {/* Footer */}
            <div className="px-4 py-2 bg-zinc-900/20 border-t border-zinc-800 text-[9px] font-bold text-zinc-500 uppercase tracking-widest flex items-center justify-between">
              <span>Status: Dev Channel Intercept Active</span>
              <span>CorvoVault Sandbox</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
