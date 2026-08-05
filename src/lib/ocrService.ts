import { ProcessedTextItem, createOcrProcessedTextItem } from './pdfSelectionEngine';

/**
 * Initial Test Phase Safeguard Guardrail
 * Can be set to false or deleted after initial 10-page test verification passes.
 */
export const ENABLE_TEST_PAGE_CAP = true;
export const TEST_OCR_MAX_PAGES = 10;

// In-memory runtime cache for quick tab switching without hitting SQLite again
const memoryOcrCache = new Map<string, ProcessedTextItem[]>();

function getCacheKey(materialId: string, pageNum: number): string {
  return `${materialId}_p${pageNum}`;
}

/**
 * Fast client-side image layout & text line detector for scanned pages.
 * Analyzes page canvas pixel density to locate horizontal lines and word boxes.
 */
export function detectTextItemsFromCanvas(
  canvas: HTMLCanvasElement,
  pageWidth: number,
  pageHeight: number
): ProcessedTextItem[] {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];

    const width = canvas.width;
    const height = canvas.height;
    if (width === 0 || height === 0) return [];

    // Scale factors to map canvas pixels back to PDF points
    const scaleX = pageWidth / width;
    const scaleY = pageHeight / height;

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Calculate row luminance (dark pixel density)
    const rowDensity = new Float32Array(height);
    for (let y = 0; y < height; y++) {
      let darkCount = 0;
      const rowOffset = y * width * 4;
      for (let x = 0; x < width; x += 4) { // sample every 4th pixel for speed
        const idx = rowOffset + x * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        // Luminance check
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum < 180) { // dark text pixel threshold
          darkCount++;
        }
      }
      rowDensity[y] = darkCount;
    }

    // Segment horizontal lines (vertical bands with dark pixel clusters)
    const lines: Array<{ yStart: number; yEnd: number }> = [];
    let inLine = false;
    let lineStart = 0;
    const minLineHeight = Math.max(8, Math.floor(height * 0.008));
    const noiseThreshold = Math.max(2, Math.floor(width * 0.005));

    for (let y = 0; y < height; y++) {
      if (rowDensity[y] > noiseThreshold) {
        if (!inLine) {
          inLine = true;
          lineStart = y;
        }
      } else {
        if (inLine) {
          inLine = false;
          if (y - lineStart >= minLineHeight) {
            lines.push({ yStart: lineStart, yEnd: y });
          }
        }
      }
    }

    if (lines.length === 0) return [];

    const items: ProcessedTextItem[] = [];

    // Process detected line bands to extract word bounding boxes
    for (let lIdx = 0; lIdx < lines.length; lIdx++) {
      const line = lines[lIdx];
      const lineHeight = line.yEnd - line.yStart;
      const fontHeightPdf = lineHeight * scaleY;
      const topPdf = line.yStart * scaleY;

      // Calculate horizontal column density within line band
      const colDensity = new Float32Array(width);
      for (let x = 0; x < width; x++) {
        let darkInCol = 0;
        for (let y = line.yStart; y < line.yEnd; y += 2) {
          const idx = (y * width + x) * 4;
          const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          if (lum < 180) darkInCol++;
        }
        colDensity[x] = darkInCol;
      }

      // Segment words along the line
      let inWord = false;
      let wordStart = 0;
      const spaceGapThreshold = Math.max(4, Math.floor(lineHeight * 0.4));

      let lastWordEnd = 0;

      for (let x = 0; x < width; x++) {
        if (colDensity[x] > 0) {
          if (!inWord) {
            inWord = true;
            wordStart = x;
          }
        } else {
          if (inWord) {
            // Check if space gap reached
            let gap = 0;
            while (x + gap < width && colDensity[x + gap] === 0) {
              gap++;
            }
            if (gap >= spaceGapThreshold || x === width - 1) {
              inWord = false;
              const wordWidthPx = x - wordStart;
              if (wordWidthPx > 4) {
                const leftPdf = wordStart * scaleX;
                const widthPdf = wordWidthPx * scaleX;
                // Generate a placeholder OCR text box item
                items.push(
                  createOcrProcessedTextItem(
                    'text',
                    leftPdf,
                    topPdf,
                    widthPdf,
                    fontHeightPdf
                  )
                );
              }
              lastWordEnd = x;
              x += gap - 1; // skip space gap
            }
          }
        }
      }
    }

    return items;
  } catch (err) {
    console.error('[OCR Service] Error detecting canvas text items:', err);
    return [];
  }
}

/**
 * Main entrance: Get or generate OCR text items for a scanned page.
 */
export async function getOrGenerateOcrTextItems(
  materialId: string,
  pageNum: number,
  canvas: HTMLCanvasElement | null,
  pageWidth: number,
  pageHeight: number
): Promise<ProcessedTextItem[]> {
  if (!materialId || pageNum == null) return [];

  const key = getCacheKey(materialId, pageNum);

  // 1. Check in-memory runtime cache
  if (memoryOcrCache.has(key)) {
    return memoryOcrCache.get(key)!;
  }

  // 2. Check SQLite persistent cache
  if (window.electronAPI?.getOcrCache) {
    try {
      const cachedJson = await window.electronAPI.getOcrCache(materialId, pageNum);
      if (cachedJson) {
        const parsed = JSON.parse(cachedJson) as ProcessedTextItem[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          memoryOcrCache.set(key, parsed);
          return parsed;
        }
      }
    } catch (err) {
      console.warn('[OCR Service] Error checking SQLite OCR cache:', err);
    }
  }

  // 3. Test Phase Guardrail Check
  if (ENABLE_TEST_PAGE_CAP && pageNum > TEST_OCR_MAX_PAGES) {
    console.log(`[OCR Test Guard] Page ${pageNum} > ${TEST_OCR_MAX_PAGES} page limit. Skipping OCR generation.`);
    return [];
  }

  // 4. Generate OCR bounding boxes if canvas is available
  if (!canvas) return [];

  const items = detectTextItemsFromCanvas(canvas, pageWidth, pageHeight);
  if (items.length > 0) {
    memoryOcrCache.set(key, items);

    // Save to SQLite asynchronously (non-blocking)
    if (window.electronAPI?.saveOcrCache) {
      window.electronAPI.saveOcrCache(materialId, pageNum, JSON.stringify(items)).catch((err) => {
        console.warn('[OCR Service] Failed to save OCR cache to SQLite:', err);
      });
    }
  }

  return items;
}
