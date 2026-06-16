import Database from 'better-sqlite3';
import { Material } from '../../src/types';
import { MaterialRepository } from '../repositories/interfaces/MaterialRepository';
import { TopicRepository } from '../repositories/interfaces/TopicRepository';
import { FolderRepository } from '../repositories/interfaces/FolderRepository';
import { NoteRepository } from '../repositories/interfaces/NoteRepository';
import { BookmarkRepository } from '../repositories/interfaces/BookmarkRepository';
import { SqliteVideoProgressRepository } from '../repositories/sqlite/SqliteVideoProgressRepository';
import { ProfileApplicationService } from '../application/ProfileApplicationService';
import { TopicApplicationService } from '../application/TopicApplicationService';
import { FolderApplicationService } from '../application/FolderApplicationService';
import { MaterialApplicationService } from '../application/MaterialApplicationService';
import { TrashApplicationService } from '../application/TrashApplicationService';
import { IntegrityApplicationService } from '../application/IntegrityApplicationService';
import { NoteApplicationService } from '../application/NoteApplicationService';
import { BookmarkApplicationService } from '../application/BookmarkApplicationService';
import { VideoProgressApplicationService } from '../application/VideoProgressApplicationService';
import { VaultPurgeApplicationService } from '../application/VaultPurgeApplicationService';

/**
 * Facade over focused application services. Preserves the public API used by IPC handlers.
 */
export class VaultService {
  private readonly profiles: ProfileApplicationService;
  private readonly topics: TopicApplicationService;
  private readonly folders: FolderApplicationService;
  private readonly materials: MaterialApplicationService;
  private readonly trash: TrashApplicationService;
  private readonly integrity: IntegrityApplicationService;
  private readonly notes: NoteApplicationService;
  private readonly bookmarks: BookmarkApplicationService;
  private readonly videoProgress: VideoProgressApplicationService;
  private readonly purge: VaultPurgeApplicationService;

  constructor(
    db: Database.Database,
    materialRepo: MaterialRepository,
    topicRepo: TopicRepository,
    folderRepo: FolderRepository,
    noteRepo: NoteRepository,
    bookmarkRepo: BookmarkRepository,
    videoProgressRepo: SqliteVideoProgressRepository
  ) {
    this.profiles = new ProfileApplicationService(db);
    this.topics = new TopicApplicationService(topicRepo, this.profiles);
    this.folders = new FolderApplicationService(folderRepo, this.profiles);
    this.materials = new MaterialApplicationService(materialRepo, this.profiles);
    this.trash = new TrashApplicationService(db, this.profiles);
    this.integrity = new IntegrityApplicationService(db);
    this.notes = new NoteApplicationService(noteRepo);
    this.bookmarks = new BookmarkApplicationService(bookmarkRepo, this.profiles);
    this.videoProgress = new VideoProgressApplicationService(videoProgressRepo);
    this.purge = new VaultPurgeApplicationService(db);
  }

  ensureProfile(profileId: string, name?: string, avatarPath?: string | null): void {
    this.profiles.ensureProfile(profileId, name, avatarPath);
  }

  async syncProfiles(profiles: Array<{ id: string; name?: string; photoURL?: string; avatar_path?: string }>): Promise<void> {
    return this.profiles.syncProfiles(profiles);
  }

  async getTopics(profileId: string) {
    return this.topics.getTopics(profileId);
  }
  async createTopic(profileId: string, name: string) {
    return this.topics.createTopic(profileId, name);
  }
  async updateTopic(id: string, name: string) {
    return this.topics.updateTopic(id, name);
  }
  async deleteTopic(id: string) {
    return this.topics.deleteTopic(id);
  }

  async getFolders(topicId: string) {
    return this.folders.getFolders(topicId);
  }
  async getFoldersByProfile(profileId: string) {
    return this.folders.getFoldersByProfile(profileId);
  }
  async createFolder(topicId: string, profileId: string, name: string) {
    return this.folders.createFolder(topicId, profileId, name);
  }
  async updateFolder(id: string, name: string) {
    return this.folders.updateFolder(id, name);
  }
  async deleteFolder(id: string) {
    return this.folders.deleteFolder(id);
  }

  async getMaterials(folderId: string, profileId: string) {
    return this.materials.getMaterials(folderId, profileId);
  }
  async getAllMaterials(profileId: string) {
    return this.materials.getAllMaterials(profileId);
  }
  async getTrashed(profileId: string) {
    return this.materials.getTrashed(profileId);
  }
  async searchMaterials(profileId: string, query: string) {
    return this.materials.searchMaterials(profileId, query);
  }

  async capture(type: string, data: any) {
    return this.materials.capture(type, data);
  }

  /** Returns active material counts by type — one SQL query, no full fetch. */
  getMaterialCounts(profileId: string) {
    return this.materials.getMaterialCounts(profileId);
  }

  async getMaterial(id: string): Promise<Material | null> {
    return this.materials.getMaterial(id);
  }

  async captureFile(data: any) {
    return this.materials.captureFile(data);
  }
  async captureLink(data: any) {
    return this.materials.captureLink(data);
  }

  moveMaterialToTrash(id: string, profileId: string, trashPath?: string): void {
    this.trash.moveMaterialToTrash(id, profileId, trashPath);
  }

  restoreMaterial(id: string, profileId: string): void {
    this.trash.restoreMaterial(id, profileId);
  }

  async getTrashPath(id: string): Promise<string | null> {
    return this.trash.getTrashPath(id);
  }

  async permanentlyDelete(id: string): Promise<void> {
    return this.materials.permanentlyDelete(id);
  }

  async getNotes(materialId: string) {
    return this.notes.getNotes(materialId);
  }
  async addNote(materialId: string, content: string) {
    return this.notes.addNote(materialId, content);
  }
  async updateNote(id: string, content: string) {
    return this.notes.updateNote(id, content);
  }
  async deleteNote(id: string) {
    return this.notes.deleteNote(id);
  }

  async getVideoProgress(materialId: string) {
    return this.videoProgress.getVideoProgress(materialId);
  }
  async saveVideoProgress(progress: any) {
    return this.videoProgress.saveVideoProgress(progress);
  }

  purgeProfile(profileId: string): void {
    this.purge.purgeProfile(profileId);
  }

  async getMaterialsByProfile(profileId: string) {
    return this.purge.getMaterialsByProfile(profileId);
  }

  /** Deletes SQLite rows for trashed materials older than N days. Returns row count deleted. */
  purgeOldTrashedRows(olderThanDays: number): number {
    return this.purge.purgeOldTrashedRows(olderThanDays);
  }

  async runIntegrityCheck(profileId: string) {
    return this.integrity.runIntegrityCheck(profileId);
  }

  async getBookmarks(profileId: string) {
    return this.bookmarks.getBookmarks(profileId);
  }
  async addBookmark(profileId: string, title: string, url: string) {
    return this.bookmarks.addBookmark(profileId, title, url);
  }
  async deleteBookmark(id: string) {
    return this.bookmarks.deleteBookmark(id);
  }
}
