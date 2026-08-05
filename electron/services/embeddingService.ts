import { pipeline, env } from '@xenova/transformers';
import path from 'path';
import { app } from 'electron';

// Cache the model in userData so it is only downloaded once, ever
const userDataPath = app?.getPath ? app.getPath('userData') : path.join(process.cwd(), '.temp-test-data');
env.cacheDir = path.join(userDataPath, 'ai-models');
// Force CPU execution — no GPU requirement, works on all student devices
env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, require('os').cpus().length - 1));

import { isRAGEnabled } from '../config/featureFlags';

type FeatureExtractionPipeline = Awaited<ReturnType<typeof pipeline>>;

export class EmbeddingService {
  private static pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;
  private batchSize: number = 4;           // conservative start for i3 laptops
  private readonly MAX_BATCH_SIZE = 32;    // ceiling on fast machines
  private readonly MIN_BATCH_SIZE = 1;     // floor for very slow devices
  private readonly TARGET_BATCH_MS = 2000; // aim for <2s per batch

  // Lazy init — model loads only when first embedding is needed
  private getOrInitPipeline(): Promise<FeatureExtractionPipeline> {
    if (!EmbeddingService.pipelinePromise) {
      console.log('[EmbeddingService] Initializing all-MiniLM-L6-v2...');
      EmbeddingService.pipelinePromise = pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        {
          quantized: true,            // quantized INT8 model (~22MB vs ~90MB)
          progress_callback: (progress: any) => {
            // Emit progress
            console.log('[EmbeddingService] Load progress:', progress);
          }
        }
      );
    }
    return EmbeddingService.pipelinePromise;
  }

  async embedBatch(texts: string[], onProgress?: (progress: number) => void): Promise<Float32Array[]> {
    if (!isRAGEnabled()) {
      console.log('[EmbeddingService] RAG pipeline is disabled via feature flags. Skipping embedding generation.');
      return [];
    }
    const extractor = await this.getOrInitPipeline();
    const embeddings: Float32Array[] = [];
    const batchSize = this.batchSize;
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const output: any = await (extractor as any)(batch, { pooling: 'mean', normalize: true });
      const dim = output.dims[1];
      for (let j = 0; j < batch.length; j++) {
        const start = j * dim;
        const end = start + dim;
        embeddings.push(new Float32Array(output.data.subarray(start, end)));
      }
      if (onProgress) {
        onProgress(Math.round((embeddings.length / texts.length) * 100));
      }
    }
    return embeddings;
  }

  // Cosine similarity between two L2-normalized embeddings (dot product shortcut)
  static cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot; // already normalized by all-MiniLM
  }

  // Serialize Float32Array → Buffer for SQLite BLOB storage
  static toBuffer(embedding: Float32Array): Buffer {
    return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  }

  // Deserialize SQLite BLOB → Float32Array
  static fromBuffer(blob: Buffer): Float32Array {
    return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
  }
}
