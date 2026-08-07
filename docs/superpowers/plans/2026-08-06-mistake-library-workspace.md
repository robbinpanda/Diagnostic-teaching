# Mistake Library Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the history quick tree while moving its central paper views into 错题合集, make exam-paper/card-folder lifecycles stable, and turn the active study card into a draggable window without message avoidance.

**Architecture:** SQLite owns paper, session, card, and managed-folder identity. A managed card-folder key survives paper deletion and allows a same-name paper to reuse the old folder, while session deletion atomically prunes only the now-empty paper. The Next.js workspace keeps one canonical collection view, a shared filtered card-library tree, and one draggable active-card shell whose drag transform is isolated from the existing FLIP motion transform.

**Tech Stack:** Python 3.11+, FastAPI, SQLite, Alembic, pytest, Next.js 15, React 19, TypeScript, CSS, node:test.

## Global Constraints

- Keep the history search quick tree and all of its open/search/delete behavior.
- SQLite remains the only session-recovery authority; JSONL/Markdown remain append-only diagnostics.
- Only saved cards survive session deletion; pending cards continue to be deleted by the existing trigger.
- Both card types share a managed `按试卷归档 / <试卷名>` folder, but explicit placement for the current save wins.
- Preserve all six teaching actions, backend-derived `wait_for_student`, durable input idempotency, checkpoint atomicity, and serial `session_runs`.
- Keep original problem image data URLs and multimodal model binding unchanged.
- Do not persist card-window coordinates; disable free drag at widths `<=900px`.
- Use existing product tokens and motion language; do not introduce a second visual theme.

---

### Task 1: Add managed paper archive folders to the database

**Files:**
- Create: `apps/api/migrations/versions/0013_paper_archive_folders.py`
- Modify: `apps/api/tests/test_database_migrations.py`
- Modify: `apps/api/app/core/schemas.py`

**Interfaces:**
- Produces: `card_folders.managed_kind`, `card_folders.managed_key`, `exam_papers.card_folder_id`.
- Produces: `CardFolderPublic.managed_kind` and `ExamPaperPublic.card_folder_id`.
- Uses managed keys `paper-archive-root:v1` and `paper-archive:v1:<ASCII-lower-clean-name>`.

- [ ] **Step 1: Write failing migration tests**

Add fixtures that migrate from `0012_merge_exam_run_heads` and assert the root/folder mapping, old paper IDs, card backfill, durable event folder IDs, unique indexes, and empty `PRAGMA foreign_key_check`:

```python
def test_paper_archive_migration_reuses_names_and_preserves_ids(tmp_path: Path):
    db_path = seed_revision_0012_with_paper_cards(tmp_path)
    upgrade_database(db_path)
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        paper = conn.execute("SELECT * FROM exam_papers WHERE id='paper_existing'").fetchone()
        folder = conn.execute(
            "SELECT * FROM card_folders WHERE managed_key=? COLLATE NOCASE",
            ("paper-archive:v1:期中卷",),
        ).fetchone()
        assert paper["card_folder_id"] == folder["id"]
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
```

Cover an existing root, existing same-name child, pending/saved/default/custom/orphan cards, case-only key collisions, and repeated startup.
Build the fixture by calling Alembic `command.upgrade(config, "0012_merge_exam_run_heads")`, inserting rows into that real schema, and then upgrading to `head`; do not simulate the old revision with a partial hand-written schema.

- [ ] **Step 2: Run the focused migration tests and confirm failure**

Run: `python -m pytest -q tests/test_database_migrations.py`

Expected: FAIL because revision `0013_paper_archive_folders` and new columns do not exist.

- [ ] **Step 3: Implement the migration**

Create the migration with exact metadata constraints and indexes:

```sql
managed_kind TEXT CHECK (
  managed_kind IS NULL OR managed_kind IN ('paper_archive_root', 'paper_archive')
),
managed_key TEXT,
CHECK ((managed_kind IS NULL) = (managed_key IS NULL));

CREATE UNIQUE INDEX uq_card_folders_managed_key
ON card_folders(managed_key COLLATE NOCASE)
WHERE managed_key IS NOT NULL;
```

The upgrade must claim or create the archive root, claim/create each paper child, rebuild `exam_papers` with a non-null `card_folder_id` and `ON DELETE RESTRICT`, recreate `uq_exam_papers_name`, add a unique paper-folder index, backfill eligible cards, update matching `card.ready` payload JSON, and fail on inconsistent pending events. The downgrade keeps folders/cards as ordinary rows, rebuilds the old paper table, removes metadata/indexes, and checks foreign keys.

- [ ] **Step 4: Add public read-only schema fields**

```python
class ExamPaperPublic(BaseModel):
    id: str
    name: str
    card_folder_id: str
    session_count: int = 0

class CardFolderPublic(BaseModel):
    id: str
    name: str
    parent_id: str | None = None
    is_system: bool = False
    managed_kind: Literal["paper_archive_root", "paper_archive"] | None = None
```

- [ ] **Step 5: Run migration tests until green**

Run: `python -m pytest -q tests/test_database_migrations.py`

Expected: PASS, including upgrade, downgrade, repeated initialization, and foreign-key checks.

- [ ] **Step 6: Commit the migration slice**

```bash
git add apps/api/migrations/versions/0013_paper_archive_folders.py apps/api/tests/test_database_migrations.py apps/api/app/core/schemas.py
git commit -m "feat(api): add managed paper card archives"
```

---

### Task 2: Make paper-folder creation and folder protection atomic

**Files:**
- Modify: `apps/api/app/storage/card_folder_repository.py`
- Modify: `apps/api/app/storage/exam_paper_repository.py`
- Modify: `apps/api/app/routes/card_folders.py`
- Modify: `apps/api/app/routes/exam_papers.py`
- Modify: `apps/api/tests/test_card_folders.py`
- Modify: `apps/api/tests/test_problem_splitting.py`

**Interfaces:**
- Produces: `paper_archive_key(name: str) -> str`.
- Produces: `ensure_paper_archive_folder(conn, name: str) -> sqlite3.Row`.
- `create_exam_paper(name)` returns a row containing `card_folder_id`.

- [ ] **Step 1: Write failing repository/API tests**

```python
def test_same_name_paper_reuses_managed_folder_after_paper_delete(client):
    first = client.post("/api/exam-papers", json={"name": "期中卷"}).json()
    with client.app.state.db.connect() as conn:
        conn.execute("DELETE FROM exam_papers WHERE id = ?", (first["id"],))
    second = client.post("/api/exam-papers", json={"name": "期中卷"}).json()
    assert second["id"] != first["id"]
    assert second["card_folder_id"] == first["card_folder_id"]
```

Also test concurrent same-name create, promotion of an existing same-name child, protection from rename/move/delete, and rejection of user create/move into the managed root.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `python -m pytest -q tests/test_card_folders.py tests/test_problem_splitting.py`

- [ ] **Step 3: Implement stable key and ensure helpers**

```python
PAPER_ARCHIVE_ROOT_KEY = "paper-archive-root:v1"

def paper_archive_key(name: str) -> str:
    clean = name.strip()
    ascii_lower = "".join(chr(ord(ch) + 32) if "A" <= ch <= "Z" else ch for ch in clean)
    return f"paper-archive:v1:{ascii_lower}"

def ensure_paper_archive_folder(conn: sqlite3.Connection, name: str) -> sqlite3.Row:
    """Return the protected child, promoting a same-name ordinary child in-place."""
```

Use the existing `BEGIN IMMEDIATE` in `create_exam_paper`; never open a nested connection. Validate managed child parentage. Protect `is_system OR managed_kind` and return stable domain errors from routes.

