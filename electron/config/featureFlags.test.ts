import { describe, it, expect } from 'vitest';
import { FEATURE_FLAGS, isRAGEnabled } from './featureFlags';

describe('Feature Flags', () => {
  it('should have RAG pipeline disabled by default', () => {
    expect(FEATURE_FLAGS.ENABLE_RAG_PIPELINE).toBe(false);
    expect(isRAGEnabled()).toBe(false);
  });
});
