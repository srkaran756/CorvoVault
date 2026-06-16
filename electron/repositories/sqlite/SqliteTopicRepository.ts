import Database from 'better-sqlite3';
import crypto from 'crypto';
import { Topic } from '../../../src/types';
import { TopicRepository } from '../interfaces/TopicRepository';
import { TopicRow, toTopic, toTopicRow } from '../../mappers/topicMapper';

export class SqliteTopicRepository implements TopicRepository {
  constructor(private db: Database.Database) {}

  async create(topicData: Omit<Topic, 'id' | 'createdAt'>): Promise<Topic> {
    const topic: Topic = {
      ...topicData,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      resourceCount: 0,
      activeNotes: 0
    };

    const row = toTopicRow(topic);

    this.db.prepare(`
      INSERT INTO topics (id, profile_id, name, created_at)
      VALUES (@id, @profile_id, @name, @created_at)
    `).run(row as any);

    return topic;
  }

  async update(id: string, updates: Partial<Topic>): Promise<void> {
    if (updates.name) {
      this.db.prepare('UPDATE topics SET name = ? WHERE id = ?').run(updates.name, id);
    }
  }

  async getById(id: string): Promise<Topic | null> {
    const row = this.db.prepare(`
      SELECT t.*, COUNT(m.id) as resource_count
      FROM topics t
      LEFT JOIN folders f ON f.topic_id = t.id
      LEFT JOIN materials m ON m.folder_id = f.id AND m.storage_status = 'active'
      WHERE t.id = ?
      GROUP BY t.id
    `).get(id) as TopicRow | undefined;

    if (!row) return null;
    return toTopic(row);
  }

  async getByProfileId(profileId: string): Promise<Topic[]> {
    const rows = this.db.prepare(`
      SELECT t.*, COUNT(m.id) as resource_count
      FROM topics t
      LEFT JOIN folders f ON f.topic_id = t.id
      LEFT JOIN materials m ON m.folder_id = f.id AND m.storage_status = 'active'
      WHERE t.profile_id = ?
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `).all(profileId) as TopicRow[];

    return rows.map(toTopic);
  }

  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM topics WHERE id = ?').run(id);
  }
}