- [ ] **Step 4: Return mapping fields from paper/folder routes**

Update `paper_from_row()` and `folder_from_row()` to include the new read-only fields. Do not expose `managed_key`.

- [ ] **Step 5: Run focused tests**

Run: `python -m pytest -q tests/test_card_folders.py tests/test_problem_splitting.py`

Expected: PASS.

- [ ] **Step 6: Commit the repository slice**

```bash
git add apps/api/app/storage/card_folder_repository.py apps/api/app/storage/exam_paper_repository.py apps/api/app/routes/card_folders.py apps/api/app/routes/exam_papers.py apps/api/tests/test_card_folders.py apps/api/tests/test_problem_splitting.py
git commit -m "feat(api): reuse paper archive folders"
```

---

### Task 3: Prune empty papers inside authoritative session transactions

**Files:**
- Create: `apps/api/app/storage/session_deletion_repository.py`
- Modify: `apps/api/app/storage/repositories.py`
- Modify: `apps/api/app/services/session_start_acceptance.py`
- Modify: `apps/api/app/storage/session_history_repository.py`
- Modify: `apps/api/app/routes/sessions.py`
- Modify: `apps/api/tests/test_chat_flow.py`
- Modify: `apps/api/tests/test_input_acceptance.py`
- Modify: `apps/api/tests/test_run_lifecycle.py`
- Modify: `apps/api/tests/test_session_logger.py`
- Modify: `apps/api/tests/test_session_intake.py`
- Modify: `apps/api/tests/test_problem_splitting.py`

**Interfaces:**
- Produces: `SessionDeleteConflictError` and `SessionDeletionRepositoryMixin`.
- `SessionRepository.delete(session_id)` keeps its public no-content behavior but atomically prunes the old paper.
- `delete_all_sessions()` atomically deletes sessions and papers.

- [ ] **Step 1: Write failing lifecycle and concurrency tests**

```python
def test_delete_last_paper_session_prunes_only_paper(client):
    paper, first, second = create_paper_with_two_sessions(client)
    assert client.delete(f"/api/sessions/{first}").status_code == 204
    assert get_paper(client, paper["id"]) is not None
    assert client.delete(f"/api/sessions/{second}").status_code == 204
    assert get_paper(client, paper["id"]) is None

def test_delete_session_preserves_saved_cards_and_drops_pending(client):
    # Save one knowledge/problem card, leave another pending, delete last session.
    # Assert saved rows/folder remain and pending row/paper disappear.
```

Add queued/running 409, rollback, concurrent create-vs-delete, restore-vs-delete, stale paper ID, DB failure/log preservation, and log failure-after-commit tests.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `python -m pytest -q tests/test_chat_flow.py tests/test_input_acceptance.py tests/test_run_lifecycle.py tests/test_session_logger.py tests/test_session_intake.py tests/test_problem_splitting.py`

- [ ] **Step 3: Implement busy-retried deletion transactions**

```python
class SessionDeleteConflictError(RuntimeError):
    pass

class SessionDeletionRepositoryMixin:
  @with_sqlite_busy_retry
  def delete(self, session_id: str) -> None:
    with self.db.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT paper_id FROM sessions WHERE id=?", (session_id,)).fetchone()
        if row is None:
            raise KeyError(session_id)
        if conn.execute(
            "SELECT 1 FROM session_runs WHERE session_id=? AND status IN ('queued','running')",
            (session_id,),
        ).fetchone():
            raise SessionDeleteConflictError(session_id)
        conn.execute("DELETE FROM sessions WHERE id=?", (session_id,))
        if row["paper_id"]:
            conn.execute(
                "DELETE FROM exam_papers WHERE id=? AND NOT EXISTS "
                "(SELECT 1 FROM sessions WHERE paper_id=?)",
                (row["paper_id"], row["paper_id"]),
            )
```

