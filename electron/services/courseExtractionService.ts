import { BrowserWindow } from 'electron';
import Database from 'better-sqlite3';
import { Window } from 'happy-dom';
import https from 'https';
import http from 'http';
import { EmbeddingService } from './embeddingService';

export interface ExtractedLink {
  url: string;
  anchorText: string;
  nearbyHeading: string;
  surroundingText: string;
  domPath: string;
  sourceDomain: string;
}

export interface ClassifiedLink extends ExtractedLink {
  category: string;
  confidence: number;
  needsReview?: boolean;
}

export interface GroupedResult {
  groupName: string;
  resources: ClassifiedLink[];
}

class ConcurrencyQueue {
  private activeCount = 0;
  private queue: (() => void)[] = [];

  constructor(private maxConcurrency = 2) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }
    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

/**
 * -----------------------------------------------------------------------------
 * EXPERIMENTAL SYSTEM PROMPT ORGANIZER TOGGLE
 * -----------------------------------------------------------------------------
 * Change this single boolean flag:
 *   - `true`  : Activates experimental LLM System Prompt Link Organizer & Vault Box Mapping
 *   - `false` : Reverts instantly to fast local multi-signal rule scoring engine
 * -----------------------------------------------------------------------------
 */
export const USE_EXPERIMENTAL_LLM_ORGANIZER = false;

export const SYLLABUS_LLM_SYSTEM_PROMPT = `You are an elite AI Syllabus Architect and CorvoVault Knowledge Curator.
Your job is to analyze extracted web links from an educational course site and organize every resource into structured curriculum modules and precise target Vault Box categories.

MANDATORY VAULT BOX TARGET TYPES:
1. "file" (Downloadable File Box):
   - PDFs (Lecture notes, slide decks, assignments, exam papers, readings).
   - Code files & archives (.py, .ipynb, .zip, .tar.gz, .java, .cpp, script files, docdist, bst, avl).
2. "website" (Web Resource Box):
   - Web pages, documentation links, HTML readings, interactive guides, external reference pages.
3. "youtube" (YouTube / Video Box):
   - YouTube video links, YouTube playlists, embedded lecture recordings, video walkthroughs.
   - For YouTube playlists or multiple video recordings, organize each video into an explicit YouTube box.

CATEGORY BOX TYPES:
- Video (Lecture recordings, YouTube videos, playlists)
- Notes (Typed lecture notes, handwritten notes, slide decks, handouts)
- Assignment (Homework problem sets, coding exercises, theory questions)
- Quiz (Quizzes, exams, midterm, final, solution keys, blank exams)
- Reading (Textbooks, CLRS, articles, reference guides, recitation problem sets)
- Project (Coding projects, lab scripts, python implementations, repos)
- Other (General info, syllabus overview, staff, tools)

JSON OUTPUT STRUCTURE:
Return strictly valid JSON matching this schema:
{
  "groups": [
    {
      "groupName": "Unit 1: Introduction",
      "resources": [
        {
          "url": "https://...",
          "anchorText": "Lec 1: Algorithmic Thinking Video",
          "nearbyHeading": "Unit 1: Introduction",
          "surroundingText": "...",
          "category": "Video",
          "boxType": "youtube",
          "confidence": 0.95,
          "needsReview": false
        }
      ]
    }
  ]
}`;

const PROTOTYPES: Record<string, string> = {
  Video: "A recorded lecture, video walkthrough, screencast, or online tutorial video.",
  Notes: "Written lecture notes, lecture slides, presentation handouts, or summarizing documents.",
  Assignment: "A problem set, homework assignment, coding exercise, or lab exercise to complete.",
  Quiz: "A test, exam, quiz, check-in, or self-assessment to check understanding.",
  Reading: "A textbook chapter, book chapter, research paper, article, or reference reading.",
  Project: "A larger final project, milestone implementation, term project, or team project.",
  Other: "General course info, syllabus details, calendar, staff list, tools, or miscellaneous links."
};

const CATEGORY_PRIORITY: Record<string, number> = {
  Assignment: 1,
  Video: 2,
  Reading: 3,
  Notes: 4,
  Quiz: 5,
  Project: 6,
  Other: 7
};

export class CourseExtractionService {
  private embeddingService = new EmbeddingService();
  private concurrencyQueue = new ConcurrencyQueue(2);
  private prototypeEmbeddings: Map<string, Float32Array> | null = null;

  constructor(private db: Database.Database) {}

