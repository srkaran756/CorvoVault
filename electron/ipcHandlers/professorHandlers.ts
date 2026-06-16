import { ipcMain } from 'electron';
import { ProfessorService } from '../services/professorService';
import Database from 'better-sqlite3';

export function registerProfessorHandlers(
  db: Database.Database,
  professorService: ProfessorService
): void {
  ipcMain.handle('professor:getIngestionStatus', async (_event, materialId: string) => {
    return professorService.getIngestionStatus(materialId);
  });

  ipcMain.handle('professor:getRelevantChunks', async (_event, materialId: string, currentPage: number, query: string) => {
    return await professorService.getRelevantChunks(materialId, currentPage, query);
  });

  ipcMain.handle('professor:classifyAndRetrieve', async (_event, materialId: string, currentPage: number, numPages: number, query: string, conversationHistory: any[]) => {
    return await professorService.classifyAndRetrieve(materialId, currentPage, numPages, query, conversationHistory);
  });

  ipcMain.handle('professor:getConceptIndex', async (_event, materialId: string) => {
    return professorService.getConceptIndex(materialId);
  });

  ipcMain.handle('professor:storeConceptIndex', async (_event, materialId: string, indexJson: any) => {
    professorService.storeConceptIndex(materialId, indexJson, 'ready');
    return { success: true };
  });

  ipcMain.handle('professor:saveSession', async (_event, materialId: string, session: any) => {
    professorService.upsertSession(materialId, session);
    return { success: true };
  });

  ipcMain.handle('professor:loadSession', async (_event, materialId: string) => {
    return professorService.loadSession(materialId);
  });

  // ─── Annotation IPC ──────────────────────────────────────────────────────
  ipcMain.handle('professor:getAnnotations', async (_event, materialId: string, page?: number) => {
    return professorService.getAnnotations(materialId, page);
  });

  ipcMain.handle('professor:saveAnnotation', async (_event, annotation: any) => {
    professorService.saveAnnotation(annotation);
    return { success: true };
  });

  ipcMain.handle('professor:deleteAnnotation', async (_event, annotationId: string) => {
    professorService.deleteAnnotation(annotationId);
    return { success: true };
  });

  ipcMain.handle('professor:deleteAnnotationsForPage', async (_event, materialId: string, page: number) => {
    professorService.deleteAnnotationsForPage(materialId, page);
    return { success: true };
  });

  // ─── PDF Bookmark IPC ────────────────────────────────────────────────────
  ipcMain.handle('professor:getPdfBookmarks', async (_event, materialId: string) => {
    return professorService.getPdfBookmarks(materialId);
  });

  ipcMain.handle('professor:savePdfBookmark', async (_event, bookmark: any) => {
    professorService.savePdfBookmark(bookmark);
    return { success: true };
  });

  ipcMain.handle('professor:deletePdfBookmark', async (_event, bookmarkId: string) => {
    professorService.deletePdfBookmark(bookmarkId);
    return { success: true };
  });

  // ─── Re-ingestion IPC ────────────────────────────────────────────────────
  ipcMain.handle('professor:clearIngestion', async (_event, materialId: string) => {
    professorService.clearIngestionForMaterial(materialId);
    return { success: true };
  });
}

