// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getColorLabel,
  formatAnnotationsToMarkdown,
  exportAnnotationsToNote,
  PdfAnnotationRecord,
} from './usePdfAnnotations';

// Mock ipcService
vi.mock('../services/ipcService', () => ({
  ipcService: {
    notes: {
      add: vi.fn().mockImplementation((materialId, content) =>
        Promise.resolve({ id: 'note-1', materialId, content, createdAt: new Date().toISOString() })
      ),
    },
  },
}));

describe('usePdfAnnotations - getColorLabel', () => {
  it('maps yellow color strings correctly', () => {
    expect(getColorLabel('rgba(253,224,71,0.5)')).toBe('Yellow');
    expect(getColorLabel('#fde047')).toBe('Yellow');
    expect(getColorLabel('yellow')).toBe('Yellow');
  });

  it('maps green, blue, pink, and red colors correctly', () => {
    expect(getColorLabel('rgba(34,197,94,0.4)')).toBe('Green');
    expect(getColorLabel('rgba(59,130,246,0.4)')).toBe('Blue');
    expect(getColorLabel('rgba(236,72,153,0.4)')).toBe('Pink');
    expect(getColorLabel('#ef4444')).toBe('Red');
  });

  it('returns default label for unmapped colors or empty string', () => {
    expect(getColorLabel('')).toBe('Highlight');
    expect(getColorLabel(undefined)).toBe('Highlight');
    expect(getColorLabel('#000000')).toBe('Highlight');
  });
});

describe('usePdfAnnotations - formatAnnotationsToMarkdown', () => {
  it('handles empty annotations gracefully', () => {
    const md = formatAnnotationsToMarkdown([], 'Quantum Mechanics 101');
    expect(md).toContain('# Highlights & Annotations: Quantum Mechanics 101');
    expect(md).toContain('*No annotations or highlights found in this document.*');
  });

  it('formats annotations grouped by page in ascending order', () => {
    const sampleAnnotations: PdfAnnotationRecord[] = [
      {
        annotation_id: 'ann-2',
        page: 3,
        target_text: 'Schrödinger equation describes quantum state change.',
        color: 'rgba(59,130,246,0.4)',
        callout: 'Important formula',
        created_at: 200,
      },
      {
        annotation_id: 'ann-1',
        page: 1,
        target_text: 'Wave function collapses upon measurement.',
        color: 'rgba(253,224,71,0.5)',
        created_at: 100,
      },
      {
        annotation_id: 'ann-3',
        page: 1,
        type: 'pen',
        callout: 'Diagram drawn here',
        created_at: 150,
      },
    ];

    const md = formatAnnotationsToMarkdown(sampleAnnotations, 'Physics Notes');

    expect(md).toContain('# Highlights & Annotations: Physics Notes');
    expect(md).toContain('## Page 1');
    expect(md).toContain('> "Wave function collapses upon measurement." (*Yellow*)');
    expect(md).toContain('- Drawing annotation on Page 1');
    expect(md).toContain('*Note:* Diagram drawn here');

    expect(md).toContain('## Page 3');
    expect(md).toContain('> "Schrödinger equation describes quantum state change." (*Blue*)');
    expect(md).toContain('*Note:* Important formula');

    // Verify ordering (Page 1 comes before Page 3)
    const page1Idx = md.indexOf('## Page 1');
    const page3Idx = md.indexOf('## Page 3');
    expect(page1Idx).toBeGreaterThan(-1);
    expect(page3Idx).toBeGreaterThan(page1Idx);
  });
});

describe('usePdfAnnotations - exportAnnotationsToNote', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns failure when electronAPI is missing', async () => {
    // @ts-ignore
    delete window.electronAPI;
    const res = await exportAnnotationsToNote('mat-123', 'Sample Doc');
    expect(res.success).toBe(false);
    expect(res.message).toContain('Electron API is not available');
  });

  it('returns failure when no annotations exist for document', async () => {
    // Mock window.electronAPI
    // @ts-ignore
    window.electronAPI = {
      professorGetAnnotations: vi.fn().mockResolvedValue([]),
    };

    const res = await exportAnnotationsToNote('mat-123', 'Sample Doc');
    expect(res.success).toBe(false);
    expect(res.message).toContain('No annotations found');
  });

  it('exports annotations into a saved note when annotations exist', async () => {
    const mockAnns = [
      {
        page: 1,
        target_text: 'Test highlight',
        color: '#fde047',
        created_at: 100,
      },
    ];

    // @ts-ignore
    window.electronAPI = {
      professorGetAnnotations: vi.fn().mockResolvedValue(mockAnns),
    };

    const res = await exportAnnotationsToNote('mat-123', 'Sample Doc');
    expect(res.success).toBe(true);
    expect(res.note).toBeDefined();
    expect(res.note.content).toContain('# Highlights & Annotations: Sample Doc');
    expect(res.note.content).toContain('> "Test highlight" (*Yellow*)');
  });
});