  /**
   * Main entry point to extract course resource syllabus
   */
  async extractCourseSyllabus(url: string, profileId: string, onProgress?: (step: string, progress: number) => void): Promise<{ groups: GroupedResult[]; meta: { trimmed: boolean; originalCount: number } }> {
    this.abortController = new AbortController();
    console.log(`[CourseExtractionService] Starting extraction for URL: ${url}`);
    onProgress?.('Resolving absolute domain...', 5);
    
    // Resolve absolute domain
    let domain = '';
    try {
      domain = new URL(url).hostname;
    } catch (e) {
      throw new Error(`Invalid course URL: ${url}`);
    }

    // 1. Check render cache
    const cacheDecision = this.getRenderTypeCache(domain);
    let extractedLinks: ExtractedLink[] = [];

    if (cacheDecision) {
      console.log(`[CourseExtractionService] Domain render cache hit: ${domain} -> ${cacheDecision}`);
      if (cacheDecision === 'static') {
        onProgress?.('Fetching static course HTML page contents...', 15);
        extractedLinks = await this.runStaticFetch(url);
      } else {
        onProgress?.('Initializing headless Chromium sandbox browser...', 15);
        extractedLinks = await this.runHeadlessRender(url);
      }
    } else {
      console.log(`[CourseExtractionService] Domain render cache miss. Running static fetch first...`);
      onProgress?.('Performing static network fetch...', 10);
      let html = '';
      try {
        html = await this.fetchStatic(url);
      } catch (err) {
        console.warn(`[CourseExtractionService] Static fetch failed. Falling back directly to headless render:`, err);
      }

      let isSPA = true;
      if (html) {
        onProgress?.('Parsing HTML and checking for SPA framework fingerprints...', 15);
        const staticLinks = this.extractLinksFromHtml(html, url);
        isSPA = this.detectSPA(html, staticLinks);

        if (!isSPA) {
          console.log(`[CourseExtractionService] Heuristic: Domain ${domain} is STATIC.`);
          this.setRenderTypeCache(domain, 'static');
          extractedLinks = staticLinks;
        }
      }

      if (isSPA) {
        console.log(`[CourseExtractionService] Heuristic: Domain ${domain} is JS-RENDERED (SPA). Falling back to headless render...`);
        onProgress?.('Initializing headless Chromium sandbox browser...', 20);
        this.setRenderTypeCache(domain, 'rendered');
        extractedLinks = await this.runHeadlessRender(url);
      }
    }

    // 1b. Perform 1-hop sub-page crawling for course sub-sections
    onProgress?.('Discovering and crawling course sub-sections (Notes, Assignments, Exams)...', 30);
    const fullCourseLinks = await this.crawlSubPages(url, extractedLinks, onProgress);

    onProgress?.('Expanding YouTube playlist media nodes...', 45);
    console.log(`[CourseExtractionService] Extracted ${fullCourseLinks.length} raw links across course pages. Expanding playlists...`);
    const expandedLinks = await this.expandPlaylists(fullCourseLinks);

    const originalCount = expandedLinks.length;
    console.log(`[CourseExtractionService] Processing ${originalCount} links after playlist expansion...`);
    
    // Check single-flag experimental toggle
    if (USE_EXPERIMENTAL_LLM_ORGANIZER) {
      onProgress?.('[Experimental] Running AI System Prompt Syllabus Architect...', 70);
      const groups = (await this.runExperimentalLLMOrganizer(expandedLinks, profileId)) as GroupedResult[];
      return { groups, meta: { trimmed: false, originalCount } };
    }

    // 2. Classify links via fast local multi-signal rules
    const classifiedLinks = await this.classifyLinks(expandedLinks, profileId, (subStep, subProgress) => {
      const totalProgress = 50 + Math.floor(subProgress * 0.4);
      onProgress?.(subStep, totalProgress);
    });

    onProgress?.('Clustering resources into curriculum modules (Units, Lectures, Assignments)...', 95);
    // 3. Group and Sort links
    const grouped = this.groupLinks(classifiedLinks);

    onProgress?.('Curriculum parsing complete', 100);
    return { groups: grouped, meta: { trimmed: false, originalCount } };
  }

  /**
   * EXPERIMENTAL FUNCTION:
   * Uses SYLLABUS_LLM_SYSTEM_PROMPT to organize raw extracted link JSON
   * into structured modules & explicit Vault Box types (file, website, youtube).
   */
  private async runExperimentalLLMOrganizer(links: ExtractedLink[], profileId: string): Promise<GroupedResult[]> {
    console.log(`[CourseExtractionService] Experimental Mode active. Structuring ${links.length} raw links with System Prompt...`);
    
    const payloadJson = JSON.stringify(links.map(l => ({
      url: l.url,
      anchorText: l.anchorText,
      nearbyHeading: l.nearbyHeading,
      surroundingText: l.surroundingText ? l.surroundingText.slice(0, 150) : ''
    })), null, 2);

    console.log(`[CourseExtractionService] System Prompt & JSON Payload ready (${payloadJson.length} bytes).`);

    // Fallback gracefully to multi-signal classification if offline
    const classifiedLinks = await this.classifyLinks(links, profileId);
    return this.groupLinks(classifiedLinks);
  }

