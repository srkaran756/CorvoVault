import { BookmarkRepository } from '../repositories/interfaces/BookmarkRepository';
import { ProfileApplicationService } from './ProfileApplicationService';

export class BookmarkApplicationService {
  constructor(
    private bookmarkRepo: BookmarkRepository,
    private profiles: ProfileApplicationService
  ) {}

  async getBookmarks(profileId: string) {
    return this.bookmarkRepo.getByProfileId(profileId);
  }

  async addBookmark(profileId: string, title: string, url: string) {
    this.profiles.ensureProfile(profileId);
    return this.bookmarkRepo.create({ profileId, title, url });
  }

  async deleteBookmark(id: string) {
    return this.bookmarkRepo.delete(id);
  }
}
