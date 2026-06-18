export interface CustomSelectionPoint {
  itemIndex: number; // Index in processedTextItemsRef.current
  charIndex: number; // Character index in the item's string
}

export interface ProcessedTextItem {
  item: {
    str: string;
    dir: string;
    width: number;
    height: number;
    transform: number[];
  };
  transform: number[];
  fontHeight: number;
  angle: number;
  left: number;
  top: number;
  width: number;
  fontFamily?: string; // New Font Family metadata
  columnIndex?: number;
  lineGroupId?: number; // Visual line group identifier
}

/**
 * Spatial band for fast hit-testing: divides page into horizontal bands
 */
export interface SpatialBand {
  yMin: number;
  yMax: number;
  itemIndices: number[];
}

/**
 * Per-page cached statistical profile derived from text item measurements.
 * Replaces all hardcoded thresholds with values computed from actual page content.
 */
export interface PageProfile {
  medianFontHeight: number;
  medianLineGap: number; // median y-diff between items on "same line"
  gutterX: number | null; // null = single column, otherwise = center x of gutter
  columnCount: number;
  isDoubleColumn: boolean;
  isTableLayout: boolean;
  fullWidthThreshold: number; // p90 of item width ratios to page width
  headerYThreshold: number; // top 15% of page height
  footerYThreshold: number; // bottom 15% of page height
  spatialBands: SpatialBand[];
  lineGroups: Map<number, number>; // itemIndex -> lineGroupId
  pageWidth: number;
  pageHeight: number;
}

const DEFAULT_HIT_PADDING = 6;

// WeakMap-based cache for PageProfile, keyed by the items array reference
export const profileCache = new WeakMap<ProcessedTextItem[], PageProfile>();

/**
 * Retrieves or computes the cached PageProfile for a set of text items.
 * Internal helper: if profile doesn't exist, computes and caches it.
 */
export function ensureProfile(
  items: ProcessedTextItem[],
  pageWidth: number,
  pageHeight: number
): PageProfile {
  if (!profileCache.has(items)) {
    const profile = computePageProfile(items, pageWidth, pageHeight);
    profileCache.set(items, profile);
  }
  return profileCache.get(items)!;
}

/**
 * Pure helper: compute all Y-differences between items on "same line"
 * (horizontal overlap within columnWidth * 0.4).
 */
function computeLineGaps(items: ProcessedTextItem[]): number[] {
  const fontHeights = items.map(i => i.fontHeight).sort((a, b) => a - b);
  const medFontHeight = fontHeights.length > 0 ? fontHeights[Math.floor(fontHeights.length / 2)] : 12;
  const pageWidth = Math.max(...items.map(i => i.left + i.width), 100);
  const lineGaps: number[] = [];

  // Sort by top coordinate to enable sliding vertical window
  const sorted = [...items].sort((a, b) => a.top - b.top);

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const yDiff = b.top - a.top;

      // Break early since sorted by top: no subsequent items can be within medFontHeight * 3.0
      if (yDiff >= medFontHeight * 3.0) {
        break;
      }

      if (yDiff > 0) {
        const aCenterX = a.left + a.width / 2;
        const bCenterX = b.left + b.width / 2;
        const xCenterDiff = Math.abs(aCenterX - bCenterX);

        // Only consider items in same general column (within 40% of page width)
        if (xCenterDiff < pageWidth * 0.4) {
          lineGaps.push(yDiff);
        }
      }
    }
  }

  return lineGaps.sort((a, b) => a - b);
}

/**
 * Compute median of a sorted array.
 */
