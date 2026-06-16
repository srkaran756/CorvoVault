import Database from 'better-sqlite3';
import crypto from 'crypto';
import { EmbeddingService } from './embeddingService';
import { VectorRepository } from '../repositories/interfaces/VectorRepository';

const englishNumberMap: { [key: string]: string } = {
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15',
  sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20'
};

export type RetrievalMode = 'CHAPTER_SUMMARY' | 'PAGE_CONTEXT' | 'FACT_LOOKUP' | 'COMPARISON' | 'GENERAL_SEMANTIC';

const STOP_WORDS = new Set([
  'what', 'is', 'are', 'the', 'a', 'an', 'and', 'or', 'but', 'how', 'why', 'who', 'where', 'when',
  'which', 'to', 'in', 'of', 'for', 'on', 'with', 'at', 'by', 'from', 'about', 'as', 'into', 'like',
  'through', 'after', 'before', 'between', 'under', 'over', 'compare', 'contrast', 'explain',
  'summarize', 'find', 'page', 'chapter', 'section', 'this', 'that', 'these', 'those', 'it', 'them',
  'they', 'he', 'she', 'you', 'me', 'us', 'we', 'i'
]);

const COMMON_ENGLISH_WORDS = new Set([
  'note', 'notes', 'book', 'books', 'read', 'write', 'learn', 'study', 'class', 'course',
  'test', 'exam', 'paper', 'page', 'pages', 'chapter', 'chapters', 'section', 'sections',
  'paragraph', 'paragraphs', 'sentence', 'sentences', 'word', 'words', 'text', 'texts',
  'file', 'files', 'data', 'information', 'detail', 'details', 'example', 'examples',
  'question', 'questions', 'answer', 'answers', 'query', 'queries', 'search', 'find',
  'highlight', 'highlights', 'show', 'list', 'explain', 'explanation', 'summarize',
  'summary', 'describe', 'description', 'define', 'definition', 'concept', 'concepts',
  'topic', 'topics', 'author', 'authors', 'writer', 'writers', 'tutor', 'student',
  'students', 'teacher', 'school', 'university', 'college', 'lecture', 'notes',
  'important', 'key', 'main', 'core', 'basic', 'general', 'specific', 'common',
  // Expanded common words list to prevent false spelling corrections of valid terms
  'here', 'there', 'this', 'that', 'these', 'those', 'where', 'when', 'what', 'which',
  'who', 'whom', 'whose', 'why', 'how', 'many', 'much', 'some', 'any', 'every', 'each',
  'other', 'another', 'such', 'same', 'only', 'very', 'even', 'just', 'also', 'than',
  'then', 'once', 'else', 'well', 'good', 'best', 'more', 'most', 'less', 'least',
  'about', 'above', 'below', 'under', 'over', 'between', 'among', 'through', 'after',
  'before', 'during', 'while', 'until', 'since', 'against', 'along', 'across', 'around',
  'behind', 'beside', 'beyond', 'except', 'inside', 'outside', 'within', 'without',
  'towards', 'throughout', 'mean', 'means', 'meaning', 'work', 'code', 'design',
  'system', 'software', 'hardware', 'interface', 'language', 'program', 'function',
  'class', 'object', 'method', 'variable', 'type', 'value', 'state', 'process',
  'thread', 'memory', 'device', 'network', 'server', 'client', 'user', 'people',
  'thing', 'things', 'point', 'points', 'line', 'lines', 'part', 'parts', 'case',
  'cases', 'fact', 'facts', 'true', 'false', 'right', 'wrong', 'simple', 'complex',
  'easy', 'hard', 'clear', 'vague', 'clean', 'dirty', 'fast', 'slow', 'high', 'low',
  'large', 'small', 'big', 'little', 'new', 'old', 'first', 'last', 'next', 'prev',
  'previous', 'follow', 'following', 'both', 'either', 'neither', 'must', 'should',
  'would', 'could', 'might', 'shall', 'will', 'can', 'may', 'want', 'need', 'like',
  'love', 'hate', 'dislike', 'prefer', 'suggest', 'recommend', 'advice', 'warn',
  'caution', 'notice', 'observe', 'watch', 'see', 'look', 'find', 'get', 'take',
  'make', 'do', 'run', 'try', 'use', 'create', 'build', 'speak', 'talk', 'hear',
  'listen', 'understand', 'know', 'think', 'believe', 'guess', 'suppose', 'assume',
  'decide', 'choose', 'select', 'pick', 'keep', 'hold', 'leave', 'stay', 'go',
  'come', 'move', 'stop', 'start', 'begin', 'end', 'finish', 'complete', 'fail',
  'succeed', 'pass', 'lose', 'win', 'play', 'hide', 'open', 'close', 'save', 'load',
  'store', 'delete', 'remove', 'add', 'insert', 'update', 'edit', 'change', 'modify',
  'replace', 'actual', 'actually', 'real', 'really', 'theory', 'practical', 'practice',
  'does', 'did', 'done', 'doing', 'give', 'gives', 'gave', 'given', 'giving',
  'one', 'ones', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'use', 'uses', 'used', 'using', 'calculate', 'calculates', 'calculated', 'calculating',
  'exercise', 'problem', 'solution', 'solve', 'result', 'effect', 'cause', 'reason',
  'difference', 'similar', 'similarity', 'different', 'compare', 'contrast', 'relation',
  'relationship', 'connect', 'connection', 'link', 'links', 'node', 'nodes', 'network',
  'packet', 'packets', 'router', 'routers', 'switch', 'switches', 'cables', 'cable',
  'fiber', 'optics', 'port', 'ports', 'socket', 'sockets', 'protocol', 'protocols',
  'address', 'addresses', 'layer', 'layers', 'model', 'reference', 'physical',
  'transport', 'session', 'presentation', 'application', 'standard', 'standards',
  'error', 'errors', 'control', 'flow', 'congestion', 'sliding', 'window', 'size',
  'buffer', 'buffers', 'security', 'firewall', 'firewalls', 'cryptography', 'encryption',
  'decryption', 'key', 'keys', 'public', 'private', 'secret', 'symmetric', 'asymmetric',
  'signature', 'signatures', 'certificate', 'certificates', 'trust', 'secure', 'safe',
  'attack', 'attacks', 'threat', 'threats', 'vulnerability', 'vulnerabilities'
]);

