# 历史搜题主页实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有根路由工作台中实现“试卷总览 → 单份试卷题目 → 原答疑会话”的历史搜题主页，并延续已提交的 C4“明亮中庭”视觉系统。

**Architecture:** 保留单根路由和现有左右侧栏，在 `page.tsx` 中用独立 `HistoryView` 控制中央历史视图；用纯函数从已有 `SessionHistoryItem[]` 派生试卷分组、搜索和排序；用受控 `HistoryWorkspace` 渲染总览与详情。历史页不新增请求，打开和删除题目继续复用现有 session 链路。

**Tech Stack:** Next.js 15、React 19、TypeScript 5.6、CSS、KaTeX/`MathText`、Node `node:test`、React `renderToStaticMarkup`、FastAPI/SQLite（仅收纳已完成的继承前置）。

## Global Constraints

- 分支必须保持为 `feat/history-search-home`；基线提交为 `a4eebc6`，规格提交为 `ccff47e`。
- 不 reset、覆盖或丢弃共享工作区里的前序改动；混合文件先看 diff，再按任务边界提交。
- 先验证并独立提交前序已经完成的试卷实体、`paper_id`/`paper_name`、图片建卷与左侧试卷树；中央历史主页不扩展这些后端/API 合同。
- 历史主页只消费现有 `SessionHistoryItem[]`；不得新增缩略图字段、完整 session N+1 请求、图片缓存或新的历史页 API。
- 不新增 Next.js 页面路由、URL 深链或浏览器历史层级。
- `activeNavigation` 只表示一级导航，`historyView` 单独表示中央历史总览/试卷详情；打开题目前必须先清空 `historyView`。
- 总览搜索命中题目时保留整份试卷；详情搜索只过滤当前试卷的题目。
- 总览搜索词和排序由 `page.tsx` 持有，在页面生命周期内保留；刷新后恢复空搜索和“最近更新”。
- 当前打开、运行中、任一打开请求中或任一删除请求中的题目不可删除；清空全部会话仍只存在于左侧树。
- 只使用 C4 `--stage-*` 与现有中性色令牌；`history.css` 不出现原始十六进制颜色，不把黄色当作 `--warning`。
- 不修改 `.appShell`、`.conversationPanel` 的 `transform`/`filter`，不改变学习卡收纳几何、480/440ms 动画、翻面字段或五个冻结文件哈希。
- 中央历史 CSS 统一用 `.historyWorkspace*`、`.historyPaper*`、`.historyQuestion*` 前缀，避免与左侧树已有 `.historySearch`、`.paperGroup`、`.sessionRow` 串样。
- 桌面 3 列；`761–1100px` 2 列；`<=760px` 1 列；主要触控目标至少 `44×44px`，支持键盘焦点与 reduced motion。

---

### Task 1: 收纳并冻结继承的试卷分组前置

**Files:**
- Modify (already present in working tree): `apps/api/app/core/schemas.py`
- Modify (already present in working tree): `apps/api/app/main.py`
- Modify (already present in working tree): `apps/api/app/routes/sessions.py`
- Modify (already present in working tree): `apps/api/app/services/session_start_acceptance.py`
- Modify (already present in working tree): `apps/api/app/storage/repositories.py`
- Modify (already present in working tree): `apps/api/app/storage/session_history_repository.py`
- Create (already present in working tree): `apps/api/app/routes/exam_papers.py`
- Create (already present in working tree): `apps/api/app/storage/exam_paper_repository.py`
- Create (already present in working tree): `apps/api/migrations/versions/0011_exam_papers.py`
- Modify (already present in working tree): `apps/api/tests/test_database_migrations.py`
- Modify (already present in working tree): `apps/api/tests/test_problem_splitting.py`
- Modify (already present in working tree): `apps/api/tests/test_session_events.py`
- Modify (already present in working tree): `apps/web/app/page.tsx`
- Modify (already present in working tree): `apps/web/components/ProblemImageSelector.tsx`
- Modify (already present in working tree): `apps/web/components/workspace/SessionSidebar.tsx`
- Modify (already present in working tree): `apps/web/lib/api.ts`
- Modify (already present in working tree): `apps/web/lib/api/sessions.ts`
- Modify (already present in working tree): `apps/web/lib/api/types.ts`
- Create (already present in working tree): `apps/web/lib/api/exam-papers.ts`
- Modify (already present in working tree): `apps/web/styles/dialogs.css`
- Modify (already present in working tree): `apps/web/styles/shell.css`
- Modify (already present in working tree): `apps/web/tests/workspace-components.test.tsx`
- Modify (already present in working tree): `README.md`
- Modify (already present in working tree): `docs/changelog.md`
- Modify (already present in working tree): `docs/database.md`

**Interfaces:**
- Produces: `SessionHistoryItem.paper_id?: string | null` and `paper_name?: string | null`.
- Produces: `GET/POST /api/exam-papers`, `ExamPaper`, `fetchExamPapers()`, `createExamPaper()`.
- Produces: image batch creation bound to one verified paper and a left-side `paper → session` quick tree.
- Does not produce: any central history page UI.

- [ ] **Step 1: Audit the inherited diff boundary**

Run from the repository root:

```powershell
git diff --stat
git diff -- apps/api apps/web/lib/api apps/web/components/ProblemImageSelector.tsx apps/web/components/workspace/SessionSidebar.tsx apps/web/app/page.tsx apps/web/styles/dialogs.css apps/web/styles/shell.css apps/web/tests/workspace-components.test.tsx README.md docs/changelog.md docs/database.md
git diff --cached --name-only
```

Expected: the index is empty; the listed diff contains exam-paper creation/assignment, paper metadata in history, image selector paper choice and left-side grouping, but no `HistoryWorkspace`, `history-view.ts` or `history.css`.

- [ ] **Step 2: Verify the inherited backend implementation**

Run from `apps/api`:

```powershell
python -m ruff check .
python -m pytest -q
```

Expected: both commands exit `0`; migration `0011_exam_papers`, paper CRUD, session paper binding and restored/history payload tests pass.

- [ ] **Step 3: Verify the inherited frontend implementation**