function median(sorted: number[]): number {
  if (sorted.length === 0) return 12;
  if (sorted.length === 1) return sorted[0];
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Compute mean and standard deviation of an array.
 */
function meanAndStdDev(arr: number[]): { mean: number; stdDev: number } {
  if (arr.length === 0) return { mean: 0, stdDev: 0 };
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((a, v) => a + (v - mean) ** 2, 0) / arr.length;
  const stdDev = Math.sqrt(variance);
  return { mean, stdDev };
}

/**
 * Compute the percentile value of an array.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 1;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Build line groups: assigns each item to a lineGroupId based on spatial proximity.
 * Returns array parallel to items where each value is a lineGroupId.
 */
function computeLineGroups(
  items: ProcessedTextItem[],
  profile: PageProfile
): number[] {
  // Sort by reading order: top first, then left (column-aware)
  const sortedIndices = items
    .map((_, i) => i)
    .sort((a, b) => {
      const ya = items[a].top;
      const yb = items[b].top;
      if (Math.abs(ya - yb) > profile.medianFontHeight * 0.6) return ya - yb;
      return items[a].left - items[b].left;
    });

  const groups = new Array(items.length).fill(-1);
  let currentGroup = 0;

  for (let i = 0; i < sortedIndices.length; i++) {
    const idx = sortedIndices[i];
    if (groups[idx] !== -1) continue;

    groups[idx] = currentGroup;
    const item = items[idx];

    // Greedily absorb nearby items into this group
    for (let j = i + 1; j < sortedIndices.length; j++) {
      const otherIdx = sortedIndices[j];
      if (groups[otherIdx] !== -1) continue;
      const other = items[otherIdx];

      const yDiff = Math.abs(other.top - item.top);
      const xOverlap = !(
        other.left + other.width < item.left ||
        other.left > item.left + item.width
      );

      // Multi-signal line detection
      const withinLineHeight = yDiff <= profile.medianFontHeight * 0.65;
      const withinMedianGap = yDiff <= profile.medianLineGap * 1.3;
      const onSameVisualLine =
        xOverlap ||
        (other.columnIndex === item.columnIndex &&
          yDiff <= profile.medianFontHeight * 0.65);

      if (withinLineHeight && withinMedianGap && onSameVisualLine) {
        groups[otherIdx] = currentGroup;
      } else if (yDiff > profile.medianFontHeight * 2) {
        // Too far vertically, stop scanning this group
        break;
      }
    }
    currentGroup++;
  }

  return groups;
}

/**
 * Build spatial bands for fast hit-testing.
 * Divides the page into horizontal bands, each tracking which items inhabit it.
 */
function buildSpatialBands(
  items: ProcessedTextItem[],
  pageHeight: number,
  medianFontHeight: number
): SpatialBand[] {
  const bandHeight = medianFontHeight * 1.5;
  const bandCount = Math.max(1, Math.ceil(pageHeight / bandHeight));
  const bands: SpatialBand[] = Array.from({ length: bandCount }, (_, i) => ({
    yMin: i * bandHeight,
    yMax: (i + 1) * bandHeight,
    itemIndices: [],
  }));

  items.forEach((item, i) => {
    const startBand = Math.floor(item.top / bandHeight);
    const endBand = Math.floor((item.top + item.fontHeight) / bandHeight);
    for (let b = startBand; b <= endBand; b++) {
      if (b >= 0 && b < bands.length) {
        bands[b].itemIndices.push(i);
      }
    }
  });

  return bands;
}

/**
 * Pure function: compute per-page statistical profile from text items.
 * Runs once per page and caches result.
 *
 * **Algorithm:**
 * 1. Compute median font height and median line gap
 * 2. Detect columns via X-clustering (gutter detection)
 * 3. Detect table layout via vertical alignment analysis
 * 4. Compute full-width, header, and footer thresholds
 * 5. Build spatial bands and line groups
 */
function computePageProfile(
  items: ProcessedTextItem[],
  pageWidth: number,
  pageHeight: number
): PageProfile {
  if (items.length === 0) {
    return {
      medianFontHeight: 12,
      medianLineGap: 12,
      gutterX: null,
      columnCount: 1,
      isDoubleColumn: false,
      isTableLayout: false,
      fullWidthThreshold: pageWidth * 0.85,
      headerYThreshold: pageHeight * 0.15,
      footerYThreshold: pageHeight * 0.85,
      spatialBands: [],
      lineGroups: new Map(),
      pageWidth,
      pageHeight,
    };
  }

  // 1. Font metrics
  const fontHeights = items.map(i => i.fontHeight).sort((a, b) => a - b);
  const medianFontHeight = median(fontHeights);

  const lineGaps = computeLineGaps(items);
  const medianLineGap = median(lineGaps);

  // 2. Column detection via X-clustering
  const centerXs = items.map(i => i.left + i.width / 2).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < centerXs.length; i++) {
    gaps.push(centerXs[i] - centerXs[i - 1]);
  }

  // Filter "significant" gaps (not tiny word-spacing)
  const significantGaps = gaps.filter(g => g > medianFontHeight * 1.2);
  const { mean: gapMean, stdDev: gapStdDev } = meanAndStdDev(significantGaps);
  const largestGap = Math.max(...gaps, 0);
  const gutterThreshold = gapMean + 2 * gapStdDev;

  let gutterX: number | null = null;
  let columnCount = 1;
  let isDoubleColumn = false;

  // If largest gap exceeds threshold and is significant, it's a gutter
  if (significantGaps.length > 0 && largestGap > gutterThreshold && largestGap > medianFontHeight * 2) {
    const gutterIdx = gaps.indexOf(largestGap);
    const candidateGutterX = (centerXs[gutterIdx] + centerXs[gutterIdx + 1]) / 2;

    // Gutter must lie in the center area of the page (30% to 70% width) to avoid far-left/right outliers
    if (candidateGutterX > pageWidth * 0.3 && candidateGutterX < pageWidth * 0.7) {
      gutterX = candidateGutterX;

      // Count items on each side
      const leftItems = items.filter(
        i => i.left + i.width / 2 < gutterX!
      );
      const rightItems = items.filter(
        i => i.left + i.width / 2 >= gutterX!
      );

      // Verify it's a real gutter by checking if items physically cross it
      // In a true double column, almost no items should cross the gutter X coordinate.
      const crossingItems = items.filter(
        i => i.left < gutterX! && i.left + i.width > gutterX!
      );

      // New Robust Split-Line Gutter Gap Filter:
      // In a true double-column layout, the visual gap between left and right columns
      // is always a wide gutter (typically > 40px). In a single-column layout with split
      // inline code or diagrams, items on the left and right of the page center are close
      // and represent split sentences.
      let smallGapSplits = 0;
      const leftSplitItems = items.filter(item => item.left + item.width < gutterX!);
      const rightSplitItems = items.filter(item => item.left >= gutterX!);
      
      const sortedLeft = [...leftSplitItems].sort((a, b) => a.top - b.top);
      const sortedRight = [...rightSplitItems].sort((a, b) => a.top - b.top);

      let rightIdx = 0;
      for (const a of sortedLeft) {
        // Advance rightIdx until the right item's top is at least a.top - threshold
        while (rightIdx < sortedRight.length && sortedRight[rightIdx].top < a.top - medianFontHeight * 0.4) {
          rightIdx++;
        }

        // Scan subsequent right items that fall within the vertical window
        for (let k = rightIdx; k < sortedRight.length; k++) {
          const b = sortedRight[k];
          if (b.top - a.top > medianFontHeight * 0.4) {
            break; // Since sortedRight is sorted by top, no further elements can fall in the vertical window
          }

          const xGap = b.left - (a.left + a.width);
          if (xGap > 0 && xGap <= medianFontHeight * 3.0) {
            smallGapSplits++;
          }
        }
      }

      // Calculate the average width of left-side and right-side items
      const leftWidthSum = leftItems.reduce((sum, item) => sum + item.width, 0);
      const leftAvgWidth = leftItems.length > 0 ? leftWidthSum / leftItems.length : 0;
      const leftWidthRatio = leftAvgWidth / pageWidth;

      const rightWidthSum = rightItems.reduce((sum, item) => sum + item.width, 0);
      const rightAvgWidth = rightItems.length > 0 ? rightWidthSum / rightItems.length : 0;
      const rightWidthRatio = rightAvgWidth / pageWidth;

      // Both columns must have substantial text width to be considered real columns.
      // Dynamically scale minimum item counts instead of hardcoding '15' to support lower density pages.
      // Both columns must have substantial text width and be balanced to be considered real academic/magazine columns.
      // Numbered/bulleted lists (where the left "column" is just narrow bullets) or unequal margins are rejected.
      const minColumnItems = Math.max(4, Math.round(items.length * 0.05));
      if (
        crossingItems.length < items.length * 0.05 && 
        smallGapSplits < 3 && 
        leftItems.length >= minColumnItems && 
        rightItems.length >= minColumnItems &&
        leftWidthRatio >= 0.20 &&
        rightWidthRatio >= 0.20 &&
        Math.abs(leftWidthRatio - rightWidthRatio) <= 0.18
      ) {
        isDoubleColumn = true;
        columnCount = 2;
      }
    }
  }

  // 3. Table layout detection
  let isTableLayout = false;
  if (isDoubleColumn && gutterX !== null) {
    const bandHeight = medianFontHeight * 1.5;
    const bandCount = Math.ceil(pageHeight / bandHeight);
    let alignedBands = 0;

    for (let b = 0; b < bandCount; b++) {
      const bandYMin = b * bandHeight;
      const bandYMax = (b + 1) * bandHeight;

      const leftInBand = items.filter(
        i =>
          i.left + i.width / 2 < gutterX! &&
          i.top >= bandYMin &&
          i.top < bandYMax
      );
      const rightInBand = items.filter(
        i =>
          i.left + i.width / 2 >= gutterX! &&
          i.top >= bandYMin &&
          i.top < bandYMax
      );

      // Check vertical alignment within tolerance
      if (leftInBand.length > 0 && rightInBand.length > 0) {
        const leftTop = Math.min(...leftInBand.map(i => i.top));
        const rightTop = Math.min(...rightInBand.map(i => i.top));
        const yTolerance = medianFontHeight * 0.3;

        if (Math.abs(leftTop - rightTop) < yTolerance) {
          alignedBands++;
        }
      }
    }

    const leftItemsCount = items.filter(
      i => i.left + i.width / 2 < gutterX!
    ).length;
    if (leftItemsCount > 0 && alignedBands / Math.max(1, bandCount) > 0.4) {
      isTableLayout = true;
    }
  }

  // 4. Full-width and header/footer thresholds
  const widthRatios = items
    .map(i => i.width / pageWidth)
    .sort((a, b) => a - b);
  const fullWidthThreshold = percentile(widthRatios, 90) || 0.85;

  const headerYThreshold = pageHeight * 0.15;
  const footerYThreshold = pageHeight * 0.85;

  // 5. Build spatial bands and line groups
  const spatialBands = buildSpatialBands(
    items,
    pageHeight,
    medianFontHeight
  );

  // Create profile *before* computing lineGroups to avoid circular dependency
  const profile: PageProfile = {
    medianFontHeight,
    medianLineGap,
    gutterX,
    columnCount,
    isDoubleColumn,
    isTableLayout,
    fullWidthThreshold,
    headerYThreshold,
    footerYThreshold,
    spatialBands,
    lineGroups: new Map(), // Populate below
    pageWidth,
    pageHeight,
  };

  const lineGroupsArray = computeLineGroups(items, profile);
  for (let i = 0; i < lineGroupsArray.length; i++) {
    profile.lineGroups.set(i, lineGroupsArray[i]);
  }

  return profile;
}

