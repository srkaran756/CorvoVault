import { ipcMain } from 'electron';
import { getDb } from '../db/connection';

export function registerOcrHandlers() {
  ipcMain.handle('ocr:getCache', async (_event, materialId: string, pageNum: number) => {
    try {
      if (!materialId || pageNum == null) return null;
      const db = getDb();
      const row = db.prepare('SELECT ocr_items FROM ocr_cache WHERE material_id = ? AND page_num = ?').get(materialId, pageNum) as { ocr_items: string } | undefined;
      return row ? row.ocr_items : null;
    } catch (err) {
      console.error('[OCR Cache] Error reading cache:', err);
      return null;
    }
  });

  ipcMain.handle('ocr:saveCache', async (_event, materialId: string, pageNum: number, ocrItemsJson: string) => {
    try {
      if (!materialId || pageNum == null || !ocrItemsJson) return { success: false };
      const db = getDb();
      db.prepare(`
        INSERT OR REPLACE INTO ocr_cache (material_id, page_num, ocr_items, created_at)
        VALUES (?, ?, ?, ?)
      `).run(materialId, pageNum, ocrItemsJson, Date.now());
      return { success: true };
    } catch (err) {
      console.error('[OCR Cache] Error saving cache:', err);
      return { success: false, error: (err as Error).message };
    }
  });
}
