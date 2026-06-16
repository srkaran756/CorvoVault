/**
 * tocDetector.ts — Page-level Table of Contents detection.
 *
 * Identifies pages that are TOC, front-matter, or too sparse to contain
 * retrievable prose. Used by the RAG indexer to skip these pages before
 * chunking so the embedding index only contains real book content.
 *
 * NOTE: The per-line isTocLine() in ingestionQueue.ts is a *chunk-level*
 * tag used to mark individual heading chunks that happen to look like TOC
 * rows. This function is a *page-level* gate applied before any chunking.
 */

// Matches either:
//   (a) Numbered section header ending with a page number:
//       "3.1 Tactical Programming ............... 42"  or  "3.1 Tactical Programming 42"
//   (b) Numbered section header without a page number (bare TOC entry):
//       "3.1 Tactical Programming"
const TOC_LINE_PATTERN =
  /^\s*\d+(\.\d+)*\s+[A-Z][^\n]{2,60}\.{2,}?\s*\d+\s*$|^\s*\d+(\.\d+)*\s+[A-Z][^\n]{2,60}\s*$/;

// If >55% of non-empty lines match the TOC pattern, treat the whole page as TOC.
const MIN_TOC_LINE_RATIO = 0.55;

// Pages with fewer than 40 words total are covers, blanks, part-title pages, etc.
// They contain nothing useful to embed, so skip them too.
const MIN_PROSE_WORD_COUNT = 40;

/**
 * Returns true if the page text looks like a Table of Contents page,
 * a front-matter page (cover, blank, title), or is too sparse to be prose.
 *
 * @param pageText  Reconstructed plain text of the page (items joined with '\n')
 */
export function isTOCPage(pageText: string): boolean {
  const text = pageText.trim();

  // Blank page
  if (!text) return true;

  // Word-count gate: covers, blanks, part dividers have almost no words
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < MIN_PROSE_WORD_COUNT) return true;

  // Line-ratio gate: is the majority of this page TOC-style lines?
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return true;

  const tocLineCount = lines.filter(l => TOC_LINE_PATTERN.test(l.trim())).length;
  return (tocLineCount / lines.length) >= MIN_TOC_LINE_RATIO;
}