Apply the equivalent global run check plus `DELETE sessions; DELETE exam_papers` to clear-all.

- [ ] **Step 4: Move paper validation into every write transaction**

Add a shared in-transaction paper assertion to `SessionRepository.create`, `SessionStartAcceptanceMixin.start_sessions`, and `SessionHistoryRepositoryMixin.restore`. Convert missing/stale paper errors to the stable 400 response “所选试卷已不存在，请重新选择”.

- [ ] **Step 5: Correct route/log ordering**

Map `SessionDeleteConflictError` to 409. Commit SQLite first, then call `logger.delete()` / `logger.delete_all()` in a warning-only `try` block. Keep 204 responses.

- [ ] **Step 6: Run focused tests**

Run: `python -m pytest -q tests/test_chat_flow.py tests/test_input_acceptance.py tests/test_run_lifecycle.py tests/test_session_logger.py tests/test_session_intake.py tests/test_problem_splitting.py`

Expected: PASS.

- [ ] **Step 7: Commit the lifecycle slice**

```bash
git add apps/api/app/storage/session_deletion_repository.py apps/api/app/storage/repositories.py apps/api/app/services/session_start_acceptance.py apps/api/app/storage/session_history_repository.py apps/api/app/routes/sessions.py apps/api/tests/test_chat_flow.py apps/api/tests/test_input_acceptance.py apps/api/tests/test_run_lifecycle.py apps/api/tests/test_session_logger.py apps/api/tests/test_session_intake.py apps/api/tests/test_problem_splitting.py
git commit -m "feat(api): prune papers with their final session"
```

---

### Task 4: Default generated and saved cards to the paper archive

**Files:**
- Modify: `apps/api/app/storage/card_folder_repository.py`
- Modify: `apps/api/app/storage/tutor_actions.py`
- Modify: `apps/api/app/storage/study_card_repository.py`
- Modify: `apps/api/app/services/card_dismissal_acceptance.py`
- Modify: `apps/api/tests/test_card_folders.py`
- Modify: `apps/api/tests/test_chat_flow.py`
- Modify: `apps/api/tests/test_input_acceptance.py`
- Modify: `apps/api/tests/test_session_events.py`

**Interfaces:**
- Produces: `session_card_folder_id(conn, session_id, card_type) -> str`.
- Extends `resolve_card_folder(..., preferred_folder_id: str | None = None)`.
- Keeps explicit client folder selection highest priority.

- [ ] **Step 1: Write failing default-placement tests**

```python
def test_both_card_types_default_to_session_paper_folder(repository):
    paper = repository.create_exam_paper("函数练习")
    session = create_session(repository, paper_id=paper["id"])
    knowledge = record_card(repository, session["id"], "knowledge_card")
    problem = record_card(repository, session["id"], "problem_card")
    assert knowledge["folder_id"] == paper["card_folder_id"]
    assert problem["folder_id"] == paper["card_folder_id"]
```

Test `card.ready.folder_id`, explicit save override, omitted-folder fallback to the generated folder, and unclassified fallback to existing type defaults.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `python -m pytest -q tests/test_card_folders.py tests/test_chat_flow.py tests/test_input_acceptance.py tests/test_session_events.py`

- [ ] **Step 3: Implement generated placement**

Resolve `sessions.paper_id -> exam_papers.card_folder_id` on the existing tutor-action connection. Write the same resolved ID into `study_cards.folder_id` and the `card.ready` payload.

- [ ] **Step 4: Implement save fallback priority**

```python
def resolve_card_folder(
    conn: sqlite3.Connection,
    folder_id: str | None,
    card_type: str,
    *,
    preferred_folder_id: str | None = None,
) -> str:
    resolved = folder_id or preferred_folder_id or default_folder_id(card_type)
```

Pass `card_row["folder_id"]` as `preferred_folder_id` from both save paths. Preserve existing atomic input/event behavior.

- [ ] **Step 5: Run focused tests**

