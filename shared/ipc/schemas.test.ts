import { describe, it, expect } from 'vitest';
import { vaultSearchArgsSchema } from './schemas';
import { repairJson } from '../../src/lib/ai';

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

describe('repairJson', () => {
  it('heals truncated json ending with unclosed string in array', () => {
    const input = `{ "speech": "abc", "pdf_annotations": [ { "type": "highlight", "targetText": "hello`;
    const repaired = repairJson(input);
    const parsed = JSON.parse(repaired);
    expect(parsed.speech).toBe('abc');
    expect(parsed.pdf_annotations[0].targetText).toBe('hello');
    expect(parsed.pdf_annotations[0].type).toBe('highlight');
  });

  it('heals truncated json ending after key colon', () => {
    const input = `{ "speech": "abc", "thinking": `;
    const repaired = repairJson(input);
    const parsed = JSON.parse(repaired);
    expect(parsed.speech).toBe('abc');
    expect(parsed.thinking).toBeUndefined();
  });

  it('heals truncated json ending with comma', () => {
    const input = `{ "speech": "abc", `;
    const repaired = repairJson(input);
    const parsed = JSON.parse(repaired);
    expect(parsed.speech).toBe('abc');
  });

  it('does not mutate normal valid json', () => {
    const input = `{ "speech": "abc", "pdf_annotations": [] }`;
    const repaired = repairJson(input);
    const parsed = JSON.parse(repaired);
    expect(parsed.speech).toBe('abc');
    expect(parsed.pdf_annotations).toEqual([]);
  });
});