// Character offset cache: key = "str|fontFamily|dir", value = normalized offset array [0..1]
const charOffsetCache = new Map<string, number[]>();
const MAX_CACHE_SIZE = 500;

/**
 * Build per-character width offsets for an item using offscreen canvas measurement.
 * Results are cached in normalized space (0..1) to avoid repeated measurements.
 */
function buildCharOffsetMap(item: ProcessedTextItem, ctx: CanvasRenderingContext2D): number[] {
  const family = item.fontFamily || 'sans-serif';
  const cacheKey = `${item.item.str}|${family}|${item.item.dir || 'ltr'}`;
  if (charOffsetCache.has(cacheKey)) return charOffsetCache.get(cacheKey)!;

  // Set font using reference size (100px) and item's actual font family for precision
  ctx.font = `100px ${family}`;

  const s = item.item.str || '';
  const offsets: number[] = new Array(s.length + 1);
  offsets[0] = 0;

  // Incremental cumulative measurement
  let acc = 0;
  for (let i = 0; i < s.length; i++) {
    const w = ctx.measureText(s[i]).width;
    acc += w;
    offsets[i + 1] = acc;
  }

  // Normalize offsets to [0..1] cumulative widths
  const measuredTotal = offsets[offsets.length - 1] || 1;
  const normalizedOffsets = offsets.map(o => o / measuredTotal);

  // Cache with LRU eviction
  if (charOffsetCache.size >= MAX_CACHE_SIZE) {
    const firstKey = charOffsetCache.keys().next().value;
    charOffsetCache.delete(firstKey);
  }
  charOffsetCache.set(cacheKey, normalizedOffsets);

  return normalizedOffsets;
}

