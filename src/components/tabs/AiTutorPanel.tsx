import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Trash2,
  X,
  Loader2,
  AlertCircle,
  Send,
  Terminal,
  Copy,
  Check,
  Download,
  Play,
  CheckCircle2,
  Clock,
  ChevronRight,
  Database,
  RefreshCw,
  Cpu,
  FileText,
  Activity,
} from 'lucide-react';
import { Material, ProfessorSession, BoardAction, PdfAnnotation, ProfessorResponse } from '../../types';
import { useUserSettings } from '../../hooks/useLocalData';
import { generateProfessorResponse, ChatMessage } from '../../lib/ai';

import { useIngestionStatus } from '../../hooks/useIngestionStatus';
import { isTOCPage } from '../../lib/rag/tocDetector';

// ─── PDF Text Utilities ──────────────────────────────────────────────────────
// Expand common PDF ligature code-points to their ASCII equivalents.
// PDF text layers often encode "fi", "fl", "ff" etc. as a single Unicode glyph
// (e.g. U+FB01 ﬁ). The LLM always writes natural ASCII, so both sides must be
// expanded before comparison or the normalised exact-match will fail silently.
function expandPdfLigatures(str: string): string {
  return str
    .replace(/\uFB00/g, 'ff')   // ﬀ
    .replace(/\uFB01/g, 'fi')   // ﬁ
    .replace(/\uFB02/g, 'fl')   // ﬂ
    .replace(/\uFB03/g, 'ffi')  // ﬃ
    .replace(/\uFB04/g, 'ffl')  // ﬄ
    .replace(/\uFB05/g, 'st')   // ﬅ
    .replace(/\uFB06/g, 'st')   // ﬆ
    .replace(/\u00AD/g, '');    // soft hyphen (invisible, breaks matching)
}

function computeContextCoverage(query: string, chunks: any[]): { coverage: number; missingWords: string[] } {
  if (!query || chunks.length === 0) return { coverage: 1.0, missingWords: [] };

  const stopWords = new Set([
    'what', 'is', 'are', 'the', 'a', 'an', 'and', 'or', 'but', 'how', 'why', 'who', 'where', 'when',
    'which', 'to', 'in', 'of', 'for', 'on', 'with', 'at', 'by', 'from', 'about', 'as', 'into', 'like',
    'through', 'after', 'before', 'between', 'under', 'over', 'compare', 'contrast', 'explain',
    'summarize', 'find', 'page', 'chapter', 'section', 'this', 'that', 'these', 'those', 'it', 'them',
    'they', 'he', 'she', 'you', 'me', 'us', 'we', 'i'
  ]);

  const cleanWords = query
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 2 && !stopWords.has(w));

  if (cleanWords.length === 0) return { coverage: 1.0, missingWords: [] };

  const combinedText = chunks.map(c => (c.text || '').toLowerCase()).join(' ');

  let matches = 0;
  const missingWords: string[] = [];
  for (const word of cleanWords) {
    if (combinedText.includes(word)) {
      matches++;
    } else {
      missingWords.push(word);
    }
  }

  return {
    coverage: matches / cleanWords.length,
    missingWords
  };
}

function compressHistory(history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
  const totalLength = history.reduce((sum, m) => sum + m.content.length, 0);
  const COMPRESSION_THRESHOLD = 7000;
  if (totalLength <= COMPRESSION_THRESHOLD) {
    return history;
  }

  const KEEP_VERBATIM = 4;
  if (history.length <= KEEP_VERBATIM) {
    return history;
  }

  const oldMessages = history.slice(0, history.length - KEEP_VERBATIM);
  const recentMessages = history.slice(history.length - KEEP_VERBATIM);

  const userQueries = oldMessages
    .filter(m => m.role === 'user')
    .map(m => m.content.slice(0, 100))
    .join('; ');

  if (!userQueries) {
    return history;
  }

  const summaryMessage = {
    role: 'system' as const,
    content: `[Previous conversation summary: The student previously asked about: ${userQueries}]`
  };

  return [summaryMessage, ...recentMessages];
}

function multiplyTransforms(a: number[], b: number[]) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/**
 * Extract sorted verbatim text from a PDF page using the same row-bucket
 * sort that CustomPdfViewer uses for annotation matching. Shared by both
 * the initial context build and the annotation-refinement pass.
 */
async function extractPageVerbatimText(pdfDoc: any, pNum: number): Promise<string> {
  const page = await pdfDoc.getPage(pNum);
  const textContent = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });

  const rawItems = textContent.items as any[];
  const pdfjsLib = (window as any).pdfjsLib;
  const util = pdfjsLib?.Util;

  const processedItems = rawItems
    .map((item: any) => {
      if (!item?.str) return null;
      const transform = util?.transform
        ? util.transform(viewport.transform, item.transform)
        : multiplyTransforms(viewport.transform, item.transform);
      const fontHeight = Math.hypot(transform[2], transform[3]) || Math.abs(transform[3]) || 10;
      return { item, fontHeight, left: transform[4], top: transform[5] - fontHeight };
    })
    .filter(Boolean) as any[];

  const sortedFH = processedItems.map((i: any) => i.fontHeight).sort((a: number, b: number) => a - b);
  const medFH = sortedFH.length > 0 ? sortedFH[Math.floor(sortedFH.length / 2)] : 12;
  const rowBucket = Math.max(4, medFH * 0.65);

  processedItems.forEach((item: any) => { item._rowKey = Math.round(item.top / rowBucket); });
  processedItems.sort((a: any, b: any) => a._rowKey !== b._rowKey ? a._rowKey - b._rowKey : a.left - b.left);

  return processedItems.map((item: any) => expandPdfLigatures(item.item.str || '')).join(' ');
}

