/**
 * tocDetector.ts — Page-level Table of Contents detection.
 */

const TOC_LINE_PATTERN =
  /^\s*\d+(\.\d+)*\s+[A-Z][^\n]{2,60}\.{2,}?\s*\d+\s*$|^\s*\d+(\.\d+)*\s+[A-Z][^\n]{2,60}\s*$/;

const MIN_TOC_LINE_RATIO = 0.55;
const MIN_PROSE_WORD_COUNT = 40;

export function isTOCPage(pageText: string): boolean {
  const text = pageText.trim();
  if (!text) return true;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < MIN_PROSE_WORD_COUNT) return true;

  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return true;

  const tocLineCount = lines.filter(l => TOC_LINE_PATTERN.test(l.trim())).length;
  return (tocLineCount / lines.length) >= MIN_TOC_LINE_RATIO;
}
