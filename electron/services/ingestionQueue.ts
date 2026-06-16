import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { EmbeddingService } from './embeddingService';
import { ProfessorService, IngestChunk } from './professorService';
import { BrowserWindow } from 'electron';
import { isTOCPage } from './tocDetector';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

// ─── CHUNKER CONSTANTS ─────────────────────────────────────────────────────
// all-MiniLM-L6-v2 has a 256-token limit ≈ 800 chars.
// We cap at 750 to stay safely inside that window.
const CHUNK_MAX_CHARS = 750;
const CHUNK_MIN_CHARS = 15;
const CHUNK_FLUSH_CHARS = 500; // soft flush threshold for paragraph grouping
const COLUMN_GAP_THRESHOLD = 0.05; // 5% of page width = column boundary

// ─── TYPES ─────────────────────────────────────────────────────────────────
interface NormalizedTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  normX: number;
  normY: number;
  normW: number;
  normH: number;
}

interface ExtractedPage {
  pageNum: number;
  items: NormalizedTextItem[];
}

export class IngestionQueue {
  private isProcessing = false;
  private embeddingService: EmbeddingService;
  private professorService: ProfessorService;
  private mainWindow: (() => BrowserWindow | null);

  constructor(
    private db: Database.Database,
    professorService: ProfessorService,
    getMainWindow: () => BrowserWindow | null
  ) {
    this.embeddingService = new EmbeddingService();
    this.professorService = professorService;
    this.mainWindow = getMainWindow;
  }

  // Add a PDF to the ingestion queue (called after vault:capture for PDF files)
  enqueue(materialId: string, localPath: string, priority: number = 0): void {
    // Idempotent: skip if already queued or done
    const existing = this.db.prepare(
      `SELECT status FROM ingestion_queue WHERE material_id = ?`
    ).get(materialId) as { status: string } | undefined;

    if (existing && ['waiting', 'processing', 'done'].includes(existing.status)) {
      console.log(`[IngestionQueue] Already queued/done for ${materialId}, skipping`);
      return;
    }

    this.db.prepare(`
      INSERT OR REPLACE INTO ingestion_queue
        (queue_id, material_id, local_path, status, priority, attempts, queued_at)
      VALUES (?, ?, ?, 'waiting', ?, 0, ?)
    `).run(crypto.randomUUID(), materialId, localPath, priority, Date.now());

    // Also initialize concept_index row to 'queued' so the viewer can show status
    this.professorService.markIngestionStatus(materialId, 'queued');

    // Start processing if not already running
    if (!this.isProcessing) {
      setImmediate(() => this.processNext());
    }
  }

  // Called on app startup: resume any unfinished jobs from before
  resumeOnStartup(): void {
    // Reset any stuck 'processing' jobs back to 'waiting' (app crash recovery)
    this.db.prepare(
      `UPDATE ingestion_queue SET status = 'waiting' WHERE status = 'processing'`
    ).run();

    const pending = this.db.prepare(
      `SELECT COUNT(*) as count FROM ingestion_queue WHERE status = 'waiting'`
    ).get() as { count: number };

    if (pending.count > 0) {
      console.log(`[IngestionQueue] Resuming ${pending.count} pending ingestion(s)`);
      setImmediate(() => this.processNext());
    }
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing) return;

    // Pick the highest-priority waiting job
    const job = this.db.prepare(`
      SELECT queue_id, material_id, local_path, attempts
      FROM ingestion_queue
      WHERE status = 'waiting' AND attempts < 3
      ORDER BY priority DESC, queued_at ASC
      LIMIT 1
    `).get() as { queue_id: string; material_id: string; local_path: string; attempts: number } | undefined;

    if (!job) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;

    // Mark as processing
    this.db.prepare(
      `UPDATE ingestion_queue SET status = 'processing', attempts = attempts + 1 WHERE queue_id = ?`
    ).run(job.queue_id);

    this.professorService.markIngestionStatus(job.material_id, 'processing');
    this.pushStatusToRenderer(job.material_id, 'processing', 0);

    try {
      await this.runIngestion(job.material_id, job.local_path);

      this.db.prepare(
        `UPDATE ingestion_queue SET status = 'done' WHERE queue_id = ?`
      ).run(job.queue_id);

      this.pushStatusToRenderer(job.material_id, 'ready', 100);
      console.log(`[IngestionQueue] Completed ingestion for ${job.material_id}`);
    } catch (err: any) {
      console.error(`[IngestionQueue] Ingestion failed for ${job.material_id}:`, err);

      const newStatus = job.attempts >= 2 ? 'failed' : 'waiting';
      this.db.prepare(
        `UPDATE ingestion_queue SET status = ?, error_message = ? WHERE queue_id = ?`
      ).run(newStatus, err.message, job.queue_id);

      this.professorService.markIngestionStatus(job.material_id, 'failed');
      this.pushStatusToRenderer(job.material_id, 'failed', 0);
    }

