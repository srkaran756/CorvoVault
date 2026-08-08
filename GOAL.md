# 🎯 Current Focus Goal: Export PDF Annotations as Markdown Notes

```
=====================================================
            🎯 CORVOVAULT FOCUS GOAL 🎯
-----------------------------------------------------
GOAL: Export PDF Annotations & Highlights -> Markdown Note

[x] Step 1: Import, Open, & Annotate PDF (DONE & STABLE)
[ ] Step 2: Add "Export as Note" button in PDF Viewer Toolbar
[ ] Step 3: Format highlights into page-by-page Markdown
[ ] Step 4: Save generated note directly into Vault Notes
=====================================================
```

### GitHub Issue Copy-Paste Content

```markdown
Title: feat(pdf): Export PDF Annotations & Highlights into Structured Markdown Notes

### 📌 Summary & User Value
When studying or reading a PDF in CorvoVault, users frequently highlight key sections, add callout notes, and draw annotations. Currently, annotations are saved reliably in SQLite (`annotations` table). 

To close the loop between reading/annotating and note-taking/knowledge synthesis, users need a 1-click feature to **Export all PDF Annotations & Highlights into a Markdown Note** linked directly to that material.

### 📋 Technical Checklist
- [ ] Add `exportAnnotationsToNote(materialId: string)` helper in `src/hooks/usePdfAnnotations.ts`.
- [ ] Query SQLite annotations via `window.electronAPI.professorGetAnnotations(materialId)`.
- [ ] Format annotations into Markdown grouped by Page Number.
- [ ] Save note via `saveMaterialNote` IPC service to local vault database.
- [ ] Add unit test coverage.
```
