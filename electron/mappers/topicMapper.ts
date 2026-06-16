import { Topic } from '../../src/types';

export interface TopicRow {
  id: string;
  profile_id: string;
  name: string;
  created_at: number;
  resource_count?: number; // populated by JOIN query
}

export function toTopic(row: TopicRow): Topic {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
    resourceCount: row.resource_count || 0,
    activeNotes: 0, // derived or separate concept
  };
}

export function toTopicRow(topic: Topic): TopicRow {
  return {
    id: topic.id,
    profile_id: topic.profileId,
    name: topic.name,
    created_at: new Date(topic.createdAt).getTime()
  };
}
