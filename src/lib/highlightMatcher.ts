/**
 * highlightMatcher.ts — Fuse.js-powered fuzzy targetText matching.
 *
 * Used as a supplementary tier in the PDF annotation highlight pipeline.
 * When the exact-match and sliding-window tiers in findRectsForTextCV
 * both fail (e.g. ligature differences, hyphenation, OCR-style spacing),
 * this function finds the best-matching text item using Fuse.js fuzzy search
 * and returns its index so the caller can build a bounding rect from it.
 *
 * This is intentionally narrow-scoped: it returns a { startIndex, endIndex }
 * tuple pointing into the processedItems array, not actual DOM rects.
 * The caller maps that back to screen coordinates using existing infrastructure.
 */

import Fuse from 'fuse.js';

export interface TextItemLike {
  str: string;
  [key: string]: any;
}

/**
 * Uses Fuse.js to find the best matching text item for a given targetText.
 *
 * @param targetText   The text the LLM wanted to highlight
 * @param items        The page's text items (processedItems or similar)
 * @param threshold    Fuse.js threshold (0 = exact, 1 = anything). Default 0.35
 * @returns            { startIndex, endIndex } into items, or null if no match found
 */
export function findFuzzyTargetItem(
  targetText: string,
  items: TextItemLike[],
  threshold = 0.35
): { startIndex: number; endIndex: number } | null {
  if (!targetText || items.length === 0) return null;

  // Build a combined-string corpus: join adjacent items into sliding windows
  // to give Fuse.js multi-item spans to search through.
  const WINDOW_SIZE = 8; // items to join per candidate span
  const candidates: { text: string; startIdx: number; endIdx: number }[] = [];

  for (let i = 0; i < items.length; i++) {
    const windowItems = items.slice(i, Math.min(i + WINDOW_SIZE, items.length));
    const combined = windowItems.map(it => it.str || '').join(' ').trim();
    if (combined.length < 3) continue;
    candidates.push({
      text: combined,
      startIdx: i,
      endIdx: Math.min(i + WINDOW_SIZE - 1, items.length - 1),
    });
  }

  if (candidates.length === 0) return null;

  const fuse = new Fuse(candidates, {
    keys: ['text'],
    threshold,
    minMatchCharLength: Math.min(6, Math.floor(targetText.length * 0.4)),
    includeScore: true,
    // Use full string distance for longer targets — Fuse.js 'distance' setting
    // controls how far from the start of the string the pattern can appear.
    distance: 300,
    ignoreLocation: true,
  });

  const results = fuse.search(targetText);
  if (!results.length) return null;

  // Accept only matches that are genuinely similar (low Fuse score = good)
  const best = results[0];
  if ((best.score ?? 1) > threshold) return null;

  return {
    startIndex: best.item.startIdx,
    endIndex: best.item.endIdx,
  };
}