/**
 * Retrieves character offset map from cache and scales it to the item's visual width.
 */
export function getCharOffsetMap(item: ProcessedTextItem): number[] {
  // Create or reuse a hidden canvas for text measurement
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas');
    measureCtx = measureCanvas.getContext('2d');
    if (!measureCtx) throw new Error('Cannot create 2D canvas context');
  }
  
  // Retrieve the normalized offset map
  const normalized = buildCharOffsetMap(item, measureCtx!);
  
  // Scale to current zoom-dependent visual width on the fly
  return normalized.map(o => o * item.width);
}

// Hidden canvas for text measurement (module-scoped)
let measureCanvas: HTMLCanvasElement | null = null;
let measureCtx: CanvasRenderingContext2D | null = null;

/**
 * Clusters text items on a page into layout columns to support reading-order selection flows.
 * Detects headers, footers, left, and right columns, and assigns each item a columnIndex.
 * Now uses dynamic profiles instead of hardcoded thresholds.
 */
export function detectAndAssignColumns(items: ProcessedTextItem[], pageWidth: number, pageHeight?: number) {
  const pageH = pageHeight ?? pageWidth;
  const profile = ensureProfile(items, pageWidth, pageH);

  items.forEach((item, i) => {
    const centerX = item.left + item.width / 2;
    const top = item.top;
    const coverage = item.width / pageWidth;

    // 1. Full-width / header / footer classification
    const isFullWidth = coverage > profile.fullWidthThreshold;
    const isHeader = isFullWidth && top < profile.headerYThreshold;
    const isFooter = isFullWidth && top > profile.footerYThreshold;

    if (isHeader) {
      item.columnIndex = -1;
      return;
    }
    if (isFooter) {
      item.columnIndex = 2;
      return;
    }

    // 2. Multi-column assignment
    if (profile.columnCount === 1 || profile.gutterX == null) {
      item.columnIndex = 0;
    } else {
      // Spanning check: if item physically crosses the gutter, it belongs to the spanning flow (columnIndex = 0)
      const crossesGutter = item.left < profile.gutterX && (item.left + item.width) > profile.gutterX;
      
      if (crossesGutter) {
        item.columnIndex = 0;
      } else if (profile.isTableLayout) {
        // Table: assign column by X but reading order is row-major (handled in text assembly)
        item.columnIndex = centerX < profile.gutterX ? 0 : 1;
      } else {
        // Magazine / academic column layout
        item.columnIndex = centerX < profile.gutterX ? 0 : 1;
      }
    }
  });
}

