import { describe, it, expect } from 'vitest';
import { vaultSearchArgsSchema } from './schemas';

describe('vaultSearchArgsSchema', () => {
  it('accepts valid profile id and query', () => {
    const r = vaultSearchArgsSchema.safeParse(['user-1', 'quantum pdf']);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual(['user-1', 'quantum pdf']);
  });

  it('rejects empty profile id', () => {
    const r = vaultSearchArgsSchema.safeParse(['', 'x']);
    expect(r.success).toBe(false);
  });

  it('rejects overly long query', () => {
    const r = vaultSearchArgsSchema.safeParse(['id', 'x'.repeat(3000)]);
    expect(r.success).toBe(false);
  });
});