Run from `apps/web`:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected: lint has no warnings, typecheck exits `0`, TAP reports `fail 0`, and Next production build plus design-contract injection complete.

- [ ] **Step 4: Stage only the inherited prerequisite**

Run from the repository root as separate commands:

```powershell
git add -- apps/api/app/core/schemas.py apps/api/app/main.py apps/api/app/routes/sessions.py apps/api/app/routes/exam_papers.py apps/api/app/services/session_start_acceptance.py apps/api/app/storage/repositories.py apps/api/app/storage/session_history_repository.py apps/api/app/storage/exam_paper_repository.py apps/api/migrations/versions/0011_exam_papers.py apps/api/tests/test_database_migrations.py apps/api/tests/test_problem_splitting.py apps/api/tests/test_session_events.py
git add -- apps/web/app/page.tsx apps/web/components/ProblemImageSelector.tsx apps/web/components/workspace/SessionSidebar.tsx apps/web/lib/api.ts apps/web/lib/api/sessions.ts apps/web/lib/api/types.ts apps/web/lib/api/exam-papers.ts apps/web/styles/dialogs.css apps/web/styles/shell.css apps/web/tests/workspace-components.test.tsx
git add -- README.md docs/changelog.md docs/database.md
git diff --cached --check
git diff --cached --name-status
```

Expected: exactly the 25 files listed above are staged; `docs/superpowers/specs/2026-08-05-history-search-home-design.md`, `.superpowers/` and `.impeccable/` are not staged.

- [ ] **Step 5: Commit the prerequisite**

```powershell
git commit -m "feat: add exam paper session grouping"
```

Expected: one atomic commit and an empty index; untracked design-process artifacts remain untouched.

---

### Task 2: 用纯函数建立历史试卷视图模型

**Files:**
- Create: `apps/web/lib/history-view.ts`
- Create: `apps/web/tests/history-view.test.ts`

**Interfaces:**
- Consumes: `SessionHistoryItem` from `apps/web/lib/api`.
- Produces: `HistoryView`, `HistorySortMode`, `HistoryPaperGroup`, `HistoryPaperAccent`.
- Produces: `buildHistoryPaperGroups`, `filterHistoryPaperGroups`, `filterHistoryQuestions`, `sortHistoryPaperGroups`, `stableHistoryPaperAccent`.

- [ ] **Step 1: Write failing pure-function tests**

Create `apps/web/tests/history-view.test.ts` with these imports and fixture:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { SessionHistoryItem } from "../lib/api";
import {
  buildHistoryPaperGroups,
  filterHistoryPaperGroups,
  filterHistoryQuestions,
  sortHistoryPaperGroups,
  stableHistoryPaperAccent
} from "../lib/history-view";

function historyItem(overrides: Partial<SessionHistoryItem> = {}): SessionHistoryItem {
  return {
    session_id: "session-default",
    paper_id: "paper-default",
    paper_name: "默认试卷",
    title: "默认题目",
    grade_band: "junior",
    model_profile_id: "profile-1",
    model_display_name: "本地演示",
    message_count: 1,
    checkpoint_count: 0,
    state_hint: "diagnosing",
    context_status: "ready",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides
  };
}
```

Then add these exact cases:

```ts
test("history groups sessions into papers and derives latest metadata", () => {
  const groups = buildHistoryPaperGroups([
    historyItem({ session_id: "old", paper_id: "paper-a", paper_name: "期中数学卷", title: "一次函数", grade_band: "junior", updated_at: "2026-08-01T00:00:00Z" }),
    historyItem({ session_id: "legacy", paper_id: null, paper_name: null, title: "旧版方程题", updated_at: "2026-08-02T00:00:00Z" }),
    historyItem({ session_id: "new", paper_id: "paper-a", paper_name: "期中数学卷", title: "等差数列", grade_band: "senior", updated_at: "2026-08-03T00:00:00Z" })
  ]);

  const paper = groups.find((group) => group.id === "paper-a");
  const legacy = groups.find((group) => group.id === "unclassified");
  assert.deepEqual(paper?.items.map((item) => item.session_id), ["new", "old"]);
  assert.equal(paper?.updatedAt, "2026-08-03T00:00:00Z");
  assert.deepEqual(paper?.gradeBands, ["junior", "senior"]);
  assert.equal(legacy?.name, "未分类题目");
});

test("history search keeps matching papers whole and narrows detail questions", () => {
  const groups = buildHistoryPaperGroups([
    historyItem({ session_id: "function", paper_id: "paper-a", paper_name: "期中数学卷", title: "一次函数" }),
    historyItem({ session_id: "sequence", paper_id: "paper-a", paper_name: "期中数学卷", title: "等差数列" }),
    historyItem({ session_id: "geometry", paper_id: "paper-b", paper_name: "二模试卷", title: "圆锥曲线" })
  ]);

  assert.deepEqual(filterHistoryPaperGroups(groups, " 二模 ").map((group) => group.id), ["paper-b"]);
  const byQuestion = filterHistoryPaperGroups(groups, "一次函数");
  assert.deepEqual(byQuestion.map((group) => group.id), ["paper-a"]);
  assert.deepEqual(byQuestion[0].items.map((item) => item.session_id), ["function", "sequence"]);
  assert.deepEqual(filterHistoryQuestions(byQuestion[0].items, "数列").map((item) => item.session_id), ["sequence"]);
});

test("history sorting supports recent and stable zh-CN name modes without mutation", () => {
  const groups = buildHistoryPaperGroups([
    historyItem({ session_id: "z", paper_id: "paper-z", paper_name: "综合卷", updated_at: "2026-08-04T00:00:00Z" }),
    historyItem({ session_id: "a-old", paper_id: "paper-a-old", paper_name: "阿卷", updated_at: "2026-08-02T00:00:00Z" }),
    historyItem({ session_id: "a-new", paper_id: "paper-a-new", paper_name: "阿卷", updated_at: "2026-08-03T00:00:00Z" })
  ]);
  const original = groups.map((group) => group.id);
  assert.deepEqual(sortHistoryPaperGroups(groups, "recent").map((group) => group.id), ["paper-z", "paper-a-new", "paper-a-old"]);
  assert.deepEqual(sortHistoryPaperGroups(groups, "name").map((group) => group.id), ["paper-a-new", "paper-a-old", "paper-z"]);
  assert.deepEqual(groups.map((group) => group.id), original);
});