/**
 * Finds the closest character index and text item under the visual mouse coordinates.
 * Works even when the cursor is in blank space or margins.
 */
export function findSelectionPoint(
  mouseX: number,
  mouseY: number,
  processedItems: ProcessedTextItem[],
  allowFarFallback = false,
  pageWidth?: number,
  pageHeight?: number
): CustomSelectionPoint | null {
  if (processedItems.length === 0) return null;

  // Get the profile and use spatial bands for fast lookup
  const pWidth = pageWidth ?? Math.max(...processedItems.map(i => i.left + i.width), 595);
  const pHeight = pageHeight ?? Math.max(...processedItems.map(i => i.top + i.fontHeight), 842);
  const profile = ensureProfile(processedItems, pWidth, pHeight);

  // Use spatial bands to narrow candidate list
  const bandIdx = Math.floor(mouseY / (profile.medianFontHeight * 1.5));
  let candidates: number[] = [];

  // Primary band
  if (bandIdx >= 0 && bandIdx < profile.spatialBands.length) {
    candidates = [...profile.spatialBands[bandIdx].itemIndices];
  }

  // If no candidates, check neighboring bands
  if (candidates.length === 0) {
    for (let delta of [-1, 1, -2, 2]) {
      const nIdx = bandIdx + delta;
      if (nIdx >= 0 && nIdx < profile.spatialBands.length) {
        candidates = [...candidates, ...profile.spatialBands[nIdx].itemIndices];
      }
    }
  }

  // Fallback to all items on the page if we still have no candidates (e.g. cursor is in deep margin)
  if (candidates.length === 0) {
    candidates = processedItems.map((_, idx) => idx);
  }

  // First: prefer items whose vertical band contains the pointer. This avoids
  // picking nearby items on other rows when the user is clearly clicking on
  // a given line. If any candidates exist, choose the one closest horizontally.
  const verticalCandidates: { idx: number; hDist: number; vDist: number }[] = [];

  for (const i of candidates) {
    const p = processedItems[i];
    const paddingX = Math.max(8, p.fontHeight * 0.4);
    const paddingY = Math.max(4, p.fontHeight * 0.4);
    const itemX1 = p.left - paddingX;
    const itemX2 = p.left + p.width + paddingX;
    const itemY1 = p.top - paddingY;
    const itemY2 = p.top + p.fontHeight + paddingY;

    if (mouseY >= itemY1 && mouseY <= itemY2) {
      // horizontal distance to the item's padded horizontal span
      const hDist = mouseX < itemX1 ? itemX1 - mouseX : mouseX > itemX2 ? mouseX - itemX2 : 0;
      const centerY = p.top + p.fontHeight / 2;
      const vDist = Math.abs(mouseY - centerY);
      verticalCandidates.push({ idx: i, hDist, vDist });
    }
  }

  let bestItemIndex = -1;
  let bestDistance = Infinity;

  if (verticalCandidates.length > 0) {
    verticalCandidates.sort((a, b) => {
      if (Math.abs(a.hDist - b.hDist) > 1e-5) {
        return a.hDist - b.hDist;
      }
      // Tiebreak: whichever item's nearest edge is to the LEFT of the cursor wins
      // (prefer the item the cursor just left, not the one it hasn't reached yet)
      const aRight = processedItems[a.idx].left + processedItems[a.idx].width;
      const bRight = processedItems[b.idx].left + processedItems[b.idx].width;
      const aIsLeft = aRight <= mouseX;
      const bIsLeft = bRight <= mouseX;
      if (aIsLeft && !bIsLeft) return -1;  // A is behind cursor, prefer A
      if (!aIsLeft && bIsLeft) return 1;
      return a.vDist - b.vDist;
    });
    bestItemIndex = verticalCandidates[0].idx;
    
    // Calculate vertical candidates distance for standardized horizontal gating
    const hDist = verticalCandidates[0].hDist;
    const vDist = verticalCandidates[0].vDist;
    const vWeight = allowFarFallback ? 25 : 12; // High-priority vertical row-locking (prevents horizontal bleed)
    bestDistance = hDist * hDist + (vDist * vDist) * vWeight;
  } else {
    // Fallback: nearest bounding-box with a high vertical penalty so items on different
    // visual rows are strongly de-prioritized compared to horizontal proximity on the same row.
    for (const i of candidates) {
      const p = processedItems[i];
      const closestX = Math.max(p.left, Math.min(mouseX, p.left + p.width));
      const closestY = Math.max(p.top, Math.min(mouseY, p.top + p.fontHeight));

      const dx = mouseX - closestX;
      const dy = mouseY - closestY;
      const vWeight = allowFarFallback ? 25 : 12; // High-priority vertical row-locking (prevents horizontal bleed)
      const dist = dx * dx + (dy * dy) * vWeight;

      if (dist < bestDistance) {
        bestDistance = dist;
        bestItemIndex = i;
      }
    }
  }

  if (bestItemIndex === -1) return null;

  const bestItem = processedItems[bestItemIndex];
  
  // Relaxed mousedown activation limit (increased from 24px to 80px) to allow clean selection
  // initiation when starting a click from the page margin area next to text.
  if (!allowFarFallback) {
    const maxDistance = Math.max(80, bestItem.fontHeight * 4.0);
    if (bestDistance > maxDistance * maxDistance) return null;
  }

  const str = bestItem.item.str;
  const totalChars = str.length || 1;
  const isRtl = bestItem.item.dir === 'rtl';

  // Use per-character width mapping instead of uniform interpolation
  try {
    const offsets = getCharOffsetMap(bestItem);
    
    // Snaps RTL local coordinate calculation
    const localX = isRtl
      ? (bestItem.left + bestItem.width) - mouseX
      : mouseX - bestItem.left;

    // Explicitly support negative offset boundaries for snapping start selections perfectly to index 0
    if (localX <= 0) {
      return { itemIndex: bestItemIndex, charIndex: 0 };
    }

    // Binary search to find the character under the cursor with midpoint rounding
    let charIndex = 0;
    for (let i = 0; i < offsets.length - 1; i++) {
      if (localX >= offsets[i] && localX < offsets[i + 1]) {
        const midpoint = (offsets[i] + offsets[i + 1]) / 2;
        charIndex = localX >= midpoint ? i + 1 : i;
        break;
      }
    }
    // If localX >= last offset, clamp to length
    if (localX >= offsets[offsets.length - 1]) {
      charIndex = totalChars;
    }

    return { itemIndex: bestItemIndex, charIndex: Math.max(0, Math.min(totalChars, charIndex)) };
  } catch (e) {
    // Fallback to linear interpolation if canvas measurement fails
    const pct = isRtl
      ? ((bestItem.left + bestItem.width) - mouseX) / bestItem.width
      : (mouseX - bestItem.left) / bestItem.width;
    const charIndex = Math.max(0, Math.min(totalChars, Math.round(pct * totalChars)));
    return { itemIndex: bestItemIndex, charIndex };
  }
}