function generateMarkdownReport(debugInfo: any, steps: any, materialTitle: string): string {
  if (!debugInfo) return '';

  const timestamp = debugInfo.timestamp || new Date().toLocaleTimeString();
  const query = debugInfo.query || 'N/A';
  const model = debugInfo.model || 'N/A';
  const intent = debugInfo.intent || 'N/A';
  const durationMs = debugInfo.durationMs || 0;
  const coverage = debugInfo.coverage !== undefined ? `${Math.round(debugInfo.coverage * 100)}%` : 'N/A';
  const missingWords = (debugInfo.missingWords || []).join(', ') || 'None';
  
  // Citation Rate Calculation
  let citationRate = '0%';
  if (debugInfo.responseRaw?.speech) {
    const speech = debugInfo.responseRaw.speech;
    const citations = speech.match(/\[\d+\]/g) || [];
    const paragraphs = speech.split(/\n+/).filter((p: string) => p.trim().length > 10).length || 1;
    citationRate = `${Math.round((citations.length / paragraphs) * 100)}%`;
  }

  // Chunk Quality Calculation
  const relevantChunksForQuality = debugInfo.relevantChunks || [];
  const chunkQuality = relevantChunksForQuality.length === 0
    ? '⚪ No chunks retrieved'
    : relevantChunksForQuality.every((c: any) => isTOCPage(c.expandedText || c.text || ''))
    ? '🔴 All chunks are TOC/headings — index may need rebuild'
    : relevantChunksForQuality.some((c: any) => isTOCPage(c.expandedText || c.text || ''))
    ? '🟡 Mixed — some chunks are TOC, some are prose'
    : '🟢 All chunks contain prose';

  // Steps Trace
  let stepsTraceMd = '| Phase | Status | Duration | Details |\n| :--- | :--- | :--- | :--- |\n';
  const pipelineStepsList = [
    { key: 'classification', name: 'Query Classification & RAG Retrieval' },
    { key: 'coverage', name: 'Semantic Coverage & Expansion Check' },
    { key: 'verbatimText', name: 'Verbatim Document Scraper' },
    { key: 'systemPrompt', name: 'System Prompt Synthesis' },
    { key: 'llmCall', name: 'LLM Response Generation' },
    { key: 'refinement', name: 'Blind Highlight Refinement Check' },
    { key: 'dispatch', name: 'Action Dispatcher & Canvas Sync' }
  ];

  pipelineStepsList.forEach((step) => {
    const info = (debugInfo.pipelineSteps || steps)[step.key] || { status: 'idle' };
    const duration = info.durationMs !== undefined ? `${info.durationMs}ms` : '-';
    const statusLabel = info.status === 'completed' ? '✅ Completed' : info.status === 'running' ? '⏳ Running' : info.status === 'error' ? '❌ Failed' : '⚪ Pending';
    const details = info.details || '-';
    stepsTraceMd += `| ${step.name} | ${statusLabel} | ${duration} | ${details} |\n`;
  });

  // Context Chunks
  let chunksMd = '';
  if (debugInfo.relevantChunks && debugInfo.relevantChunks.length > 0) {
    debugInfo.relevantChunks.forEach((chunk: any, i: number) => {
      const scores = debugInfo.metrics?.scores?.find((s: any) => s.chunkId === chunk.chunk_id);
      let scoresStr = '';
      if (scores) {
        scoresStr = `*(BM25: ${Math.round(scores.bm25Score * 100)}%, Vector: ${Math.round(scores.vectorScore * 100)}%, Metadata: ${Math.round(scores.metadataScore * 100)}%, Combined: **${Math.round(scores.finalScore * 100)}%**)*`;
      }
      chunksMd += `### Chunk ${i + 1} (Page ${chunk.page}, Section: "${chunk.section || 'General'}")\n`;
      if (scoresStr) chunksMd += `${scoresStr}\n\n`;
      chunksMd += `\`\`\`text\n${chunk.text}\n\`\`\`\n\n`;
      if (chunk.expandedText && chunk.expandedText !== chunk.text) {
        chunksMd += `**Expanded Surrounding Context:**\n\`\`\`text\n${chunk.expandedText}\n\`\`\`\n\n`;
      }
    });
  } else {
    chunksMd = '*No relevant context chunks were retrieved.*';
  }

  // LLM Messages Payload
  let payloadMd = '';
  if (debugInfo.messagesSent && Array.isArray(debugInfo.messagesSent)) {
    debugInfo.messagesSent.forEach((msg: any) => {
      payloadMd += `### **[${msg.role.toUpperCase()}]**:\n${msg.content}\n\n---\n\n`;
    });
  } else {
    payloadMd = '*No LLM payload available.*';
  }

  // Highlights
  let highlightsMd = '';
  if (debugInfo.finalAnnotations && debugInfo.finalAnnotations.length > 0) {
    highlightsMd = '| Type | Page | Color | Callout Label | Target Text |\n| :--- | :--- | :--- | :--- | :--- |\n';
    debugInfo.finalAnnotations.forEach((ann: any) => {
      highlightsMd += `| ${ann.type} | Page ${ann.page} | ${ann.color} | ${ann.callout || 'None'} | \`${ann.targetText}\` |\n`;
    });
  } else {
    highlightsMd = '*No annotations / highlights were generated.*';
  }

  // Board Actions
  let boardActionsMd = '';
  if (debugInfo.responseRaw?.board_actions && debugInfo.responseRaw.board_actions.length > 0) {
    boardActionsMd = '| Tool | Content | Position | Color | Timing |\n| :--- | :--- | :--- | :--- | :--- |\n';
    debugInfo.responseRaw.board_actions.forEach((act: any) => {
      boardActionsMd += `| ${act.tool} | \`${act.content}\` | (${act.position?.x?.toFixed(2) ?? 0}, ${act.position?.y?.toFixed(2) ?? 0}) | ${act.style?.color || 'default'} | ${act.timing}ms |\n`;
    });
  } else {
    boardActionsMd = '*No blackboard actions were triggered.*';
  }

  return `# AI Pipeline Analysis Report

Generated at: **${new Date().toLocaleString()}** (Execution time: ${timestamp})
Document Title: **${materialTitle}**

---

## 📋 Executive Summary

| Metric | Value |
| :--- | :--- |
| **User Question** | \`${query}\` |
| **Model** | \`${model}\` |
| **RAG Intent** | \`${intent}\` |
| **Total Duration** | \`${durationMs}ms\` |
| **Retrieval Coverage** | \`${coverage}\` |
| **Citation Rate** | \`${citationRate}\` |
| **Missing Query Words** | \`${missingWords}\` |
| **Chunk Quality** | ${chunkQuality} |

---

## ⏱️ Pipeline Execution Trace

${stepsTraceMd}

---

## 🔍 Retrieved Semantic Context

${chunksMd}

---

## 📝 Synthesized Prompt & Messages Payload

<details>
<summary>Click to expand LLM Messages Payload</summary>

${payloadMd}

</details>

---

## 🎯 Generated Visual Actions & Outputs

### 💬 Teaching Response (Speech)
${debugInfo.responseRaw?.speech || '*No speech response generated.*'}

### 🖍️ PDF highlights
${highlightsMd}

### 🎛️ Blackboard Board Actions
${boardActionsMd}

### 📟 Navigate To Page
${debugInfo.responseRaw?.navigate_to_page !== undefined ? `Jumps to: **Page ${debugInfo.responseRaw.navigate_to_page}**` : '*No auto-navigation triggered.*'}

---
*End of Report — AI Tutor Study Assistant Pipeline Inspector*
`;
}


interface AiTutorPanelProps {
  material: Material;
  currentPage: number;
  numPages: number;
  pdfDoc: any;
  isAiPaneOpen: boolean;
  setIsAiPaneOpen: (open: boolean) => void;
  professorSession: ProfessorSession;
  setProfessorSession: React.Dispatch<React.SetStateAction<ProfessorSession>>;
  onAnnotations: (annotations: PdfAnnotation[]) => void;
  onBoardActions: (actions: BoardAction[]) => void;
  jumpToPage: (page: number) => void;
}