test("history paper accents are stable C4 token choices", () => {
  assert.equal(stableHistoryPaperAccent("unclassified"), "yellow");
  assert.equal(stableHistoryPaperAccent("paper-a"), "lavender");
  assert.equal(stableHistoryPaperAccent("paper-b"), "sage");
  assert.equal(stableHistoryPaperAccent("paper-a"), stableHistoryPaperAccent("paper-a"));
});
```

- [ ] **Step 2: Run the tests and confirm RED**

Run from `apps/web`:

```powershell
npm.cmd test -- --test-name-pattern="history groups|history search|history sorting|history paper accents"
```

Expected: `TS2307` for `../lib/history-view`, then assertion failures until the implementation exists.

- [ ] **Step 3: Implement the pure model**

Create `apps/web/lib/history-view.ts` with these public contracts and rules:

```ts
import type { SessionHistoryItem } from "./api";

export type HistoryView =
  | { mode: "overview" }
  | { mode: "paper"; paperId: string }
  | null;
export type HistorySortMode = "recent" | "name";
export type HistoryPaperAccent = "yellow" | "lavender" | "sage";
export type HistoryPaperGroup = {
  id: string;
  name: string;
  items: SessionHistoryItem[];
  updatedAt: string;
  gradeBands: Array<SessionHistoryItem["grade_band"]>;
};

export const UNCLASSIFIED_PAPER_ID = "unclassified";

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN");
}

export function buildHistoryPaperGroups(items: readonly SessionHistoryItem[]) {
  const groups = new Map<string, { id: string; name: string; items: SessionHistoryItem[] }>();
  for (const item of items) {
    const id = item.paper_id || UNCLASSIFIED_PAPER_ID;
    const name = id === UNCLASSIFIED_PAPER_ID
      ? "未分类题目"
      : item.paper_name?.trim() || "未命名试卷";
    const group = groups.get(id) ?? { id, name, items: [] };
    group.items.push(item);
    groups.set(id, group);
  }
  return [...groups.values()].map((group): HistoryPaperGroup => {
    const sortedItems = [...group.items].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    const gradeBands = (["junior", "senior"] as const).filter((grade) => sortedItems.some((item) => item.grade_band === grade));
    return { ...group, items: sortedItems, updatedAt: sortedItems[0].updated_at, gradeBands };
  });
}

export function filterHistoryPaperGroups(groups: readonly HistoryPaperGroup[], query: string) {
  const needle = normalized(query);
  if (!needle) return [...groups];
  return groups.filter((group) => normalized(group.name).includes(needle)
    || group.items.some((item) => normalized(item.title || "未命名题目").includes(needle)));
}

export function filterHistoryQuestions(items: readonly SessionHistoryItem[], query: string) {
  const needle = normalized(query);
  if (!needle) return [...items];
  return items.filter((item) => normalized(item.title || "未命名题目").includes(needle));
}

export function sortHistoryPaperGroups(groups: readonly HistoryPaperGroup[], mode: HistorySortMode) {
  return [...groups].sort((left, right) => mode === "recent"
    ? right.updatedAt.localeCompare(left.updatedAt)
    : left.name.localeCompare(right.name, "zh-CN") || right.updatedAt.localeCompare(left.updatedAt));
}

export function stableHistoryPaperAccent(paperId: string): HistoryPaperAccent {
  if (paperId === UNCLASSIFIED_PAPER_ID) return "yellow";
  const accents = ["lavender", "sage", "yellow"] as const;
  let hash = 0;
  for (const character of paperId) hash = (hash + character.codePointAt(0)!) % accents.length;
  return accents[hash];
}
```

- [ ] **Step 4: Run targeted and full tests**

```powershell
npm.cmd test -- --test-name-pattern="history groups|history search|history sorting|history paper accents"
npm.cmd test
```

Expected: all four new tests report `ok`; full TAP reports `fail 0`.

- [ ] **Step 5: Commit the view model**

```powershell
git add -- apps/web/lib/history-view.ts apps/web/tests/history-view.test.ts
git diff --cached --check
git commit -m "feat(web): derive history paper views"
```

---

### Task 3: 构建可访问的历史总览与试卷详情组件

**Files:**
- Create: `apps/web/components/workspace/HistoryWorkspace.tsx`
- Modify: `apps/web/tests/workspace-components.test.tsx`

**Interfaces:**
- Consumes: Task 2 history types/functions and existing `MathText`.
- Consumes: controlled overview query/sort and existing open/delete/busy/runtime state.
- Produces: total overview, paper detail, six skeletons, empty/no-result/error/empty-paper states and accessible actions.

- [ ] **Step 1: Add failing SSR component tests**

Import `HistoryWorkspace`, add three history items named `当前题目`、`生成中题目`、`可删除题目`, and use this shared prop factory:

```ts
const historyWorkspaceItems: SessionHistoryItem[] = [
  {
    session_id: "session-current", paper_id: "paper-a", paper_name: "期中数学卷", title: "当前题目",
    grade_band: "junior", model_profile_id: profile.id, model_display_name: profile.display_name,
    message_count: 3, checkpoint_count: 1, state_hint: "diagnosing", context_status: "ready",
    created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-03T00:00:00Z"
  },
  {
    session_id: "session-running", paper_id: "paper-a", paper_name: "期中数学卷", title: "生成中题目",
    grade_band: "junior", model_profile_id: profile.id, model_display_name: profile.display_name,
    message_count: 2, checkpoint_count: 0, state_hint: "diagnosing", context_status: "ready",
    created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-02T00:00:00Z"
  },
  {
    session_id: "session-delete", paper_id: "paper-a", paper_name: "期中数学卷", title: "可删除题目",
    grade_band: "senior", model_profile_id: profile.id, model_display_name: profile.display_name,
    message_count: 1, checkpoint_count: 0, state_hint: "diagnosing", context_status: "ready",
    created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z"
  }
];

