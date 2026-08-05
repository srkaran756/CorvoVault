/**
 * Feature Flags Configuration
 * 
 * Centralized feature flags for controlling application functionality across CorvoVault.
 * To enable or disable a feature globally, toggle the corresponding flag here.
 */
export const FEATURE_FLAGS = {
  /**
   * Local AI & RAG Pipeline Flag
   * 
   * When `false` (default):
   * - Local AI embedding generation (all-MiniLM-L6-v2) is bypassed cleanly during ingestion and querying.
   * - Retrieval falls back seamlessly to BM25 keyword search and structural indexing without throwing errors.
   * 
   * Set to `true` to enable local vector embedding generation and hybrid RAG retrieval.
   */
  ENABLE_RAG_PIPELINE: false,
} as const;

/**
 * Returns whether the RAG (Retrieval-Augmented Generation) local AI pipeline is enabled.
 */
export function isRAGEnabled(): boolean {
  return FEATURE_FLAGS.ENABLE_RAG_PIPELINE;
}