Run: `python -m pytest -q tests/test_card_folders.py tests/test_chat_flow.py tests/test_input_acceptance.py tests/test_session_events.py`

Expected: PASS.

- [ ] **Step 6: Commit the placement slice**

```bash
git add apps/api/app/storage/card_folder_repository.py apps/api/app/storage/tutor_actions.py apps/api/app/storage/study_card_repository.py apps/api/app/services/card_dismissal_acceptance.py apps/api/tests/test_card_folders.py apps/api/tests/test_chat_flow.py apps/api/tests/test_input_acceptance.py apps/api/tests/test_session_events.py
git commit -m "feat(api): default cards to paper archives"
```

---

### Task 5: Synchronize paper/card-folder state in the web client

**Files:**
- Modify: `apps/web/lib/api/types.ts`
- Modify: `apps/web/hooks/useStudyCards.ts`
- Modify: `apps/web/lib/card-folders.ts`
- Modify: `apps/web/components/FolderLocationSelect.tsx`
- Modify: `apps/web/components/workspace/StudyCardSidebar.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/tests/card-folders.test.ts`
- Modify: `apps/web/tests/workspace-components.test.tsx`
- Modify: `apps/web/tests/api-http.test.ts`

**Interfaces:**
- Adds `ExamPaper.card_folder_id` and `CardFolder.managed_kind`.
- `refreshCards()` gains request-generation protection and remains awaitable.
- Managed folders are selectable for cards but not renameable/movable/deletable.

- [ ] **Step 1: Write failing type/helper/component tests**

```ts
test("managed paper folders are selectable but protected", () => {
  const folder = paperArchiveFolder("期中卷");
  assert.equal(canManageFolder(folder), false);
  assert.equal(canPlaceCardInFolder(folder), true);
});
```

Add stale cards/folders response tests, folder refresh after paper creation, type-filtered counts, and hidden global clear in single-type views.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- --test-name-pattern="folder|paper|card library"`

If the script does not forward the filter, run: `npm test`.

- [ ] **Step 3: Extend API types and folder helpers**

```ts
export type CardFolder = {
  id: string;
  name: string;
  parent_id: string | null;
  is_system: boolean;
  managed_kind?: "paper_archive_root" | "paper_archive" | null;
};

export function isProtectedFolder(folder: CardFolder) {
  return folder.is_system || Boolean(folder.managed_kind);
}
```

- [ ] **Step 4: Add request-generation protection**

Use a ref counter in `useStudyCards`; only the latest `Promise.all([fetchCards(), fetchCardFolders()])` can update state. Increment before mutations that require authoritative refresh.

- [ ] **Step 5: Refresh all affected projections**

After `createExamPaper`, await `Promise.all([refreshExamPapers(), refreshCards()])`. After single-session delete, invalidate and refresh history plus papers rather than inferring prune from local counts. After clear-all, invalidate both generations and clear both states.

- [ ] **Step 6: Run focused and full web tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 7: Commit the client data slice**

```bash
git add apps/web/lib/api/types.ts apps/web/hooks/useStudyCards.ts apps/web/lib/card-folders.ts apps/web/components/FolderLocationSelect.tsx apps/web/components/workspace/StudyCardSidebar.tsx apps/web/app/page.tsx apps/web/tests/card-folders.test.ts apps/web/tests/workspace-components.test.tsx apps/web/tests/api-http.test.ts
git commit -m "feat(web): synchronize paper card archives"
```

---

### Task 6: Move the central history views into 错题合集 while retaining the quick tree

**Files:**
- Modify: `apps/web/components/workspace/SessionSidebar.tsx`
- Modify: `apps/web/components/workspace/HistoryWorkspace.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/styles/shell.css`
- Modify: `apps/web/styles/history.css`
- Modify: `apps/web/styles/responsive.css`
- Modify: `apps/web/tests/workspace-components.test.tsx`
- Modify: `apps/web/tests/history-view.test.ts`

**Interfaces:**
- Splits central ownership from right-library overlay state:

```ts
type WorkspaceContentNavigation = "start" | "history" | "mistake_collection";
type CardLibraryNavigation = "knowledge" | "mistakes";
type WorkspaceNavigation = WorkspaceContentNavigation | CardLibraryNavigation;
```

- `activeNavigation` is `rightOpen && cardLibraryNavigation ? cardLibraryNavigation : contentNavigation`.
- Keeps one `HistoryWorkspace` instance/state model; visible copy becomes 错题合集.

- [ ] **Step 1: Write failing navigation/render tests**

```tsx
test("history quick tree remains while mistake library exposes two children", () => {
  const html = renderSidebar({ activeNavigation: "mistake_collection" });
  assert.match(html, /历史搜题/);
  assert.match(html, /错题合集/);
  assert.match(html, /打开错题库/);
  assert.equal(countAriaCurrent(html), 1);
});
```

Test history-label alias to collection, parent default, tree session open -> history active, refresh restore ownership, collection copy, last-session detail fallback, and low-height reachability contract.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test`

