# 输入区与试卷清理修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除首页输入区年级选择器、完整显示“推理 · 关闭”，并让清空全部会话同步清除试卷记录及前端缓存状态。

**Architecture:** 前端只断开 `GradeBandPicker` 与 `TutorComposer` 的连接，继续由页面状态向现有 API 提供默认 `junior`。推理控件通过最小宽度、内容自适应与不可收缩标签修复中文档位显示；批量删除在 SQLite 单事务中依次删除 sessions 和 exam papers，前端用请求代次阻止删除前的试卷响应回填。

**Tech Stack:** Next.js 15、React 19、TypeScript、CSS、FastAPI、SQLite、pytest、Node test runner

## Global Constraints

- 保留 `grade_band` API、SQLite 字段及当前默认值 `junior`。
- 单条会话删除不自动删除空试卷。
- SQLite 仍是 session 和 exam paper 的唯一权威来源。
- 已归档全局卡片、模型配置和 API key 存储行为不变。
- 活动生成流存在时，`DELETE /api/sessions` 继续返回 `409` 且不清理任何数据。
- 不修改当前六种教学 action 或 `wait_for_student` 推导方式。

---

### Task 1: 精简输入区并修复推理档位显示

**Files:**
- Modify: `apps/web/components/workspace/TutorComposer.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/styles/conversation.css`
- Test: `apps/web/tests/workspace-components.test.tsx`

**Interfaces:**
- Consumes: `Home` 内现有 `gradeBand` 状态，继续供文字/图片建会话流程使用。
- Produces: 不含 `gradeBand` 和 `onGradeBandChange` 属性的 `TutorComposer`；完整显示当前 `ReasoningEffort` 文案的 `.reasoningPicker`。

- [ ] **Step 1: 写失败的组件契约测试**

在现有 `TutorComposer` 静态渲染测试中删除 `gradeBand` 与 `onGradeBandChange` 参数，并增加源文件/HTML 断言：

```tsx
assert.doesNotMatch(composer, /学习阶段|初中|高中/);
assert.doesNotMatch(tutorComposerSource, /GradeBandPicker|onGradeBandChange|gradeBand:/);
assert.match(composer, /推理\s*·\s*关闭/);
assert.match(conversationCss, /\.reasoningPicker\s*\{[^}]*min-width:\s*128px/);
assert.match(conversationCss, /\.reasoningPickerCurrentLabel\s*\{[^}]*flex:\s*0\s+0\s+auto/s);
```

- [ ] **Step 2: 编译并运行定向前端测试，确认旧实现失败**

Run: `npm exec tsc -- -p tsconfig.test.json`

Run: `node --test --test-name-pattern="composer" dist/test/tests/workspace-components.test.js`

Working directory: `apps/web`

Expected: FAIL，指出 `TutorComposer` 仍要求年级属性或仍渲染 `GradeBandPicker`，且推理控件 CSS 不满足新约束。

- [ ] **Step 3: 实现最小输入区修改**

从 `TutorComposer.tsx` 删除 `GradeBandPicker` import、两个 Props 字段、函数解构项和 JSX：

```tsx
// 删除整段
<GradeBandPicker
  value={gradeBand}
  disabled={Boolean(sessionId) || composerBlocked || speechBusy}
  onChange={onGradeBandChange}
/>
```

从 `page.tsx` 的 `<TutorComposer>` 调用删除：

```tsx
gradeBand={gradeBand}
onGradeBandChange={setGradeBand}
```

保留 `const [gradeBand, setGradeBand] = useState<...>("junior")` 以及打开历史会话时的 `setGradeBand(opened.grade_band)`。

在 `conversation.css` 中调整：

```css
.reasoningPicker {
  position: relative;
  min-width: 128px;
  flex: 0 0 auto;
}

.reasoningPickerCurrentLabel {
  flex: 0 0 auto;
  color: #62635e;
  font-size: 10px;
  white-space: nowrap;
}
```

移除该规则内的 `overflow: hidden` 和 `text-overflow: ellipsis`，保留下拉箭头现有固定空间。

- [ ] **Step 4: 运行组件测试与类型检查**

