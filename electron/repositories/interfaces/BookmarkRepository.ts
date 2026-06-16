export interface Bookmark {
  id: string;
  profileId: string;
  title: string;
  url: string;
  createdAt: string;
}

export interface BookmarkRepository {
  create(bookmark: Omit<Bookmark, 'id' | 'createdAt'>): Promise<Bookmark>;
  getByProfileId(profileId: string): Promise<Bookmark[]>;
  delete(id: string): Promise<void>;
}