/**
 * Finds word boundaries (start/end indexes) around a character index for double-click word selection.
 */
/**
 * Legacy fallback: regex-based word boundary detection for environments without Intl.Segmenter.
 */
function legacyFindWordBoundaries(
  str: string,
  index: number
): { start: number; end: number } {
  const isWordChar = (char: string) => Boolean(char && !/\s/.test(char) && !/[()[\]{}.,;:!?'"""'']/.test(char));

  let start = index;
  while (start > 0 && isWordChar(str[start - 1])) {
    start--;
  }
  let end = index;
  while (end < str.length && isWordChar(str[end])) {
    end++;
  }

  // If no word character was clicked, select at least the character itself
  if (start === end && index < str.length) {
    end = index + 1;
  }

  return { start, end };
}

/**
 * Find word boundaries using Intl.Segmenter for proper i18n support (CJK, Arabic, Thai, etc.).
 * Falls back to legacy regex walker if Intl.Segmenter is unavailable.
 */
function detectLocale(str: string): string {
  if (/[\u4e00-\u9fa5]/.test(str)) return 'zh';
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(str)) return 'ja';
  if (/[\u0600-\u06ff]/.test(str)) return 'ar';
  if (/[\u0e00-\u0e7f]/.test(str)) return 'th';
  return 'en-US';
}

export function findWordBoundaries(
  str: string,
  index: number,
  locale?: string
): { start: number; end: number } {
  // Defensive clamp
  if (!str || index < 0) {
    return { start: 0, end: 0 };
  }

  // UX boundary shift: if user clicked exactly at or past the end of the text item,
  // target the last valid character index to select the trailing word instead of selecting nothing.
  let adjustedIndex = index;
  if (adjustedIndex >= str.length) {
    adjustedIndex = Math.max(0, str.length - 1);
  }

  // Check if Intl.Segmenter is available
  if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
    try {
      const detectedLocale = locale || detectLocale(str);

      const segmenter = new (Intl as any).Segmenter(detectedLocale, {
        granularity: 'word',
      });
      const segments = Array.from(segmenter.segment(str)) as any[];

      for (const segment of segments) {
        if (
          adjustedIndex >= segment.index &&
          adjustedIndex < segment.index + segment.segment.length
        ) {
          return { start: segment.index, end: segment.index + segment.segment.length };
        }
      }
    } catch (e) {
      // Silently fall through to legacy method
    }
  }

  // Fallback: use legacy regex-based walker
  return legacyFindWordBoundaries(str, adjustedIndex);
}