- [ ] **Step 3: Implement the parent/child navigation**

Use separate expansion state for history and mistake-library groups. The history main button opens the canonical collection target; its chevron independently toggles the quick tree. Give parent/child distinct accessible names and only the canonical target `aria-current`.

- [ ] **Step 4: Move visible central ownership**

Update `HistoryWorkspace` headings, descriptions, ARIA, loading/empty/error copy to 错题合集. Keep overview query/sort in `page.tsx`; keep per-paper query ephemeral. On opening a session, clear collection view and set history ownership.

- [ ] **Step 5: Make sidebar height resilient**

Ensure the primary navigation can scroll, the quick-tree scroller has `min-height:0`, and knowledge/mistake children remain reachable at `390×600`.

- [ ] **Step 6: Run web tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 7: Commit the navigation slice**

```bash
git add apps/web/components/workspace/SessionSidebar.tsx apps/web/components/workspace/HistoryWorkspace.tsx apps/web/app/page.tsx apps/web/styles/shell.css apps/web/styles/history.css apps/web/styles/responsive.css apps/web/tests/workspace-components.test.tsx apps/web/tests/history-view.test.ts
git commit -m "feat(web): move history views into mistake collections"
```

---

### Task 7: Build the draggable card-window primitive

**Files:**
- Create: `apps/web/lib/card-window-geometry.ts`
- Create: `apps/web/components/workspace/DraggableCardWindow.tsx`
- Modify: `apps/web/components/workspace/CardShelfTabs.tsx`
- Modify: `apps/web/components/workspace/ConversationHeader.tsx`
- Modify: `apps/web/components/workspace/StudyCardSidebar.tsx`
- Modify: `apps/web/styles/conversation.css`
- Modify: `apps/web/styles/dialogs.css`
- Modify: `apps/web/styles/responsive.css`
- Create: `apps/web/tests/card-window-geometry.test.ts`
- Modify: `apps/web/tests/workspace-components.test.tsx`

**Interfaces:**
- Produces: `clampCardWindowOffset`, `getCardWindowKeyboardCommand`, and `getRectTransitionMotion` pure functions.
- Produces: `DraggableCardWindow` with outer motion and inner drag layers.
- `DraggableCardWindowHandle` exposes `consumeOffsetAndReset`, `reset`, `reclamp`, and `focusHandle`.
- Keeps `StudyCardModal` content unchanged; the wrapper owns the dedicated handle.
- `CardShelfTabs` and `StudyCardSidebar` pass `{ trigger, rect }` with the opened card; `ConversationHeader` accepts a ref for its card-panel toggle fallback.

- [ ] **Step 1: Write failing geometry tests**

