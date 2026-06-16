import { Topic } from '../../../src/types';

export interface TopicRepository {
  create(topic: Omit<Topic, 'id' | 'createdAt'>): Promise<Topic>;
  update(id: string, updates: Partial<Topic>): Promise<void>;
  getById(id: string): Promise<Topic | null>;
  getByProfileId(profileId: string): Promise<Topic[]>;
  delete(id: string): Promise<void>;
}