const historyWorkspaceProps = {
  items: historyWorkspaceItems,
  overviewQuery: "",
  sortMode: "recent" as const,
  selectedPaperName: "期中数学卷",
  historyBusy: false,
  historyLoadError: "",
  actionError: "",
  leftOpen: true,
  activeSessionId: "session-current",
  runningSessionIds: ["session-running"],
  openSessionBusyId: "",
  deleteSessionBusyId: "",
  onExpandLeft: () => {},
  onOverviewQueryChange: () => {},
  onSortModeChange: () => {},
  onOpenPaper: () => {},
  onBackToOverview: () => {},
  onOpenSession: () => {},
  onDeleteSession: () => {},
  onStartNewChat: () => {},
  onRetry: () => {},
  onClearActionError: () => {}
};

function historyDeleteButton(markup: string, title: string) {
  const match = markup.match(new RegExp(
    `<button(?=[^>]*class="historyQuestionDelete")(?=[^>]*aria-label="删除会话：${title}")[^>]*>`
  ));
  assert.ok(match);
  return match[0];
}
```

Add these complete cases:

```ts
test("history workspace renders overview and paper detail from real session metadata", () => {
  const overview = renderToStaticMarkup(
    <HistoryWorkspace {...historyWorkspaceProps} view={{ mode: "overview" }} />
  );
  const detail = renderToStaticMarkup(
    <HistoryWorkspace {...historyWorkspaceProps} view={{ mode: "paper", paperId: "paper-a" }} />
  );

  assert.match(overview, /历史搜题/);
  assert.match(overview, /按试卷继续你的学习/);
  assert.match(overview, /搜索试卷或题目/);
  assert.match(overview, /最近更新/);
  assert.match(overview, /名称排序/);
  assert.doesNotMatch(overview, /<img/);
  assert.doesNotMatch(overview, /historyQuestionDelete/);
  assert.match(detail, /返回全部试卷/);
  assert.match(detail, /正在思考/);
  assert.match(detail, /3 条消息/);
  assert.match(detail, /1 个检查点/);
});

test("history workspace renders loading empty no-result error and emptied-paper states", () => {
  const loading = renderToStaticMarkup(<HistoryWorkspace {...historyWorkspaceProps} items={[]} historyBusy view={{ mode: "overview" }} />);
  const empty = renderToStaticMarkup(<HistoryWorkspace {...historyWorkspaceProps} items={[]} view={{ mode: "overview" }} />);
  const noResult = renderToStaticMarkup(<HistoryWorkspace {...historyWorkspaceProps} overviewQuery="不存在" view={{ mode: "overview" }} />);
  const failed = renderToStaticMarkup(<HistoryWorkspace {...historyWorkspaceProps} items={[]} historyLoadError="连接失败" view={{ mode: "overview" }} />);
  const emptiedPaper = renderToStaticMarkup(<HistoryWorkspace {...historyWorkspaceProps} items={[]} view={{ mode: "paper", paperId: "paper-a" }} />);

  assert.equal((loading.match(/class="historyPaperSkeleton"/g) ?? []).length, 6);
  assert.match(empty, /还没有历史答疑/);
  assert.match(empty, /开始答疑/);
  assert.match(noResult, /没有匹配的试卷或题目/);
  assert.match(noResult, /清除搜索/);
  assert.match(failed, /重新加载/);
  assert.match(emptiedPaper, /这份试卷暂无历史题目/);
  assert.match(emptiedPaper, /返回全部试卷/);
});

test("history workspace disables deletion for current running and concurrent sessions", () => {
  const detail = renderToStaticMarkup(
    <HistoryWorkspace {...historyWorkspaceProps} view={{ mode: "paper", paperId: "paper-a" }} />
  );
  assert.match(historyDeleteButton(detail, "当前题目"), /disabled=""/);
  assert.match(historyDeleteButton(detail, "生成中题目"), /disabled=""/);
  assert.doesNotMatch(historyDeleteButton(detail, "可删除题目"), /disabled=""/);

  const opening = renderToStaticMarkup(
    <HistoryWorkspace {...historyWorkspaceProps} openSessionBusyId="session-other" view={{ mode: "paper", paperId: "paper-a" }} />
  );
  assert.match(historyDeleteButton(opening, "可删除题目"), /disabled=""/);
});
```

- [ ] **Step 2: Run component tests and confirm RED**

```powershell
npm.cmd test -- --test-name-pattern="history workspace"
```

Expected: `TS2307` for `HistoryWorkspace` or the new semantic assertions fail.

- [ ] **Step 3: Implement the controlled component contract**

Create `HistoryWorkspace.tsx` with this prop boundary:

```ts
type Props = {
  view: Exclude<HistoryView, null>;
  items: SessionHistoryItem[];
  overviewQuery: string;
  sortMode: HistorySortMode;
  selectedPaperName: string;
  historyBusy: boolean;
  historyLoadError: string;
  actionError: string;
  leftOpen: boolean;
  activeSessionId: string;
  runningSessionIds: string[];
  openSessionBusyId: string;
  deleteSessionBusyId: string;
  onExpandLeft: () => void;
  onOverviewQueryChange: (value: string) => void;
  onSortModeChange: (mode: HistorySortMode) => void;
  onOpenPaper: (group: HistoryPaperGroup) => void;
  onBackToOverview: () => void;
  onOpenSession: (sessionId: string) => void;
  onDeleteSession: (item: SessionHistoryItem) => void;
  onStartNewChat: () => void;
  onRetry: () => void;
  onClearActionError: () => void;
};
```

Inside the component:

```ts
const [paperQuery, setPaperQuery] = useState("");
const groups = useMemo(() => buildHistoryPaperGroups(items), [items]);
const visibleGroups = useMemo(
  () => sortHistoryPaperGroups(filterHistoryPaperGroups(groups, overviewQuery), sortMode),
  [groups, overviewQuery, sortMode]
);
const selectedGroup = view.mode === "paper"
  ? groups.find((group) => group.id === view.paperId)
  : undefined;
