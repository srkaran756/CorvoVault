export const EMBEDDING_DIM = 384;

export interface VectorChunk {
  chunkId: string;
  embedding: Float32Array;
}

export interface KnnResult {
  chunkId: string;
  distance: number;
}

export interface VectorRepository {
  initialize(): void;
  readonly isAvailable: boolean;
  insertChunks(materialId: string, chunks: VectorChunk[]): void;
  deleteByMaterial(materialId: string): void;
  knnSearch(materialId: string, queryEmbedding: Float32Array, k: number): KnnResult[];
  knnSearchInChapter(materialId: string, queryEmbedding: Float32Array, chapterIds: string[], k: number): KnnResult[];
  knnSearchOnPage(materialId: string, queryEmbedding: Float32Array, page: number, k: number): KnnResult[];
}

