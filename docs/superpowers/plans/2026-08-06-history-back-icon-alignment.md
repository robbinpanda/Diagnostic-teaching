# History Detail Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align and distill the history detail back control, then return restored history sessions to the existing answer-page navigation state.

**Architecture:** Keep the existing `onBackToOverview` interaction and introduce only a detail-header modifier class. The modifier widens the capped header by its two existing `32px` paddings, while the icon button remains a normal flex item; this creates exact wide-screen alignment without negative margins or absolute positioning. When a history question opens, keep the existing `handleOpenSession` data flow but let `handleOpenHistorySession` own the main-navigation transition to `"start"`; remove the asynchronous helper's stale `"history"` write so it cannot override that explicit choice. `SessionSidebar` retains its local history-tree expansion state and no new page or route is introduced.

**Tech Stack:** React 19, Next.js 15, TypeScript, Lucide React, CSS, Node test runner with server-rendered markup contracts.

## Global Constraints

- The visible back control is icon-only and remains exactly `44 × 44px`.
- Its accessible name and tooltip are both `返回全部试卷`.
- The detail header changes; the history overview header keeps its current width and layout.
- Opening a history question reuses the existing conversation page, activates “开始答疑”, and leaves the history tree expanded.
- Do not call `handleStartNewChat` while restoring a history session.
- Do not change search, sort, deletion, session restoration, sidebar, or learning-card behavior.
- Do not stage or modify `.impeccable/**` or `.superpowers/**`.

---

### Task 1: Align and distill the history detail back control

**Files:**
- Modify: `apps/web/tests/workspace-components.test.tsx:274-292`
- Modify: `apps/web/tests/ui-visual-contract.test.ts:199-275`
- Modify: `apps/web/components/workspace/HistoryWorkspace.tsx:116-134`
- Modify: `apps/web/styles/history.css:12-105`

**Interfaces:**
- Consumes: `HistoryWorkspace` prop `onBackToOverview: () => void` and `HistoryView` mode `"paper"`.
- Produces: `.historyWorkspaceHeaderDetail` and an icon-only `.historyWorkspaceBack` button with `aria-label` and `title` set to `返回全部试卷`.

- [ ] **Step 1: Write failing component and visual contracts**

In `workspace-components.test.tsx`, extend the existing history overview/detail test with:

```tsx
const backButton = detail.match(
  /<button class="historyWorkspaceBack"[\s\S]*?<\/button>/
)?.[0] ?? "";

assert.match(detail, /historyWorkspaceHeader historyWorkspaceHeaderDetail/);
assert.match(backButton, /aria-label="返回全部试卷"/);
assert.match(backButton, /title="返回全部试卷"/);
assert.match(backButton, /<svg/);
assert.doesNotMatch(backButton, /<span>/);
```

In the history visual-contract test, add:

```ts
assert.match(
  history,
  /\.historyWorkspaceHeader\.historyWorkspaceHeaderDetail\s*\{[\s\S]*?width:\s*min\(1184px,\s*100%\)/
);
assert.match(
  history,
  /\.historyWorkspaceBack\s*\{[\s\S]*?width:\s*44px;[\s\S]*?min-width:\s*44px;[\s\S]*?flex:\s*0 0 44px;[\s\S]*?padding:\s*0;/
);
```

- [ ] **Step 2: Run the full frontend test command and confirm red state**

Run from `apps/web`:

```powershell
npm.cmd test
```

Expected: exit code `1`; the new component contract cannot find `historyWorkspaceHeaderDetail`/icon-only attributes and the visual contract cannot find the new `1184px`/`44px` rules.

- [ ] **Step 3: Implement the minimal React markup**

Change the header and back button in `HistoryWorkspace.tsx` to:

```tsx
<header
  className={`historyWorkspaceHeader${view.mode === "paper" ? " historyWorkspaceHeaderDetail" : ""}`}
>
  {view.mode === "paper" ? (
    <button
      className="historyWorkspaceBack"
      type="button"
      onClick={onBackToOverview}
      aria-label="返回全部试卷"
      title="返回全部试卷"
    >
      <ArrowLeft size={18} aria-hidden="true" />
    </button>
  ) : null}
```

Keep the existing conditional left-navigation button immediately before this detail button. Do not add a visible `<span>` and do not change `onBackToOverview`.

- [ ] **Step 4: Implement exact alignment and hit-area CSS**

Add after the base header rule in `history.css`:

```css
.historyWorkspaceHeader.historyWorkspaceHeaderDetail {
  width: min(1184px, 100%);
}
```

Replace the back-button sizing block with:

```css
.historyWorkspaceBack {
  width: 44px;
  min-width: 44px;
  flex: 0 0 44px;
  align-self: flex-start;
  padding: 0;
}
```

Keep horizontal padding and typography only on `.historyWorkspaceAction`; do not leave the shared action padding rule on `.historyWorkspaceBack`.

