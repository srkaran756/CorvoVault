import { TopicRepository } from '../repositories/interfaces/TopicRepository';
import { ProfileApplicationService } from './ProfileApplicationService';

export class TopicApplicationService {
  constructor(
    private topicRepo: TopicRepository,
    private profiles: ProfileApplicationService
  ) {}

  async getTopics(profileId: string) {
    return this.topicRepo.getByProfileId(profileId);
  }

  async createTopic(profileId: string, name: string) {
    this.profiles.ensureProfile(profileId);
    return this.topicRepo.create({ profileId, name, resourceCount: 0, activeNotes: 0 });
  }

  async updateTopic(id: string, name: string) {
    return this.topicRepo.update(id, { name });
  }

  async deleteTopic(id: string) {
    return this.topicRepo.delete(id);
  }
}
