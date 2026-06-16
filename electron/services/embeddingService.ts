import { pipeline, env } from '@xenova/transformers';
import path from 'path';
import { app } from 'electron';

// Cache the model in userData so it is only downloaded once, ever
const userDataPath = app?.getPath ? app.getPath('userData') : path.join(process.cwd(), '.temp-test-data');
env.cacheDir = path.join(userDataPath, 'ai-models');
// Force CPU execution — no GPU requirement, works on all student devices
env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, require('os').cpus().length - 1));

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

  // Main entry point: embed a list of text strings
  // Returns an array of Float32Array, one per input string
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const pipe = await this.getOrInitPipeline();
    const results: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const batchStart = Date.now();

      const output = await (pipe as any)(batch, {
        pooling: 'mean',
        normalize: true,
      });

      const batchMs = Date.now() - batchStart;

      // Adapt batch size based on measured throughput
      if (batchMs > this.TARGET_BATCH_MS && this.batchSize > this.MIN_BATCH_SIZE) {
        this.batchSize = Math.max(this.MIN_BATCH_SIZE, Math.floor(this.batchSize / 2));
        console.log(`[EmbeddingService] Slow batch (${batchMs}ms), reducing to batchSize=${this.batchSize}`);
      } else if (batchMs < this.TARGET_BATCH_MS * 0.5 && this.batchSize < this.MAX_BATCH_SIZE) {
        this.batchSize = Math.min(this.MAX_BATCH_SIZE, this.batchSize * 2);
        console.log(`[EmbeddingService] Fast batch (${batchMs}ms), increasing to batchSize=${this.batchSize}`);
      }

      // Extract Float32Arrays from the model output tensor
      for (let j = 0; j < batch.length; j++) {
        const embedding = output[j]?.data ?? output.data?.slice(j * 384, (j + 1) * 384);
        results.push(new Float32Array(embedding));
      }

      // Yield to event loop between batches — keeps app responsive on weak hardware
      await new Promise<void>(resolve => setImmediate(resolve));
    }

    return results;
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
