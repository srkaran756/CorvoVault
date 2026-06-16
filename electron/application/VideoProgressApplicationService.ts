import { SqliteVideoProgressRepository } from '../repositories/sqlite/SqliteVideoProgressRepository';

export class VideoProgressApplicationService {
  constructor(private videoProgressRepo: SqliteVideoProgressRepository) {}

  async getVideoProgress(materialId: string) {
    return this.videoProgressRepo.get(materialId);
  }

  async saveVideoProgress(progress: any) {
    return this.videoProgressRepo.save(progress);
  }
}
