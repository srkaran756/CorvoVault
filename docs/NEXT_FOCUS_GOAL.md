# GitHub Issue & Focus Goal

> **Status:** COMPLETED & VERIFIED  
> **Topic:** Export PDF Annotations & Highlights as Markdown Notes  
> **Repository:** `srkaran756/CorvoVault`

---

## 🎯 Goal Title: `feat(pdf): Export PDF Annotations & Highlights into Structured Markdown Notes`

### 📌 Summary & User Value
When studying or reading a PDF in CorvoVault, users frequently highlight key sections, add callout notes, and draw annotations. Currently, annotations are saved reliably in SQLite (`annotations` table). 

To close the loop between **reading/annotating** and **note-taking/knowledge synthesis**, users need a 1-click feature to **Export all PDF Annotations & Highlights into a Markdown Note** linked directly to that material.

---

### 🎨 Key Feature Scope & UX
1. **Toolbar / Sidebar Action**:
   - Add an **"Export Annotations as Note"** button in `PdfToolbar.tsx` and `PdfSidebar.tsx`.
2. **Structured Note Generation**:
   - Group highlights and notes by **Page Number**.
   - Preserves highlight text, color tags, callout comments, and created timestamps.
   - Include direct clickable deep-links back to the specific PDF page.
3. **Vault Integration**:
   - Creates a new entry in `material_notes` linked to the current `material_id`.
   - Opens the generated Markdown note in the split side-panel editor for immediate editing.

---

### 📋 Technical Checklist

- [x] Add `exportAnnotationsToNote(materialId: string)` helper in `src/hooks/usePdfAnnotations.ts`.
- [x] Query SQLite annotations via `window.electronAPI.professorGetAnnotations(materialId)`.
- [x] Format annotations into GitHub-Flavored Markdown:
  ```markdown
  # Highlights & Annotations: [Document Title]

  ## Page 1
  > "Highlighted sentence from PDF..." (Yellow)
  *Note:* User callout or summary comment

  ## Page 3
  > "Another key formula or quote..." (Red)
  ```
- [x] Call `saveMaterialNote` IPC service (`ipcService.notes.add`) to save to local vault database.
- [x] Add unit test coverage in `src/hooks/usePdfAnnotations.test.ts`.

---

### 📌 Wall Poster Note (Printable / Quick Ref)

```
=====================================================
            🎯 CORVOVAULT FOCUS GOAL 🎯
-----------------------------------------------------
GOAL: Export PDF Annotations & Highlights -> Markdown Note

[x] Step 1: Import, Open, & Annotate PDF (DONE & STABLE)
[x] Step 2: Add "Export as Note" button in PDF Viewer Toolbar
[x] Step 3: Format highlights into page-by-page Markdown
[x] Step 4: Save generated note directly into Vault Notes
=====================================================
```
