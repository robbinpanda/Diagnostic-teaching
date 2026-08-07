# Mistake Set Export and Card Rearchive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build durable cross-paper mistake sets, central mistake-set and knowledge-library workspaces, reusable paper-folder placement for every study card, and whole-card dragging without a separate handle.

**Architecture:** SQLite stores immutable mistake-set item snapshots behind a small FastAPI repository/router. The Next.js root workspace owns navigation, cross-paper selection and print-preview state, while focused components render mistake collections, saved sets and knowledge folders. Existing exam-paper managed folders remain the only bridge between sessions and long-lived card placement.

**Tech Stack:** FastAPI, SQLite/Alembic, Pydantic, Next.js 15, React 19, TypeScript, CSS, Node test runner.

## Global Constraints

- Preserve the six teaching actions, server-derived `wait_for_student`, run serialization, idempotent inputs and SQLite recovery authority.
- Keep the existing single root workspace and current visual tokens; do not add a router or UI dependency.
- Persist saved mistake sets as snapshots so source session deletion cannot break them.
- Keep card open/return FLIP durations at 480ms/440ms and the 901px/900px drag breakpoint.
- Keep text at full width; do not restore card avoidance.
- All new controls require accessible names, visible focus and mobile-safe layout.

---

### Task 1: Durable mistake-set storage and API

**Files:**
- Create: `apps/api/migrations/versions/0014_mistake_sets.py`
- Create: `apps/api/app/storage/mistake_set_repository.py`
- Create: `apps/api/app/routes/mistake_sets.py`
- Modify: `apps/api/app/storage/repositories.py`
- Modify: `apps/api/app/main.py`
- Modify: `apps/api/app/core/schemas.py`
- Test: `apps/api/tests/test_mistake_sets.py`
- Test: `apps/api/tests/test_database_migrations.py`

**Interfaces:**
- Consumes: `SessionRepository.db`, `new_id`, `now_iso`, session `problem_text`, `problem_image_data_url`, and optional exam-paper name.
- Produces: `MistakeSetRepositoryMixin.list_mistake_sets()`, `get_mistake_set(id)`, `create_mistake_set(name, session_ids)` and `/api/mistake-sets` JSON.

- [ ] **Step 1: Write failing repository/API tests**

```python
def test_create_mistake_set_snapshots_cross_paper_sessions(client, seeded_sessions):
    response = client.post("/api/mistake-sets", json={
        "name": "期末复习",
        "session_ids": [seeded_sessions[1].id, seeded_sessions[0].id],
    })
    assert response.status_code == 201
    assert [item["source_session_id"] for item in response.json()["items"]] == [
        seeded_sessions[1].id,
        seeded_sessions[0].id,
    ]
```

- [ ] **Step 2: Run the focused tests and confirm they fail for missing route/table**

Run: `python -m pytest -q tests/test_mistake_sets.py tests/test_database_migrations.py`

- [ ] **Step 3: Add migration and repository transaction**

Create `mistake_sets` plus ordered `mistake_set_items`; validate unique non-empty session IDs, fetch every source row in request order, and insert the set and snapshots inside one `BEGIN IMMEDIATE` transaction.

- [ ] **Step 4: Add Pydantic contracts and FastAPI route**

```python
class MistakeSetCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80, pattern=r".*\S.*")
    session_ids: list[str] = Field(min_length=1)
```

Map duplicate/empty IDs to 400, missing source sessions or set to 404, and return full ordered items.

- [ ] **Step 5: Run focused backend tests**

Run: `python -m pytest -q tests/test_mistake_sets.py tests/test_database_migrations.py`

---

### Task 2: Frontend mistake-set API and state hook

