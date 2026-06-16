import { useState, useEffect } from 'react';

export interface StudyBookmark {
  id: string;
  pageNum: number;
  label: string;
  createdAt: string;
}

export function usePdfBookmarks(materialId: string) {
  const [studyBookmarks, setStudyBookmarks] = useState<StudyBookmark[]>([]);
  const [newBookmarkLabel, setNewBookmarkLabel] = useState('');

  // Hydrate bookmarks from SQLite / localStorage on mount or materialId change
  useEffect(() => {
    if (window.electronAPI?.professorGetPdfBookmarks) {
      window.electronAPI.professorGetPdfBookmarks(materialId).then((dbBookmarks: any[]) => {
        if (dbBookmarks && dbBookmarks.length > 0) {
          setStudyBookmarks(dbBookmarks.map((b: any) => ({
            id: b.bookmark_id,
            pageNum: b.page,
            label: b.label,
            createdAt: new Date(b.created_at).toISOString(),
          })));
          // Clean up localStorage keys on successful DB load
          const stored = localStorage.getItem(`corvovault-pdf-bookmarks-${materialId}`);
          if (stored) {
            localStorage.removeItem(`corvovault-pdf-bookmarks-${materialId}`);
            console.log(`[V3 Cleanup] Cleaned up localStorage bookmarks for ${materialId}`);
          }
        } else {
          // Try localStorage migration
          const stored = localStorage.getItem(`corvovault-pdf-bookmarks-${materialId}`);
          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              setStudyBookmarks(parsed);
              // Migrate to SQLite
              for (const b of parsed) {
                window.electronAPI!.professorSavePdfBookmark({
                  bookmark_id: b.id,
                  material_id: materialId,
                  page: b.pageNum,
                  label: b.label,
                  created_at: new Date(b.createdAt).getTime() || Date.now(),
                });
              }
              console.log(`[V3 Migration] Migrated ${parsed.length} bookmarks to SQLite`);
              localStorage.removeItem(`corvovault-pdf-bookmarks-${materialId}`);
            } catch {
              setStudyBookmarks([]);
            }
          } else {
            setStudyBookmarks([]);
          }
        }
      }).catch(() => {
        const stored = localStorage.getItem(`corvovault-pdf-bookmarks-${materialId}`);
        setStudyBookmarks(stored ? JSON.parse(stored) : []);
      });
    } else {
      const stored = localStorage.getItem(`corvovault-pdf-bookmarks-${materialId}`);
      if (stored) {
        try { setStudyBookmarks(JSON.parse(stored)); } catch { setStudyBookmarks([]); }
      } else {
        setStudyBookmarks([]);
      }
    }
  }, [materialId]);

  const saveBookmarks = (updated: StudyBookmark[]) => {
    setStudyBookmarks(updated);
    // V3: Write to SQLite
    if (window.electronAPI?.professorSavePdfBookmark) {
      for (const b of updated) {
        window.electronAPI.professorSavePdfBookmark({
          bookmark_id: b.id,
          material_id: materialId,
          page: b.pageNum,
          label: b.label,
          created_at: new Date(b.createdAt).getTime() || Date.now(),
        });
      }
    } else {
      localStorage.setItem(`corvovault-pdf-bookmarks-${materialId}`, JSON.stringify(updated));
    }
  };

  const handleAddBookmark = (currentPage: number) => {
    const label = newBookmarkLabel.trim() || `Page ${currentPage}`;
    const updated = [
      ...studyBookmarks,
      {
        id: Math.random().toString(36).slice(2, 9),
        pageNum: currentPage,
        label,
        createdAt: new Date().toISOString(),
      },
    ];
    saveBookmarks(updated);
    setNewBookmarkLabel('');
  };

  const handleDeleteBookmark = (id: string) => {
    const updated = studyBookmarks.filter((x) => x.id !== id);
    if (window.electronAPI?.professorDeletePdfBookmark) {
      window.electronAPI.professorDeletePdfBookmark(id);
    }
    saveBookmarks(updated);
  };

  return {
    studyBookmarks,
    newBookmarkLabel,
    setNewBookmarkLabel,
    handleAddBookmark,
    handleDeleteBookmark,
  };
}