const visibleQuestions = filterHistoryQuestions(selectedGroup?.items ?? [], paperQuery);
const runningSessions = new Set(runningSessionIds);
```

Render rules:

- Header always exposes `aria-label="展开会话栏"` when `leftOpen` is false.
- Detail search uses local `paperQuery`; Task 4 keys the component by `paperId`/`overview`, so entering another paper or returning to overview resets only this detail query while the controlled overview query remains intact.
- Overview toolbar uses a labeled search input and `<select aria-label="历史排序">` with values `recent` and `name`.
- Each `.historyPaperCard` is one button; it contains the real grade label, real paper name, `group.items.slice(0, 3)` through `MathText`, count and `updatedAt`, plus `data-accent={stableHistoryPaperAccent(group.id)}`.
- Grade labels are exact: unclassified group `未分类`, both bands `混合学段`, only junior `初中数学`, only senior `高中数学`.
- Format dates with one `Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" })` instance; never use `ExamPaper.updated_at`.
- Overview cards contain no delete, menu, image or nested interactive control.
- Paper detail header contains `返回全部试卷`, the selected group name or `selectedPaperName`, count, and a local paper search input.
- Each `.historyQuestionRow` contains a main open button and a separate `.historyQuestionDelete` button.
- Question metadata contains `message_count`, `checkpoint_count` only when positive, and the formatted session `updated_at`.
- Delete is disabled when `Boolean(deleteSessionBusyId) || Boolean(openSessionBusyId) || isRunning || item.session_id === activeSessionId`.
- Running rows show `Loader2` plus the text `正在思考`.
- `checkpoint_count` is rendered only when greater than zero.
- If `historyLoadError` exists with no items, render a full retry state; with stale items, render an inline alert and keep the content.
- Render `actionError` as a dismissible `role="alert"` without writing it into `historyLoadError`.
- When a selected paper disappears after its last session is deleted, keep the detail header via `selectedPaperName` and render `这份试卷暂无历史题目` without automatic navigation.
- A non-empty detail query with zero matches renders `没有匹配的题目` and a button that calls `setPaperQuery("")`; overview no-results calls `onOverviewQueryChange("")`.

- [ ] **Step 4: Run targeted tests and accessibility markup checks**

```powershell
npm.cmd test -- --test-name-pattern="history workspace"
npm.cmd run typecheck
```

Expected: all history workspace SSR states pass; TypeScript exits `0`.

- [ ] **Step 5: Commit the component**

```powershell
git add -- apps/web/components/workspace/HistoryWorkspace.tsx apps/web/tests/workspace-components.test.tsx
git diff --cached --check
git commit -m "feat(web): add history paper workspace"
```

---

### Task 4: 接入中央三态导航并修复删除竞态

**Files:**
- Modify: `apps/web/app/page.tsx:18-21,109-119,466-474,654-750,1249-1440`
- Modify: `apps/web/components/workspace/SessionSidebar.tsx:158-170`
- Modify: `apps/web/tests/workspace-components.test.tsx`

**Interfaces:**
- Consumes: Task 2 `HistoryView`/`HistorySortMode` and Task 3 `HistoryWorkspace`.
- Produces: one `handleOpenHistorySession()` shared by left tree and central detail.
- Preserves: current runtime, streams, drafts, cards and the complete existing conversation subtree.

- [ ] **Step 1: Add failing page and sidebar contract tests**

Add a source contract named `history navigation owns a three-state central view and separate load errors`. Assert:

```ts
assert.match(pageSource, /useState<HistoryView>\(null\)/);
assert.match(pageSource, /useState<HistorySortMode>\("recent"\)/);
assert.match(pageSource, /const \[historyLoadError, setHistoryLoadError\]/);
assert.match(pageSource, /<HistoryWorkspace/);
```

Slice `refreshHistory` and assert it calls `setHistoryLoadError("")`, writes failure with `setHistoryLoadError`, and contains no `runtime.setError`. Slice `handleOpenHistorySession` and assert `setHistoryView(null)` occurs before `handleOpenSession`.

Render `SessionSidebar` with the active session, no running session and empty open/delete busy IDs; assert its delete button alone still has `disabled=""`.

- [ ] **Step 2: Run the contracts and confirm RED**

```powershell
npm.cmd test -- --test-name-pattern="history navigation|workspace sidebars"
```

Expected: missing state/branch assertions and the active-session delete assertion fail.

- [ ] **Step 3: Add history-owned page state**

Add imports and state:

```ts
import { HistoryWorkspace } from "../components/workspace/HistoryWorkspace";
import type { HistoryPaperGroup, HistorySortMode, HistoryView } from "../lib/history-view";

const [historyView, setHistoryView] = useState<HistoryView>(null);
const [historyOverviewQuery, setHistoryOverviewQuery] = useState("");
const [historySortMode, setHistorySortMode] = useState<HistorySortMode>("recent");
const [historySelectedPaperName, setHistorySelectedPaperName] = useState("");
const [historyLoadError, setHistoryLoadError] = useState("");
```

Initialize `historyBusy` as `true` so a very early navigation click cannot flash the empty state before bootstrap starts.

- [ ] **Step 4: Separate load errors and unify navigation actions**

Implement these boundaries:

```ts
async function refreshHistory() {
  const requestId = historyRequestRef.current + 1;
  historyRequestRef.current = requestId;
  setHistoryBusy(true);
  setHistoryLoadError("");
  try {
    const nextItems = await fetchSessionHistory();
    if (historyRequestRef.current === requestId) setHistoryItems(nextItems);
  } catch (nextError) {
    if (historyRequestRef.current === requestId) {
      setHistoryLoadError(nextError instanceof Error ? nextError.message : "历史会话加载失败");
    }
  } finally {
    if (historyRequestRef.current === requestId) setHistoryBusy(false);
  }
}

function handleOpenHistoryPaper(group: HistoryPaperGroup) {
  setHistorySelectedPaperName(group.name);
  setHistoryView({ mode: "paper", paperId: group.id });
}

function handleOpenHistorySession(targetSessionId: string) {
  setHistoryView(null);
  setActiveNavigation("history");
  setRightOpen(false);
  void handleOpenSession(targetSessionId);
}

function handleStartNewChat() {
  setHistoryView(null);
  setActiveNavigation("start");
  clearCurrentSessionState();
  closeNavigationOnMobile();
}
```