**Files:**
- Create: `apps/web/lib/api/mistake-sets.ts`
- Create: `apps/web/hooks/useMistakeSets.ts`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/lib/api/types.ts`
- Test: `apps/web/tests/mistake-sets.test.ts`

**Interfaces:**
- Consumes: `/api/mistake-sets`.
- Produces: `MistakeSet`, `MistakeSetItem`, `fetchMistakeSets()`, `createMistakeSet()`, and hook state `{ mistakeSets, busy, error, refreshMistakeSets, saveMistakeSet }`.

- [ ] **Step 1: Write failing API and ordering tests**

Verify POST preserves `session_ids` order and the hook ignores stale list responses after a save mutation.

- [ ] **Step 2: Implement typed API functions**

```ts
export type MistakeSet = {
  id: string;
  name: string;
  items: MistakeSetItem[];
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 3: Implement request-generation-safe hook**

Use one request generation and one mutation generation so a late GET cannot overwrite the newly returned set.

- [ ] **Step 4: Run the focused frontend test**

Run: `npm.cmd test -- --test-name-pattern="mistake set"`

---

### Task 3: Cross-paper selection and mistake-set print preview

**Files:**
- Create: `apps/web/components/MistakeSetPrintView.tsx`
- Create: `apps/web/lib/mistake-selection.ts`
- Modify: `apps/web/components/workspace/HistoryWorkspace.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/styles/history.css`
- Modify: `apps/web/styles/print.css`
- Modify: `apps/web/styles/responsive.css`
- Test: `apps/web/tests/mistake-selection.test.ts`
- Test: `apps/web/tests/workspace-components.test.tsx`

**Interfaces:**
- Consumes: `SessionHistoryItem[]`, ordered selected session IDs and `saveMistakeSet`.
- Produces: persistent selection mode and `MistakeSetPrintView` actions `onBack`, `onSaveOnly`, `onSaveAndPrint`.

- [ ] **Step 1: Write failing selection reducer tests**

```ts
assert.deepEqual(toggleSelection(["a", "b"], "a"), ["b"]);
assert.deepEqual(togglePaperSelection(["a"], ["b", "c"]), ["a", "b", "c"]);
```

- [ ] **Step 2: Add overview and detail selection controls**

Keep selected IDs in `page.tsx`; expose selection mode/count, whole-paper toggle and per-question checkboxes through `HistoryWorkspace` props. Disable delete/open actions while a checkbox click is being handled, not for the entire selection mode.

- [ ] **Step 3: Add printable preview**

Render numbered text/image questions with source paper labels. Add editable 1–80 character name, return, “仅保存” and “保存并打印”; call `window.print()` only after POST succeeds and fonts/two animation frames settle.

- [ ] **Step 4: Add print and responsive CSS**

Reuse the existing white A4 print surface, hide the app shell during print, and keep preview controls outside the printed section.

- [ ] **Step 5: Run focused component and selection tests**

Run: `npm.cmd test -- --test-name-pattern="selection|mistake.*print|history workspace"`

---

### Task 4: Saved mistake-set workspace

**Files:**
- Create: `apps/web/components/workspace/MistakeSetWorkspace.tsx`
- Create: `apps/web/lib/mistake-set-view.ts`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/components/workspace/SessionSidebar.tsx`
- Modify: `apps/web/styles/history.css`
- Test: `apps/web/tests/workspace-components.test.tsx`

**Interfaces:**
- Consumes: `MistakeSet[]` and shared `MistakeSetPrintView`.
- Produces: overview/detail state `null | { mode: "overview" } | { mode: "detail"; setId: string }`.

- [ ] **Step 1: Write failing navigation and markup tests**

Assert “历史搜题” has no navigation callback, “错题库” children are exactly “错题合集/错题集”, and a saved set opens a PDF preview instead of session rows.

- [ ] **Step 2: Refactor sidebar navigation types**

Use central destinations `start | history | mistake_collection | mistake_sets | knowledge`. Render history and mistake-library parent labels as non-navigation group headings; keep their chevrons interactive.

- [ ] **Step 3: Implement saved-set overview/detail**

Reuse `historyPaperGrid/historyPaperCard/historyPaperPreview` classes for the overview. Detail embeds read-only printable content with back and print controls.

- [ ] **Step 4: Wire save results and refresh**

Saving from Task 3 selects the new set in state; “仅保存” navigates to overview, while “保存并打印” keeps preview until `afterprint` or explicit back.

- [ ] **Step 5: Run navigation/component tests**

Run: `npm.cmd test -- --test-name-pattern="quick tree|mistake set workspace"`

---

### Task 5: Central knowledge-library workspace

**Files:**
- Create: `apps/web/components/workspace/KnowledgeWorkspace.tsx`
- Create: `apps/web/lib/knowledge-view.ts`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/components/workspace/SessionSidebar.tsx`
- Modify: `apps/web/styles/history.css`
- Test: `apps/web/tests/knowledge-view.test.ts`
- Test: `apps/web/tests/workspace-components.test.tsx`

**Interfaces:**
- Consumes: saved knowledge cards and card folders.
- Produces: folder overview/detail and `onOpenCard(card, rect, trigger)`, `onMoveCard(card)`.

- [ ] **Step 1: Write failing grouping tests**

Group managed `paper_archive` folders in stable updated order, retain empty managed folders only when they contain knowledge cards, and collect non-managed knowledge cards into “其他知识卡”.

- [ ] **Step 2: Implement paper-style overview and knowledge detail**

Overview mirrors the mistake-collection paper grid; detail rows show title, knowledge point and saved time. Opening uses the existing card FLIP/window path.

- [ ] **Step 3: Change the Knowledge navigation action**

It must close the right sidebar, set central navigation to `knowledge`, and render `KnowledgeWorkspace`. The conversation-header card button remains the way to open the full right card manager.

- [ ] **Step 4: Run focused tests**

Run: `npm.cmd test -- --test-name-pattern="knowledge workspace|knowledge view"`

---

### Task 6: Paper-folder creation and card rearchive for all card states

**Files:**
- Modify: `apps/web/components/FolderLocationSelect.tsx`
- Modify: `apps/web/components/CardMoveDialog.tsx`
- Modify: `apps/web/components/StudyCardModal.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/hooks/useStudyCards.ts`
- Modify: `apps/web/styles/dialogs.css`
- Test: `apps/web/tests/workspace-components.test.tsx`

**Interfaces:**
- Consumes: `createExamPaper(name) -> ExamPaper`, `moveCard(cardId, folderId)` and optional knowledge content update.
- Produces: `onCreatePaperFolder(name) -> Promise<string | null>` used by the location selector and move dialog.

- [ ] **Step 1: Write failing pending/archived placement tests**

Assert flashcard view renders a folder selector for pending and archived cards, archived problem cards can save a new location, and both selectors expose “新建试卷文件夹”.

- [ ] **Step 2: Extend FolderLocationSelect**

Add an inline creation disclosure with name input, cancel and create buttons. Keep the current selection on failure; on success call `onChange(newFolderId)`.

- [ ] **Step 3: Add root paper-folder creator**

Call `createExamPaper`, then refresh exam papers and card folders in parallel; return `paper.card_folder_id` and report API errors through the existing runtime error channel.

- [ ] **Step 4: Support archived content plus placement save**

For knowledge cards, update content first and then move when the chosen folder changed. For problem cards, only move. Always upsert the final server card into the hook and current viewer.

- [ ] **Step 5: Run focused frontend tests**

Run: `npm.cmd test -- --test-name-pattern="folder|placement|archived card"`

---

### Task 7: Whole-card drag and gray pin restoration

**Files:**
- Modify: `apps/web/components/workspace/DraggableCardWindow.tsx`
- Modify: `apps/web/styles/conversation.css`
- Modify: `apps/web/styles/dialogs.css`
- Modify: `apps/web/styles/responsive.css`
- Modify: `apps/web/tests/draggable-card-window.test.tsx`
- Modify: `apps/web/tests/ui-visual-contract.test.ts`
- Modify: `DESIGN.md`

**Interfaces:**
- Consumes: existing geometry helpers and `DraggableCardWindowHandle` callers.
- Produces: the same imperative handle, but `focusHandle()` focuses the window root and pointer dragging originates on non-interactive card surfaces.

- [ ] **Step 1: Change tests to require no drag button and a focusable window**

Assert no `GripVertical`/`cardWindowDragHandle`, root pointer handlers exist, interactive descendants are ignored, and keyboard movement remains.

- [ ] **Step 2: Move pointer/keyboard handling to the root**

Ignore `button, input, select, textarea, a, [contenteditable]`; pointer-capture the root for the remainder. Preserve offset refs, requestAnimationFrame batching, Escape semantics and imperative methods.

- [ ] **Step 3: Restore the gray pin and whole-card affordance**

Remove heading padding and the rule that hides `.flashcardPin`; render it as a low-contrast gray circle. Use `cursor: grab/grabbing` on draggable non-interactive surfaces and no floating handle.

- [ ] **Step 4: Update contract hashes and run drag tests**

Run: `npm.cmd test -- --test-name-pattern="draggable|visual contract|card window"`

---

### Task 8: Documentation, complete verification and commit

**Files:**
- Modify: `README.md`
- Modify: `PRODUCT.md`
- Modify: `DESIGN.md`
- Modify: `docs/database.md`
- Modify: `docs/context-management.md`
- Modify: `docs/how-to-run.md`
- Modify: `docs/changelog.md`

**Interfaces:**
- Consumes: final implementation.
- Produces: current user-facing and persistence documentation.

- [ ] **Step 1: Update current docs and superseded navigation/card contracts**

Document migration 0014, snapshot survival, central knowledge and mistake-set views, history non-navigation, rearchive flow and whole-card drag.

- [ ] **Step 2: Run backend verification**

Run in `apps/api`: `python -m pytest -q` and `python -m ruff check .`.

- [ ] **Step 3: Run frontend verification**

Run in `apps/web`: `npm.cmd test`, `npm.cmd run lint`, `npm.cmd exec tsc -- --noEmit`, `npm.cmd run build`.

- [ ] **Step 4: Run one Impeccable detector pass**

Run once after UI is final: `node C:\Users\robbin\.codex\skills\impeccable\scripts\detect.mjs --json <changed UI targets>`.

- [ ] **Step 5: Browser regression**

Verify 1440, 1318, 901, 900 and 390 widths: history label, both central libraries, cross-paper selection, save/print, source deletion survival, folder creation, all four card placement cases, whole-card mouse/keyboard drag, focus return and zero console errors.

- [ ] **Step 6: Commit verified implementation**

```powershell
git add -A
git commit -m "feat: add printable mistake sets and card rearchive"
```
