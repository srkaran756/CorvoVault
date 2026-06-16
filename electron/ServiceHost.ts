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
  }
}
