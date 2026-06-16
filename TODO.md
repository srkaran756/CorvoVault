# TODO - PDF selection engine upgrade (copy / selection / highlights)

## Step 1: Understand current behavior
- [x] Read `src/lib/pdfSelectionEngine.ts`
- [x] Read `src/components/tabs/CustomPdfViewer.tsx`
- [x] Read `src/components/tabs/DocumentViewer.tsx` (confirm usage path)

## Step 2: Implement engine improvements
- [ ] Optimize per-character width offset calculation
  - Replace O(n²) substring measuring with incremental/cumulative measurement
  - Keep cache behavior but reduce thrash by improving cache key + computation
- [ ] Improve hit-tested drag stability / ordering
  - Ensure normalized start/end use a more “visual reading order” approach
  - Reduce reversed start/end issues when dragging across columns/lines
- [ ] Improve copied text formatting
  - Use spatial (y/x) heuristics for newline/space decisions
  - Handle punctuation/spacing better to avoid “word-join” or “stuck together” paste artifacts
- [ ] Improve highlight rectangle rendering
  - Merge contiguous rect slices that belong to the same visual line
  - Reduce chunky highlight blocks and gaps between adjacent slices

## Step 3: Wire minimal viewer adjustments (only if needed)
- [ ] If flicker persists, adjust CustomPdfViewer integration:
  - prevent selection point thrashing during mousemove
  - ensure rect + text assembly use consistent page dimensions

## Step 4: Validation
- [ ] Manual QA checklist
  - [ ] Single column copy across multiple lines
  - [ ] Double column drag selection copy order
  - [ ] Double click word selection boundaries
  - [ ] Highlights (highlight/underline/strike) look continuous per line
  - [ ] RTL / rotated text sanity check (where present)
  - [ ] Performance: drag selection remains responsive
