import { FolderRepository } from '../repositories/interfaces/FolderRepository';
import { ProfileApplicationService } from './ProfileApplicationService';

export class FolderApplicationService {
  constructor(
    private folderRepo: FolderRepository,
    private profiles: ProfileApplicationService
  ) {}

  async getFolders(topicId: string) {
    return this.folderRepo.getByTopicId(topicId);
  }

  async getFoldersByProfile(profileId: string) {
    return this.folderRepo.getByProfileId(profileId);
  }

  async createFolder(topicId: string, profileId: string, name: string) {
    this.profiles.ensureProfile(profileId);
    return this.folderRepo.create({ topicId, profileId, name });
  }

  async updateFolder(id: string, name: string) {
    return this.folderRepo.update(id, { name });
  }

  async deleteFolder(id: string) {
    return this.folderRepo.delete(id);
  }
}