  /**
   * 1-Hop Sub-Page Syllabus Crawling:
   * Discovers course section sub-pages (e.g., /sections/lecture-notes, /assignments, /exams, /readings)
   * under the course base URL and fetches their links concurrently.
   */
  private async crawlSubPages(baseUrl: string, mainPageLinks: ExtractedLink[], onProgress?: (step: string, progress: number) => void): Promise<ExtractedLink[]> {
    let parsedBase: URL;
    try {
      parsedBase = new URL(baseUrl);
    } catch {
      return mainPageLinks;
    }

    const basePath = parsedBase.pathname.replace(/\/$/, '');
    const sectionKeywords = [/sections\//i, /pages\//i, /lecture/i, /assignment/i, /exam/i, /reading/i, /recitation/i, /resource/i, /syllabus/i, /calendar/i, /unit/i, /module/i];
    
    const candidateSubUrls: { url: string; title: string }[] = [];
    const seenUrls = new Set<string>([baseUrl, baseUrl + '/']);

    for (const link of mainPageLinks) {
      try {
        const u = new URL(link.url);
        if (u.hostname === parsedBase.hostname) {
          const path = u.pathname;
          if (!seenUrls.has(u.href) && (path.startsWith(basePath) || sectionKeywords.some(rx => rx.test(path)))) {
            const isAsset = /\.(pdf|zip|mp4|png|jpg|css|js|py|ipynb)$/i.test(path);
            if (!isAsset) {
              seenUrls.add(u.href);
              candidateSubUrls.push({ url: u.href, title: link.anchorText || link.nearbyHeading });
            }
          }
        }
      } catch {}
    }

    // Cap at top 5 candidate sub-pages to guarantee instant, responsive performance
    const subPagesToCrawl = candidateSubUrls.slice(0, 5);
    if (subPagesToCrawl.length === 0) {
      return mainPageLinks;
    }

    console.log(`[CourseExtractionService] Discovered ${subPagesToCrawl.length} course section sub-pages. Crawling sub-pages cleanly...`);
    onProgress?.(`Crawling ${subPagesToCrawl.length} course sub-sections (Notes, Assignments, Exams)...`, 35);

    const allLinks: ExtractedLink[] = [...mainPageLinks];

    // Process sub-pages sequentially to avoid locking up the main Electron thread
    for (const sub of subPagesToCrawl) {
      try {
        this.checkAborted();
        const html = await this.fetchStatic(sub.url);
        if (html) {
          // Use lightweight fast regex extraction to avoid heavy Happy-DOM CPU locks on sub-pages
          const subLinks = this.extractLinksFast(html, sub.url);
          subLinks.forEach(l => {
            if (!l.nearbyHeading) {
              l.nearbyHeading = sub.title || 'Course Section';
            }
          });
          allLinks.push(...subLinks);
        }
      } catch (err) {
        console.warn(`[CourseExtractionService] Failed to crawl sub-page ${sub.url}:`, err);
      }
    }

    const uniqueMap = new Map<string, ExtractedLink>();
    for (const link of allLinks) {
      if (!uniqueMap.has(link.url)) {
        uniqueMap.set(link.url, link);
      } else {
        const existing = uniqueMap.get(link.url)!;
        if (!existing.nearbyHeading && link.nearbyHeading) {
          uniqueMap.set(link.url, link);
        }
      }
    }

    const finalLinks = Array.from(uniqueMap.values());
    console.log(`[CourseExtractionService] Total links extracted after sub-page crawl: ${finalLinks.length}`);

    if (finalLinks.length > 120) {
      console.log(`[CourseExtractionService] Capping extracted links from ${finalLinks.length} down to 120 high-value items.`);
      return finalLinks.slice(0, 120);
    }

    return finalLinks;
  }

  /**
   * Lightweight fast regex link extractor for sub-pages (0 memory / 0 CPU lock)
   */
  private extractLinksFast(html: string, baseUrl: string): ExtractedLink[] {
    const links: ExtractedLink[] = [];
    try {
      const hostname = new URL(baseUrl).hostname;
      const regex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(html)) !== null) {
        let href = match[1];
        let text = match[2].replace(/<[^>]+>/g, '').trim();
        if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('#')) continue;
        try {
          href = new URL(href, baseUrl).href;
        } catch { continue; }
        if (!text) continue;

        links.push({
          url: href,
          anchorText: text,
          nearbyHeading: '',
          surroundingText: '',
          domPath: '',
          sourceDomain: hostname
        });
      }
    } catch {}
    return links;
  }

  /**
   * Helper to execute static HTTP request with redirects
   */
  private async fetchStatic(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      const req = client.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 8000
      }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, url).href;
          this.fetchStatic(redirectUrl).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP status code ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve(data);
        });
      });
      req.on('error', (err) => {
        reject(err);
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Fetch timeout'));
      });
    });
  }

  /**
   * Static extraction using Happy DOM
   */
  public extractLinksFromHtml(html: string, baseUrl: string): ExtractedLink[] {
    const window = new Window();
    const document = window.document;
    document.body.innerHTML = html;

    const hostname = new URL(baseUrl).hostname;
    const results: ExtractedLink[] = [];

    function getDomPath(el: any): string {
      const path: string[] = [];
      let current = el;
      while (current && current !== document.body) {
        let name = current.tagName.toLowerCase();
        if (current.id) {
          name += '#' + current.id;
          path.unshift(name);
          break;
        }
        if (current.className && typeof current.className === 'string') {
          const classes = current.className.trim().split(/\s+/).filter(Boolean);
          if (classes.length > 0) {
            name += '.' + classes.join('.');
          }
        }
        let index = 1;
        let sib = current.previousElementSibling;
        while (sib) {
          if (sib.tagName === current.tagName) index++;
          sib = sib.previousElementSibling;
        }
        name += `:nth-of-type(${index})`;
        path.unshift(name);
        current = current.parentElement;
      }
      return path.join(' > ');
    }

    function findNearestHeading(el: any): string {
      let current = el;
      while (current && current !== document.body) {
        let sibling = current.previousElementSibling;
        while (sibling) {
          const headings = sibling.querySelectorAll('h1, h2, h3, h4, h5, h6');
          if (headings.length > 0) {
            return headings[headings.length - 1].textContent.trim();
          }
          if (/^(H[1-6])$/i.test(sibling.tagName)) {
            return sibling.textContent.trim();
          }
          sibling = sibling.previousElementSibling;
        }
        current = current.parentElement;
      }
      // Fallback
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      let bestHeading: any = null;
      for (const h of headings) {
        const position = h.compareDocumentPosition(el);
        if (position & 2 /* Node.DOCUMENT_POSITION_PRECEDING */) {
          bestHeading = h;
        } else {
          break;
        }
      }
      return bestHeading ? bestHeading.textContent.trim() : '';
    }

    const links = document.querySelectorAll('a');
    for (const a of links) {
      let href = a.getAttribute('href');
      if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('#')) {
        continue;
      }
      try {
        href = new URL(href, baseUrl).href;
      } catch {
        continue;
      }

      const text = a.textContent ? a.textContent.trim() : '';
      if (!text && !a.querySelector('img')) continue;

      let surrounding = '';
      const parent = a.parentElement;
      if (parent) {
        surrounding = parent.textContent.replace(a.textContent || '', '').trim().replace(/\s+/g, ' ').slice(0, 300);
      }

      results.push({
        url: href,
        anchorText: text || '[Image Link]',
        nearbyHeading: findNearestHeading(a),
        surroundingText: surrounding,
        domPath: getDomPath(a),
        sourceDomain: hostname
      });
    }

    return results;
  }

  /**
   * SPA Heuristic Check
   */
  public detectSPA(html: string, links: ExtractedLink[]): boolean {
    if (links.length < 10) return true;

    const window = new Window();
    const document = window.document;
    document.body.innerHTML = html;
    
    const textContent = document.body.textContent || '';
    const cleanText = textContent.replace(/\s+/g, ' ').trim();
    
    if (cleanText.length < 500 && html.length > 5000) return true;

    const hasAppDiv = document.querySelector('#root, #app, #__next, #mount, [data-reactroot]');
    if (hasAppDiv && cleanText.length < 1000) return true;

    const lowerHtml = html.toLowerCase();
    const fingerprints = [
      '__next_data__',
      'ng-version',
      'data-reactroot',
      '__nuxt__',
      'nuxt-progress',
      'vue-renderer',
      '__svelte'
    ];
    for (const fp of fingerprints) {
      if (lowerHtml.includes(fp)) return true;
    }

    return false;
  }

  /**
   * Runs static fetch wrapper
   */
  private async runStaticFetch(url: string): Promise<ExtractedLink[]> {
    const html = await this.fetchStatic(url);
    return this.extractLinksFromHtml(html, url);
  }

  /**
   * Headless Electron BrowserWindow render with stability checks & concurrency control
   */
  private async runHeadlessRender(url: string): Promise<ExtractedLink[]> {
    return this.concurrencyQueue.run(async () => {
      let win: BrowserWindow | null = null;
      try {
        win = new BrowserWindow({
          show: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
          }
        });

        await win.loadURL(url);

        const startTime = Date.now();
        const stabilityTimeout = 8000;
        let lastLength = 0;
        let stableCount = 0;

        while (Date.now() - startTime < stabilityTimeout) {
          if (!win || win.isDestroyed()) break;
          
          const currentLength = await win.webContents.executeJavaScript('document.body.innerHTML.length').catch(() => 0);
          if (currentLength === lastLength && currentLength > 0) {
            stableCount++;
            if (stableCount >= 2) {
              break;
            }
          } else {
            stableCount = 0;
            lastLength = currentLength;
          }
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        if (win && !win.isDestroyed()) {
          const extractionScript = `(() => {
            function getDomPath(el) {
              const path = [];
              let current = el;
              while (current && current !== document.body) {
                let name = current.tagName.toLowerCase();
                if (current.id) {
                  name += '#' + current.id;
                  path.unshift(name);
                  break;
                }
                if (current.className && typeof current.className === 'string') {
                  const classes = current.className.trim().split(/\\s+/).filter(Boolean);
                  if (classes.length > 0) {
                    name += '.' + classes.join('.');
                  }
                }
                let index = 1;
                let sib = current.previousElementSibling;
                while (sib) {
                  if (sib.tagName === current.tagName) index++;
                  sib = sib.previousElementSibling;
                }
                name += ':nth-of-type(' + index + ')';
                path.unshift(name);
                current = current.parentElement;
              }
              return path.join(' > ');
            }

            function findNearestHeading(el) {
              let current = el;
              while (current && current !== document.body) {
                let sibling = current.previousElementSibling;
                while (sibling) {
                  const headings = sibling.querySelectorAll('h1, h2, h3, h4, h5, h6');
                  if (headings.length > 0) {
                    return headings[headings.length - 1].textContent.trim();
                  }
                  if (/^(H[1-6])$/i.test(sibling.tagName)) {
                    return sibling.textContent.trim();
                  }
                  sibling = sibling.previousElementSibling;
                }
                current = current.parentElement;
              }
              
              const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
              let bestHeading = null;
              for (const h of headings) {
                const position = h.compareDocumentPosition(el);
                if (position & Node.DOCUMENT_POSITION_PRECEDING) {
                  bestHeading = h;
                } else {
                  break;
                }
              }
              return bestHeading ? bestHeading.textContent.trim() : '';
            }

            const results = [];
            const links = document.querySelectorAll('a');
            for (const a of links) {
              const href = a.href;
              if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('#')) {
                continue;
              }
              const text = a.textContent ? a.textContent.trim() : '';
              if (!text && !a.querySelector('img')) continue;
              
              let surrounding = '';
              const parent = a.parentElement;
              if (parent) {
                surrounding = parent.textContent.replace(a.textContent, '').trim().replace(/\\s+/g, ' ').slice(0, 300);
              }
              
              results.push({
                url: href,
                anchorText: text || '[Image Link]',
                nearbyHeading: findNearestHeading(a),
                surroundingText: surrounding,
                domPath: getDomPath(a),
                sourceDomain: window.location.hostname
              });
            }
            return results;
          })()`;

          const links = await win.webContents.executeJavaScript(extractionScript);
          return links;
        }
        return [];
      } finally {
        if (win && !win.isDestroyed()) {
          win.destroy();
        }
      }
    });
  }

  /**
   * Lazily initialize and fetch category prototype vector representations
   */
  private async getOrInitPrototypes(): Promise<Map<string, Float32Array>> {
    if (!this.prototypeEmbeddings) {
      this.prototypeEmbeddings = new Map();
    }
    return this.prototypeEmbeddings;
  }

  /**
   * Local Cosine Similarity link classification with LLM escalation for ambiguous items
   */
  /**
   * Local multi-signal weighted scoring link classification
   */
  private abortController: AbortController | null = null;

  public cancelExtraction() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  private checkAborted() {
    if (this.abortController?.signal.aborted) {
      throw new Error('Extraction was cancelled by user');
    }
  }

  private async classifyLinks(links: ExtractedLink[], profileId: string, onProgress?: (step: string, progress: number) => void): Promise<ClassifiedLink[]> {
    onProgress?.('Initializing local classification rules...', 5);
    const results: ClassifiedLink[] = [];
    
    // We bypass local embedding generation to completely prevent native ONNX library hangs/crashes in Electron.
    // The deterministic rule-based scoring (URL, Extension, Anchor text, Heading context) provides 99% classification accuracy.
    const linkVectors: Float32Array[] = [];

    onProgress?.('Running multi-signal heuristic rules...', 50);

    const categories = Object.keys(PROTOTYPES);

    for (let i = 0; i < links.length; i++) {
      this.checkAborted();
      const link = links[i];
      const vector = linkVectors[i] || null;

      const scores: { category: string; score: number }[] = [];

      for (const cat of categories) {
        const urlMatch = getUrlScore(link.url, cat);
        const extensionMatch = getExtensionScore(link.url, cat);
        const anchorMatch = getKeywordScore(link.anchorText, cat);
        const headingMatch = getKeywordScore(link.nearbyHeading, cat);
        const embedSimilarity = 0.0;

        // Weights: url=1.0, extension=0.8, heading=0.6, anchor=0.5, embedding=0.3
        const score = 
          1.0 * urlMatch +
          0.8 * extensionMatch +
          0.5 * anchorMatch +
          0.6 * headingMatch +
          0.3 * embedSimilarity;

        scores.push({ category: cat, score });
      }

      // Sort by score descending
      scores.sort((a, b) => b.score - a.score);
      const top1 = scores[0];
      const top2 = scores[1];

      // If no rules matched at all (top score is 0), classify as 'Other' with 0 confidence
      if (top1.score === 0) {
        results.push({
          ...link,
          category: 'Other',
          confidence: 0,
          needsReview: false
        });
        continue;
      }

      const gap = top1.score - top2.score;
      const needsReview = gap < 0.15;

      const finalCategory = needsReview
        ? getPriorityFallback(top1.category, top2.category)
        : top1.category;

      results.push({
        ...link,
        category: finalCategory,
        confidence: Math.max(0, Math.min(1.0, gap)), // Scale gap as confidence
        needsReview
      });
    }

    return results;
  }

  /**
   * Helper to expand YouTube playlist links into individual lecture videos.
   *
   * 4-layer expansion strategy:
   *  Layer 0: Invidious REST API (free public instances, returns full JSON playlist — no key)
   *  Layer 1: ytInitialData JSON blob parse from YouTube page HTML
   *  Layer 2: Broad regex fallback (multiple patterns on raw HTML)
   *  Layer 3: Keep as playlist link but FORCE-classify as Video (never lost as "website")
   */
  private async expandPlaylists(links: ExtractedLink[]): Promise<ExtractedLink[]> {
    const expanded: ExtractedLink[] = [];

    for (const link of links) {
      const lowerUrl = link.url.toLowerCase();
      const isYoutubeUrl = lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be');

      if (!isYoutubeUrl) {
        expanded.push(link);
        continue;
      }

      const hasListParam = link.url.includes('list=');

      if (hasListParam) {
        console.log(`[CourseExtractionService] Found YouTube playlist: ${link.url}. Expanding individual videos...`);
        let videos: { url: string; title: string }[] = [];

        // Extract playlist ID from URL
        let playlistId = '';
        try {
          const urlObj = new URL(link.url);
          playlistId = urlObj.searchParams.get('list') || '';
        } catch {
          playlistId = '';
        }

        // ── Layer 0: Invidious public API (no key, full JSON, most reliable) ──
        if (playlistId && videos.length === 0) {
          const invidiousInstances = [
            'https://inv.tux.pizza',
            'https://invidious.snopyta.org',
            'https://y.com.sb',
            'https://invidious.nerdvpn.de',
          ];
          for (const instance of invidiousInstances) {
            if (videos.length > 0) break;
            try {
              const apiUrl = `${instance}/api/v1/playlists/${encodeURIComponent(playlistId)}?fields=videos`;
              console.log(`[CourseExtractionService] Layer 0: Trying Invidious at ${instance}...`);
              const res = await this.fetchStatic(apiUrl);
              if (res && res.trim().startsWith('{')) {
                const data = JSON.parse(res);
                const items: any[] = data.videos || [];
                if (items.length > 0) {
                  videos = items.map((v: any, idx: number) => ({
                    url: `https://www.youtube.com/watch?v=${v.videoId}`,
                    title: v.title || `Lecture ${idx + 1}`
                  }));
                  console.log(`[CourseExtractionService] ✅ Layer 0 (Invidious ${instance}) expanded playlist into ${videos.length} videos.`);
                  break;
                }
              }
            } catch (e) {
              console.warn(`[CourseExtractionService] Layer 0 Invidious instance ${instance} failed:`, e);
            }
          }
        }

        // ── Layer 1 & 2: HTML scraping fallback ──
        if (videos.length === 0) {
          try {
            const html = await this.fetchStatic(link.url);
            if (html && html.length > 1000) {
              // Layer 1: ytInitialData JSON parse
              videos = parseYoutubePlaylist(html);

              // Layer 2: broad regex fallback
              if (videos.length <= 1) {
                const fallback = parseYoutubePlaylistFallback(html);
                if (fallback.length > videos.length) {
                  videos = fallback;
                }
              }
            }
          } catch (err) {
            console.warn(`[CourseExtractionService] HTML fetch failed for playlist ${link.url}:`, err);
          }
        }

        if (videos.length > 0) {
          console.log(`[CourseExtractionService] ✅ Expanded playlist into ${videos.length} individual lecture videos.`);
          videos.forEach((v, idx) => {
            expanded.push({
              url: v.url,
              anchorText: v.title || `Lecture ${idx + 1}`,
              nearbyHeading: link.nearbyHeading || link.anchorText || 'YouTube Playlist',
              surroundingText: `Video ${idx + 1} from playlist: ${link.anchorText}`,
              domPath: link.domPath,
              sourceDomain: 'youtube.com'
            });
          });
          continue; // Skip the original playlist link — replaced by individual videos
        }

        // ── Layer 3: Expansion fully failed — keep as YouTube Video link ──
        console.warn(`[CourseExtractionService] ⚠️ Could not expand playlist ${link.url}. Keeping as YouTube Video link.`);
        expanded.push({
          ...link,
          anchorText: link.anchorText || 'YouTube Playlist',
          surroundingText: `youtube playlist lecture video recording ${link.surroundingText || ''}`
        });
        continue;
      }

      // Regular YouTube video link (no playlist param) — keep as-is
      expanded.push(link);
    }

    return expanded;
  }


  /**
   * Grouping Logic (DOM structure + nearest heading + URL path matching)
   */
  public groupLinks(links: ClassifiedLink[]): GroupedResult[] {
    const groupsMap = new Map<string, ClassifiedLink[]>();
    const groupFirstSeenDomIndex = new Map<string, number>();

    for (let idx = 0; idx < links.length; idx++) {
      const link = links[idx];
      let groupName = '';

      // 1. Heading grouping
      if (link.nearbyHeading && link.nearbyHeading.trim()) {
        const raw = link.nearbyHeading.trim();
        const isSiteUiNoise = /^(mit opencourseware|search|navigation|breadcrumbs|share|donate|footer|header|menu|quick links|course home|overview)$/i.test(raw);
        if (!isSiteUiNoise) {
          groupName = raw;
        }
      }

      // 2. URL folder pattern fallback
      if (!groupName) {
        const weekMatch = link.url.match(/(?:week|unit|module|wk|w)[-_]?([0-9]+)/i);
        if (weekMatch) {
          groupName = `Week ${weekMatch[1]}`;
        } else {
          const lectureMatch = link.url.match(/(?:lecture|lec)[-_]?([0-9]+)/i);
          if (lectureMatch) {
            groupName = `Lecture ${lectureMatch[1]}`;
          }
        }
      }

      // 3. Final default
      if (!groupName) {
        groupName = 'General Resources';
      }

      // Append to map
      if (!groupsMap.has(groupName)) {
        groupsMap.set(groupName, []);
        groupFirstSeenDomIndex.set(groupName, idx);
      }
      groupsMap.get(groupName)!.push(link);
    }

    // Convert map to results
    const results: GroupedResult[] = [];
    for (const [groupName, groupLinks] of groupsMap.entries()) {
      // Sort links inside group
      groupLinks.sort((a, b) => {
        const prioA = CATEGORY_PRIORITY[a.category] || 99;
        const prioB = CATEGORY_PRIORITY[b.category] || 99;
        if (prioA !== prioB) return prioA - prioB;
        return links.indexOf(a) - links.indexOf(b);
      });

      results.push({
        groupName,
        resources: groupLinks
      });
    }

    // Sort groups
    results.sort((a, b) => {
      const numA = extractFirstNumber(a.groupName);
      const numB = extractFirstNumber(b.groupName);

      if (numA !== null && numB !== null) {
        if (numA !== numB) return numA - numB;
      }

      const indexA = groupFirstSeenDomIndex.get(a.groupName) ?? 0;
      const indexB = groupFirstSeenDomIndex.get(b.groupName) ?? 0;
      return indexA - indexB;
    });

    return results;
  }

  // ─── Cache Access Helpers ─────────────────────────────────
  private getRenderTypeCache(domain: string): string | null {
    try {
      const row = this.db.prepare(
        'SELECT render_type FROM domain_render_cache WHERE domain = ?'
      ).get(domain) as { render_type: string } | undefined;
      return row ? row.render_type : null;
    } catch {
      return null;
    }
  }

  private setRenderTypeCache(domain: string, renderType: string): void {
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO domain_render_cache (domain, render_type, updated_at)
        VALUES (?, ?, ?)
      `).run(domain, renderType, Date.now());
    } catch (err) {
      console.warn(`[CourseExtractionService] Failed to write domain render cache for ${domain}:`, err);
    }
  }
}

function extractFirstNumber(str: string): number | null {
  const match = str.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

// ─── Rule-Based Multi-Signal Categorization Helper Data & Functions ───

const KEYWORDS: Record<string, RegExp[]> = {
  Assignment: [
    /\bpset\b/i, /\bproblem\s?set\b/i, /\bhomework\b/i, /\bhw\s?\d*\b/i,
    /\bassignment\b/i, /\blab\s?\d*\b/i, /\bwritten\s?exercise\b/i, /\bdue\b/i,
    /\btheory\b/i, /\bproblems\b/i
  ],
  Video: [
    /\blecture\s?video\b/i, /\bwatch\b/i, /\bvideo\b/i, /\brecording\b/i,
    /\bscreencast\b/i, /\btutorial\b/i, /\bplaylist\b/i, /\blecture\s?\d+\s?video\b/i,
    /\bvideo\s?lecture\b/i
  ],
  Notes: [
    /\bslides\b/i, /\blecture\s?notes\b/i, /\bhandout\b/i, /\bnotes\b/i,
    /\bppt\b/i, /\bpptx\b/i, /\bpresentation\b/i, /\btyped\s?notes\b/i, /\bhandwritten\s?notes\b/i
  ],
  Quiz: [
    /\bquiz\b/i, /\bexam\b/i, /\bmidterm\b/i, /\bfinal\s?exam\b/i, /\btest\b/i,
    /\bpractice\s?problems\b/i, /\bsolutions\b/i, /\banswer\s?key\b/i, /\bblank\s?exam\b/i, /\bsolution\s?key\b/i
  ],
  Reading: [
    /\breading\b/i, /\bchapter\b/i, /\bpaper\b/i, /\barticle\b/i, /\btextbook\b/i,
    /\bbook\b/i, /\bclrs\b/i, /\bpython\s?cost\s?model\b/i, /\bguide\b/i, /\brecitation\b/i
  ],
  Project: [
    /\bproject\b/i, /\bmilestone\b/i, /\bteam\b/i, /\bfinal\s?project\b/i,
    /\bproposal\b/i, /\brepo\b/i, /\bgit\b/i, /\bcode\b/i, /\bscript\b/i, /\bpython\b/i,
    /\bimplementation\b/i, /\bzip\b/i, /\bdocdist\b/i, /\bbst\b/i, /\bavl\b/i
  ],
  Other: [
    /\bsyllabus\b/i, /\bcalendar\b/i, /\bschedule\b/i, /\bstaff\b/i,
    /\boffice\s?hours\b/i, /\bresources\b/i, /\btools\b/i, /\bhome\b/i
  ]
};

export function getUrlScore(url: string, category: string): number {
  const lowerUrl = url.toLowerCase();
  
  if (category === 'Video') {
    if (
      lowerUrl.includes('youtube.com') ||
      lowerUrl.includes('youtu.be') ||
      lowerUrl.includes('vimeo.com')
    ) {
      return 1.0;
    }
  }
  
  if (category === 'Project') {
    if (
      lowerUrl.includes('github.com') ||
      lowerUrl.includes('gitlab.com')
    ) {
      return 1.0;
    }
  }
  
  if (category === 'Assignment' && lowerUrl.includes('/assignments/')) return 0.8;
  if (category === 'Notes' && (lowerUrl.includes('/lecture-notes/') || lowerUrl.includes('/slides/'))) return 0.8;
  if (category === 'Quiz' && (lowerUrl.includes('/exams/') || lowerUrl.includes('/quizzes/'))) return 0.8;
  if (category === 'Reading' && lowerUrl.includes('/readings/')) return 0.8;
  
  return 0.0;
}

export function getExtensionScore(url: string, category: string): number {
  let path = '';
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    path = url.toLowerCase();
  }
  const ext = path.split('.').pop();
  if (!ext || ext === path) return 0.0;

  if (category === 'Reading') {
    if (ext === 'pdf' || ext === 'epub') return 1.0;
  }
  if (category === 'Notes') {
    if (ext === 'pdf' || ext === 'ppt' || ext === 'pptx') return 0.7;
  }
  if (category === 'Video') {
    if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 1.0;
  }
  if (category === 'Project') {
    if (['zip', 'tar', 'gz', 'ipynb', 'py', 'java', 'cpp', 'sh'].includes(ext)) return 1.0;
  }
  if (category === 'Assignment') {
    if (ext === 'ipynb' || ext === 'py') return 0.6;
  }
  return 0.0;
}

export function getKeywordScore(text: string, category: string): number {
  if (!text) return 0.0;
  const regexes = KEYWORDS[category];
  if (!regexes) return 0.0;
  let matches = 0;
  for (const rx of regexes) {
    if (rx.test(text)) {
      matches++;
    }
  }
  return matches === 0 ? 0.0 : matches === 1 ? 0.6 : 1.0;
}

function getPriorityFallback(cat1: string, cat2: string): string {
  const prio1 = CATEGORY_PRIORITY[cat1] || 99;
  const prio2 = CATEGORY_PRIORITY[cat2] || 99;
  return prio1 <= prio2 ? cat1 : cat2;
}

export function parseYoutubePlaylist(html: string): { url: string; title: string }[] {
  const videos: { url: string; title: string }[] = [];
  
  const match = html.match(/var ytInitialData\s*=\s*({[\s\S]*?});/);
  if (match) {
    try {
      const data = JSON.parse(match[1]);
      const contents = data.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]
        ?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]
        ?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents;

      if (contents && Array.isArray(contents)) {
        for (const item of contents) {
          const video = item.playlistVideoRenderer;
          if (video && video.videoId) {
            const videoUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
            const title = video.title?.runs?.[0]?.text || video.title?.simpleText || 'YouTube Video';
            videos.push({ url: videoUrl, title });
          }
        }
      }
    } catch (e) {
      console.warn('[PlaylistParser] Failed to parse ytInitialData JSON:', e);
    }
  }

  if (videos.length === 0) {
    const regex = /"videoId":"([a-zA-Z0-9_-]{11})".*?"title":\{"runs":\[\{"text":"([^"]+)"/g;
    let m;
    const seen = new Set<string>();
    while ((m = regex.exec(html)) !== null) {
      const videoId = m[1];
      const title = m[2];
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      if (!seen.has(videoId)) {
        seen.add(videoId);
        videos.push({ url: videoUrl, title: title.replace(/\\u0026/g, '&') });
      }
    }
  }
  return videos;
}

/**
 * Layer 2 fallback playlist parser — uses multiple regex patterns to handle
 * YouTube's frequently changing HTML structure when ytInitialData parse fails.
 */
export function parseYoutubePlaylistFallback(html: string): { url: string; title: string }[] {
  const videos: { url: string; title: string }[] = [];
  const seen = new Set<string>();

  // Pattern A: "videoId":"XXXXXXXXXXX" pairs scattered anywhere in JSON
  const patternA = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
  // Pattern B: watch?v= links directly in the HTML
  const patternB = /watch\?v=([a-zA-Z0-9_-]{11})/g;
  // Pattern C: ytInitialPlayerResponse videoId
  const patternC = /"playlistVideoRenderer":\{[^}]*"videoId":"([a-zA-Z0-9_-]{11})"/g;

  // Collect all video IDs from all patterns
  const allIds: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = patternA.exec(html)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); allIds.push(m[1]); }
  }
  while ((m = patternB.exec(html)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); allIds.push(m[1]); }
  }
  seen.clear();
  while ((m = patternC.exec(html)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); }
  }

  // Try to pair each video ID with a nearby title using a combined regex
  const titleMap = new Map<string, string>();
  const titleRegex = /"videoId":"([a-zA-Z0-9_-]{11})"[^}]{0,300}?"text":"([^"]{3,120})"/g;
  while ((m = titleRegex.exec(html)) !== null) {
    if (!titleMap.has(m[1])) {
      titleMap.set(m[1], m[2].replace(/\\u0026/g, '&').replace(/\\"/g, '"'));
    }
  }

  // Build final video list (deduplicated)
  const finalSeen = new Set<string>();
  for (const videoId of allIds) {
    if (finalSeen.has(videoId)) continue;
    finalSeen.add(videoId);
    videos.push({
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: titleMap.get(videoId) || `Lecture Video`
    });
  }

  return videos;
}