/**
 * Normalizes start and end coordinates so that 'first' is visually before 'last' in reading order.
 */
export function normalizeSelection(
  start: CustomSelectionPoint,
  end: CustomSelectionPoint
): { first: CustomSelectionPoint; last: CustomSelectionPoint } {
  // Primary ordering: processedTextItemsRef array order (reading order).
  // Fallback ordering: charIndex.
  if (start.itemIndex !== end.itemIndex) {
    return start.itemIndex < end.itemIndex ? { first: start, last: end } : { first: end, last: start };
  }
  if (start.charIndex !== end.charIndex) {
    return start.charIndex < end.charIndex ? { first: start, last: end } : { first: end, last: start };
  }
  return { first: start, last: end };
}

/**
 * Calculates a list of normalized (0..1) bounding rectangles for all selected characters between start and end.
 */
export function getCustomSelectionRects(
  selection: { start: CustomSelectionPoint; end: CustomSelectionPoint },
  processedItems: ProcessedTextItem[],
  pageWidth: number,
  pageHeight: number
): { x: number; y: number; w: number; h: number }[] {
  const norm = normalizeSelection(selection.start, selection.end);
  if (processedItems.length === 0) return [];

  const preliminary: { x: number; y: number; w: number; h: number }[] = [];

  for (let i = norm.first.itemIndex; i <= norm.last.itemIndex; i++) {
    const p = processedItems[i];
    const charStart = i === norm.first.itemIndex ? norm.first.charIndex : 0;
    const charEnd = i === norm.last.itemIndex ? norm.last.charIndex : p.item.str.length;
    if (charStart >= charEnd) continue;

    const y = p.top / pageHeight;
    const h = p.fontHeight / pageHeight;
    const isRtl = p.item.dir === 'rtl';

    try {
      const offsets = getCharOffsetMap(p);
      
      // Snaps RTL horizontal highlight coordinate calculations
      const startX = isRtl
        ? p.left + p.width - offsets[charEnd]
        : p.left + offsets[charStart];
      const selectWidth = offsets[charEnd] - offsets[charStart];

      preliminary.push({
        x: Math.max(0, startX / pageWidth),
        y: Math.max(0, y),
        w: Math.min(1, selectWidth / pageWidth),
        h: Math.min(1, h),
      });
    } catch {
      const totalChars = p.item.str.length || 1;
      const charWidth = p.width / totalChars;
      
      const startX = isRtl
        ? p.left + p.width - charEnd * charWidth
        : p.left + charStart * charWidth;
      const selectWidth = (charEnd - charStart) * charWidth;

      preliminary.push({
        x: Math.max(0, startX / pageWidth),
        y: Math.max(0, y),
        w: Math.min(1, selectWidth / pageWidth),
        h: Math.min(1, h),
      });
    }
  }

  // Merge adjacent slices that belong to the same visual line.
  // This smooths highlights to look more like Adobe (fewer chunky gaps).
  const merged: typeof preliminary = [];
  
  // Calculate median font height for robust line tolerance mapping
  const fontHeights = processedItems.map(p => p.fontHeight).sort((a, b) => a - b);
  const medianFontHeight = fontHeights.length > 0 ? fontHeights[Math.floor(fontHeights.length / 2)] : 12;
  const yTolerance = (medianFontHeight * 0.65) / pageHeight;

  for (const r of preliminary) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push(r);
      continue;
    }

    const sameLine = Math.abs(prev.y - r.y) <= yTolerance;
    const prevRight = prev.x + prev.w;
    const rLeft = r.x;

    const gap = rLeft - prevRight;
    // Fix: Allow any negative horizontal overlap to merge seamlessly (avoids double-paint patches).
    // Tighten boundary threshold to 0.008 (approx 6px) to prevent bleed across close layout columns.
    const canMerge = sameLine && gap <= 0.008;

    if (canMerge) {
      const newLeft = Math.min(prev.x, r.x);
      const newRight = Math.max(prev.x + prev.w, r.x + r.w);
      prev.x = newLeft;
      prev.w = newRight - newLeft;
    } else {
      merged.push(r);
    }
  }

  return merged;
}