Run: `npm exec tsc -- -p tsconfig.test.json`

Run: `node --test --test-name-pattern="composer" dist/test/tests/workspace-components.test.js`

Run: `npm exec tsc -- --noEmit`

Working directory: `apps/web`

Expected: 两条命令均退出 0。

- [ ] **Step 5: 提交前端控件修复**

```bash
git add apps/web/components/workspace/TutorComposer.tsx apps/web/app/page.tsx apps/web/styles/conversation.css apps/web/tests/workspace-components.test.tsx
git commit -m "fix(web): simplify composer controls"
```

### Task 2: 在同一事务中清空会话与试卷

**Files:**
- Modify: `apps/api/app/storage/repositories.py`
- Test: `apps/api/tests/test_chat_flow.py`

**Interfaces:**
- Consumes: `SessionRepository.delete_all_sessions() -> None`，由 `DELETE /api/sessions` 路由调用。
- Produces: 原子删除全部 `sessions` 与 `exam_papers` 的相同公开方法；路由签名和响应保持不变。

- [ ] **Step 1: 扩展批量删除回归测试**

在 `test_delete_all_sessions_clears_sqlite_and_logs_but_preserves_saved_cards` 中，删除前创建试卷并将第二个 session 归属该试卷：

```python
paper = client.post("/api/exam-papers", json={"name": "待清理试卷"}).json()
second = client.post(
    "/api/sessions",
    json={
        "grade_band": "junior",
        "subject": "math",
        "model_profile_id": profile_id,
        "problem_text": "计算 $2+2$。",
        "student_initial_thought": "",
        "paper_id": paper["id"],
    },
).json()["session_id"]
assert client.get("/api/exam-papers").json()["papers"]
```

批量删除后增加：

```python
assert client.get("/api/exam-papers").json()["papers"] == []
```

并在 `test_bulk_delete_is_rejected_while_a_chat_stream_is_active` 中先创建试卷，断言 `409` 后试卷仍存在。

- [ ] **Step 2: 运行后端定向测试，确认试卷残留**

Run: `python -m pytest -q tests/test_chat_flow.py -k "delete_all_sessions or bulk_delete"`

Working directory: `apps/api`

Expected: FAIL，成功删除路径仍返回旧试卷。

- [ ] **Step 3: 实现数据库原子清理**

修改 `delete_all_sessions`，复用同一连接的事务：

```python
def delete_all_sessions(self) -> None:
    """Delete sessions and exam papers while preserving archived global cards."""
    with self.db.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM sessions")
        conn.execute("DELETE FROM exam_papers")
```

依赖连接上下文在正常退出时提交、异常时回滚；删除顺序满足 `sessions.paper_id -> exam_papers.id` 外键约束。

- [ ] **Step 4: 运行后端定向测试**

Run: `python -m pytest -q tests/test_chat_flow.py -k "delete_all_sessions or bulk_delete"`

Working directory: `apps/api`

Expected: PASS，活动流拒绝路径不删除试卷，成功路径同时清空试卷。

- [ ] **Step 5: 提交后端事务修复**

```bash
git add apps/api/app/storage/repositories.py apps/api/tests/test_chat_flow.py
git commit -m "fix(api): clear exam papers with sessions"
```

### Task 3: 清理前端试卷状态并阻止旧响应回填

**Files:**
- Modify: `apps/web/app/page.tsx`
- Test: `apps/web/tests/workspace-components.test.tsx`

**Interfaces:**
- Consumes: `examPapersRequestRef: MutableRefObject<number>` 与 `setExamPapers`。
- Produces: `handleDeleteAllSessions()` 的成功分支使旧请求失效并同步设置空试卷数组。

- [ ] **Step 1: 写失败的清空状态契约测试**

提取 `handleDeleteAllSessions` 源码并断言清空发生在 API 成功之后：

