import { Material } from '../../types';
import { Video, Link as LinkIcon, StickyNote, FileText, ExternalLink, Globe, Trash2, Play } from 'lucide-react';

interface LibraryCardProps {
  material: Material;
  onDelete: () => void;
  onOpen: () => void;
  onOpenInBrowser?: () => void;
  ingestionStatus?: { status: string; progress: number };
  isActive?: boolean;
}

export function LibraryCard({ material, onDelete, onOpen, onOpenInBrowser, ingestionStatus, isActive }: LibraryCardProps) {
  const isYoutube = material.boxType === 'youtube';
  const Icon = isYoutube ? Video : material.boxType === 'link' ? LinkIcon : material.boxType === 'note' ? StickyNote : FileText;
  const colorMap = {
    youtube: 'bg-red-50 text-red-600',
    link: 'bg-blue-50 text-blue-600',
    file: 'bg-amber-50 text-amber-600',
    note: 'bg-yellow-50 text-yellow-600',
  };

  let youtubeId = null;
  if (isYoutube && material.url) {
    const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = material.url.match(regExp);
    youtubeId = (match && match[2].length === 11) ? match[2] : null;
  }

  return (
    <div
      className={`group relative p-4 rounded-xl border transition-all cursor-pointer overflow-hidden flex flex-col shrink-0 ${
        isActive
          ? 'bg-white border-accent/30 shadow-sm dark:bg-black/25 dark:border-accent/40 dark:shadow-inner'
          : 'bg-surface-container-lowest border-outline-variant/10 hover:shadow-lg'
      }`}
      onClick={onOpen}
    >
      {youtubeId && (
        <div className="relative w-full aspect-video rounded-lg overflow-hidden mb-3 bg-black shrink-0">
          <img src={`https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`} alt="Thumbnail" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-10 h-10 bg-red-600/90 rounded-full flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform">
              <Play className="w-4 h-4 ml-0.5" />
            </div>
          </div>
        </div>
      )}
      <div className="flex items-start gap-3">
        {!youtubeId && (
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${colorMap[material.boxType]}`}>
            <Icon className="w-5 h-5" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-sm text-on-surface leading-tight line-clamp-2 group-hover:text-primary transition-colors flex items-center gap-2">
            {material.title}
            {material.storageStatus === 'missing' && (
              <span style={{ color: 'var(--color-text-danger)', fontSize: 12 }} className="text-red-500 shrink-0">
                File missing
              </span>
            )}
          </h4>
          <p className="text-[10px] text-outline truncate mt-0.5">{material.url?.substring(0, 60)}</p>
        </div>
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {material.boxType === 'file' ? (
            <button onClick={(e) => {
              e.stopPropagation();
              const targetUrl = material.localPath || material.url;
              if (window.electronAPI) window.electronAPI.openExternal(targetUrl);
              else window.open(targetUrl, '_blank');
            }} className="p-1.5 hover:bg-surface-container-high text-primary rounded-lg" title="Open Externally">
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          ) : material.boxType !== 'note' && onOpenInBrowser && (
            <button onClick={(e) => { e.stopPropagation(); onOpenInBrowser(); }} className="p-1.5 hover:bg-surface-container-high text-primary rounded-lg" title="Open in Browser">
              <Globe className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg" title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {material.metadata?.summary && (
        <p className="text-[10px] text-on-surface-variant italic mt-2 line-clamp-2">"{material.metadata.summary}"</p>
      )}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-outline-variant/5">
        <span className="text-[9px] font-bold text-outline uppercase tracking-widest">
          {new Date(material.createdAt).toLocaleDateString()}
        </span>
        {ingestionStatus && ingestionStatus.status !== 'not_started' && (
          <span className={`text-[8px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
            ingestionStatus.status === 'processing' ? 'bg-amber-100/50 text-amber-700 animate-pulse' :
            ingestionStatus.status === 'queued' ? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800/40 dark:text-zinc-400' :
            ingestionStatus.status === 'failed' ? 'bg-red-50 text-red-600 dark:bg-red-950/20 dark:text-red-400' :
            'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400'
          }`}>
            {ingestionStatus.status === 'processing' ? `AI: ${ingestionStatus.progress}%` :
             ingestionStatus.status === 'queued' ? 'AI Queued' :
             ingestionStatus.status === 'failed' ? 'AI Failed' : '✓ AI Ready'}
          </span>
        )}
        {(() => {
          const formatBytes = (bytes?: number): string => {
            if (!bytes) return 'Unknown size';
            if (bytes < 1024) return `${bytes} B`;
            if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
          };
          const sizeStr = (material.fileSizeBytes
            ? formatBytes(material.fileSizeBytes)
            : (material.metadata?.size as unknown as string | undefined)
          );

          if (typeof sizeStr === 'string' && sizeStr !== 'NaN KB' && sizeStr !== '0.0 KB' && sizeStr !== 'Unknown size') {
            return <span className="text-[9px] font-bold text-primary bg-primary/5 px-2 py-0.5 rounded">{sizeStr}</span>;
          }
          return null;
        })()}
        {material.metadata?.fileType && (
          <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded">{material.metadata.fileType}</span>
        )}
      </div>
    </div>
  );
}