In `restoreSessionAfterRefresh`, after `runtime.loadSession(opened)`, set `historyView` to `null` and `activeNavigation` to `history`.

For `onNavigate`:

- `history`: set `{ mode: "overview" }`, close the right sidebar, call `closeNavigationOnMobile()`, and do not clear the current session.
- `knowledge`/`mistakes`: set `historyView(null)`, open the existing filtered card library and preserve existing mobile closing.
- `start`: set `historyView(null)`; `onNewChat={handleStartNewChat}` performs the existing clear.

Set both sidebar `onOpenSession` and central `onOpenSession` to `handleOpenHistorySession`; do not add `closeNavigationOnMobile` to direct session opening because the existing contract forbids it.

- [ ] **Step 5: Render the history branch without altering conversation internals**

Inside the existing `.conversationPanel`, put `HistoryWorkspace` in the true branch and wrap the current exact `<ConversationHeader>` through `</div>` composer subtree in the false fragment. Pass:

```tsx
<HistoryWorkspace
  key={historyView.mode === "paper" ? historyView.paperId : "overview"}
  view={historyView}
  items={historyItems}
  overviewQuery={historyOverviewQuery}
  sortMode={historySortMode}
  selectedPaperName={historySelectedPaperName}
  historyBusy={historyBusy}
  historyLoadError={historyLoadError}
  actionError={error}
  leftOpen={leftOpen}
  activeSessionId={sessionId}
  runningSessionIds={runningSessionIds}
  openSessionBusyId={openSessionBusyId}
  deleteSessionBusyId={deleteSessionBusyId}
  onExpandLeft={() => setLeftOpen(true)}
  onOverviewQueryChange={setHistoryOverviewQuery}
  onSortModeChange={setHistorySortMode}
  onOpenPaper={handleOpenHistoryPaper}
  onBackToOverview={() => setHistoryView({ mode: "overview" })}
  onOpenSession={handleOpenHistorySession}
  onDeleteSession={(item) => void handleDeleteSession(item)}
  onStartNewChat={handleStartNewChat}
  onRetry={() => void refreshHistory()}
  onClearActionError={runtime.clearError}
/>
```

Do not edit the existing card shelf, message timeline, card dock, composer or right sidebar code inside the false branch.

- [ ] **Step 6: Harden single-session deletion**

In both `SessionSidebar` and `HistoryWorkspace`, include `activeSessionId === item.session_id` in the delete disabled condition. Add this function-level guard before `window.confirm`:

```ts
if (
  item.session_id === sessionId
  || runningSessionIds.includes(item.session_id)
  || Boolean(openSessionBusyId)
  || Boolean(deleteSessionBusyId)
) return;
```

Keep the existing confirmation, API call, request-recovery cleanup, draft cleanup and list update unchanged.

- [ ] **Step 7: Run integration contracts and commit**

```powershell
npm.cmd test -- --test-name-pattern="history navigation|history workspace|workspace sidebars"
npm.cmd run typecheck
git add -- apps/web/app/page.tsx apps/web/components/workspace/SessionSidebar.tsx apps/web/tests/workspace-components.test.tsx
git diff --cached --check
git commit -m "feat(web): route history browsing through the workspace"
```

Expected: targeted tests and typecheck pass; the commit contains no card component/hook changes.

---

### Task 5: 落地 A 方案纸张封面和响应式视觉

**Files:**
- Create: `apps/web/styles/history.css`
- Modify: `apps/web/app/globals.css:1-8`
- Modify: `apps/web/styles/responsive.css:5-67,69-77,79-195,337-440,442-450`
- Modify: `apps/web/tests/ui-visual-contract.test.ts`

**Interfaces:**
- Consumes: C4 stage tokens and Task 3 semantic class names.
- Produces: 3/2/1-column paper grid, local formula overflow, 44px controls and reduced-motion behavior.
- Preserves: shell geometry, card shelf geometry and frozen source hashes.

- [ ] **Step 1: Add a failing visual contract**

Add `history workspace reuses C4 tokens and responsive paper grids` to `ui-visual-contract.test.ts`. It must assert:

```ts
const globals = text("app/globals.css");
const history = text("styles/history.css");
const responsive = text("styles/responsive.css");
assert.match(globals, /@import "\.\.\/styles\/history\.css";[\s\S]*?@import "\.\.\/styles\/responsive\.css";/);
assert.doesNotMatch(history, /#[0-9a-f]{3,8}\b/i);
assert.doesNotMatch(history, /var\(--warning/);
for (const token of ["--stage-canvas", "--stage-line", "--stage-forest", "--stage-sage", "--stage-sage-soft", "--stage-yellow", "--stage-yellow-soft", "--stage-lavender-deep"]) {
  assert.match(history, new RegExp(`var\\(${token}\\)`));
}
assert.match(history, /\.historyPaperGrid\s*\{[\s\S]*?repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
assert.match(responsive, /@media \(max-width: 1100px\) and \(min-width: 761px\)[\s\S]*?\.historyPaperGrid\s*\{[\s\S]*?repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
assert.match(responsive, /@media \(max-width: 760px\)[\s\S]*?\.historyPaperGrid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
assert.match(history, /\.historyQuestionDelete\s*\{[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px/);
```

- [ ] **Step 2: Run the visual contract and confirm RED**

```powershell
npm.cmd test -- --test-name-pattern="history workspace reuses"
```

Expected: `ENOENT styles/history.css` or import/token/grid assertions fail.

- [ ] **Step 3: Create the central history stylesheet**

Import `history.css` after `conversation.css` and before `cards.css`. Create these base rules without raw colors:

```css
.historyWorkspace {
  grid-row: 1 / -1;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  color: var(--neutral-900);
  background: var(--stage-canvas);
}

.historyWorkspaceHeader,
.historyWorkspaceBodyInner {
  width: min(1120px, 100%);
  margin-inline: auto;
}

.historyWorkspaceHeader {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-8) var(--space-4);
}

.historyWorkspaceTitle h1 {
  margin: 0;
  color: var(--stage-ink);
  font-size: clamp(28px, 3vw, 32px);
  line-height: 1.1;
}

.historyWorkspaceTitle p,
.historyPaperMeta,
.historyQuestionMeta {
  color: var(--neutral-600);
}

.historyWorkspaceToolbar {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.historyWorkspaceSearch {
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-inline: var(--space-3);
  border: 1px solid var(--stage-line);
  border-radius: var(--radius-md);
  background: var(--neutral-25);
}

.historyWorkspaceBody {
  min-height: 0;
  overflow: auto;
  padding: 0 var(--space-8) var(--space-8);
}

.historyPaperGrid,
.historySkeletonGrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-5);
}

.historyPaperCard {
  min-width: 0;
  display: grid;
  grid-template-rows: auto 1fr;
  padding: 0;
  overflow: hidden;
  text-align: left;
  border: 1px solid var(--stage-line);
  border-radius: var(--radius-lg);
  background: var(--stage-canvas);
  box-shadow: var(--shadow-card);
  transition: transform 180ms var(--ease-standard), box-shadow 180ms var(--ease-standard), border-color 180ms var(--ease-standard);
}

.historyPaperCard:hover,
.historyPaperCard:focus-visible {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--stage-sage) 54%, var(--stage-line));
  box-shadow: var(--shadow-float);
}

.historyPaperPreview {
  position: relative;
  aspect-ratio: 8 / 5;
  padding: var(--space-5);
  background-color: var(--stage-canvas);
  background-image: linear-gradient(var(--stage-line) 1px, transparent 1px), linear-gradient(90deg, var(--stage-line) 1px, transparent 1px);
  background-size: 24px 24px;
}

.historyPaperCard[data-accent="yellow"] .historyPaperPreview { background-color: color-mix(in srgb, var(--stage-yellow-soft) 16%, var(--stage-canvas)); }
.historyPaperCard[data-accent="lavender"] .historyPaperTab { background: var(--stage-lavender-deep); }
.historyPaperCard[data-accent="sage"] .historyPaperTab { background: var(--stage-sage); }
.historyPaperCard[data-accent="yellow"] .historyPaperTab { background: var(--stage-yellow); }

.historyGradeBadge {
  color: var(--primary-800);
  background: var(--stage-sage-soft);
}

.historyPaperQuestionPreview,
.historyQuestionTitle {
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.historyQuestionList {
  display: grid;
  gap: var(--space-3);
}

.historyQuestionRow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px;
  gap: var(--space-3);
  align-items: stretch;
  border: 1px solid var(--stage-line);
  border-radius: var(--radius-lg);
  background: var(--neutral-25);
}

.historyQuestionDelete {
  min-width: 44px;
  min-height: 44px;
}

.historyWorkspaceState,
.historyWorkspaceAlert {
  border: 1px solid var(--stage-line);
  border-radius: var(--radius-lg);
  background: var(--neutral-50);
}

.historyWorkspaceAlert[role="alert"] {
  border-color: color-mix(in srgb, var(--danger) 32%, var(--stage-line));
  background: var(--danger-soft);
}

.historySkeletonGrid { animation: historySkeletonBreath 1600ms var(--ease-standard) infinite alternate; }
@keyframes historySkeletonBreath { from { opacity: 0.58; } to { opacity: 0.9; } }
```

Add the remaining semantic selectors with these concrete rules; do not use `.titleMathText` inside paper previews or question rows:

```css
.historyWorkspaceNav,
.historyWorkspaceBack,
.historyWorkspaceSort,
.historyWorkspaceAction {
  min-height: 44px;
  border: 1px solid var(--stage-line);
  border-radius: var(--radius-md);
  color: var(--stage-forest);
  background: var(--neutral-25);
}

.historyWorkspaceSearch input {
  min-width: 0;
  width: 240px;
  border: 0;
  outline: 0;
  color: var(--neutral-900);
  background: transparent;
}

.historyPaperTab {
  position: absolute;
  top: 0;
  right: var(--space-5);
  width: 30px;
  height: 7px;
  border-radius: 0 0 var(--radius-md) var(--radius-md);
}

.historyGradeBadge {
  display: inline-flex;
  width: fit-content;
  padding: 4px 8px;
  border-radius: var(--radius-full);
  font-size: 11px;
  font-weight: 700;
}

.historyPaperPreview h2,
.historyQuestionTitle strong {
  margin: 0;
  color: var(--stage-ink);
}

.historyPaperPreviewList {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.historyPaperQuestionPreview {
  color: var(--neutral-900);
  font-size: 12px;
  line-height: 1.5;
}

.historyPaperMeta {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--stage-line);
}

.historyQuestionOpen {
  min-width: 0;
  padding: var(--space-4);
  border: 0;
  text-align: left;
  color: inherit;
  background: transparent;
}

.historyQuestionMeta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
  font-size: 12px;
}

.historyQuestionDelete {
  align-self: center;
  justify-self: center;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--danger);
  background: transparent;
}

.historyQuestionDelete:disabled {
  color: var(--neutral-500);
  cursor: not-allowed;
}

.historyWorkspaceState {
  display: grid;
  place-items: center;
  gap: var(--space-3);
  min-height: 280px;
  padding: var(--space-8);
  text-align: center;
}

.historyWorkspaceAlert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
  padding: var(--space-3) var(--space-4);
}

.historyPaperSkeleton {
  aspect-ratio: 8 / 5;
  border: 1px solid var(--stage-line);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--stage-sage-soft) 18%, var(--stage-canvas));
}
```

- [ ] **Step 4: Add content-width responsive rules**

Add to `responsive.css` before the existing reduced-motion block:

```css
@media (max-width: 1100px) and (min-width: 761px) {
  .historyPaperGrid,
  .historySkeletonGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 900px) and (min-width: 761px) {
  .historyWorkspaceHeader { align-items: stretch; flex-direction: column; }
  .historyWorkspaceToolbar { width: 100%; margin-left: 0; }
  .historyWorkspaceSearch { flex: 1; }
}

@media (max-width: 760px) {
  .historyWorkspaceHeader { align-items: stretch; flex-direction: column; padding: var(--space-4); }
  .historyWorkspaceToolbar { width: 100%; margin-left: 0; }
  .historyWorkspaceSearch { flex: 1; }
  .historyWorkspaceBody { padding: 0 var(--space-4) var(--space-6); }
  .historyPaperGrid,
  .historySkeletonGrid { grid-template-columns: 1fr; }
  .historyQuestionRow { grid-template-columns: minmax(0, 1fr) 44px; }
}

@media (max-width: 480px) {
  .historyWorkspaceHeader,
  .historyWorkspaceBody { padding-inline: var(--space-3); }
  .historyWorkspaceToolbar { flex-direction: column; }
  .historyWorkspaceSearch,
  .historyWorkspaceSort { width: 100%; }
}
```

In the existing reduced-motion block, explicitly disable `.historyPaperCard` translation and `.historySkeletonGrid` animation.

- [ ] **Step 5: Run visual and frozen-contract tests**

```powershell
npm.cmd test -- --test-name-pattern="history workspace reuses|C4 bright atrium|medium widths|card behavior sources"
npm.cmd run lint
npm.cmd run typecheck
```

Expected: all selected tests pass; frozen hashes remain unchanged; lint/typecheck exit `0`.

- [ ] **Step 6: Commit the visual layer**

```powershell
git add -- apps/web/styles/history.css apps/web/app/globals.css apps/web/styles/responsive.css apps/web/tests/ui-visual-contract.test.ts
git diff --cached --check
git commit -m "feat(web): style the history paper workspace"
```

---

### Task 6: 更新产品与设计文档

**Files:**
- Modify: `DESIGN.md:121-125`
- Modify: `README.md:42-58`
- Modify: `docs/superpowers/specs/2026-08-05-history-search-home-design.md:5-23`

**Interfaces:**
- Documents: three-state central history navigation, A content-paper preview and inherited exam-paper prerequisite.
- Preserves: C4 visual contract and existing product behavior descriptions.

- [ ] **Step 1: Update DESIGN.md**

Replace the obsolete “flat recent sessions / no paper grouping” section with explicit contracts:

- Left sidebar remains the quick `paper → question` tree and owns “clear all sessions”.
- Central overview uses 3/2/1 content-paper cards derived from real history.
- Central detail lists real metadata and opens the original session.
- `HistoryView` is independent from `activeNavigation`.
- Current/running/concurrent operations disable single deletion.
- No thumbnail API, no paper-level delete, no card-system behavior changes.

- [ ] **Step 2: Update README.md**

Extend the history paragraph to state that “历史搜题” now opens a central paper overview, supports paper/question search and recent/name sorting, opens paper detail, and restores the original session without copying it.

- [ ] **Step 3: Self-check documentation consistency**

```powershell
rg -n "平铺会话|不引入试卷分组|历史搜题|内容化纸张|HistoryView" DESIGN.md README.md docs/superpowers/specs/2026-08-05-history-search-home-design.md
git diff --check
```

Expected: obsolete C4-only statements are removed from `DESIGN.md`; all three documents agree on scope and navigation.

- [ ] **Step 4: Commit docs**

```powershell
git add -- DESIGN.md README.md docs/superpowers/specs/2026-08-05-history-search-home-design.md
git diff --cached --check
git commit -m "docs: document the history paper workspace"
```

---

### Task 7: 完整自动化与浏览器验收

**Files:**
- Verify only: all files from Tasks 1–6.
- Do not modify: frozen card components/hooks unless a verified regression requires a separate approved scope change.

**Interfaces:**
- Verifies: clean branch reproducibility, functional history flow, responsive layout, accessibility and card regression safety.

- [ ] **Step 1: Run full backend quality gates**

Run from `apps/api`:

```powershell
python -m ruff check .
python -m pytest -q
```

Expected: both exit `0`.

- [ ] **Step 2: Run full frontend quality gates**

Run from `apps/web`:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected: lint has no warnings; typecheck exits `0`; TAP reports `fail 0`; Next build and contract injection complete.

- [ ] **Step 3: Audit branch and frozen boundaries**

Run from the repository root:

```powershell
git status --short --branch
git log --oneline --decorate -8
git diff a4eebc6 -- apps/web/components/StudyCardModal.tsx apps/web/components/workspace/CardShelfTabs.tsx apps/web/components/workspace/StudyCardSidebar.tsx apps/web/hooks/useStudyCards.ts apps/web/hooks/useSessionRuntime.ts
git diff --check
```

Expected: branch is `feat/history-search-home`; frozen-file diff is empty; only known design-process artifacts may remain untracked.

- [ ] **Step 4: Run desktop and tablet browser QA**

Open `http://127.0.0.1:3000/` at `1440×900`, `1280×800`, `1024×768` and `768×1024`. At every size:

- Enter history from the left navigation; confirm the topbar and quick tree remain.
- Search by paper name and by question name; use both sort modes; clear a no-result search.
- Open a paper and return; confirm overview search/sort are retained.
- Open a question; confirm the original conversation, messages, checkpoints, cards, draft and running state restore.
- Confirm current/running questions cannot be deleted and a normal question still requires confirmation.
- Confirm 3 columns at 1440/1280, 2 columns at 1024/768, no page-level horizontal overflow and a working “展开会话栏” control when the drawer is closed.

- [ ] **Step 5: Run mobile, keyboard and reduced-motion QA**

Repeat at `390×844` and `375×812`:

- Confirm one column, stacked tools, fixed header return action, 44px delete target, safe areas and no horizontal overflow.
- Complete expand/search/sort/open/back/open-session using keyboard only and verify visible focus.
- Enable reduced motion and confirm no card lift, page entrance translation or skeleton breathing.
- Keep another session generating while browsing history and verify the stream is not stopped.
- Reopen one learning card, flip it, and close it along the existing path to confirm history CSS does not affect the C4 card contract.

- [ ] **Step 6: Final independent review**

Request one read-only spec review and one read-only code/visual review. Resolve all priority defects, rerun the affected targeted test and then rerun the complete frontend gate before reporting completion.