/**
 * Constructs the formatted, spaces-and-newlines preserved text sequence between selection points.
 */
export function getCustomSelectionText(
  start: CustomSelectionPoint,
  end: CustomSelectionPoint,
  processedItems: ProcessedTextItem[],
  pageWidth?: number,
  pageHeight?: number
): string {
  if (processedItems.length === 0) return '';
  const norm = normalizeSelection(start, end);

  const pWidth = pageWidth ?? Math.max(...processedItems.map(i => i.left + i.width), 595);
  const pHeight = pageHeight ?? Math.max(...processedItems.map(i => i.top + i.fontHeight), 842);
  const profile = ensureProfile(processedItems, pWidth, pHeight);

  let result = '';

  const shouldBreakLine = (
    prev: ProcessedTextItem,
    curr: ProcessedTextItem,
    prevLineGroup: any,
    currLineGroup: any
  ) => {
    if (prevLineGroup !== currLineGroup) return true;

    const prevCenterY = prev.top + prev.fontHeight / 2;
    const currCenterY = curr.top + curr.fontHeight / 2;
    const yDiff = Math.abs(currCenterY - prevCenterY);

    if (yDiff > Math.max(prev.fontHeight, curr.fontHeight) * 0.55) return true;

    // When double-column, prefer newline when column changes
    if (profile.isDoubleColumn && (prev.columnIndex ?? 0) !== (curr.columnIndex ?? 0)) return true;

    return false;
  };

  const joinWithSpace = (prevItem: ProcessedTextItem, currItem: ProcessedTextItem, prevText: string, currText: string) => {
    const prevLast = prevText.slice(-1);
    if (prevLast === '\n' || prevLast === '\u2014' || prevLast === '-') return '';

    // Precise physical gap calculation
    const prevRight = prevItem.left + prevItem.width;
    const xGap = currItem.left - prevRight;
    const fontHeight = Math.min(prevItem.fontHeight, currItem.fontHeight);

    // If gap is more than 10% of font height, insert a space.
    if (xGap > fontHeight * 0.10) {
      return ' ';
    }
    return '';
  };

  for (let i = norm.first.itemIndex; i <= norm.last.itemIndex; i++) {
    const p = processedItems[i];
    const charStart = i === norm.first.itemIndex ? norm.first.charIndex : 0;
    const charEnd = i === norm.last.itemIndex ? norm.last.charIndex : p.item.str.length;

    const slice = p.item.str.slice(charStart, charEnd);
    if (!slice) continue;

    if (i > norm.first.itemIndex) {
      const prev = processedItems[i - 1];
      const prevLineGroup = profile.lineGroups.get(i - 1);
      const currLineGroup = profile.lineGroups.get(i);

      if (shouldBreakLine(prev, p, prevLineGroup, currLineGroup)) {
        result += '\n';
      } else {
        result += joinWithSpace(prev, p, result, slice);
      }
    }

    result += slice;
  }

  return result;
}