export default function AiTutorPanel({
  material,
  currentPage,
  numPages,
  pdfDoc,
  isAiPaneOpen,
  setIsAiPaneOpen,
  professorSession,
  setProfessorSession,
  onAnnotations,
  onBoardActions,
  jumpToPage,
}: AiTutorPanelProps) {
  const { settings } = useUserSettings();
  const geminiKey = settings?.geminiKey || '';
  const openrouterKey = settings?.openrouterKey || '';
  const openaiKey = settings?.openaiKey || '';
  const anthropicKey = settings?.anthropicKey || '';
  const selectedModel = settings?.selectedModel || 'gemini';

  // AI chat states
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string; timestamp: string; sources?: number[] }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Pipeline debug state
  const [showDebugDrawer, setShowDebugDrawer] = useState(false);
  const [lastDebugInfo, setLastDebugInfo] = useState<any>(null);
  const [activeDebugTab, setActiveDebugTab] = useState<'flow' | 'rag' | 'prompt' | 'payload' | 'response'>('flow');
  const [copiedText, setCopiedText] = useState(false);

  const [pipelineSteps, setPipelineSteps] = useState<Record<string, {
    status: 'idle' | 'running' | 'completed' | 'error';
    durationMs?: number;
    details?: string;
  }>>({
    classification: { status: 'idle' },
    coverage: { status: 'idle' },
    verbatimText: { status: 'idle' },
    systemPrompt: { status: 'idle' },
    llmCall: { status: 'idle' },
    refinement: { status: 'idle' },
    dispatch: { status: 'idle' }
  });

  // Ingestion status from hook
  const ingestionStatus = useIngestionStatus(material.id);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const currentSourceMapRef = useRef<Array<{ page: number; section: string }>>([]);

  // Reset local state if material changes
  useEffect(() => {
    setChatMessages([]);
    setLastDebugInfo(null);
    setPipelineSteps({
      classification: { status: 'idle' },
      coverage: { status: 'idle' },
      verbatimText: { status: 'idle' },
      systemPrompt: { status: 'idle' },
      llmCall: { status: 'idle' },
      refinement: { status: 'idle' },
      dispatch: { status: 'idle' }
    });
    setAiError(null);
    setChatInput('');
  }, [material.id]);

  // 1. Sync messages from hydrated database session
  useEffect(() => {
    if (professorSession.conversationHistory.length > 0 && chatMessages.length === 0) {
      const restored = professorSession.conversationHistory.map((m) => {
        const sources: number[] = [];
        const pageMatches = m.content.match(/\b[pP]age\s+(\d+)\b/g) || [];
        pageMatches.forEach(match => {
          const num = parseInt(match.match(/\d+/)![0], 10);
          if (!sources.includes(num)) sources.push(num);
        });
        sources.sort((a, b) => a - b);

        return {
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          sources: sources.length > 0 ? sources : undefined,
        };
      });
      setChatMessages(restored);
    }
  }, [professorSession.conversationHistory]);

  // 3. Welcome greeting
  useEffect(() => {
    if (isAiPaneOpen && chatMessages.length === 0 && professorSession.conversationHistory.length === 0) {
      setChatMessages([
        {
          role: 'assistant',
          content: `📚 **Welcome to the AI Study Chat!**\n\nI have scanned **Page ${currentPage}** of this document using **${
            selectedModel === 'openrouter'
              ? 'OpenRouter Auto Free'
              : selectedModel === 'gemini'
              ? 'Google Gemini'
              : selectedModel === 'openai'
              ? 'OpenAI'
              : 'Anthropic Claude'
          }**.\n\nChoose a quick preset command above to begin analyzing, or type a custom question below to start discussing this page!`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    }
  }, [isAiPaneOpen, currentPage, selectedModel, professorSession.conversationHistory.length]);

  // 4. Page sync notification (silently updates reference to prevent message spam)
  const lastPageRef = useRef(currentPage);
  useEffect(() => {
    if (isAiPaneOpen && currentPage !== lastPageRef.current) {
      lastPageRef.current = currentPage;
    }
  }, [currentPage, isAiPaneOpen]);

  // 5. Scroll chat to bottom
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, aiLoading]);

  // AI Message Dispatcher
  const handleSendMessage = async (customPrompt?: string) => {
    const promptText = customPrompt || chatInput.trim();
    if (!promptText) return;

    const startTime = performance.now();
    let resolvedProvider = selectedModel || 'gemini';

    // Key fallbacks logic
    if (resolvedProvider === 'gemini' && !geminiKey) {
      if (openrouterKey) resolvedProvider = 'openrouter';
      else if (openaiKey) resolvedProvider = 'openai';
      else if (anthropicKey) resolvedProvider = 'anthropic';
    } else if (resolvedProvider === 'openrouter' && !openrouterKey) {
      if (geminiKey) resolvedProvider = 'gemini';
      else if (openaiKey) resolvedProvider = 'openai';
      else if (anthropicKey) resolvedProvider = 'anthropic';
    } else if (resolvedProvider === 'openai' && !openaiKey) {
      if (geminiKey) resolvedProvider = 'gemini';
      else if (openrouterKey) resolvedProvider = 'openrouter';
      else if (anthropicKey) resolvedProvider = 'anthropic';
    } else if (resolvedProvider === 'anthropic' && !anthropicKey) {
      if (geminiKey) resolvedProvider = 'gemini';
      else if (openrouterKey) resolvedProvider = 'openrouter';
      else if (openaiKey) resolvedProvider = 'openai';
    }

    let activeKey = '';
    let providerName = 'Gemini';

    if (resolvedProvider === 'gemini') {
      activeKey = geminiKey;
      providerName = 'Gemini';
    } else if (resolvedProvider === 'openrouter') {
      activeKey = openrouterKey;
      providerName = 'OpenRouter';
    } else if (resolvedProvider === 'openai') {
      activeKey = openaiKey;
      providerName = 'OpenAI';
    } else if (resolvedProvider === 'anthropic') {
      activeKey = anthropicKey;
      providerName = 'Anthropic';
    }

    if (!activeKey) {
      setAiError(`Add your ${providerName} API Key in Settings to use AI study features.`);
      setIsAiPaneOpen(true);
      return;
    }
    if (!pdfDoc) return;

    // Add user message to conversation stream
    const userMsg = {
      role: 'user' as const,
      content: promptText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    if (!customPrompt) setChatInput(''); // clear text box

    setAiLoading(true);
    setAiError(null);
    setIsAiPaneOpen(true);

    const aiConfig = {
      provider: resolvedProvider,
      geminiKey,
      openrouterKey,
      openaiKey,
      anthropicKey,
    };

    const currentSteps: Record<string, {
      status: 'idle' | 'running' | 'completed' | 'error';
      durationMs?: number;
      details?: string;
    }> = {
      classification: { status: 'running', details: 'Querying classifier & database...' },
      coverage: { status: 'idle' },
      verbatimText: { status: 'idle' },
      systemPrompt: { status: 'idle' },
      llmCall: { status: 'idle' },
      refinement: { status: 'idle' },
      dispatch: { status: 'idle' }
    };
    setPipelineSteps({ ...currentSteps });

    const updateStep = (
      key: string,
      status: 'idle' | 'running' | 'completed' | 'error',
      durationMs?: number,
      details?: string
    ) => {
      currentSteps[key] = { status, durationMs, details };
      setPipelineSteps({ ...currentSteps });
    };

    try {
      // 1. Classification & context retrieval
      const classificationStart = performance.now();
      let conceptIndex = null;
      let relevantChunks = [];
      let intent = 'FACTUAL';
      let retrieveMetrics = null;
      if ((window as any).electronAPI) {
        try {
          const res = await (window as any).electronAPI.professorClassifyAndRetrieve(
            material.id,
            currentPage,
            numPages,
            promptText,
            professorSession.conversationHistory
          );
          conceptIndex = res.conceptIndex;
          relevantChunks = res.relevantChunks || [];
          intent = res.intent;
          retrieveMetrics = res.metrics || null;
        } catch (e: any) {
          console.warn('[Professor] RAG classify and retrieval failed:', e);
          updateStep('classification', 'error', Math.round(performance.now() - classificationStart), e.message || 'RAG Retrieval Failed');
          throw e;
        }
      }
      const classificationDuration = Math.round(performance.now() - classificationStart);
      updateStep('classification', 'completed', classificationDuration, `Intent: ${intent} | ${relevantChunks.length} chunks retrieved`);

      // 2. Coverage verification and secondary retrieval
      updateStep('coverage', 'running', undefined, 'Analyzing semantic coverage...');
      const coverageStart = performance.now();
      const currentCoverage = retrieveMetrics?.coverage ?? 0;
      const missingWords = retrieveMetrics?.missingConcepts ?? [];
      let secondaryPerformed = false;
      if (currentCoverage < 0.80 && missingWords.length > 0 && (window as any).electronAPI) {
        try {
          secondaryPerformed = true;
          const refinedQuery = `INTENT:FACTUAL ${missingWords.join(' ')}`;
          const secondRes = await (window as any).electronAPI.professorClassifyAndRetrieve(
            material.id,
            currentPage,
            numPages,
            refinedQuery,
            professorSession.conversationHistory
          );
          const secondChunks = secondRes.relevantChunks || [];
          
          // Merge and de-duplicate by chunk_id.
          // FIX: Keep primary chunks in their score-rank order, then append secondary
          // chunks that are genuinely new. Do NOT re-sort by chunk_order — that would
          // replace the most semantically relevant later-chapter chunks with earlier
          // chronological ones that may not answer the query at all.
          const seen = new Set(relevantChunks.map(c => c.chunk_id || c.chunkId));
          const merged = [...relevantChunks];
          for (const c of secondChunks) {
            const cid = c.chunk_id || c.chunkId;
            if (!seen.has(cid)) {
              seen.add(cid);
              merged.push(c);
              if (merged.length >= 10) break; // cap at 10
            }
          }
          relevantChunks = merged.slice(0, 10);

          // Update metrics to reflect secondary coverage
          if (retrieveMetrics) {
            const newCoverage = secondRes.metrics?.coverage ?? currentCoverage;
            const newMissing = secondRes.metrics?.missingConcepts ?? [];
            retrieveMetrics.coverage = Math.max(currentCoverage, newCoverage);
            retrieveMetrics.missingConcepts = newMissing.filter(w => !relevantChunks.some(rc => (rc.text || '').toLowerCase().includes(w)));
          }
        } catch (e: any) {
          console.warn('[Professor] Secondary RAG retrieval failed:', e);
          updateStep('coverage', 'error', Math.round(performance.now() - coverageStart), e.message || 'Secondary RAG Failed');
          throw e;
        }
      }
      const coverageDuration = Math.round(performance.now() - coverageStart);
      const finalCoverage = retrieveMetrics?.coverage ?? currentCoverage;
      updateStep('coverage', 'completed', coverageDuration, `Coverage: ${Math.round(finalCoverage * 100)}% | Secondary Retrieval: ${secondaryPerformed ? 'Performed' : 'Skipped'}`);

      // Save source map for inline clickable citations
      currentSourceMapRef.current = (relevantChunks ?? []).map((c: any) => ({
        page: c.page,
        section: c.section || 'General'
      }));

      // 3. Build context sections
      const chunkContext = (relevantChunks ?? [])
        .map((c: any, index: number) => `[Source ${index + 1}: Page ${c.page}, Section "${c.section || 'General'}"]\n${c.expandedText || c.text}`)
        .join('\n\n');

      const conceptMapText =
        conceptIndex?.topics?.length > 0
          ? conceptIndex.topics.map((t: any) => `• ${t.name} (pp. ${(t.pages ?? []).join(', ')})`).join('\n')
          : 'Concept map not yet available.';

      // 4. Build system prompt
      updateStep('systemPrompt', 'running', undefined, 'Synthesizing instructions & context...');
      const systemPromptStart = performance.now();

      // Problem 2 fix: assess chunk substance before passing to LLM.
      // If the retrieved chunks contain fewer than 80 words total, the LLM has
      // nothing to ground its answer in and will fabricate. Inject a warning.
      const totalChunkWords = (relevantChunks ?? []).reduce((sum: number, c: any) => {
        return sum + ((c.expandedText || c.text || '').split(/\s+/).filter(Boolean).length);
      }, 0);
      const chunkSubstance: 'sufficient' | 'insufficient' = totalChunkWords >= 80 ? 'sufficient' : 'insufficient';
      
      // UX 2 friendly fallback message when retrieval is insufficient/empty
      if (finalCoverage === 0 && chunkSubstance === 'insufficient') {
        const fallbackSpeech = "I wasn't able to find detailed content for that in the indexed version of this document. This can happen if that section hasn't been fully processed yet. Try asking about a specific concept by name, or rephrase your question.";
        
        // Emulate completed remaining steps for the debug inspector drawer
        updateStep('systemPrompt', 'completed', 0, 'Bypassed prompt synthesis');
        updateStep('verbatimText', 'completed', 0, 'Bypassed verbatim scraping');
        updateStep('llmCall', 'completed', 0, 'Bypassed LLM due to insufficient retrieval quality');
        updateStep('refinement', 'completed', 0, 'Bypassed highlight refinement check');
        
        const dispatchStart = performance.now();
        
        const nextHistory = [
          ...professorSession.conversationHistory,
          { role: 'user', content: promptText },
          { role: 'assistant', content: fallbackSpeech },
        ];

        setProfessorSession((prev) => ({
          ...prev,
          conversationHistory: nextHistory,
        }));

        setChatMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: fallbackSpeech,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            sources: [],
          },
        ]);
        
        const durationMs = Math.round(performance.now() - startTime);
        const dispatchDuration = Math.round(performance.now() - dispatchStart);
        updateStep('dispatch', 'completed', dispatchDuration, 'Dispatched friendly warning warning.');

        const finalSteps = { ...currentSteps };

        setLastDebugInfo({
          timestamp: new Date().toLocaleTimeString(),
          query: promptText,
          intent,
          systemPrompt: '(Bypassed)',
          relevantChunks,
          pageTextsVerbatim: '',
          messagesSent: [],
          responseRaw: {
            speech: fallbackSpeech,
            pdf_annotations: [],
            board_actions: [],
          },
          finalAnnotations: [],
          durationMs,
          model: 'fallback',
          coverage: 0,
          missingWords: [],
          metrics: retrieveMetrics,
          pipelineSteps: finalSteps,
        });

        setAiLoading(false);
        return;
      }

      const systemPrompt = buildProfessorSystemPrompt(
        material.title,
        numPages,
        conceptMapText,
        professorSession.studentModel,
        professorSession.teachingAgenda,
        chunkSubstance
      );
      const systemPromptDuration = Math.round(performance.now() - systemPromptStart);
      updateStep('systemPrompt', 'completed', systemPromptDuration, `Synthesized instructions (len: ${systemPrompt.length} chars, chunk substance: ${chunkSubstance} — ${totalChunkWords} words)`);

      // 5. Verbatim Text Extraction
      updateStep('verbatimText', 'running', undefined, 'Scraping page contents verbatim...');
      const verbatimStart = performance.now();
      const verbatimPageSet = new Set<number>();
      let pageTextsVerbatim = '';
      let pagesCount = 0;
      try {
        verbatimPageSet.add(currentPage);
        if (relevantChunks && Array.isArray(relevantChunks)) {
          relevantChunks.forEach((c: any) => {
            if (typeof c.page === 'number' && c.page >= 1 && c.page <= numPages) {
              verbatimPageSet.add(c.page);
            }
          });
        }

        const sortedPages = Array.from(verbatimPageSet).sort((a, b) => a - b);
        pagesCount = sortedPages.length;

        // Group raw_text by page from retrieved chunks
        const rawTextByPage = new Map<number, string[]>();
        if (relevantChunks && Array.isArray(relevantChunks)) {
          for (const c of relevantChunks) {
            if (c.raw_text && typeof c.page === 'number') {
              if (!rawTextByPage.has(c.page)) rawTextByPage.set(c.page, []);
              rawTextByPage.get(c.page)!.push(c.raw_text);
            }
          }
        }

        const results = await Promise.all(
          sortedPages.map(async (pNum) => {
            const dbTexts = rawTextByPage.get(pNum);
            if (dbTexts && dbTexts.length > 0) {
              // Problem 3 fix: check substance of DB-sourced text before including.
              // If the combined raw_text for this page is sparse (< 40 words),
              // it is almost certainly a TOC or cover page that slipped through.
              const combinedDb = dbTexts.join(' ');
              const wordCountDb = combinedDb.split(/\s+/).filter(Boolean).length;
              if (wordCountDb < 40) {
                console.warn(`[VerbatimScraper] Page ${pNum} has only ${wordCountDb} words from DB — skipping (likely TOC)`);
                return null;
              }
              return `--- PAGE ${pNum} TEXT ---\n${combinedDb}`;
            }
            const text = await extractPageVerbatimText(pdfDoc, pNum);
            // Word-count guard for live-extracted pages too
            const wordCount = text.split(/\s+/).filter(Boolean).length;
            if (wordCount < 40) {
              console.warn(`[VerbatimScraper] Page ${pNum} has only ${wordCount} words — skipping verbatim (likely TOC/cover)`);
              return null;
            }
            return `--- PAGE ${pNum} TEXT ---\n${text}`;
          })
        );
        // Filter out null entries (skipped TOC/sparse pages)
        pageTextsVerbatim = results.filter(Boolean).join('\n\n');
      } catch (e: any) {
        console.warn('[Professor] Failed to extract page texts verbatim:', e);
        updateStep('verbatimText', 'error', Math.round(performance.now() - verbatimStart), e.message || 'Verbatim Extraction Failed');
        throw e;
      }
      const verbatimDuration = Math.round(performance.now() - verbatimStart);
      updateStep('verbatimText', 'completed', verbatimDuration, `Extracted verbatim text from ${pagesCount} pages`);

      // 6. LLM Inference
      updateStep('llmCall', 'running', undefined, `Requesting structured response from ${resolvedProvider}...`);
      const llmStart = performance.now();
      
      const userTurnContent = [
        `Current Page: ${currentPage} of ${numPages}`,
        '',
        'Verbatim Text of Relevant Pages (use this for highlights):',
        pageTextsVerbatim || '(Unable to extract text)',
        '',
        'Relevant Document Sections (for extra context):',
        chunkContext || '(not yet indexed — use your knowledge)',
        '',
        `Student: ${promptText}`,
      ].join('\n').trim();

      const historyMessages = compressHistory(
        professorSession.conversationHistory
          .filter((m) => !m.content.startsWith('🔄') && !m.content.startsWith('📚'))
          .map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }))
      );

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...historyMessages,
        { role: 'user', content: userTurnContent },
      ];

      const professorResponse = await generateProfessorResponse(aiConfig, messages);
      const llmDuration = Math.round(performance.now() - llmStart);
      updateStep('llmCall', 'completed', llmDuration, `Response received from ${professorResponse.modelNameUsed || resolvedProvider} (${professorResponse.speech.length} chars of speech)`);

      // 7. Annotation Refinement (Blind Check)
      updateStep('refinement', 'running', undefined, 'Checking annotations for missing page contexts...');
      const refinementStart = performance.now();
      let finalAnnotations = professorResponse.pdf_annotations ?? [];
      let blindPagesSize = 0;
      let refinementPerformed = false;
      let refinementModel = '';

      if (finalAnnotations.length > 0) {
        const blindPages = new Set<number>();
        for (const ann of finalAnnotations) {
          if (typeof ann.page === 'number' && ann.page >= 1 && ann.page <= numPages && !verbatimPageSet.has(ann.page)) {
            blindPages.add(ann.page);
          }
        }
        blindPagesSize = blindPages.size;

        if (blindPages.size > 0) {
          updateStep('refinement', 'running', undefined, `Refining ${blindPages.size} blind page annotations...`);
          const blindPageTexts: string[] = [];
          for (const pNum of Array.from(blindPages).sort((a, b) => a - b)) {
            try {
              const text = await extractPageVerbatimText(pdfDoc, pNum);
              blindPageTexts.push(`--- PAGE ${pNum} TEXT ---\n${text}`);
            } catch (e) {
              console.warn(`[Professor] Refinement: failed to extract page ${pNum}`, e);
            }
          }

          if (blindPageTexts.length > 0) {
            refinementPerformed = true;
            const refinementUserContent = [
              'You previously generated pdf_annotations but lacked verbatim text for some pages.',
              'Here is the EXACT text for those pages (use it to copy targetText verbatim):',
              '',
              blindPageTexts.join('\n\n'),
              '',
              'Original annotations that need refinement (only fix targetText — keep page, type, color, callout):',
              JSON.stringify(
                finalAnnotations.filter(a => blindPages.has(a.page)),
                null, 2
              ),
            ].join('\n');

            const refinementMessages: ChatMessage[] = [
              {
                role: 'system',
                content: 'CRITICAL OUTPUT RULE:\nYou must output a single valid JSON object. Do not write any explanation, reasoning, or commentary before or after the JSON. Do not use markdown fences (```json). Your entire response must start with { and end with }.\n\n' +
                  'You are fixing annotation targetText. Return ONLY a valid JSON object with a single key "pdf_annotations" containing the corrected annotations array. ' +
                  'Copy targetText verbatim (≥10 consecutive words, or the entire page text if the page contains fewer than 10 words) from the page text provided. Keep page, type, color, callout unchanged. No other keys.',
              },
              { role: 'user', content: refinementUserContent },
            ];

            try {
              const refined = await generateProfessorResponse(aiConfig, refinementMessages);
              refinementModel = refined.modelNameUsed || '';
              if (refined.pdf_annotations?.length > 0) {
                const refinedByPage = new Map<number, typeof finalAnnotations>();
                for (const ann of refined.pdf_annotations) {
                  if (!refinedByPage.has(ann.page)) refinedByPage.set(ann.page, []);
                  refinedByPage.get(ann.page)!.push(ann);
                }
                finalAnnotations = [
                  ...finalAnnotations.filter(a => !blindPages.has(a.page)),
                  ...Array.from(refinedByPage.values()).flat(),
                ];
              }
            } catch (e) {
              console.warn('[Professor] Refinement call failed, using original annotations:', e);
            }
          }
        }
      }
      const refinementDuration = Math.round(performance.now() - refinementStart);
      updateStep(
        'refinement', 
        'completed', 
        refinementDuration, 
        blindPagesSize > 0 
          ? `Refined ${blindPagesSize} blind pages using ${refinementModel || resolvedProvider} (${refinementPerformed ? 'Success' : 'Failed to extract text'})` 
          : 'Skipped: all annotation targets had verbatim context.'
      );

      // 8. Visual Action Dispatching
      updateStep('dispatch', 'running', undefined, 'Dispatching visual updates & syncing...');
      const dispatchStart = performance.now();

      const nextHistory = [
        ...professorSession.conversationHistory,
        { role: 'user', content: promptText },
        { role: 'assistant', content: professorResponse.speech },
      ];

      setProfessorSession((prev) => ({
        ...prev,
        conversationHistory: nextHistory,
        studentModel: mergeStudentModel(prev.studentModel, professorResponse.student_model_delta, promptText),
        teachingAgenda: professorResponse.agenda_update ?? prev.teachingAgenda,
      }));

      const uniquePages = Array.from(new Set((relevantChunks ?? []).map((c: any) => c.page).filter(Boolean) as number[]))
        .sort((a, b) => a - b);

      setChatMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: professorResponse.speech,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          sources: uniquePages,
        },
      ]);

      if (professorResponse.board_actions?.length > 0) {
        onBoardActions(professorResponse.board_actions);
      }

      // UX 3 — Navigate to the right page automatically when answering a chapter question
      let targetPage: number | null = null;
      if (typeof professorResponse.navigate_to_page === 'number' && professorResponse.navigate_to_page >= 1 && professorResponse.navigate_to_page <= numPages) {
        // If the LLM pointed to page 4 (Table of Contents) but it's a chapter query, find first content page
        if (professorResponse.navigate_to_page === 4 && intent === 'CHAPTER_SUMMARY') {
          const nonTocChunks = (relevantChunks ?? []).filter((c: any) => !c.is_toc && c.page !== 4);
          if (nonTocChunks.length > 0) {
            const pages = nonTocChunks.map((c: any) => c.page).sort((a, b) => a - b);
            targetPage = pages[0];
          } else {
            targetPage = professorResponse.navigate_to_page;
          }
        } else {
          targetPage = professorResponse.navigate_to_page;
        }
      } else if (intent === 'CHAPTER_SUMMARY' && relevantChunks && relevantChunks.length > 0) {
        const nonTocChunks = relevantChunks.filter((c: any) => !c.is_toc && c.page !== 4);
        if (nonTocChunks.length > 0) {
          const pages = nonTocChunks.map((c: any) => c.page).sort((a, b) => a - b);
          targetPage = pages[0];
        }
      }

      if (targetPage && targetPage >= 1 && targetPage <= numPages) {
        if (targetPage !== currentPage) {
          console.log(`[AutoNav] Navigating to resolved page: ${targetPage}`);
          jumpToPage(targetPage);
        }
      } else if (finalAnnotations.length > 0) {
        // Suggestion A — Auto-navigation post-processor:
        // If the LLM did not set navigate_to_page but annotations reference pages
        // different from the current one, jump to the most-cited annotation page.
        const pageCounts = finalAnnotations.reduce((acc: Record<number, number>, ann: any) => {
          if (typeof ann.page === 'number' && ann.page >= 1 && ann.page <= numPages) {
            acc[ann.page] = (acc[ann.page] || 0) + 1;
          }
          return acc;
        }, {} as Record<number, number>);

        const topPageEntry = Object.entries(pageCounts)
          .sort(([, a], [, b]) => (b as number) - (a as number))[0];

        if (topPageEntry) {
          const topPage = parseInt(topPageEntry[0], 10);
          if (topPage !== currentPage) {
            console.log(`[AutoNav] Navigating to most-cited annotation page: ${topPage}`);
            jumpToPage(topPage);
          }
        }
      }

      if (finalAnnotations.length > 0) {
        onAnnotations(finalAnnotations);
      }

      const durationMs = Math.round(performance.now() - startTime);
      const dispatchDuration = Math.round(performance.now() - dispatchStart);
      updateStep('dispatch', 'completed', dispatchDuration, `Dispatched ${finalAnnotations.length} highlights and ${professorResponse.board_actions?.length || 0} board actions.`);

      const finalSteps = { ...currentSteps };

      setLastDebugInfo({
        timestamp: new Date().toLocaleTimeString(),
        query: promptText,
        intent,
        systemPrompt,
        relevantChunks,
        pageTextsVerbatim,
        messagesSent: messages,
        responseRaw: professorResponse,
        finalAnnotations,
        durationMs,
        model: professorResponse.modelNameUsed || selectedModel,
        coverage: retrieveMetrics?.coverage ?? 0,
        missingWords: retrieveMetrics?.missingConcepts ?? [],
        metrics: retrieveMetrics,
        pipelineSteps: finalSteps,
      });

    } catch (err: any) {
      console.error('[Professor] Dispatcher failed:', err);
      const errorContent = `⚠️ Request failed: ${err.message || 'Unknown error'}`;
      setChatMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: errorContent,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
      setAiError(err.message);

      // Find the running step and mark as error
      Object.keys(currentSteps).forEach((k) => {
        if (currentSteps[k].status === 'running') {
          currentSteps[k] = { ...currentSteps[k], status: 'error', details: err.message };
        }
      });
      setPipelineSteps({ ...currentSteps });
      const finalSteps = { ...currentSteps };

      const durationMs = Math.round(performance.now() - startTime);
      setLastDebugInfo((prev: any) => ({
        ...prev,
        timestamp: new Date().toLocaleTimeString(),
        query: promptText,
        error: err.message,
        durationMs,
        model: resolvedProvider,
        pipelineSteps: finalSteps,
      }));
    } finally {
      setAiLoading(false);
    }
  };

  const buildProfessorSystemPrompt = (
    title: string,
    totalPages: number,
    conceptMapText: string,
    studentModel: ProfessorSession['studentModel'],
    agenda: string[],
    chunkSubstance: 'sufficient' | 'insufficient' = 'sufficient'
  ): string => {
    // Problem 2 fix: when retrieved chunks lack prose, inject an explicit
    // grounding warning so the LLM does not fabricate from training data.
    const substanceWarning = chunkSubstance === 'insufficient'
      ? `
RETRIEVAL QUALITY WARNING: The retrieved document sections for this query contain very
little prose content (possibly due to indexing of front-matter or TOC pages). If you
cannot find a direct answer in the sections provided below, you MUST say exactly:
"I could not find enough information in the document to answer this."
Do NOT synthesize an answer from your general knowledge. Do NOT invent citations.
`
      : '';

    return `CRITICAL OUTPUT RULE:
You must output a single valid JSON object. Do not write any explanation, reasoning, or commentary before or after the JSON. Do not use markdown fences (\`\`\`json). Your entire response must start with { and end with }.

You are an elite academic professor teaching the document "${title}" (${totalPages} pages total).
${substanceWarning}
DOCUMENT STRUCTURE:
${conceptMapText}

STUDENT MODEL:
${
  studentModel.confused_concepts.length > 0
    ? `Struggling with: ${studentModel.confused_concepts.join(', ')}`
    : 'No known confusion yet.'
}
${
  studentModel.understood_concepts.length > 0
    ? `Has understood: ${studentModel.understood_concepts.join(', ')}`
    : ''
}
Questions asked: ${studentModel.questions_asked.length}

GROUNDING RULES — CRITICAL:
1. Base your answer ONLY on the "Relevant Document Sections" provided. Do NOT use your general training knowledge to explain details not present in the document.
2. If the answer or necessary information cannot be found in the provided sections, you must state exactly: "I could not find this in the document."
3. Every factual claim, explanation, or definition you write in "speech" must be immediately followed by an inline source citation in brackets (e.g. [1], [2], etc.) pointing to the source index from "Relevant Document Sections" that supports it. Do not group multiple sources into [1, 2], write them separately as [1][2].

TEACHING & FORMATTING RULES:
- Focus on the student's question, but build connections to related sections.
- When referencing specific text or sections of the document, set page, targetText, and color in pdf_annotations. Use any color requested by the student (e.g., 'red', 'green', 'blue', 'pink', 'purple'), or if none is specified, use 'orange'.
- targetText rules: (a) Copy at least 10 consecutive words (or the entire page text if the page contains fewer than 10 words), verbatim, from the raw "Verbatim Text of Relevant Pages" provided below — exact bytes, no paraphrasing, no spelling corrections. (b) Set page to the exact number shown in the "--- PAGE N ---" header. (c) Never copy across page boundaries.
- If the student asks about or references a topic on a different page (or if the teaching agenda leads you to a new page), and you want to jump/scroll the viewer to that page, set navigate_to_page to that page number.
- When explaining abstract concepts, formulas, definitions, or visual steps, draw them on the blackboard by setting board_actions.

BLACKBOARD RULES:
- If the student asks "what is X?" or "explain X" and X is a defined concept in the document, draw a simple diagram or comparison table on the blackboard.
- Always use the blackboard for any concept that has a visual form (formulas, comparisons, diagrams).

RESPONSE FORMAT: Respond as a valid JSON object with keys: speech, pdf_annotations, board_actions, and optional keys: navigate_to_page, agenda_update, student_model_delta.`.trim();
  };

  const mergeStudentModel = (
    current: ProfessorSession['studentModel'],
    delta: ProfessorResponse['student_model_delta'] | undefined,
    question: string
  ): ProfessorSession['studentModel'] => {
    return {
      understood_concepts: [
        ...new Set([...current.understood_concepts, ...(delta?.now_understood ?? [])]),
      ],
      confused_concepts: [
        ...new Set([...current.confused_concepts, ...(delta?.now_confused ?? [])]),
      ],
      questions_asked: [...current.questions_asked, question],
    };
  };

  const renderStyledText = (content: string) => {
    const lines = content.split('\n');
    return lines.map((line, lineIdx) => {
      const inlineRegex = /(\*\*[^*]+\*\*|\b[pP]age\s+\d+\b|\[\d+\])/g;
      const parts = line.split(inlineRegex);
      const renderedLine = parts.map((part, partIdx) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          const boldText = part.slice(2, -2);
          return (
            <strong key={partIdx} className="font-semibold text-on-surface">
              {boldText}
            </strong>
          );
        }

        const pageMatch = part.match(/\b[pP]age\s+(\d+)\b/i);
        if (pageMatch) {
          const pageNum = parseInt(pageMatch[1], 10);
          return (
            <button
              key={partIdx}
              onClick={() => {
                if (pageNum >= 1 && pageNum <= numPages) {
                  jumpToPage(pageNum);
                }
              }}
              className="text-primary hover:underline font-bold inline-block mx-0.5 align-baseline cursor-pointer"
            >
              {part}
            </button>
          );
        }

        const citationMatch = part.match(/^\[(\d+)\]$/);
        if (citationMatch) {
          const index = parseInt(citationMatch[1], 10);
          const source = currentSourceMapRef.current[index - 1];
          if (source) {
            return (
              <button
                key={partIdx}
                onClick={() => {
                  if (source.page >= 1 && source.page <= numPages) {
                    jumpToPage(source.page);
                  }
                }}
                className="inline-flex items-center justify-center bg-primary/20 hover:bg-primary/35 text-primary text-[9px] font-extrabold w-4.5 h-4.5 rounded-md mx-0.5 align-middle cursor-pointer transition-colors shadow-sm"
                title={`Jump to Page ${source.page} — ${source.section}`}
              >
                {index}
              </button>
            );
          }
        }

        return part;
      });

      return (
        <div key={lineIdx} className={line.trim() ? 'min-h-[1.2em]' : 'h-3'}>
          {renderedLine}
        </div>
      );
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  const handleExportReport = () => {
    if (!lastDebugInfo) return;
    const reportText = generateMarkdownReport(lastDebugInfo, pipelineSteps, material.title);
    const blob = new Blob([reportText], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `ai-pipeline-report-${material.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`relative bg-surface-container-low flex flex-col shrink-0 transition-[width,opacity] duration-300 ease-in-out ${
      isAiPaneOpen
        ? 'w-80 opacity-100 border-l border-outline-variant/10'
        : 'w-0 opacity-0 overflow-hidden border-l-0 pointer-events-none'
    }`}>
      <div className="p-3 border-b border-outline-variant/10 flex items-center justify-between shrink-0 bg-surface">
        <h4 className="text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 text-on-surface">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          AI Study Chat
          {ingestionStatus?.status === 'ready' && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block shadow-[0_0_8px_rgba(34,197,94,0.6)]"
              title="AI Document Map Active"
            />
          )}
        </h4>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowDebugDrawer(!showDebugDrawer)}
            className={`p-1 rounded cursor-pointer transition-colors ${
              showDebugDrawer
                ? 'bg-primary/20 text-primary animate-pulse'
                : 'hover:bg-surface-container-high text-outline hover:text-on-surface'
            }`}
            title="Toggle Pipeline Debugger"
          >
            <Terminal className="w-3 h-3" />
          </button>
          {chatMessages.length > 1 && (
            <button
              onClick={() => {
                if (confirm('Clear chat history?')) {
                  setChatMessages([
                    {
                      role: 'assistant',
                      content: `📚 **Chat history cleared.**\n\nActive context: **Page ${currentPage}**. Ask me any question below!`,
                      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    },
                  ]);
                }
              }}
              className="p-1 hover:bg-surface-container-high rounded text-outline hover:text-red-500 cursor-pointer"
              title="Clear chat history"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={() => setIsAiPaneOpen(false)}
            className="p-1 hover:bg-surface-container-high rounded text-outline hover:text-on-surface cursor-pointer"
            title="Close sidebar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Ingestion Status Banner */}
      {ingestionStatus && ingestionStatus.status !== 'ready' && (
        <div className="mx-3 mt-3 p-2.5 bg-surface-container rounded-xl border border-outline-variant/10 space-y-1.5 shrink-0">
          <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-wider text-outline">
            <span>AI Document Map</span>
            <span
              className={
                ingestionStatus.status === 'processing'
                  ? 'text-primary animate-pulse'
                  : ingestionStatus.status === 'failed'
                  ? 'text-red-500'
                  : 'text-outline-variant'
              }
            >
              {ingestionStatus.status}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 bg-surface-container-high rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-300"
                style={{ width: `${ingestionStatus.progress || 0}%` }}
              />
            </div>
            <span className="text-[8px] font-black text-on-surface">{ingestionStatus.progress || 0}%</span>
          </div>
          <p className="text-[8px] text-outline leading-normal">
            {ingestionStatus.status === 'processing'
              ? 'Processing text & generating ONNX vector embeddings. You can start reading/chatting now.'
              : ingestionStatus.status === 'queued'
              ? 'In queue for semantic analysis. Processing will start shortly.'
              : ingestionStatus.status === 'failed'
              ? 'Vector generation failed. Check app logs.'
              : ''}
          </p>
        </div>
      )}

      <div className="p-2.5 border-b border-outline-variant/5 space-y-1.5 shrink-0 bg-surface/50">
        <span className="text-[8px] font-black uppercase text-outline tracking-wider block ml-0.5">
          Quick Analysis Commands
        </span>
        <div className="grid grid-cols-3 gap-1">
          {[
            { label: 'Summary', prompt: 'INTENT:LOCAL Give me the 3 most important facts on this current page only, as bullet points. Cite each with [n].' },
            { label: 'Explain', prompt: 'INTENT:LOCAL Explain the core concept on this page in simple terms for a student. Ground every claim in the page text and cite with [n].' },
            { label: 'Cards', prompt: 'INTENT:LOCAL Create 3 Q&A study flashcards from this page only. Each answer must cite its source with [n].' },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => handleSendMessage(p.prompt)}
              disabled={aiLoading}
              className="py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wide cursor-pointer bg-primary/10 border border-primary/20 text-primary hover:bg-primary hover:text-on-primary transition-all disabled:opacity-40 disabled:pointer-events-none"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-surface-container-lowest scrollbar-thin select-text flex flex-col">
        {chatMessages.map((msg, i) => (
          <div
            key={i}
            className={`flex flex-col max-w-[85%] ${msg.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'}`}
          >
            <div
              className={`p-3 rounded-2xl text-xs leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary text-on-primary rounded-tr-none shadow-sm'
                  : 'bg-surface-container-high text-on-surface-variant rounded-tl-none border border-outline-variant/10 shadow-sm'
              }`}
            >
              <div className="whitespace-pre-wrap select-text break-words space-y-1">
                {renderStyledText(msg.content)}
              </div>
              {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                <div className="mt-3 pt-2 border-t border-outline-variant/10 flex flex-wrap gap-1.5 items-center">
                  <span className="text-[9px] font-black uppercase text-outline tracking-wider mr-1">Sources:</span>
                  {msg.sources.map((page) => (
                    <button
                      key={page}
                      onClick={() => {
                        if (page >= 1 && page <= numPages) {
                          jumpToPage(page);
                        }
                      }}
                      className="px-2 py-1 bg-surface-container hover:bg-primary/10 border border-outline-variant/15 text-primary rounded-lg text-[9px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                    >
                      📄 Page {page}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="text-[8px] text-outline mt-1 px-1">{msg.timestamp}</span>
          </div>
        ))}

        {aiLoading && (
          <div className="mr-auto items-start max-w-[85%] flex gap-2 p-2">
            <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Loader2 className="w-3 h-3 animate-spin text-primary" />
            </div>
            <div className="bg-surface-container-high p-3 rounded-2xl rounded-tl-none border border-outline-variant/10 text-xs text-outline animate-pulse">
              {pipelineSteps.classification.status === 'running' ||
               pipelineSteps.coverage.status === 'running' ||
               pipelineSteps.verbatimText.status === 'running'
                ? 'Reading the document...'
                : pipelineSteps.systemPrompt.status === 'running' ||
                  pipelineSteps.llmCall.status === 'running'
                ? 'Thinking...'
                : pipelineSteps.refinement.status === 'running' ||
                  pipelineSteps.dispatch.status === 'running'
                ? 'Preparing highlights...'
                : 'Tutor is thinking...'}
            </div>
          </div>
        )}

        {aiError && (
          <div className="p-2.5 bg-red-500/5 border border-red-500/10 rounded-xl space-y-1 text-red-500 text-[10px]">
            <div className="flex items-center gap-1 font-black uppercase">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Error</span>
            </div>
            <p>{aiError}</p>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="p-3 bg-surface border-t border-outline-variant/10 shrink-0">
        <div className="flex gap-1.5 items-center relative">
          <input
            type="text"
            placeholder={`Ask about Page ${currentPage}...`}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !aiLoading) {
                handleSendMessage();
              }
            }}
            disabled={aiLoading}
            className="flex-1 text-xs p-2.5 pr-9 border border-outline-variant/20 rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-surface-container-low text-on-surface placeholder:text-outline disabled:opacity-50"
          />
          <button
            onClick={() => handleSendMessage()}
            disabled={aiLoading || !chatInput.trim()}
            className="absolute right-1.5 p-1.5 bg-primary text-on-primary rounded-lg hover:opacity-90 transition-opacity disabled:opacity-30 disabled:pointer-events-none cursor-pointer flex items-center justify-center"
            title="Send message"
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Slide-out Pipeline Debugger Drawer */}
      {showDebugDrawer && (
        <div className="absolute right-[320px] top-0 bottom-0 w-[550px] bg-surface-container-low border-r border-outline-variant/10 shadow-2xl z-[100] flex flex-col animate-in slide-in-from-right duration-200">
          {/* Debug Drawer Header */}
          <div className="p-3 border-b border-outline-variant/10 bg-surface flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5">
              <Terminal className="w-4 h-4 text-primary" />
              <div>
                <h3 className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  AI Pipeline Inspector
                  <span className="px-1.5 py-0.5 rounded-full text-[8px] font-bold bg-green-500/10 text-green-500 uppercase tracking-wide">
                    Dev Mode
                  </span>
                </h3>
                <p className="text-[9px] text-outline">Inspect retrieval context, prompts, & outputs</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {lastDebugInfo && (
                <button
                  onClick={handleExportReport}
                  className="flex items-center gap-1.5 py-1.5 px-3 rounded-xl text-[9px] font-black uppercase tracking-wide cursor-pointer bg-primary/10 border border-primary/20 text-primary hover:bg-primary hover:text-on-primary transition-all duration-200 shadow-sm"
                  title="Export Analysis Report (.md)"
                >
                  <Download className="w-3 h-3" />
                  Export Report
                </button>
              )}
              <button
                onClick={() => setShowDebugDrawer(false)}
                className="p-1 hover:bg-surface-container-high rounded text-outline hover:text-on-surface cursor-pointer"
                title="Close debugger"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Debug Tabs */}
          <div className="flex border-b border-outline-variant/5 bg-surface/50 text-[9px] font-black uppercase tracking-wider shrink-0">
            {[
              { id: 'flow', label: 'Pipeline Flow' },
              { id: 'rag', label: 'RAG & Context' },
              { id: 'prompt', label: 'System Instruction' },
              { id: 'payload', label: 'LLM Payload' },
              { id: 'response', label: 'JSON Response' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveDebugTab(tab.id as any)}
                className={`flex-1 py-2 text-center border-b-2 cursor-pointer transition-colors ${
                  activeDebugTab === tab.id
                    ? 'border-primary text-primary bg-primary/5'
                    : 'border-transparent text-outline hover:text-on-surface hover:bg-surface-container-high/50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Debug Content Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-surface-container-lowest text-xs leading-relaxed select-text scrollbar-thin">
            {!lastDebugInfo && !aiLoading ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-2 text-outline">
                <Terminal className="w-8 h-8 opacity-20" />
                <p className="font-bold text-on-surface/80">No Pipeline Executions Logged Yet</p>
                <p className="text-[10px] max-w-[240px]">Send a message to the AI study assistant to capture and inspect the debug trace.</p>
              </div>
            ) : (
              <>
                {/* Meta details bar */}
                {lastDebugInfo ? (
                  <div className="p-2.5 rounded-xl bg-surface border border-outline-variant/10 grid grid-cols-3 gap-3 text-[10px] shrink-0 font-medium">
                    <div>
                      <span className="text-outline block text-[8px] uppercase tracking-wide">RAG Mode</span>
                      <span className="text-primary font-bold uppercase tracking-wider">{lastDebugInfo.intent}</span>
                    </div>
                    <div>
                      <span className="text-outline block text-[8px] uppercase tracking-wide">RAG Latency</span>
                      <span className="text-on-surface font-semibold">{lastDebugInfo.metrics?.latencyMs ?? 'N/A'}ms</span>
                    </div>
                    <div>
                      <span className="text-outline block text-[8px] uppercase tracking-wide">Total Time</span>
                      <span className="text-on-surface font-semibold">{lastDebugInfo.durationMs}ms</span>
                    </div>
                    <div>
                      <span className="text-outline block text-[8px] uppercase tracking-wide">Coverage</span>
                      <span className="text-green-500 font-bold">{Math.round((lastDebugInfo.coverage || 0) * 100)}%</span>
                    </div>
                    <div>
                      <span className="text-outline block text-[8px] uppercase tracking-wide">Citation Rate</span>
                      <span className="text-on-surface font-semibold">
                        {(() => {
                          const speech = lastDebugInfo.responseRaw?.speech || '';
                          const citations = speech.match(/\[\d+\]/g) || [];
                          const paragraphs = speech.split(/\n+/).filter((p: string) => p.trim().length > 10).length || 1;
                          return `${Math.round((citations.length / paragraphs) * 100)}%`;
                        })()}
                      </span>
                    </div>
                    <div>
                      <span className="text-outline block text-[8px] uppercase tracking-wide">Scored Chunks</span>
                      <span className="text-on-surface font-semibold">{lastDebugInfo.metrics?.chunksScored ?? 0}</span>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-primary/5 border border-primary/10 rounded-xl text-primary flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
                    <span className="text-[10px] font-bold uppercase tracking-wide">Active Pipeline Running...</span>
                  </div>
                )}

                {lastDebugInfo?.error && (
                  <div className="p-3 bg-red-500/5 border border-red-500/10 rounded-xl text-red-500 space-y-1">
                    <p className="font-bold uppercase text-[9px]">Pipeline Error</p>
                    <p className="text-[11px] font-mono">{lastDebugInfo.error}</p>
                  </div>
                )}

                {activeDebugTab === 'flow' && (
                  <div className="space-y-4">
                    <div className="space-y-3">
                      <h4 className="font-bold text-on-surface uppercase text-[9px] tracking-wider flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-primary" />
                        Execution Trace {aiLoading && <span className="text-[8px] font-bold text-primary animate-pulse lowercase">(running...)</span>}
                      </h4>
                      <div className="relative border-l border-outline-variant/20 ml-2.5 pl-5 space-y-4">
                        {(() => {
                          const stepsToRender = aiLoading ? pipelineSteps : (lastDebugInfo?.pipelineSteps || pipelineSteps);
                          
                          const stepsList = [
                            { key: 'classification', name: 'Query Classification & RAG Retrieval', icon: Database },
                            { key: 'coverage', name: 'Semantic Coverage & Expansion Check', icon: RefreshCw },
                            { key: 'verbatimText', name: 'Verbatim Document Scraper', icon: FileText },
                            { key: 'systemPrompt', name: 'System Prompt Synthesis', icon: Cpu },
                            { key: 'llmCall', name: 'LLM Response Generation', icon: Sparkles },
                            { key: 'refinement', name: 'Blind Highlight Refinement Check', icon: ChevronRight },
                            { key: 'dispatch', name: 'Action Dispatcher & Canvas Sync', icon: CheckCircle2 }
                          ];

                          return stepsList.map((step) => {
                            const info = stepsToRender[step.key] || { status: 'idle' };
                            const StepIcon = step.icon;

                            let statusColor = 'text-outline border-outline-variant/30 bg-surface-container';
                            let iconColor = 'text-outline';
                            let statusText = 'Pending';
                            let cardStyle = 'opacity-55';
                            let badgeStyle = 'bg-outline-variant/10 text-outline';

                            if (info.status === 'running') {
                              statusColor = 'border-primary bg-primary/10 text-primary shadow-[0_0_8px_rgba(var(--primary-rgb),0.2)]';
                              iconColor = 'text-primary';
                              statusText = 'Running';
                              cardStyle = 'border-primary/20 opacity-100 ring-1 ring-primary/10 scale-[1.01] transition-all duration-300';
                              badgeStyle = 'bg-primary/10 text-primary';
                            } else if (info.status === 'completed') {
                              statusColor = 'border-green-500/30 bg-green-500/10 text-green-500';
                              iconColor = 'text-green-500';
                              statusText = 'Completed';
                              cardStyle = 'border-green-500/10 opacity-100';
                              badgeStyle = 'bg-green-500/10 text-green-500';
                            } else if (info.status === 'error') {
                              statusColor = 'border-red-500/30 bg-red-500/10 text-red-500';
                              iconColor = 'text-red-500';
                              statusText = 'Failed';
                              cardStyle = 'border-red-500/20 opacity-100 bg-red-500/5';
                              badgeStyle = 'bg-red-500/10 text-red-500';
                            }

                            return (
                              <div key={step.key} className={`relative flex gap-3 p-3 rounded-xl border border-outline-variant/10 bg-surface/50 shadow-sm hover:shadow-md hover:bg-surface/80 transition-all group ${cardStyle}`}>
                                <div className={`absolute -left-[27px] top-[14px] w-3 h-3 rounded-full border-2 flex items-center justify-center z-10 transition-colors duration-300 ${statusColor}`}>
                                  {info.status === 'running' && (
                                    <span className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />
                                  )}
                                </div>
                                
                                <div className={`p-2 rounded-lg bg-surface-container-high shrink-0 flex items-center justify-center w-8 h-8 ${iconColor}`}>
                                  {info.status === 'running' ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <StepIcon className="w-4 h-4" />
                                  )}
                                </div>

                                <div className="flex-1 min-w-0 space-y-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <h5 className="font-semibold text-[10.5px] text-on-surface leading-tight truncate">
                                      {step.name}
                                    </h5>
                                    {info.durationMs !== undefined && (
                                      <span className="text-[9px] font-bold text-outline shrink-0 flex items-center gap-0.5">
                                        <Clock className="w-2.5 h-2.5" />
                                        {info.durationMs}ms
                                      </span>
                                    )}
                                  </div>
                                  
                                  {info.details && (
                                    <p className="text-[9.5px] font-mono text-on-surface-variant leading-relaxed select-text truncate-multiline break-words">
                                      {info.details}
                                    </p>
                                  )}

                                  <div className="flex items-center gap-1.5 pt-0.5">
                                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${badgeStyle}`}>
                                      {statusText}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  </div>
                )}

                {activeDebugTab === 'rag' && (
                  lastDebugInfo ? (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <h4 className="font-bold text-on-surface uppercase text-[9px] tracking-wider">Retrieved Context Chunks ({lastDebugInfo.relevantChunks?.length || 0})</h4>
                        <span className="text-[9px] font-bold text-outline">
                          Context Coverage: {Math.round((lastDebugInfo.coverage || 0) * 100)}%
                        </span>
                      </div>

                      {lastDebugInfo.missingWords?.length > 0 && (
                        <div className="p-2 bg-yellow-500/5 border border-yellow-500/10 rounded-lg text-[10px]">
                          <span className="font-bold text-yellow-600 dark:text-yellow-400">Missing query words:</span>{' '}
                          <span className="font-mono text-outline">{lastDebugInfo.missingWords.join(', ')}</span>
                        </div>
                      )}

                      <div className="space-y-2.5">
                        {lastDebugInfo.relevantChunks?.map((chunk: any, i: number) => {
                          const chunkScores = lastDebugInfo.metrics?.scores?.find((s: any) => s.chunkId === chunk.chunk_id);
                          return (
                            <div key={i} className="p-3 bg-surface rounded-xl border border-outline-variant/5 space-y-1.5 shadow-sm">
                              <div className="flex items-center justify-between text-[9px] font-bold text-outline uppercase">
                                <span>Chunk {i + 1} — Page {chunk.page}</span>
                                <span className="text-primary">{chunk.section || 'General'}</span>
                              </div>
                              {chunkScores && (
                                <div className="text-[9px] bg-surface-container-high/40 p-1.5 rounded border border-outline-variant/5 font-sans leading-none flex items-center justify-between gap-1 text-outline">
                                  <span>BM25: <strong className="text-on-surface font-semibold">{Math.round(chunkScores.bm25Score * 100)}%</strong></span>
                                  <span>Vector: <strong className="text-on-surface font-semibold">{Math.round(chunkScores.vectorScore * 100)}%</strong></span>
                                  <span>Metadata: <strong className="text-on-surface font-semibold">{Math.round(chunkScores.metadataScore * 100)}%</strong></span>
                                  <span className="border-l border-outline-variant/10 pl-2">Combined: <strong className="text-primary font-black">{Math.round(chunkScores.finalScore * 100)}%</strong></span>
                                </div>
                              )}
                              <div className="text-[11px] text-on-surface-variant font-mono bg-surface-container-low p-2 rounded-lg border border-outline-variant/5 leading-normal space-y-2">
                                {chunk.expandedText && chunk.expandedText !== chunk.text ? (
                                  <>
                                    <div className="text-[9px] text-primary/75 font-semibold uppercase tracking-wider border-b border-outline-variant/5 pb-0.5">Target Match</div>
                                    <p className="bg-primary/5 dark:bg-primary/10 border-l-2 border-primary pl-2 italic py-0.5 select-text">{chunk.text}</p>
                                    <div className="text-[9px] text-outline font-semibold uppercase tracking-wider border-b border-outline-variant/5 pb-0.5">Expanded Context</div>
                                    <p className="opacity-90 select-text leading-relaxed whitespace-pre-wrap">{chunk.expandedText}</p>
                                  </>
                                ) : (
                                  <p className="select-text whitespace-pre-wrap">{chunk.text}</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {(!lastDebugInfo.relevantChunks || lastDebugInfo.relevantChunks.length === 0) && (
                          <p className="text-outline text-center py-4 italic">No context chunks retrieved.</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-2 text-outline">
                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      <p className="text-[10px]">Retrieval context will load once context retrieval completes.</p>
                    </div>
                  )
                )}

                {activeDebugTab === 'prompt' && (
                  lastDebugInfo ? (
                    <div className="space-y-2 flex flex-col h-full">
                      <div className="flex justify-between items-center shrink-0">
                        <h4 className="font-bold text-on-surface uppercase text-[9px] tracking-wider">System Instruction</h4>
                        <button
                          onClick={() => copyToClipboard(lastDebugInfo.systemPrompt)}
                          className="flex items-center gap-1 py-1 px-2 rounded-lg text-[9px] font-black uppercase tracking-wide cursor-pointer bg-primary/10 border border-primary/20 text-primary hover:bg-primary hover:text-on-primary transition-all"
                        >
                          {copiedText ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                          {copiedText ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <pre className="flex-1 p-3 bg-surface text-on-surface-variant font-mono text-[10.5px] rounded-xl border border-outline-variant/10 whitespace-pre-wrap select-text leading-relaxed shadow-sm overflow-auto">
                        {lastDebugInfo.systemPrompt}
                      </pre>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-2 text-outline">
                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      <p className="text-[10px]">System instructions will load once prompt synthesis completes.</p>
                    </div>
                  )
                )}

                {activeDebugTab === 'payload' && (
                  lastDebugInfo ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <div className="flex justify-between items-center shrink-0">
                          <h4 className="font-bold text-on-surface uppercase text-[9px] tracking-wider">Verbatim Page Context</h4>
                          <button
                            onClick={() => copyToClipboard(lastDebugInfo.pageTextsVerbatim)}
                            className="flex items-center gap-1 py-1 px-2 rounded-lg text-[9px] font-black uppercase tracking-wide cursor-pointer bg-primary/10 border border-primary/20 text-primary hover:bg-primary hover:text-on-primary transition-all"
                          >
                            {copiedText ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                            {copiedText ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        <pre className="p-3 bg-surface text-on-surface-variant font-mono text-[10.5px] rounded-xl border border-outline-variant/10 whitespace-pre-wrap select-text leading-relaxed shadow-sm max-h-60 overflow-y-auto">
                          {lastDebugInfo.pageTextsVerbatim || 'No verbatim text extracted.'}
                        </pre>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between items-center shrink-0">
                          <h4 className="font-bold text-on-surface uppercase text-[9px] tracking-wider">Full Message payload (JSON)</h4>
                          <button
                            onClick={() => copyToClipboard(JSON.stringify(lastDebugInfo.messagesSent, null, 2))}
                            className="flex items-center gap-1 py-1 px-2 rounded-lg text-[9px] font-black uppercase tracking-wide cursor-pointer bg-primary/10 border border-primary/20 text-primary hover:bg-primary hover:text-on-primary transition-all"
                          >
                            {copiedText ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                            {copiedText ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        <pre className="p-3 bg-surface text-on-surface-variant font-mono text-[10.5px] rounded-xl border border-outline-variant/10 whitespace-pre-wrap select-text leading-relaxed shadow-sm max-h-80 overflow-y-auto">
                          {JSON.stringify(lastDebugInfo.messagesSent, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-2 text-outline">
                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      <p className="text-[10px]">LLM request payload will load once context retrieval completes.</p>
                    </div>
                  )
                )}

                {activeDebugTab === 'response' && (
                  lastDebugInfo ? (
                    <div className="space-y-3 flex flex-col h-full">
                      <div className="flex justify-between items-center shrink-0">
                        <h4 className="font-bold text-on-surface uppercase text-[9px] tracking-wider">LLM Response JSON</h4>
                        <button
                          onClick={() => copyToClipboard(JSON.stringify(lastDebugInfo.responseRaw, null, 2))}
                          className="flex items-center gap-1 py-1 px-2 rounded-lg text-[9px] font-black uppercase tracking-wide cursor-pointer bg-primary/10 border border-primary/20 text-primary hover:bg-primary hover:text-on-primary transition-all"
                        >
                          {copiedText ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                          {copiedText ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <pre className="flex-1 p-3 bg-surface text-on-surface-variant font-mono text-[10.5px] rounded-xl border border-outline-variant/10 whitespace-pre-wrap select-text leading-relaxed shadow-sm overflow-auto">
                        {JSON.stringify(lastDebugInfo.responseRaw, null, 2)}
                      </pre>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-2 text-outline">
                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      <p className="text-[10px]">LLM response will load once response generation completes.</p>
                    </div>
                  )
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