```ts
test("clamps the full title bar inside message viewport", () => {
  const restingRect = { left: 400, top: 100, right: 800, bottom: 500, width: 400, height: 400 };
  const boundsRect = { left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700 };
  assert.deepEqual(
    clampCardWindowOffset(restingRect, boundsRect, { x: 900, y: -200 }, 12),
    { x: 188, y: -88 }
  );
});
```

Cover oversized cards, resize re-clamp, default reset, 16px arrows, 4px shifted arrows, and Home.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test`

- [ ] **Step 3: Implement pure geometry**

```ts
export type CardWindowPoint = { x: number; y: number };
export type CardWindowRect = {
  left: number; top: number; right: number; bottom: number;
  width: number; height: number;
};
export function clampCardWindowOffset(
  restingRect: CardWindowRect,
  boundsRect: CardWindowRect,
  candidateOffset: CardWindowPoint,
  padding = 12
): CardWindowPoint;
```

- [ ] **Step 4: Implement the window shell**

Use Pointer Events, pointer capture, refs, and one `requestAnimationFrame` write per frame. Observe both `.messageViewport` and the card with `ResizeObserver`. The dedicated wrapper handle receives `touch-action:none`, keyboard movement, and Home reset. Hide it and use the safe full-width layout at `<=900px`.

```ts
export type DraggableCardWindowHandle = {
  consumeOffsetAndReset(): CardWindowPoint;
  reset(options?: { focusHandle?: boolean }): void;
  reclamp(): void;
  focusHandle(): void;
};
```

- [ ] **Step 5: Keep content accessible**

Limit height to the boundary; make the card body scroll while title/actions remain reachable. Pending Escape cancels drag only. Archived Escape calls the supplied close state machine.

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test`

Run: `npm exec tsc -- --noEmit`

Expected: both PASS.

- [ ] **Step 7: Commit the primitive**

```bash
git add apps/web/lib/card-window-geometry.ts apps/web/components/workspace/DraggableCardWindow.tsx apps/web/components/workspace/CardShelfTabs.tsx apps/web/components/workspace/ConversationHeader.tsx apps/web/components/workspace/StudyCardSidebar.tsx apps/web/styles/conversation.css apps/web/styles/dialogs.css apps/web/styles/responsive.css apps/web/tests/card-window-geometry.test.ts apps/web/tests/workspace-components.test.tsx
git commit -m "feat(web): add draggable study card window"
```

---

### Task 8: Integrate card motion and remove message avoidance