```ts
const deleteStart = pageSource.indexOf("async function handleDeleteAllSessions()");
const deleteEnd = pageSource.indexOf("function readFileAsDataUrl", deleteStart);
const deleteSource = pageSource.slice(deleteStart, deleteEnd);

assert.ok(deleteStart >= 0 && deleteEnd > deleteStart);
assert.match(
  deleteSource,
  /await deleteAllSessions\(\);[\s\S]*examPapersRequestRef\.current \+= 1;[\s\S]*setExamPapers\(\[\]\)/
);
```

- [ ] **Step 2: 编译并运行定向测试，确认旧成功分支没有清空试卷**

Run: `npm exec tsc -- -p tsconfig.test.json`

Run: `node --test --test-name-pattern="exam paper|clear" dist/test/tests/workspace-components.test.js`

Working directory: `apps/web`

Expected: FAIL，`handleDeleteAllSessions` 中缺少请求失效和 `setExamPapers([])`。

- [ ] **Step 3: 实现成功后的状态清理**

在 `await deleteAllSessions()` 后、其他前端清理之前加入：

```tsx
examPapersRequestRef.current += 1;
setExamPapers([]);
```

不要在请求发出前清空，确保 API 失败或 `409` 时仍保留当前试卷列表。

- [ ] **Step 4: 运行试卷、清空与输入区定向测试**

Run: `npm exec tsc -- -p tsconfig.test.json`

Run: `node --test --test-name-pattern="exam paper|clear|composer" dist/test/tests/workspace-components.test.js`

Working directory: `apps/web`

Expected: PASS。

- [ ] **Step 5: 提交前端清理修复**

```bash
git add apps/web/app/page.tsx apps/web/tests/workspace-components.test.tsx
git commit -m "fix(web): clear stale exam paper state"
```

### Task 4: 同步现行文档

**Files:**
- Modify: `README.md`
- Modify: `docs/context-management.md`
- Modify: `docs/changelog.md`

**Interfaces:**
- Consumes: 已验证的 `DELETE /api/sessions` 行为和首页输入区行为。
- Produces: 与代码一致的运行说明、存储语义和未发布变更记录。

- [ ] **Step 1: 更新 README 当前行为**

将首页输入区说明改为“年级段选择入口暂从首页移除，底层仍使用默认 `junior`”，并将清空全部会话说明补充为“同时删除全部试卷记录；保留归档卡片和模型配置”。

- [ ] **Step 2: 更新上下文与存储文档**

将 `docs/context-management.md` 的 `DELETE /api/sessions` 段落明确为：同一 SQLite 事务删除 sessions 与 exam papers，其他 session 子表按现有外键/触发器清理，归档卡片与模型配置保留。

- [ ] **Step 3: 更新未发布变更**

在 `docs/changelog.md` 的“未发布”顶部增加“输入区与试卷清理修复”，记录年级选择器移除、推理“关闭”兼容和批量删除试卷三项变化。

- [ ] **Step 4: 检查文档格式与差异**

Run: `git diff --check`

Expected: 退出 0，无尾随空格或冲突标记。

- [ ] **Step 5: 提交文档同步**

```bash
git add README.md docs/context-management.md docs/changelog.md
git commit -m "docs: document composer and exam cleanup behavior"
```

### Task 5: 完整验证

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes: Tasks 1–4 的全部修改。
- Produces: 可交付的测试、类型和构建证据。

- [ ] **Step 1: 运行完整后端测试**

Run: `python -m pytest -q`

Working directory: `apps/api`

Expected: 全部通过，0 failures。

- [ ] **Step 2: 运行完整前端测试**

Run: `npm test`

Working directory: `apps/web`

Expected: 全部通过，0 failures。

- [ ] **Step 3: 运行 TypeScript 类型检查**

Run: `npm exec tsc -- --noEmit`

Working directory: `apps/web`

Expected: 退出 0。

- [ ] **Step 4: 运行生产构建**

Run: `npm run build`

Working directory: `apps/web`

Expected: Next.js 构建与设计契约注入均成功。

- [ ] **Step 5: 核对最终差异和工作区边界**

Run: `git diff --check HEAD~4..HEAD`

Run: `git status --short --branch`

Expected: 本次提交只包含计划内文件；用户既有 `.impeccable/` 与 `.superpowers/` 未跟踪内容保持不变。
