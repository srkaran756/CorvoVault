import Database from 'better-sqlite3';
import { BrowserWindow } from 'electron';
import { VaultService } from './services/vaultService';
import { SettingsService } from './services/settingsService';
import { SecretService } from './services/secretService';
import { ThemeService } from './services/themeService';
import { AnalyticsService } from './services/analyticsService';
import { SqliteMaterialRepository } from './repositories/sqlite/SqliteMaterialRepository';
import { SqliteTopicRepository } from './repositories/sqlite/SqliteTopicRepository';
import { SqliteFolderRepository } from './repositories/sqlite/SqliteFolderRepository';
import { SqliteNoteRepository } from './repositories/sqlite/SqliteNoteRepository';
import { SqliteBookmarkRepository } from './repositories/sqlite/SqliteBookmarkRepository';
import { SqliteActivityRepository } from './repositories/sqlite/SqliteActivityRepository';
import { SqliteVideoProgressRepository } from './repositories/sqlite/SqliteVideoProgressRepository';
import { ProfessorService } from './services/professorService';
import { IngestionQueue } from './services/ingestionQueue';
import { SqliteVectorRepository } from './repositories/sqlite/SqliteVectorRepository';

export class ServiceHost {
  vault: VaultService;
  settings: SettingsService;
  secrets: SecretService;
  theme: ThemeService;
  analytics: AnalyticsService;
  professor: ProfessorService;
  ingestionQueue: IngestionQueue;

  constructor(db: Database.Database, getMainWindow: () => BrowserWindow | null) {
    const materialRepo = new SqliteMaterialRepository(db);
    const topicRepo = new SqliteTopicRepository(db);
    const folderRepo = new SqliteFolderRepository(db);
    const noteRepo = new SqliteNoteRepository(db);
    const bookmarkRepo = new SqliteBookmarkRepository(db);
    const activityRepo = new SqliteActivityRepository(db);
    const videoProgressRepo = new SqliteVideoProgressRepository(db);

    this.vault = new VaultService(
      db,
      materialRepo,
      topicRepo,
      folderRepo,
      noteRepo,
      bookmarkRepo,
      videoProgressRepo
    );

    this.settings = new SettingsService(db);
    this.secrets = new SecretService();
    this.theme = new ThemeService(db);
    this.analytics = new AnalyticsService(activityRepo);
    
    const vectorRepo = new SqliteVectorRepository(db);
    vectorRepo.initialize();
    
    this.professor = new ProfessorService(db, vectorRepo);
    this.ingestionQueue = new IngestionQueue(db, this.professor, getMainWindow);
    this.cleanCorruptedIngestions(db);
  }

  private cleanCorruptedIngestions(db: Database.Database): void {
    try {
      const rows = db.prepare(
        "SELECT material_id, index_json FROM concept_index WHERE status = 'ready'"
      ).all() as Array<{ material_id: string; index_json: string }>;

      const proseKeywords = /\b(will argue|described|pointed out|introduced|argued|discuss|deals with|shows|about|manifests)\b/i;

      for (const row of rows) {
        let isCorrupted = false;
        try {
          const parsed = JSON.parse(row.index_json);
          if (parsed.topics && Array.isArray(parsed.topics)) {
            for (const topic of parsed.topics) {
              const name = topic.name || '';
              if (name.length > 80 || proseKeywords.test(name)) {
                isCorrupted = true;
                break;
              }
            }
          }
        } catch {
          isCorrupted = true;
        }

        if (isCorrupted) {
          console.log(`[ServiceHost] Detected corrupted/noisy concept index for material ${row.material_id}. Clearing and queueing for re-ingestion.`);
          this.professor.clearIngestionForMaterial(row.material_id);
        }
      }
    } catch (err) {
      console.warn('[ServiceHost] Failed to clean corrupted ingestions:', err);
    }
  }
}