- [ ] **Step 5: Run lint and type checking**

Run from `apps/web`:

```powershell
npm.cmd run lint
npm.cmd run typecheck
```

Expected: both commands exit `0` with no lint or TypeScript errors.

- [ ] **Step 6: Run the full frontend tests**

Run from `apps/web`:

```powershell
npm.cmd test
```

Expected: exit code `0` and all frontend tests pass.

- [ ] **Step 7: Run the production build**

Run from `apps/web`:

```powershell
npm.cmd run build
```

Expected: exit code `0`, the production build compiles, and `/` exports successfully.

- [ ] **Step 8: Verify the requested geometry in the browser**

At a wide detail view with the left sidebar open, confirm:

```js
Math.abs(
  document.querySelector(".historyWorkspaceBack").getBoundingClientRect().left
  - document.querySelector(".historyQuestionRow").getBoundingClientRect().left
) <= 1
```

Also confirm the back button is `44 × 44px`, contains no visible text, exposes the accessible name `返回全部试卷`, returns to the overview when clicked, and creates no document-level horizontal overflow at `1920 × 1080` and `390 × 844`.

- [ ] **Step 9: Commit the implementation**

```powershell
git add -- apps/web/tests/workspace-components.test.tsx apps/web/tests/ui-visual-contract.test.ts apps/web/components/workspace/HistoryWorkspace.tsx apps/web/styles/history.css
git commit -m "fix(web): align history back icon"
```

---

### Task 2: Return restored history sessions to answer navigation

**Files:**
- Modify: `apps/web/tests/workspace-components.test.tsx:165-265`
- Modify: `apps/web/app/page.tsx:765-772`

**Interfaces:**
- Consumes: `handleOpenHistorySession(targetSessionId: string)`, `setActiveNavigation`, `setHistoryView`, and existing `handleOpenSession(targetSessionId)`.
- Produces: the existing conversation UI with `activeNavigation === "start"`; it does not create a route, page, or new session.

- [ ] **Step 1: Write the failing navigation source contract**

After `openHistorySource` is created in the existing bootstrap/navigation test, also slice `handleOpenSession` from its declaration through `handleOpenHistoryPaper` as `openSessionSource`, then add:

```ts
assert.match(
  openHistorySource,
  /setHistoryView\(null\);[\s\S]*?setActiveNavigation\("start"\);[\s\S]*?void handleOpenSession\(targetSessionId\);/
);
assert.doesNotMatch(openHistorySource, /handleStartNewChat\(/);
assert.doesNotMatch(openSessionSource, /setActiveNavigation\(/);
```

- [ ] **Step 2: Run the full frontend test command and confirm red state**

Run from `apps/web`:

```powershell
npm.cmd test
```

Expected: exit code `1`; the wrapper contract sees `setActiveNavigation("history")` instead of `setActiveNavigation("start")`, and the helper contract detects the asynchronous `"history"` override.

- [ ] **Step 3: Make the history entry own navigation state**

Change the navigation assignment inside `handleOpenHistorySession`:

```ts
function handleOpenHistorySession(targetSessionId: string) {
  invalidateBootstrapNavigation();
  setHistoryView(null);
  setActiveNavigation("start");
  setRightOpen(false);
  void handleOpenSession(targetSessionId);
}
```

Remove the `setActiveNavigation("history")` call from the successful `handleOpenSession` branch. Keep its session loading, request-staleness guard, model/grade restoration, draft restoration, and run recovery unchanged. The separate refresh-bootstrap path continues to own its existing `"history"` restoration state.

Do not call `handleStartNewChat`, do not change `SessionSidebar`, and do not reset its `historyExpanded` or `expandedPaperIds` state.

- [ ] **Step 4: Run the full frontend tests**

Run from `apps/web`:

```powershell
npm.cmd test
```

Expected: exit code `0` and all frontend tests pass.

- [ ] **Step 5: Run lint and type checking**

Run from `apps/web`:

```powershell
npm.cmd run lint
npm.cmd run typecheck
```

Expected: both commands exit `0` with no lint or TypeScript errors.

- [ ] **Step 6: Run the production build**

Run from `apps/web`:

```powershell
npm.cmd run build
```

Expected: exit code `0`; the production build compiles and exports `/` successfully.

- [ ] **Step 7: Verify the navigation transition in the browser**

From the history overview, open a paper and then one question. Confirm the existing conversation timeline is restored, the “开始答疑” button owns the active navigation class, “历史搜题” is not active, and the `按试卷分组的历史题目` region remains rendered and expanded. Confirm no new route or blank-new-chat state appears.

- [ ] **Step 8: Commit the navigation change**

```powershell
git add -- apps/web/tests/workspace-components.test.tsx apps/web/app/page.tsx
git commit -m "fix(web): return history sessions to chat navigation"
```