    this.isProcessing = false;

    // Process next item in queue (if any)
    setImmediate(() => this.processNext());
  }

  // ─── PDF EXTRACTION (pdfjs-dist) ──────────────────────────────────────────

  private async extractPagesWithBBoxes(filePath: string): Promise<ExtractedPage[]> {
    // Dynamic import to support ES Modules in CommonJS context
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

    const data = new Uint8Array(fs.readFileSync(filePath));
    const doc = await pdfjsLib.getDocument({ data }).promise;
    const pages: ExtractedPage[] = [];

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent({ includeMarkedContent: false });
      const vp = page.getViewport({ scale: 1.0 });

      const items: NormalizedTextItem[] = (content.items as any[])
        .filter((item: any) => item.str && item.str.trim().length > 0)
        .map((item: any) => ({
          str: item.str,
          transform: item.transform,
          width: item.width,
          height: item.height,
          // Normalize coordinates to [0.0 – 1.0] relative to page size
          normX: item.transform[4] / vp.width,
          normY: item.transform[5] / vp.height,
          normW: (item.width || 0) / vp.width,
          normH: (item.height || 0) / vp.height,
        }));

      pages.push({ pageNum: p, items });
    }

    return pages;
  }

  // ─── COLUMN DETECTION ─────────────────────────────────────────────────────

  private detectColumns(items: NormalizedTextItem[]): NormalizedTextItem[][] {
    if (items.length === 0) return [];

    // Sort items by X coordinate (left edge)
    const sorted = [...items].sort((a, b) => a.normX - b.normX);

    // Find X-axis gaps larger than threshold → column boundaries
    const boundaries: number[] = [0];
    for (let i = 1; i < sorted.length; i++) {
      const prevRight = sorted[i - 1].normX + sorted[i - 1].normW;
      const currLeft = sorted[i].normX;
      if (currLeft - prevRight > COLUMN_GAP_THRESHOLD) {
        boundaries.push(i);
      }
    }
    boundaries.push(sorted.length);

    // Slice into column groups, then sort each column top-to-bottom
    const columns: NormalizedTextItem[][] = [];
    for (let c = 0; c < boundaries.length - 1; c++) {
      const col = sorted
        .slice(boundaries[c], boundaries[c + 1])
        .sort((a, b) => b.normY - a.normY); // PDF Y is bottom-up
      columns.push(col);
    }
    return columns;
  }

  // ─── HEADING DETECTION (improved, fixes B-06) ─────────────────────────────

  private isHeadingLine(line: string): boolean {
    const trimmed = line.trim();
    if (trimmed.length < 3) return false;
    if (trimmed.length > 200) return false; // was 80 in V2 — too restrictive

    // Chapter patterns (case-insensitive)
    if (/^Chapter\s+\d+/i.test(trimmed)) return true;
    if (/^CHAPTER\s+\d+/i.test(trimmed)) return true;
    if (/^Part\s+\w+/i.test(trimmed)) return true;

    // Numbered sections: "1. Introduction", "2.3 Methods", "A.1 Appendix"
    if (/^\d+(?:\.\d+)*[\.\s]/.test(trimmed)) return true;
    if (/^[A-Z]\.\d+[\.\s]/.test(trimmed)) return true;

    // Known academic headings (at line start)
    if (/^(Abstract|Introduction|Conclusion|Summary|References|Bibliography|Appendix|Acknowledgements?|Methods?|Results?|Discussion|Background|Overview)\b/i.test(trimmed)) return true;

    // ALL CAPS lines (but not short ones that could be acronyms)
    if (trimmed.length >= 5 && /^[A-Z0-9\s\-–:,]+$/.test(trimmed)) return true;

    return false;
  }

  // ─── TOC LINE DETECTION ─────────────────────────────────────────────────────
  // Detects lines that came from the Table of Contents, not actual chapter body.
  // A TOC line's job is to list sections + page numbers — not to hold content.
  // Including them in retrieval is a false positive: BM25 loves them because
  // they contain every chapter number and keyword with zero actual explanation.
  private isTocLine(line: string, pageNum?: number): boolean {
    const trimmed = line.trim();

    // Pattern 1: Numbered section ending in a page number (classic TOC row)
    // e.g. "7.1 Introduction ........................ 5" or "7.1 Introduction 5"
    // Require: starts with a section number, has >3 chars of content, ends with 1-4 digit page number
    if (/^\d+(?:\.\d+)*\s+.{3,}\s+\d{1,4}$/.test(trimmed)) return true;

    // Pattern 2: Chapter line ending in a page number
    // e.g. "Chapter 7 Decorators 142"
    if (/^(chapter|ch\.?)\s+\d+\s+.{0,60}\s+\d{1,4}$/i.test(trimmed)) return true;

    // Pattern 3: Line is almost entirely dots or dashes (filler row)
    // e.g. ".........." or "----------"
    if (/^[.\-\s]{6,}$/.test(trimmed)) return true;

    // Pattern 4 (REMOVED - was too aggressive): Never blanket-flag all early-page
    // heading-like lines. A line like "1.1 Introduction" on page 5 is real content.
    // Only flag it if it ALSO ends with a page number (already caught by Pattern 1).

    return false;
  }

  // ─── CHAPTER ID SLUGIFIER ─────────────────────────────────────────────────

  private slugify(heading: string): string {
    return heading
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 60);
  }

  // ─── HEADER / FOOTER DETECTION ────────────────────────────────────────────

  private detectHeadersFooters(pages: ExtractedPage[]): Set<string> {
    const ignoredText = new Set<string>();
    if (pages.length <= 2) return ignoredText;

    const occurrences = new Map<string, number>();

    for (const page of pages) {
      const pageHeaders: string[] = [];
      const pageFooters: string[] = [];

      for (const item of page.items) {
        const text = (item.str || '').trim();
        if (text.length < 3) continue;
        if (/^\d+$/.test(text)) continue;

        if (item.normY > 0.94) {
          pageHeaders.push(text);
        } else if (item.normY < 0.06) {
          pageFooters.push(text);
        }
      }

      const headerStr = pageHeaders.join(' ').toLowerCase().trim();
      const footerStr = pageFooters.join(' ').toLowerCase().trim();

      if (headerStr && !/^\d+$/.test(headerStr) && headerStr.length > 3) {
        occurrences.set(headerStr, (occurrences.get(headerStr) || 0) + 1);
      }
      if (footerStr && !/^\d+$/.test(footerStr) && footerStr.length > 3) {
        occurrences.set(footerStr, (occurrences.get(footerStr) || 0) + 1);
      }

      for (const h of pageHeaders) {
        const hNorm = h.toLowerCase().trim();
        if (hNorm.length > 3) {
          occurrences.set(hNorm, (occurrences.get(hNorm) || 0) + 1);
        }
      }
      for (const f of pageFooters) {
        const fNorm = f.toLowerCase().trim();
        if (fNorm.length > 3) {
          occurrences.set(fNorm, (occurrences.get(fNorm) || 0) + 1);
        }
      }
    }

    for (const [text, count] of occurrences.entries()) {
      if (count >= 3) {
        ignoredText.add(text);
      }
    }

    return ignoredText;
  }

  // ─── CORE INGESTION ───────────────────────────────────────────────────────

  private async runIngestion(materialId: string, localPath: string): Promise<void> {
    // Phase 1: Extract pages with bounding boxes using pdfjs-dist
    const extractedPages = await this.extractPagesWithBBoxes(localPath);

    // Pre-detect repeating headers and footers
    const ignoredMargins = this.detectHeadersFooters(extractedPages);

    // LangChain splitter — replaces the custom paragraph flush loop.
    // chunkSize=512 chars (~400 words) fits comfortably within all-MiniLM-L6-v2's
    // 256-token limit. chunkOverlap=64 chars preserves sentence context at boundaries.
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 512,
      chunkOverlap: 64,
      separators: ['\n\n', '\n', '. ', ' '],
    });

    // Phase 2: Chunk with column detection + structural metadata
    const chunks: IngestChunk[] = [];
    let chunkOrder = 0;
    let currentChapterId: string | null = null;
    let currentSection = '';
    let inIndex = false;

    for (let pageIdx = 0; pageIdx < extractedPages.length; pageIdx++) {
      const { pageNum, items } = extractedPages[pageIdx];

      // ── TOC / front-matter guard (Problem 1 fix) ─────────────────────────
      // Reconstruct text lines for the whole page to support line-based TOC detection
      const pageLineGroups = new Map<number, NormalizedTextItem[]>();
      const pageLineHeight = items.length > 0
        ? Math.max(0.01, items.reduce((sum, it) => sum + it.normH, 0) / items.length)
        : 0.02;

      for (const item of items) {
        const lineKey = Math.round(item.normY / (pageLineHeight * 0.8));
        if (!pageLineGroups.has(lineKey)) pageLineGroups.set(lineKey, []);
        pageLineGroups.get(lineKey)!.push(item);
      }

      const pageSortedLines = Array.from(pageLineGroups.entries())
        .sort((a, b) => b[0] - a[0]) // sort top-to-bottom (normY descending)
        .map(([_, lineItems]) => lineItems.sort((a, b) => a.normX - b.normX));

      const rawPageText = pageSortedLines
        .map(lineItems => lineItems.map(it => it.str).join(' '))
        .join('\n');

      if (isTOCPage(rawPageText)) {
        console.log(`[RAG Indexer] Skipping page ${pageNum} — detected as TOC/front-matter`);
        continue;
      }
      // ─────────────────────────────────────────────────────────────────────

      // Detect and separate columns
      const columns = this.detectColumns(items);

      // Process each column independently (left-to-right, top-to-bottom)
      for (const columnItems of columns) {
        // Filter out repeating headers, footers, and page numbers
        const filteredItems = columnItems.filter(item => {
          if (item.normY > 0.94 || item.normY < 0.06) {
            const normalizedText = (item.str || '').toLowerCase().trim();
            if (/^\d+$/.test(normalizedText) || /^(page|pg\.?)\s*\d+$/i.test(normalizedText)) {
              return false;
            }
            if (ignoredMargins.has(normalizedText)) {
              return false;
            }
            for (const ignored of ignoredMargins) {
              if (ignored.includes(normalizedText) || normalizedText.includes(ignored)) {
                return false;
              }
            }
          }
          return true;
        });

        // Build raw text for this column (verbatim, for raw_text column)
        const rawText = filteredItems.map(item => item.str).join(' ');

        // Use first filtered item for bbox (all LangChain chunks in this column share it)
        const bboxItem = filteredItems[0] as NormalizedTextItem | undefined;

        // Reconstruct text lines from column items
        const lineGroups = new Map<number, NormalizedTextItem[]>();
        const lineHeight = filteredItems.length > 0
          ? Math.max(0.01, filteredItems.reduce((sum, it) => sum + it.normH, 0) / filteredItems.length)
          : 0.02;

        for (const item of filteredItems) {
          const lineKey = Math.round(item.normY / (lineHeight * 0.8));
          if (!lineGroups.has(lineKey)) lineGroups.set(lineKey, []);
          lineGroups.get(lineKey)!.push(item);
        }

        const sortedLines = Array.from(lineGroups.entries())
          .sort((a, b) => b[0] - a[0])
          .map(([_, lineItems]) => lineItems.sort((a, b) => a.normX - b.normX));

        // Accumulate non-heading text for LangChain splitting.
        // Headings are still emitted as individual heading chunks to preserve
        // section/chapter metadata, then the accumulated prose between headings
        // is split by LangChain.
        const pendingProseLines: string[] = [];

        const flushProseWithSplitter = async () => {
          if (pendingProseLines.length === 0) return;
          const fullText = pendingProseLines.join('\n').trim();
          pendingProseLines.length = 0;
          if (fullText.length < CHUNK_MIN_CHARS) return;

          const docs = await splitter.createDocuments([fullText]);
          for (const doc of docs) {
            const text = doc.pageContent.trim();
            if (text.length < CHUNK_MIN_CHARS) continue;
            chunks.push({
              chunkId: crypto.randomUUID(),
              page: pageNum,
              section: currentSection || 'Introduction',
              chunkType: 'paragraph',
              text: text.slice(0, CHUNK_MAX_CHARS),
              chunkOrder: chunkOrder++,
              bbox: bboxItem ? {
                x: bboxItem.normX,
                y: bboxItem.normY,
                w: bboxItem.normW,
                h: bboxItem.normH,
              } : undefined,
              chapterId: currentChapterId,
              rawText: rawText,
              isToc: inIndex || this.isTocLine(text, pageNum),
            } as any);
          }
        };

        for (const lineItems of sortedLines) {
          const lineText = lineItems.map(it => it.str).join(' ').trim();
          if (!lineText) continue;

          // Index detection
          const lowerText = lineText.toLowerCase().trim();
          if (
            lowerText === 'index' ||
            lowerText === 'subject index' ||
            lowerText === 'author index' ||
            lowerText.startsWith('index note:') ||
            lowerText.includes('index note: ')
          ) {
            inIndex = true;
          }

          // Heading detection — flush accumulated prose first, then emit heading chunk
          if (!inIndex && this.isHeadingLine(lineText)) {
            await flushProseWithSplitter();
            currentSection = lineText;
            currentChapterId = this.slugify(lineText);

            chunks.push({
              chunkId: crypto.randomUUID(),
              page: pageNum,
              section: currentSection,
              chunkType: 'heading',
              text: lineText.slice(0, CHUNK_MAX_CHARS),
              chunkOrder: chunkOrder++,
              chapterId: currentChapterId,
              rawText: lineText,
              isToc: inIndex || this.isTocLine(lineText, pageNum),
            } as any);
            continue;
          }

          // Equations and captions: flush prose first, then emit as their own chunk
          const isEquation = /[∫∑∏∂∆∇±≤≥≠∞=]/.test(lineText) || /^\s*\([0-9]+\)/.test(lineText);
          const isCaption = /^(Figure|Fig\.|Table|Equation|Eq\.|Theorem|Lemma|Proof)/i.test(lineText);
          if (isEquation || isCaption) {
            await flushProseWithSplitter();
            const type: IngestChunk['chunkType'] = isEquation ? 'equation' : 'caption';
            chunks.push({
              chunkId: crypto.randomUUID(),
              page: pageNum,
              section: currentSection || 'Introduction',
              chunkType: type,
              text: lineText.slice(0, CHUNK_MAX_CHARS),
              chunkOrder: chunkOrder++,
              bbox: bboxItem ? {
                x: bboxItem.normX,
                y: bboxItem.normY,
                w: bboxItem.normW,
                h: bboxItem.normH,
              } : undefined,
              chapterId: currentChapterId,
              rawText: lineText,
              isToc: false,
            } as any);
            continue;
          }

          // Regular prose line — accumulate for LangChain
          if (!inIndex) {
            pendingProseLines.push(lineText);
          }
        }

        // Flush any remaining prose at end of column
        await flushProseWithSplitter();
      }

      // Report progress every 10 pages
      if (pageIdx % 10 === 0) {
        const pct = Math.round((pageIdx / extractedPages.length) * 60);
        this.pushStatusToRenderer(materialId, 'processing', pct);
        await new Promise<void>(resolve => setImmediate(resolve));
      }
    }

    // Phase 3: Generate embeddings
    this.pushStatusToRenderer(materialId, 'processing', 60);
    const chunkTexts = chunks.map(c => c.text);
    const embeddings = await this.embeddingService.embedBatch(chunkTexts);

    // Phase 4: Store chunks + embeddings to SQLite
    this.pushStatusToRenderer(materialId, 'processing', 90);
    this.professorService.storeChunksWithEmbeddings(materialId, chunks, embeddings);

    // Phase 5: Build concept index
    const topics = this.buildBasicConceptIndex(chunks);
    this.professorService.storeConceptIndex(materialId, {
      topics,
      structure: `${extractedPages.length} pages, ${chunks.length} sections`,
      status: 'ready_for_llm_enrichment'
    }, 'ready');
  }

  // Build a basic concept index from headings alone (excludes TOC entries)
  private buildBasicConceptIndex(chunks: IngestChunk[]): any[] {
    const headings = chunks.filter(c => c.chunkType === 'heading' && !c.isToc);
    const topics: any[] = [];

    for (let i = 0; i < headings.length; i++) {
      const current = headings[i];
      const startPage = current.page;
      let endPage = startPage;

      let foundNext = false;
      for (let j = i + 1; j < headings.length; j++) {
        if (headings[j].page > startPage) {
          endPage = headings[j].page - 1;
          foundNext = true;
          break;
        }
      }

      if (!foundNext) {
        const maxPage = chunks.reduce((max, c) => Math.max(max, c.page), startPage);
        endPage = maxPage;
      }

      // Problem 4 fix: store only the section's starting page, not a range.
      // The old code built arrays like [9, 10, 11, ..., 23] per section,
      // which produced bloated "pp. 9, 10, 11 ... 23" strings in the system
      // prompt's DOCUMENT STRUCTURE block and wasted token budget.
      topics.push({
        name: current.text,
        title: current.text,
        page: startPage,
        endPage: endPage,
        pages: [startPage], // single start page — see sanitizePageRef() spec
        description: '',
        related: []
      });
    }

    return topics;
  }

  // Push IPC event to renderer with ingestion progress
  private pushStatusToRenderer(materialId: string, status: string, progress: number): void {
    const win = this.mainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('professor:ingestionProgress', { materialId, status, progress });
    }
  }
}
