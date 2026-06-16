import { useState } from 'react';
import { Search, X, Loader2, FileSearch, AlertCircle, CheckCircle, Download, Globe, FileText } from 'lucide-react';
import { useOverscroll } from '../../hooks/useOverscroll';
import { Screen } from '../../types';
import { motion } from 'motion/react';

interface PdfResult {
  title: string;
  url: string;
  content: string;
  engine: string;
  score: number;
  publishedDate: string | null;
}

interface PdfSearchPanelProps {
  onNavigate?: (screen: Screen, url?: string) => void;
  addMaterial: (m: any) => void;
  topics: any[];
  folders: any[];
  selectedTopicId: string | null;
  selectedFolderId: string | null;
  onClose: () => void;
}

export function PdfSearchPanel({ onNavigate, addMaterial, topics, folders, selectedTopicId, selectedFolderId, onClose }: PdfSearchPanelProps) {
  const resultsOverscrollRef = useOverscroll();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PdfResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchedInstance, setSearchedInstance] = useState('');
  const [savingUrl, setSavingUrl] = useState<string | null>(null);
  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set());
  const [saveTopicId, setSaveTopicId] = useState(selectedTopicId || '');
  const [saveFolderId, setSaveFolderId] = useState(selectedFolderId || '');

  const customInstance = localStorage.getItem('browser_searxng_instance') || undefined;

  // ── CORS-friendly academic PDF APIs ────────────────────────────────────────
  // These APIs all set Access-Control-Allow-Origin: * so they work from the
  // Electron renderer without a proxy. SearXNG is only used via IPC (Node.js).

  /** Semantic Scholar — open-access papers with direct PDF URLs */
  const searchSemanticScholar = async (q: string): Promise<PdfResult[]> => {
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&fields=title,year,openAccessPdf,abstract&limit=20`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Semantic Scholar HTTP ${res.status}`);
    const data = await res.json() as any;
    return (data.data || [])
      .filter((p: any) => p.openAccessPdf?.url)
      .map((p: any) => ({
        title: p.title || 'Untitled',
        url: p.openAccessPdf.url as string,
        content: p.abstract ? (p.abstract as string).slice(0, 200) : '',
        engine: 'Semantic Scholar',
        score: 0,
        publishedDate: p.year ? String(p.year) : null,
      }));
  };

  /** arXiv — physics / math / CS / economics papers, always free PDFs */
  const searchArXiv = async (q: string): Promise<PdfResult[]> => {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&max_results=15&sortBy=relevance`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`arXiv HTTP ${res.status}`);
    const xml = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    return Array.from(doc.querySelectorAll('entry')).map(entry => {
      const title = entry.querySelector('title')?.textContent?.trim() || 'Untitled';
      const summary = entry.querySelector('summary')?.textContent?.trim().slice(0, 200) || '';
      const published = entry.querySelector('published')?.textContent?.slice(0, 10) || null;
      const id = entry.querySelector('id')?.textContent?.trim() || '';
      // Convert abstract URL to PDF URL: https://arxiv.org/abs/XXXX → https://arxiv.org/pdf/XXXX
      const pdfUrl = id.replace('abs', 'pdf') + '.pdf';
      return { title, url: pdfUrl, content: summary, engine: 'arXiv', score: 0, publishedDate: published };
    });
  };

  /** CORE — aggregates 200M+ open-access research papers */
  const searchCore = async (q: string): Promise<PdfResult[]> => {
    const url = `https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(q)}&limit=15`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`CORE HTTP ${res.status}`);
    const data = await res.json() as any;
    return (data.results || [])
      .filter((p: any) => p.downloadUrl || p.sourceFulltextUrls?.length)
      .map((p: any) => ({
        title: p.title || 'Untitled',
        url: (p.downloadUrl || p.sourceFulltextUrls?.[0]) as string,
        content: p.abstract ? (p.abstract as string).slice(0, 200) : '',
        engine: 'CORE',
        score: 0,
        publishedDate: p.yearPublished ? String(p.yearPublished) : null,
      }));
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setSearchError(null);
    setResults([]);
    try {
      let allResults: PdfResult[] = [];
      let sources: string[] = [];

      // ── Path 1: IPC via Node.js (SearXNG, no CORS issues — after electron recompile) ──
      if (window.electronAPI?.searxngSearch) {
        const res = await window.electronAPI.searxngSearch(query.trim(), customInstance);
        if (res.success && res.results.length > 0) {
          allResults = res.results;
          sources = [res.instance || 'WebSearch'];
        } else if (!res.success) {
          throw new Error(`Web Search Failed: ${res.error}`);
        } else if (res.success && res.results.length === 0) {
          throw new Error(`Web Search returned 0 results.`);
        }
      }

      // ── Path 2: CORS-friendly academic APIs (always available in renderer) ──
      if (allResults.length === 0) {
        const errors: string[] = [];
        // Run all three in parallel for speed
        const [ssResults, arxivResults, coreResults] = await Promise.allSettled([
          searchSemanticScholar(query.trim()),
          searchArXiv(query.trim()),
          searchCore(query.trim()),
        ]);

        if (ssResults.status === 'fulfilled' && ssResults.value.length > 0) {
          allResults.push(...ssResults.value);
          sources.push('Semantic Scholar');
        } else if (ssResults.status === 'rejected') errors.push(`SS: ${ssResults.reason?.message}`);

        if (arxivResults.status === 'fulfilled' && arxivResults.value.length > 0) {
          allResults.push(...arxivResults.value);
          sources.push('arXiv');
        } else if (arxivResults.status === 'rejected') errors.push(`arXiv: ${arxivResults.reason?.message}`);

        if (coreResults.status === 'fulfilled' && coreResults.value.length > 0) {
          allResults.push(...coreResults.value);
          sources.push('CORE');
        } else if (coreResults.status === 'rejected') errors.push(`CORE: ${coreResults.reason?.message}`);

        if (allResults.length === 0) {
          throw new Error(`No results from any source. ${errors.join(' | ')}`);
        }
      }

      // De-duplicate by URL, cap at 30
      const seen = new Set<string>();
      const finalResults = allResults.filter(r => {
        if (!r.url || seen.has(r.url)) return false;
        seen.add(r.url);
        return true;
      }).slice(0, 30);

      setResults(finalResults);
      setSearchedInstance(sources.join(' + '));
      if (finalResults.length === 0) setSearchError('No open-access PDFs found. Try a broader query.');
    } catch (e: any) {
      setSearchError(e.message || 'Search failed. Check your internet connection.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSaveToVault = async (result: PdfResult) => {
    if (!saveTopicId || !saveFolderId) {
      alert('Please select a topic and folder to save into.');
      return;
    }
    setSavingUrl(result.url);
    try {
      if (window.electronAPI?.downloadPdf) {
        const fileName = result.title.replace(/[^a-zA-Z0-9 _-]/g, '').substring(0, 80) + '.pdf';
        const dl = await window.electronAPI.downloadPdf(result.url, fileName);
        if (dl.success && dl.localPath) {
          const fileHash = await window.electronAPI.hashFile(dl.localPath);
          addMaterial({
            title: result.title,
            url: result.url,
            boxType: 'file',
            folderId: saveFolderId,
            topicId: saveTopicId,
            localPath: dl.localPath,
            fileSizeBytes: dl.size,
            fileHash: fileHash ?? undefined,
            storageStatus: 'active',
            metadata: { fileType: 'PDF', source: 'WebSearch', engine: result.engine },
          });
          setSavedUrls(prev => new Set([...prev, result.url]));
        } else {
          alert(`Download failed: ${dl.error}`);
        }
      } else {
        // Web: just save URL as a link
        addMaterial({
          title: result.title,
          url: result.url,
          boxType: 'link',
          folderId: saveFolderId,
          topicId: saveTopicId,
          metadata: { source: 'WebSearch', engine: result.engine },
        });
        setSavedUrls(prev => new Set([...prev, result.url]));
      }
    } finally {
      setSavingUrl(null);
    }
  };

  const filteredFolders = folders.filter((f: any) => f.topicId === saveTopicId);

  return (
    <div
      className="absolute inset-0 z-[80] flex items-end justify-center p-0"
      onClick={onClose}
    >
      <motion.div
        initial={{ height: 0 }}
        animate={{ height: '70vh' }}
        exit={{ height: 0 }}
        className="w-full max-w-none bg-surface-container-lowest border-t border-outline-variant/20 shadow-2xl flex flex-col overflow-hidden"
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-outline-variant/10 flex items-center gap-4 bg-surface-container-low shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary/10 rounded-xl flex items-center justify-center">
              <FileSearch className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-black">Search Web for PDFs</h3>
              <p className="text-[10px] text-outline">Powered by DuckDuckGo · finds publicly available PDF documents</p>
            </div>
          </div>
          <form onSubmit={e => { e.preventDefault(); handleSearch(); }} className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-outline" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="e.g. machine learning lecture notes, quantum physics..."
                className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-primary transition-all"
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={isSearching || !query.trim()}
              className="px-5 py-2 bg-primary text-on-primary rounded-full text-sm font-bold disabled:opacity-40 hover:opacity-90 transition-all flex items-center gap-2"
            >
              {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {isSearching ? 'Searching...' : 'Search PDFs'}
            </button>
          </form>
          {/* Save target picker */}
          <div className="flex items-center gap-2 shrink-0">
            <select value={saveTopicId} onChange={e => { setSaveTopicId(e.target.value); setSaveFolderId(''); }}
              className="bg-surface-container-low text-xs font-bold border border-outline-variant/20 rounded-lg px-2 py-1.5 focus:outline-none">
              <option value="">Select Topic</option>
              {topics.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={saveFolderId} onChange={e => setSaveFolderId(e.target.value)}
              className="bg-surface-container-low text-xs font-bold border border-outline-variant/20 rounded-lg px-2 py-1.5 focus:outline-none">
              <option value="">Select Folder</option>
              {filteredFolders.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface-container-high rounded-full transition-all shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div ref={resultsOverscrollRef} className="flex-1 overflow-y-auto p-4 no-scrollbar bg-surface-container-lowest">
          {isSearching && (
            <div className="flex flex-col items-center justify-center h-48 gap-4 text-outline">
              <div className="relative w-12 h-12">
                <div className="absolute inset-0 border-4 border-primary/20 rounded-full" />
                <div className="absolute inset-0 border-4 border-transparent border-t-primary rounded-full animate-spin" />
              </div>
              <p className="text-sm font-bold">Searching for PDFs across the web...</p>
              <p className="text-xs opacity-60">Querying DuckDuckGo web search engine</p>
            </div>
          )}
          {searchError && !isSearching && (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-outline">
              <AlertCircle className="w-10 h-10 text-amber-500 opacity-70" />
              <p className="text-sm font-bold text-center max-w-md">{searchError}</p>
              {!window.electronAPI && <p className="text-xs opacity-60">Desktop app required for full functionality</p>}
            </div>
          )}
          {!isSearching && results.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-outline uppercase tracking-widest mb-3">
                {results.length} PDF results {searchedInstance && `· via ${searchedInstance}`}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {results.map((r, i) => {
                  const isSaved = savedUrls.has(r.url);
                  const isSaving = savingUrl === r.url;
                  const domain = (() => { try { return new URL(r.url).hostname; } catch { return r.url; } })();
                  return (
                    <motion.div
                      key={r.url + i}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="bg-surface-container-low border border-outline-variant/10 rounded-xl p-3 flex flex-col gap-2 hover:shadow-md transition-all"
                    >
                      <div className="flex items-start gap-2">
                        <div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                          <FileText className="w-4 h-4 text-red-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-bold text-on-surface line-clamp-2 leading-tight">{r.title}</h4>
                          <p className="text-[9px] text-outline truncate mt-0.5">{domain}</p>
                        </div>
                      </div>
                      {r.content && (
                        <p className="text-[10px] text-on-surface-variant line-clamp-2 leading-relaxed">{r.content}</p>
                      )}
                      <div className="flex gap-2 mt-auto pt-1">
                        <button
                          onClick={() => onNavigate?.('browser', r.url)}
                          className="flex-1 py-1.5 bg-surface-container-high text-on-surface-variant text-[10px] font-bold rounded-lg hover:bg-primary/10 hover:text-primary transition-all flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Globe className="w-3.5 h-3.5" /> Preview
                        </button>
                        <button
                          onClick={() => handleSaveToVault(r)}
                          disabled={isSaved || isSaving || !saveTopicId || !saveFolderId}
                          className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer ${
                            isSaved
                              ? 'bg-green-50 text-green-600'
                              : 'bg-primary/10 text-primary hover:bg-primary hover:text-on-primary disabled:opacity-30'
                          }`}
                        >
                          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isSaved ? <CheckCircle className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                          {isSaving ? 'Saving...' : isSaved ? 'Saved!' : 'Save to Vault'}
                        </button>
                      </div>
                      {(!saveTopicId || !saveFolderId) && (
                        <p className="text-[9px] text-amber-500 text-center">Select topic & folder above to save</p>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}
          {!isSearching && !searchError && results.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-outline">
              <FileSearch className="w-12 h-12 opacity-20" />
              <p className="font-bold text-sm">Search for any academic topic</p>
              <p className="text-xs opacity-60">Results are PDFs from across the internet via DuckDuckGo</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