function stem(word: string): string {
  // Lightweight English suffix stripping for better term recall
  // Handles common inflections: running→run, defines→defin, definitions→definit
  if (word.length <= 4) return word;
  if (word.endsWith('ings')) return word.slice(0, -4);
  if (word.endsWith('ing')) return word.slice(0, -3);
  if (word.endsWith('tion') || word.endsWith('sion')) return word.slice(0, -3); // keep 'ti'/'si' for partial match
  if (word.endsWith('tions') || word.endsWith('sions')) return word.slice(0, -4);
  if (word.endsWith('ness') || word.endsWith('ment') || word.endsWith('ment')) return word.slice(0, -4);
  if (word.endsWith('ness')) return word.slice(0, -4);
  if (word.endsWith('ment')) return word.slice(0, -4);
  if (word.endsWith('ful')) return word.slice(0, -3);
  if (word.endsWith('less')) return word.slice(0, -4);
  if (word.endsWith('able') || word.endsWith('ible')) return word.slice(0, -4);
  if (word.endsWith('ness')) return word.slice(0, -4);
  if (word.endsWith('ies') && word.length > 5) return word.slice(0, -3) + 'y';
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('er') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('ly') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && word.length > 4 && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function tokenize(text: string): string[] {
  if (!text) return [];
  const cleanedText = text
    .toLowerCase()
    .replace(/(?<!\d)\.|(?<=\d)(?!\.\d)/g, ' ') // preserve dots surrounded by digits e.g. 1.1
    .replace(/[,\/#!$%\^&\*;:{}=\-_`~()?"']/g, ' ');
  return cleanedText
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 0 && (w.length > 1 || /^\d+$/.test(w)) && !STOP_WORDS.has(w))
    .map(w => stem(w)); // apply stemming for better recall
}

export interface IngestChunk {
  chunkId: string;
  page: number;
  section: string | null;
  chunkType: 'heading' | 'paragraph' | 'equation' | 'caption' | 'list_item';
  text: string;
  chunkOrder: number;
  bbox?: { x: number; y: number; w: number; h: number };
  chapterId?: string | null;  // V3: normalized slug e.g. "chapter_2"
  rawText?: string | null;    // V3: verbatim text from pdfjs getTextContent()
  isToc?: boolean; // true for table of contents entries
}

export class ProfessorService {
  constructor(
    private db: Database.Database,
    private vectorRepo?: VectorRepository
  ) {}

  getIngestionStatus(materialId: string): string {
    const row = this.db.prepare(
      'SELECT status FROM concept_index WHERE material_id = ?'
    ).get(materialId) as { status: string } | undefined;
    return row?.status ?? 'not_started';
  }

  markIngestionStatus(
    materialId: string,
    status: 'not_started' | 'queued' | 'processing' | 'ready' | 'failed'
  ): void {
    const now = Date.now();
    const exists = this.db.prepare('SELECT 1 FROM concept_index WHERE material_id = ?').get(materialId);
    if (exists) {
      this.db.prepare('UPDATE concept_index SET status = ?, updated_at = ? WHERE material_id = ?')
        .run(status, now, materialId);
    } else {
      this.db.prepare(
        `INSERT INTO concept_index (material_id, index_json, status, created_at, updated_at)
         VALUES (?, '{}', ?, ?, ?)`
      ).run(materialId, status, now, now);
    }
  }

  storeChunksWithEmbeddings(
    materialId: string,
    chunks: IngestChunk[],
    embeddings: Float32Array[]
  ): void {
    const now = Date.now();
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO document_chunks
        (chunk_id, material_id, page, section, chunk_type, text,
         bbox_x, bbox_y, bbox_w, bbox_h, embedding, chunk_order, created_at,
         chapter_id, raw_text, is_toc)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      this.db.prepare('DELETE FROM document_chunks WHERE material_id = ?').run(materialId);
      if (this.vectorRepo && this.vectorRepo.isAvailable) {
        this.vectorRepo.deleteByMaterial(materialId);
      }

      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const embBlob = embeddings[i] ? EmbeddingService.toBuffer(embeddings[i]) : null;
        insert.run(
          c.chunkId, materialId, c.page, c.section ?? null, c.chunkType, c.text,
          c.bbox?.x ?? null, c.bbox?.y ?? null, c.bbox?.w ?? null, c.bbox?.h ?? null,
          embBlob, c.chunkOrder, now,
          c.chapterId ?? null, c.rawText ?? null,
          c.isToc ? 1 : 0
        );
      }
      this.db.prepare('UPDATE concept_index SET total_chunks = ? WHERE material_id = ?')
        .run(chunks.length, materialId);
    })();

    if (this.vectorRepo && this.vectorRepo.isAvailable) {
      const vectorChunks = chunks
        .map((c, i) => ({ chunkId: c.chunkId, embedding: embeddings[i] }))
        .filter(vc => vc.embedding !== null && vc.embedding !== undefined);
      if (vectorChunks.length > 0) {
        this.vectorRepo.insertChunks(materialId, vectorChunks);
      }
    }
  }

  // Helper to check if a heading is major (Chapter or single digit like 1. Introduction, but not 1.1)
  private isMajorHeading(text: string): boolean {
    const cleanText = text.trim();
    if (/^chapter\b/i.test(cleanText)) return true;
    if (/^\d+(?:\.|\b)/.test(cleanText) && !/^\d+\.\d+/.test(cleanText)) return true;
    return false;
  }

  private isLocalQuery(userQuery: string): boolean {
    const localPatterns = /(this page|current page|here|highlight this|what does this say|on this page)/i;
    return localPatterns.test(userQuery);
  }

  private extractChapterRefs(userQuery: string): string[] {
    const patterns = [
      /chapter\s+(\d+)/i,
      /ch\.\s*(\d+)/i,
      /chapter\s+([a-zA-Z]+)/i,
    ];
    const refs: string[] = [];
    for (const pattern of patterns) {
      const match = userQuery.match(pattern);
      if (match) {
        refs.push(match[1]);
      }
    }
    return refs;
  }

  // Semantic search: embed query and find top-K chunks by cosine similarity
  async getRelevantChunks(
    materialId: string,
    currentPage: number,
    query: string,
    limit: number = 8
  ): Promise<any[]> {
    const embService = new EmbeddingService();
    const queryEmbeddings = await embService.embedBatch([query]);
    const queryEmbedding = queryEmbeddings[0];

    let allChunks: any[];
    if (this.vectorRepo && this.vectorRepo.isAvailable && queryEmbedding) {
      const k = Math.max(limit * 5, 50);
      const knnResults = this.vectorRepo.knnSearch(materialId, queryEmbedding, k);
      if (knnResults.length > 0) {
        const chunkIds = knnResults.map(r => r.chunkId);
        const placeholders = chunkIds.map(() => '?').join(',');
        allChunks = this.db.prepare(
          `SELECT *, embedding FROM document_chunks WHERE chunk_id IN (${placeholders}) AND is_toc = 0`
        ).all(...chunkIds) as any[];
      } else {
        allChunks = [];
      }
    } else {
      // Fallback: Load chunks WITHOUT embeddings first, then compute similarity in batches
      // V3 fix for B-08: prevents loading all embeddings into heap at once
      console.warn('[ProfessorService] sqlite-vec unavailable, using limited fallback');
      // Only load chunks near the current page to prevent memory bomb
      const pageWindow = 10;
      allChunks = this.db.prepare(
          `SELECT *, embedding FROM document_chunks
           WHERE material_id = ? AND page BETWEEN ? AND ? AND is_toc = 0
           ORDER BY chunk_order`
        ).all(materialId, Math.max(1, currentPage - pageWindow), currentPage + pageWindow) as any[];
    }

    if (allChunks.length === 0) {
      // Fallback: return current-page chunks if no embeddings yet
      return this.db.prepare(
          'SELECT * FROM document_chunks WHERE material_id = ? AND page = ? AND is_toc = 0 LIMIT ?'
        ).all(materialId, currentPage, limit);
    }

    // Load concept map topics
    let topics: any[] = [];
    // Exclude TOC chunks from further processing (already filtered above)

    const conceptIndex = this.getConceptIndex(materialId);
    if (conceptIndex && Array.isArray(conceptIndex.topics)) {
      topics = conceptIndex.topics;
    } else {
      // Fallback: build basic topic structure from database headings
      const headings = this.db.prepare(
        "SELECT page, text FROM document_chunks WHERE material_id = ? AND chunk_type = 'heading' AND is_toc = 0 ORDER BY chunk_order"
      ).all(materialId) as Array<{ page: number; text: string }>;

      for (let i = 0; i < headings.length; i++) {
        const cur = headings[i];
        let endPage = cur.page;
        for (let j = i + 1; j < headings.length; j++) {
          if (headings[j].page > cur.page) {
            endPage = headings[j].page - 1;
            break;
          }
        }
        const pages = [];
        for (let p = cur.page; p <= endPage; p++) pages.push(p);

        topics.push({
          name: cur.text,
          title: cur.text,
          page: cur.page,
          endPage,
          pages
        });
      }
    }

    const detectedRefs = this.extractChapterRefs(query);
    const chapterNumbers = detectedRefs.map(ref => {
      const lower = ref.toLowerCase();
      return englishNumberMap[lower] || ref;
    });

    const chapterPages: number[] = [];
    const queryLower = query.toLowerCase();

    for (const topic of topics) {
      const name = topic.name || topic.title || '';
      if (!name) continue;

      const nameLower = name.toLowerCase();

      // Chapter pattern checking
      let isChapterMatch = false;
      for (const num of chapterNumbers) {
        const hasChapterNum = new RegExp(`\\b(?:chapter|ch|ch\\.)\\s*0*${num}\\b`, 'i').test(name);
        const startsWithNum = new RegExp(`^0*${num}(?:\\s|\\.|\\d)`, 'i').test(name);
        if (hasChapterNum || startsWithNum) {
          isChapterMatch = true;
          break;
        }
      }

      // Title substring checking
      const cleanName = nameLower.replace(/[^a-z0-9\s]/g, '').trim();
      const isSubstringMatch = cleanName.length > 3 && queryLower.includes(cleanName);

      if (isChapterMatch || isSubstringMatch) {
        let pages: number[] = [];
        if (Array.isArray(topic.pages) && topic.pages.length > 0) {
          pages = topic.pages;
        } else if (typeof topic.page === 'number') {
          const end = typeof topic.endPage === 'number' ? topic.endPage : topic.page;
          for (let p = topic.page; p <= end; p++) {
            pages.push(p);
          }
        }
        chapterPages.push(...pages);
      }
    }

    const uniqueChapterPages = new Set(chapterPages);
    const queryIsLocal = this.isLocalQuery(query);

    // Score each chunk: 70% semantic similarity + proximity boost
    const scored = allChunks.map(chunk => {
      let semanticScore = 0;
      if (chunk.embedding && queryEmbedding) {
        const chunkEmb = EmbeddingService.fromBuffer(chunk.embedding);
        semanticScore = EmbeddingService.cosineSimilarity(queryEmbedding, chunkEmb);
      }

      // Page proximity boost: max 0.1, decaying distance (window of 5 pages), conditional on local query
      const pageDist = Math.abs(chunk.page - currentPage);
      const proximityScore = queryIsLocal
        ? 0.1 * Math.max(0, 1 - pageDist / 5)
        : 0;

      // V3: Topic boost REMOVED. Replaced by SQL pre-filter (chapter_id WHERE clause).
      // Old formula: +0.8 flat boost overpowered cosine (max 0.7). Now max score = 0.8.
      const finalScore = (semanticScore * 0.7) + proximityScore;

      return { ...chunk, score: finalScore };
    });

    let finalLimit = limit;
    if (uniqueChapterPages.size > 0) {
      finalLimit = Math.max(limit, Math.min(uniqueChapterPages.size, 15));
    }

    // Sort all chunks by score descending
    const sorted = scored.sort((a, b) => b.score - a.score);

    // Ensure we select at least one chunk from each matched page to guarantee context extraction
    const selectedChunks: any[] = [];
    if (uniqueChapterPages.size > 0) {
      for (const page of uniqueChapterPages) {
        if (selectedChunks.length >= finalLimit) break;
        const bestChunkForPage = sorted.find(c => c.page === page);
        if (bestChunkForPage) {
          selectedChunks.push(bestChunkForPage);
        }
      }
    }

    // Fill the remaining quota with the overall highest-scoring chunks
    for (const chunk of sorted) {
      if (selectedChunks.length >= finalLimit) break;
      // Deduplicate by DB column name (chunk_id, not chunkId)
      if (!selectedChunks.some(c => c.chunk_id === chunk.chunk_id)) {
        selectedChunks.push(chunk);
      }
    }

    // Sort the final selection chronologically by chunk_order
    return selectedChunks.sort((a, b) => a.chunk_order - b.chunk_order);
  }

  private correctQuerySpelling(query: string, materialId: string): string {
    try {
      const chunks = this.db.prepare(
        'SELECT text FROM document_chunks WHERE material_id = ? AND is_toc = 0'
      ).all(materialId) as Array<{ text: string }>;

      if (chunks.length === 0) return query;

      const vocabulary = new Set<string>();
      for (const chunk of chunks) {
        const words = chunk.text.toLowerCase().match(/[a-zA-Z]{4,}/g);
        if (words) {
          for (const w of words) vocabulary.add(w);
        }
      }

      // Helper to compute edit distance
      const levenshtein = (s1: string, s2: string): number => {
        if (s1.length < s2.length) return levenshtein(s2, s1);
        if (s2.length === 0) return s1.length;
        
        let previousRow = Array.from({ length: s2.length + 1 }, (_, i) => i);
        for (let i = 0; i < s1.length; i++) {
          const currentRow = [i + 1];
          for (let j = 0; j < s2.length; j++) {
            const insertions = previousRow[j + 1] + 1;
            const deletions = currentRow[j] + 1;
            const substitutions = previousRow[j] + (s1[i] !== s2[j] ? 1 : 0);
            currentRow.push(Math.min(insertions, deletions, substitutions));
          }
          previousRow = currentRow;
        }
        return previousRow[previousRow.length - 1];
      };

      // Split query into words and non-words
      const parts = query.split(/([a-zA-Z]+)/);
      const correctedParts = parts.map(part => {
        if (!/^[a-zA-Z]{4,}$/.test(part)) {
          return part;
        }

        const lower = part.toLowerCase();
        // If word is in common english, or book's vocabulary, or stop words, do not change
        if (vocabulary.has(lower) || STOP_WORDS.has(lower) || COMMON_ENGLISH_WORDS.has(lower)) {
          return part;
        }

        let bestWord = lower;
        let minDistance = 3; // Max 2 edits allowed

        for (const vocabWord of vocabulary) {
          if (Math.abs(vocabWord.length - lower.length) >= minDistance) {
            continue;
          }
          const dist = levenshtein(lower, vocabWord);
          if (dist < minDistance) {
            minDistance = dist;
            bestWord = vocabWord;
          }
        }

        if (minDistance < 3) {
          if (part[0] === part[0].toUpperCase()) {
            return bestWord.charAt(0).toUpperCase() + bestWord.slice(1);
          }
          return bestWord;
        }
        return part;
      });

      const corrected = correctedParts.join('');
      if (corrected !== query) {
        console.log(`[ProfessorService] Corrected query typos: "${query}" -> "${corrected}"`);
      }
      return corrected;
    } catch (err) {
      console.warn('[ProfessorService] Query spelling correction failed:', err);
      return query;
    }
  }

  async classifyAndRetrieve(
    materialId: string,
    currentPage: number,
    numPages: number,
    query: string,
    conversationHistory: any[],
    limit: number = 8
  ): Promise<{
    intent: RetrievalMode;
    relevantChunks: any[];
    conceptIndex: any | null;
    metrics?: any;
  }> {
    const startTime = Date.now();
    const conceptIndex = this.getConceptIndex(materialId);

    // Parse the intent prefix first to avoid spelling-correcting it
    let routingPrefix = '';
    let textQuery = query;
    const prefixMatch = query.match(/^INTENT:(LOCAL|CHAPTER|GLOBAL|CROSS|FACTUAL)\s+/i);
    if (prefixMatch) {
      routingPrefix = prefixMatch[0];
      textQuery = query.slice(routingPrefix.length);
    }

    // Apply spelling correction only to the actual query text
    const correctedTextQuery = this.correctQuerySpelling(textQuery, materialId);

    // 1. Rewrite the query to resolve relative references
    const rewrittenTextQuery = this.rewriteQuery(correctedTextQuery, conversationHistory);
    const cleanQuery = rewrittenTextQuery.trim();

    // 2. Classify intent deterministically (Retrieval Mode Router)
    let intent: RetrievalMode = 'GENERAL_SEMANTIC';
    
    if (query.startsWith('INTENT:LOCAL ')) {
      intent = 'PAGE_CONTEXT';
    } else if (query.startsWith('INTENT:CHAPTER ')) {
      intent = 'CHAPTER_SUMMARY';
    } else if (query.startsWith('INTENT:GLOBAL ')) {
      intent = 'CHAPTER_SUMMARY';
    } else if (query.startsWith('INTENT:CROSS ')) {
      intent = 'COMPARISON';
    } else if (query.startsWith('INTENT:FACTUAL ')) {
      intent = 'FACT_LOOKUP';
    } else {
      const lowerQuery = cleanQuery.toLowerCase();
      const isLocal = /(this page|here|current page|highlight this|what does this say|on this page)/i.test(lowerQuery);
      
      const hasChapterKeyword = /(chapter|ch\.|ch)\s+\d+/i.test(lowerQuery);
      const asksForSummary = /(summarize|summary|overview|about|contain|say|write|author say|explain|tell me|intro|introduction)/i.test(lowerQuery);
      const isChapterSummary = hasChapterKeyword && asksForSummary;

      const isGlobalSummary = /summarize (the |this )?(whole |entire |full )?(document|book|textbook)|overview|table of contents|all chapters/i.test(lowerQuery);

      const isComparison = /(compare|difference between|contrast|versus|vs|relation|relationship|distinguish)/i.test(lowerQuery);
      const isFactLookup = /(why|how|what|define|explain|describe|detail|reason|cause|effect|result|formula|equation)/i.test(lowerQuery);

      if (isLocal) {
        intent = 'PAGE_CONTEXT';
      } else if (isChapterSummary || isGlobalSummary) {
        intent = 'CHAPTER_SUMMARY';
      } else if (isComparison) {
        intent = 'COMPARISON';
      } else if (isFactLookup) {
        intent = 'FACT_LOOKUP';
      } else {
        intent = 'GENERAL_SEMANTIC';
      }
    }

    let rawRelevantChunks: any[] = [];

    // 3. Retrieval Mode Routing Execution
    switch (intent) {
      case 'PAGE_CONTEXT': {
        // Retrieve chunks in page window (+/- 2 pages)
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(numPages, currentPage + 2);
        const candidates = this.db.prepare(
          `SELECT *, embedding FROM document_chunks 
           WHERE material_id = ? AND page BETWEEN ? AND ? AND is_toc = 0`
        ).all(materialId, startPage, endPage) as any[];

        rawRelevantChunks = await this.rankHybrid(materialId, cleanQuery, candidates, currentPage, limit);
        break;
      }
      case 'CHAPTER_SUMMARY': {
        const chapterRefs = this.extractChapterRefs(cleanQuery);
        const chapterNumbers = chapterRefs.map(ref => englishNumberMap[ref.toLowerCase()] || ref);

        if (chapterNumbers.length > 0) {
          const clauses = chapterNumbers.map(() => 'chapter_id LIKE ? OR chapter_id LIKE ?').join(' OR ');
          const params: string[] = [];
          chapterNumbers.forEach(num => {
            params.push(`%chapter_${num}%`);
            params.push(`${num}_%`);
          });

          rawRelevantChunks = this.db.prepare(
            `SELECT *, embedding FROM document_chunks WHERE material_id = ? AND is_toc = 0 AND (${clauses})`
          ).all(materialId, ...params) as any[];

          if (rawRelevantChunks.length > 30) {
            // FIX: rankHybrid now returns in score order. Pass directly to expandChunkContexts
            // WITHOUT re-sorting by chunk_order, so higher-scored chunks are expanded first.
            // Previously re-sorting by chunk_order meant early-document chunks always
            // got their windows expanded first, causing later high-relevance chunks to be dropped.
            rawRelevantChunks = await this.rankHybrid(materialId, cleanQuery, rawRelevantChunks, currentPage, 30);
          } else {
            // No re-ranking needed — small candidate set, just keep original order
            rawRelevantChunks = rawRelevantChunks.sort((a, b) => a.chunk_order - b.chunk_order);
          }
        } else {
          // Fallback if no specific chapter detected
          const isGlobal = /summarize (the |this )?(whole |entire |full )?(document|book|textbook)|overview|table of contents|all chapters/i.test(cleanQuery.toLowerCase());
          const queryStr = isGlobal 
            ? `SELECT *, embedding FROM document_chunks WHERE material_id = ? AND is_toc = 0 AND chunk_type = 'heading'`
            : `SELECT *, embedding FROM document_chunks WHERE material_id = ? AND is_toc = 0`;
          const candidates = this.db.prepare(queryStr).all(materialId) as any[];
          rawRelevantChunks = await this.rankHybrid(materialId, cleanQuery, candidates, currentPage, limit);
        }
        break;
      }
      case 'COMPARISON': {
        const queryParts = cleanQuery
          .replace(/compare|difference between|contrast|how does|relate to/ig, '')
          .split(/\band\b|\bvs\b|\bversus\b/i)
          .map(p => p.trim())
          .filter(p => p.length > 2);

        if (queryParts.length >= 2) {
          const subLimit = Math.max(4, Math.floor(limit / 2));
          const allCandidates = this.db.prepare(
            `SELECT *, embedding FROM document_chunks WHERE material_id = ? AND is_toc = 0`
          ).all(materialId) as any[];

          const results = await Promise.all(
            queryParts.map(part => this.rankHybrid(materialId, part, allCandidates, currentPage, subLimit))
          );

          const seen = new Set<string>();
          const merged: any[] = [];
          for (const list of results) {
            for (const chunk of list) {
              if (!seen.has(chunk.chunk_id)) {
                seen.add(chunk.chunk_id);
                merged.push(chunk);
              }
            }
          }
          rawRelevantChunks = merged.sort((a, b) => a.chunk_order - b.chunk_order);
        } else {
          const candidates = this.db.prepare(
            `SELECT *, embedding FROM document_chunks WHERE material_id = ? AND is_toc = 0`
          ).all(materialId) as any[];
          rawRelevantChunks = await this.rankHybrid(materialId, cleanQuery, candidates, currentPage, limit);
        }
        break;
      }
      case 'FACT_LOOKUP':
      case 'GENERAL_SEMANTIC':
      default: {
        const candidates = this.db.prepare(
          `SELECT *, embedding FROM document_chunks WHERE material_id = ? AND is_toc = 0`
        ).all(materialId) as any[];
        rawRelevantChunks = await this.rankHybrid(materialId, cleanQuery, candidates, currentPage, limit);
        break;
      }
    }

    // 4. Context Window Expansion (Stage 4)
    const relevantChunks = await this.expandChunkContexts(materialId, rawRelevantChunks);

    // Calculate quality metrics
    const latencyMs = Date.now() - startTime;
    const coverageMetrics = this.calculateContextCoverage(cleanQuery, relevantChunks);

    return {
      intent,
      relevantChunks,
      conceptIndex,
      metrics: {
        retrievalMode: intent,
        chunksScored: rawRelevantChunks.length,
        latencyMs,
        coverage: coverageMetrics.coverage,
        missingConcepts: coverageMetrics.missingWords,
        scores: rawRelevantChunks.map(c => ({
          chunkId: c.chunk_id,
          bm25Score: Number((c.bm25Score || 0).toFixed(4)),
          vectorScore: Number((c.vectorScore || 0).toFixed(4)),
          metadataScore: Number((c.metadataScore || 0).toFixed(4)),
          finalScore: Number((c.score || 0).toFixed(4))
        }))
      }
    };
  }

  private rewriteQuery(query: string, conversationHistory: any[]): string {
    const relativePattern = /\b(it|that|this|the above|what you said|the formula|the concept|the equation|those)\b/i;
    if (!relativePattern.test(query)) {
      return query;
    }
    const lastAssistantMessage = [...conversationHistory]
      .reverse()
      .find(m => m.role === 'assistant');
    if (!lastAssistantMessage) {
      return query;
    }
    const cleanMsg = lastAssistantMessage.content
      .replace(/[\*#_\-`\[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const sentences = cleanMsg.split(/[.!?]/);
    const firstSentence = sentences[0]?.trim() || '';
    if (firstSentence.length > 5 && firstSentence.length < 150) {
      return `${query} (referring to: "${firstSentence}")`;
    }
    return query;
  }

  private calculateBM25(
    chunks: Array<{ chunk_id: string; text: string }>,
    query: string
  ): Map<string, number> {
    const scores = new Map<string, number>();
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0 || chunks.length === 0) {
      for (const c of chunks) scores.set(c.chunk_id, 0);
      return scores;
    }

    const N = chunks.length;
    const chunkTokensMap = new Map<string, string[]>();
    const docFreq = new Map<string, number>();
    let totalTokens = 0;

    for (const chunk of chunks) {
      const tokens = tokenize(chunk.text);
      chunkTokensMap.set(chunk.chunk_id, tokens);
      totalTokens += tokens.length;

      const uniqueTokens = new Set(tokens);
      for (const token of uniqueTokens) {
        docFreq.set(token, (docFreq.get(token) || 0) + 1);
      }
    }

    const avgdl = totalTokens / N;
    const k1 = 1.2;
    const b = 0.75;

    for (const chunk of chunks) {
      const tokens = chunkTokensMap.get(chunk.chunk_id) || [];
      const len = tokens.length;

      const tf = new Map<string, number>();
      for (const token of tokens) {
        tf.set(token, (tf.get(token) || 0) + 1);
      }

      let score = 0;
      for (const qToken of queryTokens) {
        const count = tf.get(qToken) || 0;
        if (count === 0) continue;

        const df = docFreq.get(qToken) || 0;
        const idf = Math.max(0.0001, Math.log((N - df + 0.5) / (df + 0.5) + 1));
        const termScore = idf * (count * (k1 + 1)) / (count + k1 * (1 - b + b * (len / avgdl)));
        score += termScore;
      }
      scores.set(chunk.chunk_id, score);
    }

    let maxScore = 0;
    for (const score of scores.values()) {
      if (score > maxScore) maxScore = score;
    }

    if (maxScore > 0) {
      for (const [id, score] of scores.entries()) {
        scores.set(id, score / maxScore);
      }
    }

    return scores;
  }

  private async rankHybrid(
    materialId: string,
    query: string,
    candidates: any[],
    currentPage: number,
    limit: number
  ): Promise<any[]> {
    if (candidates.length === 0) return [];

    const bm25Map = this.calculateBM25(candidates, query);

    const embService = new EmbeddingService();
    let queryEmbedding: Float32Array | null = null;
    try {
      const queryEmbeddings = await embService.embedBatch([query]);
      queryEmbedding = queryEmbeddings[0] || null;
    } catch (err) {
      console.warn('[ProfessorService] Query embedding generation failed:', err);
    }

    const queryIsLocal = this.isLocalQuery(query);
    const chapterRefs = this.extractChapterRefs(query);
    const chapterNumbers = chapterRefs.map(ref => englishNumberMap[ref.toLowerCase()] || ref);

    // Resolve chapter title matches against topics in concept index
    const queryLower = query.toLowerCase();
    const matchedChapters = new Set<string>();
    for (const num of chapterNumbers) {
      matchedChapters.add(`chapter_${num}`);
    }

    try {
      const conceptIndex = this.getConceptIndex(materialId);
      if (conceptIndex && Array.isArray(conceptIndex.topics)) {
        for (const topic of conceptIndex.topics) {
          const name = topic.name || topic.title || '';
          if (!name) continue;
          const nameLower = name.toLowerCase();
          const cleanName = nameLower.replace(/[^a-z0-9\s]/g, '').trim();
          if (cleanName.length > 5 && queryLower.includes(cleanName)) {
            matchedChapters.add(this.slugify(name));
          }
        }
      }
    } catch (err) {
      console.warn('[ProfessorService] Failed to load topics for chapter boosting:', err);
    }

    // Sort candidates by BM25 descending to get BM25 ranks (handling ties)
    const bm25Sorted = [...candidates].sort((a, b) => (bm25Map.get(b.chunk_id) || 0) - (bm25Map.get(a.chunk_id) || 0));
    const bm25RankMap = new Map<string, number>();
    let prevBm25Score = -1;
    let currentBm25Rank = 0;
    bm25Sorted.forEach((chunk, index) => {
      const score = bm25Map.get(chunk.chunk_id) || 0;
      if (score !== prevBm25Score) {
        currentBm25Rank = index + 1;
        prevBm25Score = score;
      }
      bm25RankMap.set(chunk.chunk_id, currentBm25Rank);
    });

    // Sort candidates by Vector Similarity descending to get Vector ranks (handling ties)
    const vectorScoresMap = new Map<string, number>();
    const vectorRankMap = new Map<string, number>();

    if (queryEmbedding) {
      candidates.forEach(chunk => {
        let sim = 0;
        if (chunk.embedding) {
          const chunkEmb = EmbeddingService.fromBuffer(chunk.embedding);
          sim = Math.max(0, EmbeddingService.cosineSimilarity(queryEmbedding!, chunkEmb));
        }
        vectorScoresMap.set(chunk.chunk_id, sim);
      });

      const vectorSorted = [...candidates].sort((a, b) => (vectorScoresMap.get(b.chunk_id) || 0) - (vectorScoresMap.get(a.chunk_id) || 0));
      let prevVecScore = -1;
      let currentVecRank = 0;
      vectorSorted.forEach((chunk, index) => {
        const score = vectorScoresMap.get(chunk.chunk_id) || 0;
        if (score !== prevVecScore) {
          currentVecRank = index + 1;
          prevVecScore = score;
        }
        vectorRankMap.set(chunk.chunk_id, currentVecRank);
      });
    }

    const scored = candidates.map(chunk => {
      const bm25Score = bm25Map.get(chunk.chunk_id) || 0;
      const vectorScore = vectorScoresMap.get(chunk.chunk_id) || 0;

      const r_bm25 = bm25RankMap.get(chunk.chunk_id) || candidates.length;
      const r_vector = vectorRankMap.get(chunk.chunk_id) || candidates.length;

      let rrfScore = 1 / (60 + r_bm25);
      if (queryEmbedding) {
        rrfScore += 1 / (60 + r_vector);
      }

      let chapterMatch = false;
      if (chunk.chapter_id) {
        const chunkChapterLower = chunk.chapter_id.toLowerCase();
        if (matchedChapters.has(chunkChapterLower)) {
          chapterMatch = true;
        } else {
          chapterMatch = chapterNumbers.some(num =>
            chunkChapterLower.includes(`chapter_${num}`) || chunkChapterLower.startsWith(`${num}_`)
          );
        }
      }

      const pageDist = Math.abs(chunk.page - currentPage);
      const proximityBoost = queryIsLocal
        ? Math.max(0, 1 - pageDist / 5)
        : 0;

      // FIX: Additive boost capped at 0.4 of the max possible RRF score, not a 3x multiplier.
      // This nudges relevant results up without completely overriding semantic/BM25 evidence.
      // Max RRF score (rank=1 in both) = 1/61 + 1/61 ≈ 0.033. We allow up to +0.025 from metadata.
      const metadataScore = (chapterMatch ? 0.7 : 0.0) + (proximityBoost * 0.3);
      const metadataBoost = metadataScore * 0.025; // additive, not multiplicative
      const finalScore = rrfScore + metadataBoost;

      return {
        ...chunk,
        bm25Score,
        vectorScore,
        metadataScore,
        score: finalScore
      };
    });

    const sorted = scored.sort((a, b) => b.score - a.score);
    return sorted.slice(0, limit);
  }

  private async expandChunkContexts(materialId: string, chunks: any[]): Promise<any[]> {
    if (chunks.length === 0) return [];

    const expanded: any[] = [];
    const stmt = this.db.prepare(
      'SELECT text FROM document_chunks WHERE material_id = ? AND chunk_order BETWEEN ? AND ? AND is_toc = 0 ORDER BY chunk_order'
    );

    // FIX: Track which CENTER orders we've already expanded. Deduplicate by center,
    // not by membership in a previous window. This prevents silently dropping
    // high-scoring chunks whose neighbors were already fetched by a different center.
    const expandedCenters = new Set<number>();

    for (const chunk of chunks) {
      const order = chunk.chunk_order;

      // Skip if this exact chunk was already expanded as someone else's center or window
      if (expandedCenters.has(order)) {
        continue;
      }
      expandedCenters.add(order);

      const start = Math.max(0, order - 1);
      const end = order + 3;

      try {
        const neighbors = stmt.all(materialId, start, end) as Array<{ text: string }>;
        chunk.expandedText = neighbors.map(n => n.text).join('\n');
        // Ensure c.text is equal to c.expandedText for direct matching compatibility
        chunk.text = chunk.expandedText;
      } catch (e) {
        console.warn(`[ProfessorService] Failed to expand context for chunk ${chunk.chunk_id}:`, e);
        chunk.expandedText = chunk.text;
      }

      expanded.push(chunk);
    }

    return expanded;
  }

  private calculateContextCoverage(query: string, chunks: any[]): { coverage: number; missingWords: string[] } {
    if (!query || chunks.length === 0) return { coverage: 1.0, missingWords: [] };

    const cleanWords = query
      .toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, ' ')
      .split(/\s+/)
      .map(w => w.trim())
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));

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

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 60);
  }

  storeConceptIndex(materialId: string, indexJson: any, status: 'ready' | 'failed'): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT OR REPLACE INTO concept_index
        (material_id, index_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(materialId, JSON.stringify(indexJson), status, now, now);
  }

  getConceptIndex(materialId: string): any | null {
    const row = this.db.prepare(
      'SELECT index_json FROM concept_index WHERE material_id = ?'
    ).get(materialId) as { index_json: string } | undefined;
    return row ? JSON.parse(row.index_json) : null;
  }

  loadSession(materialId: string): any | null {
    return this.db.prepare(
      'SELECT * FROM professor_sessions WHERE material_id = ? ORDER BY updated_at DESC LIMIT 1'
    ).get(materialId);
  }

  upsertSession(materialId: string, session: any): void {
    const now = Date.now();
    const existing = this.loadSession(materialId);
    if (existing) {
      this.db.prepare(`
        UPDATE professor_sessions SET
          conversation_json = ?, student_model_json = ?, agenda_json = ?,
          board_state_json = ?, last_page = ?, updated_at = ?
        WHERE session_id = ?
      `).run(
        JSON.stringify(session.conversationHistory),
        JSON.stringify(session.studentModel),
        JSON.stringify(session.agenda),
        JSON.stringify(session.boardState),
        session.currentPage, now, existing.session_id
      );
    } else {
      this.db.prepare(`
        INSERT INTO professor_sessions
          (session_id, material_id, conversation_json, student_model_json,
           agenda_json, board_state_json, last_page, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(), materialId,
        JSON.stringify(session.conversationHistory),
        JSON.stringify(session.studentModel),
        JSON.stringify(session.agenda),
        JSON.stringify(session.boardState ?? null),
        session.currentPage ?? 1, now, now
      );
    }
  }

  // ─── Annotation Storage (replaces localStorage) ───────────────────────────

  getAnnotations(materialId: string, page?: number): any[] {
    if (page !== undefined) {
      return this.db.prepare(
        'SELECT * FROM annotations WHERE material_id = ? AND page = ? ORDER BY created_at'
      ).all(materialId, page);
    }
    return this.db.prepare(
      'SELECT * FROM annotations WHERE material_id = ? ORDER BY page, created_at'
    ).all(materialId);
  }

  saveAnnotation(annotation: {
    annotation_id: string;
    material_id: string;
    chunk_id?: string;
    page: number;
    type: string;
    target_text?: string;
    color: string;
    callout?: string;
    bbox_x?: number;
    bbox_y?: number;
    bbox_w?: number;
    bbox_h?: number;
    stroke_data?: string;
    source: string;
    created_at: number;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO annotations
        (annotation_id, material_id, chunk_id, page, type, target_text, color,
         callout, bbox_x, bbox_y, bbox_w, bbox_h, stroke_data, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      annotation.annotation_id, annotation.material_id, annotation.chunk_id ?? null,
      annotation.page, annotation.type, annotation.target_text ?? null,
      annotation.color, annotation.callout ?? null,
      annotation.bbox_x ?? null, annotation.bbox_y ?? null,
      annotation.bbox_w ?? null, annotation.bbox_h ?? null,
      annotation.stroke_data ?? null, annotation.source, annotation.created_at
    );
  }

  deleteAnnotation(annotationId: string): void {
    this.db.prepare('DELETE FROM annotations WHERE annotation_id = ?').run(annotationId);
  }

  deleteAnnotationsForPage(materialId: string, page: number): void {
    this.db.prepare(
      'DELETE FROM annotations WHERE material_id = ? AND page = ?'
    ).run(materialId, page);
  }

  // ─── PDF Bookmark Storage (replaces localStorage) ─────────────────────────

  getPdfBookmarks(materialId: string): any[] {
    return this.db.prepare(
      'SELECT * FROM pdf_bookmarks WHERE material_id = ? ORDER BY page'
    ).all(materialId);
  }

  savePdfBookmark(bookmark: {
    bookmark_id: string;
    material_id: string;
    page: number;
    label: string;
    created_at: number;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO pdf_bookmarks
        (bookmark_id, material_id, page, label, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(bookmark.bookmark_id, bookmark.material_id, bookmark.page, bookmark.label, bookmark.created_at);
  }

  deletePdfBookmark(bookmarkId: string): void {
    this.db.prepare('DELETE FROM pdf_bookmarks WHERE bookmark_id = ?').run(bookmarkId);
  }

  // ─── Re-ingestion support ──────────────────────────────────────────────────

  clearIngestionForMaterial(materialId: string): void {
    if (this.vectorRepo && this.vectorRepo.isAvailable) {
      this.vectorRepo.deleteByMaterial(materialId);
    }
    this.db.prepare('DELETE FROM document_chunks WHERE material_id = ?').run(materialId);
    this.db.prepare('DELETE FROM vec_chunk_map WHERE material_id = ?').run(materialId);
    this.db.prepare(
      `UPDATE ingestion_queue SET status = 'waiting', attempts = 0
       WHERE material_id = ? AND status IN ('done', 'failed')`
    ).run(materialId);
    this.markIngestionStatus(materialId, 'not_started');
  }
}