**Files:**
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/components/workspace/MessageTimeline.tsx`
- Modify: `apps/web/components/workspace/StudyCardSidebar.tsx`
- Modify: `apps/web/styles/conversation.css`
- Modify: `apps/web/styles/responsive.css`
- Modify: `apps/web/tests/workspace-components.test.tsx`
- Modify: `apps/web/tests/ui-visual-contract.test.ts`

**Interfaces:**
- `DraggableCardWindow` wraps the latest pending card or selected archived card.
- Existing shelf motion phases remain `preparing/opening/open/closing/idle`.
- Removes `floatingObstacleRef`, `floatingObstacleActive`, and `floatingCardAvoidanceWidth`.
- `MessageTimeline` accepts `viewportRef` and binds it directly to `.messageViewport` for drag bounds.

- [ ] **Step 1: Replace avoidance tests with window integration tests**

Remove tests for `floatingCardAvoidanceWidth`. Add source/render contracts for no avoidance observers/classes, one active window, archived/pending Escape semantics, drawer fallback focus, and reduced motion final states.

- [ ] **Step 2: Run web tests and confirm expected failures**

Run: `npm test`

- [ ] **Step 3: Integrate the outer/inner transform layers**

Wrap `displayedDockCard` in `DraggableCardWindow`. During close, capture the visible dragged rect, transfer the offset to the outer motion layer in the same `flushSync`, zero the inner offset, and compute the target from the still-visible source. Disable drag during motion phases.

Use `event.target === event.currentTarget` plus the outer `animationName` to distinguish enter/open/close completion; child animations must not advance the shelf state machine.

- [ ] **Step 4: Handle right-library origins**

Capture the sidebar item before open. Keep the persistent desktop right rail open at `>=1320px`. At `<=1319px`, close the drawer and use a lightweight exit/focus fallback to the conversation-header card button instead of animating toward hidden content.

- [ ] **Step 5: Remove avoidance code completely**

Delete the MessageTimeline props/helper/effect, `.avoidsKnowledgeCard`, and `--knowledge-card-avoidance-width`. Messages remain full width.

- [ ] **Step 6: Update intentional visual contract hashes**

Recompute only the hashes for files intentionally changed by this feature; keep all unrelated frozen contracts unchanged.

- [ ] **Step 7: Run web tests, lint, typecheck, and build**

Run: `npm test`

Run: `npm run lint`

Run: `npm exec tsc -- --noEmit`

Run: `npm run build`

Expected: all exit 0.

- [ ] **Step 8: Commit the integration slice**

```bash
git add apps/web/app/page.tsx apps/web/components/workspace/MessageTimeline.tsx apps/web/components/workspace/StudyCardSidebar.tsx apps/web/styles/conversation.css apps/web/styles/responsive.css apps/web/tests/workspace-components.test.tsx apps/web/tests/ui-visual-contract.test.ts
git commit -m "feat(web): integrate draggable card motion"
```

---

### Task 9: Update behavior documentation and complete verification

**Files:**
- Modify: `README.md`
- Modify: `DESIGN.md`
- Modify: `docs/context-management.md`
- Modify: `docs/database.md`
- Modify: `docs/changelog.md`
- Modify: `docs/superpowers/specs/2026-08-06-composer-and-exam-paper-cleanup-design.md`
- Modify: `docs/superpowers/specs/2026-08-05-history-search-home-design.md`

**Interfaces:**
- Documents the new authoritative deletion and archive behavior.
- Marks superseded sentences in older specs rather than leaving contradictory current guidance.

- [ ] **Step 1: Update all current docs**

Document the preserved quick tree, canonical 错题合集, managed folder identity, saved/pending deletion boundary, same-name reuse, shared typed views, draggable window, `>900px` threshold, and removal of message avoidance.

- [ ] **Step 2: Scan for stale contradictory copy**

Run:

```powershell
rg -n "单条会话删除行为不变|空试卷实体继续保留|顶部卡片架|文字避让|历史搜题主页" README.md DESIGN.md docs apps/web
```

Expected: only historical/superseded context explicitly labeled as such.

- [ ] **Step 3: Run full backend verification**

Working directory: `apps/api`

Run: `python -m pytest -q`

Expected: all tests pass with zero failures.

- [ ] **Step 4: Run full frontend verification**

Working directory: `apps/web`

Run: `npm test`

Run: `npm run lint`

Run: `npm exec tsc -- --noEmit`

Run: `npm run build`

Expected: all commands exit 0.

- [ ] **Step 5: Run bounded browser verification**

Verify `1440×900`, `1320×800`, `1319×800`, `1024×600`, `901×768`, `900×768`, `768×1024`, and `390×600`: navigation ownership, quick-tree reachability, last-session paper prune, selector refresh, saved-card survival, same-name folder reuse, mouse/touch/keyboard drag, resize/edit/flip clamping, archived/pending Escape, reduced motion, drawer focus fallback, and full-width messages.

- [ ] **Step 6: Audit every explicit requirement against evidence**

Create a checklist from the approved design §12. Point each item to a test output, source location, or browser observation. Continue fixing until no requirement is missing or supported only indirectly.

- [ ] **Step 7: Commit documentation and any final verified fixes**

```bash
git add README.md DESIGN.md docs apps/api apps/web
git commit -m "docs: document mistake library workspace"
```
