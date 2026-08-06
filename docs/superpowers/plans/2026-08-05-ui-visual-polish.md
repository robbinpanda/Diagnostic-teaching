# Luminous Atrium UI Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有诊断式数学答疑工作台重构为已批准的「明亮中庭」视觉，同时保持全部业务功能、“试卷 → 题目”信息层级，以及右侧卡片收纳与自然滑出/返回形式。

**Architecture:** 保留现有单路由 React 组件树和状态链路，使用独立的 `--stage-*` / `--shell-*` 设计令牌与 CSS-first 表面重构完成视觉升级。卡片外观通过 `card-theme.ts`、`cards.css` 和 `dialogs.css` 更新；卡片来源筛选、竖向重叠收纳几何、`getBoundingClientRect()` 开合测量、状态机和正反面字段映射由合同测试锁定。

**Tech Stack:** Next.js 15、React 19、TypeScript 5.6、原生 CSS、Lucide React、KaTeX、Node test runner、Electron。

## Global Constraints

- 只在 `feat/ui-visual-polish` 分支实施，不切回或改写用户原分支。
- 保持根路由、业务 API、教学状态机、数据字段和原有信息层级不变。
- 左侧历史始终按“试卷 → 题目”组织；无试卷题目进入“未分类题目”。
- 卡片的配色、材质、排版和正反面视觉可以调整；右侧卡签的筛选/顺序/数量、66×128px 竖向重叠形式、自然滑出/返回轨迹、开合状态机、翻面触发和正反面字段映射不得改变。
- 不新增熊猫、卡通角色、无关插画、业务模块、页面路由或前端依赖。
- 不给 `.appShell`、`.conversationPanel` 或卡片 dock 的祖先增加 `transform`、`scale` 或 `filter`，避免破坏卡片几何测量。
- 使用 Windows/中文系统字体，不请求网络字体。
- 所有新动效尊重 `prefers-reduced-motion`；正文对比度至少 4.5:1；主要交互具备可见焦点。
- 当前工作区在本任务开始前已有大量用户未提交改动。不得暂存或提交这些既有改动；仅新文档/新资产可独立提交。对已经脏的实现文件以 `git diff --check`、测试与浏览器截图作为任务检查点，除非用户另行授权，不创建混入其既有改动的实现提交。

---

### Task 1: 锁定卡片收纳/滑动合同并恢复历史侧栏回归

**Files:**
- Create: `apps/web/tests/ui-visual-contract.test.ts`
- Modify: `apps/web/tests/workspace-components.test.tsx`
- Modify: `apps/web/components/workspace/SessionSidebar.tsx`
- Modify: `apps/web/app/page.tsx`

**Interfaces:**
- Consumes: 现有 `SessionSidebar` props、`openShelfCard(card, origin)`、`closeShelfCard()` 和 `StudyCardModal` 正反面状态。
- Produces: `.historyDangerZone`、`.clearSessionsButton`；恢复完整历史树操作；可执行的源文件哈希与卡片动画合同测试。

- [ ] **Step 1: 新增冻结文件与动画合同测试**

创建 `apps/web/tests/ui-visual-contract.test.ts`，使用以下结构锁定行为文件与几何常量：

```ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = (path: string) => readFileSync(resolve(__dirname, `../../../${path}`));
const text = (path: string) => source(path).toString("utf8");
const sha256 = (path: string) => createHash("sha256").update(source(path)).digest("hex").toUpperCase();

const frozenFiles = new Map([
  ["components/StudyCardModal.tsx", "00AFE8C85B9F13B45DD365F2EA960C74258CF90719D102F91CE496B8F058A721"],
  ["components/workspace/CardShelfTabs.tsx", "8CDC67AC6615C122CC7B57C690F7C32FF3EAC4DB2F5F62990C42C4D87F55B5EF"],
  ["components/workspace/StudyCardSidebar.tsx", "811FA9B446B6257992A07F8E831BF2DFA5244D56AB3867B94FA4FB53C5FAF393"],
  ["hooks/useStudyCards.ts", "E6E2ED3FCFFADD7E58DF592571B9AECC51DA37111DB9400682B9F04152824E94"],
  ["hooks/useSessionRuntime.ts", "FA0DEF4BFF68A4D5549E22547CA6CA5D982CF6BF3891A2DF2A8F67C0BBA9279A"],
  ["lib/api/types.ts", "646C76F6B9455C9D629E0EA9EC7895C887B2EE3BC6492CC042221CD1EC1DED7D"]
]);

test("card behavior sources stay byte-identical", () => {
  for (const [path, expected] of frozenFiles) assert.equal(sha256(path), expected, path);
});

test("card shelf geometry and slide timing stay unchanged", () => {
  const shell = text("styles/shell.css");
  const conversation = text("styles/conversation.css");
  assert.match(shell, /\.cardShelfTabs button\s*\{[^}]*width:\s*66px;[^}]*height:\s*128px;[^}]*margin-top:\s*-28px;/s);
  assert.match(shell, /\.cardShelfTabs button\.firstKnowledgeTab\s*\{[^}]*margin-top:\s*32px;/s);
  assert.match(conversation, /shelfCardOpen 480ms cubic-bezier\(0\.22, 0\.82, 0\.24, 1\)/);
  assert.match(conversation, /shelfCardClose 440ms cubic-bezier\(0\.4, 0, 0\.2, 1\)/);
  assert.match(conversation, /@keyframes activeCardDockEnter[\s\S]*translate3d\(100vw,/);
});
```

- [ ] **Step 2: 运行测试确认现有卡片合同通过**

Run: `npm.cmd test -- --test-name-pattern="card behavior|card shelf geometry"`

Expected: 两项 PASS；如果哈希失败，先确认文件是否在本计划生成前被用户继续修改，不得更新期望值掩盖差异。

- [ ] **Step 3: 把历史侧栏回归写成失败测试**

在 `workspace-components.test.tsx` 的 sidebar 测试中：

```ts
assert.match(sessions, /clearSessionsButton/);
assert.match(sessions, /清空全部会话/);
assert.match(sessions, /期中数学卷/);
assert.ok(sessions.indexOf("期中数学卷") < sessions.indexOf("方程题"));

const pageSource = readFileSync(resolve(__dirname, "../../../app/page.tsx"), "utf8");
assert.doesNotMatch(
  pageSource,
  /onOpenSession=\{\(targetSessionId\)[\s\S]*?closeNavigationOnMobile\(\)[\s\S]*?handleOpenSession/
);
```

再渲染 `openSessionBusyId="session-a"` 的侧栏，断言对应 `.sessionDeleteButton` 含 `disabled`；增加 `paper_id: null` / `paper_name: null` fixture 并断言出现“未分类题目”。

- [ ] **Step 4: 运行侧栏测试确认失败**

Run: `npm.cmd test -- --test-name-pattern="workspace sidebars"`

Expected: FAIL，至少包含缺失 `clearSessionsButton` 或仍调用 `closeNavigationOnMobile()`。

- [ ] **Step 5: 恢复清空入口和删除禁用**

在 `SessionSidebar` props 解构中加入 `deleteAllSessionsBusy` 与 `onDeleteAllSessions`；在 `.paperTreeScroll` 后加入：

```tsx
<div className="historyDangerZone">
  <button
    className="clearSessionsButton"
    type="button"
    onClick={onDeleteAllSessions}
    disabled={deleteAllSessionsBusy || runningSessions.size > 0 || historyItems.length === 0}
  >
    {deleteAllSessionsBusy ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
    清空全部会话
  </button>
</div>
```

把单题删除的禁用条件改为：

```tsx
disabled={Boolean(deleteSessionBusyId) || Boolean(openSessionBusyId) || isRunning}
```

- [ ] **Step 6: 恢复会话导航状态且不自动收起**

在 `handleOpenSession` 成功加载后执行 `setActiveNavigation("history")`。在 `SessionSidebar.onOpenSession` 回调中删除 `closeNavigationOnMobile()`，保留 `void handleOpenSession(targetSessionId)`。

- [ ] **Step 7: 运行目标测试和静态检查**

Run: `npm.cmd test -- --test-name-pattern="workspace sidebars|card behavior|card shelf geometry"`

Expected: PASS。

- [ ] **Step 8: 保存安全检查点**

Run: `git diff --check -- apps/web/tests/ui-visual-contract.test.ts apps/web/tests/workspace-components.test.tsx apps/web/components/workspace/SessionSidebar.tsx apps/web/app/page.tsx`

Expected: 无输出。由于三个实现文件在任务前已是脏文件，本步骤不提交它们。

---

### Task 2: 建立明亮中庭的视觉令牌、背景与方向合同

**Files:**
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/styles/base.css`
- Create: `apps/web/public/ambient-grain.webp`
- Modify: `apps/web/tests/ui-visual-contract.test.ts`

**Interfaces:**
- Consumes: 已批准 seed `31d2d748`、构图 `focus-light-a-luminous-atrium`、现有 CSS import 顺序。
- Produces: `--stage-*` / `--shell-*` 令牌、环境渐变与纹理；后续 shell/conversation/card 样式只消费这些令牌。

- [ ] **Step 1: 紧邻 UI 修改前加载 Impeccable craft floor**

完整读取 `C:\Users\robbin\.codex\skills\impeccable\reference\craft-floor.md`，并把其中要求的方向合同作为 `<body>` 的第一个可检索标记。合同必须包含 seed `31d2d748`、世界 `stagecraft-theater-lighting-cyclorama-dawn`、构图 `focus-light-a-luminous-atrium` 和该文件规定的 `FINISH` 行。

- [ ] **Step 2: 先写令牌与几何安全测试**

在 `ui-visual-contract.test.ts` 增加：

```ts
test("luminous atrium tokens exist without transforming the measured shell", () => {
  const base = text("styles/base.css");
  const shell = text("styles/shell.css");
  assert.match(base, /--stage-ink:\s*#26372b/i);
  assert.match(base, /--stage-lavender:\s*#e8e4f2/i);
  assert.match(base, /url\(["']?\/ambient-grain\.webp/);
  assert.doesNotMatch(shell, /\.appShell\s*\{[^}]*\b(?:transform|filter):/s);
  assert.doesNotMatch(shell, /\.conversationPanel\s*\{[^}]*\b(?:transform|filter):/s);
});
```

- [ ] **Step 3: 运行令牌测试确认失败**

Run: `npm.cmd test -- --test-name-pattern="luminous atrium tokens"`

Expected: FAIL，报告缺少 `--stage-ink`。

- [ ] **Step 4: 生成无语义环境纹理**

使用 `imagegen` 生成一张无文字、无对象、无角色、可平铺的细颗粒暖白纸雾纹理；提示词固定为：

```text
Seamless square ambient grain texture for a premium educational web app, warm white base, extremely fine low-contrast paper mist and photographic grain, no objects, no fibers, no symbols, no text, no vignette, no directional light, uniform edge-to-edge tiling, subtle enough for 5% opacity.
```

保存为 `apps/web/public/ambient-grain.webp`；不得从批准构图截图裁切。

- [ ] **Step 5: 实现基础令牌与环境层**

在 `:root` 中增加并仅供新壳层消费：

```css
--stage-ink: #26372b;
--stage-forest: #55705c;
--stage-sage: #78977d;
--stage-sage-soft: #d5e2d3;
--stage-lavender: #e8e4f2;
--stage-canvas: #fcfdf9;
--stage-wing: rgba(250, 252, 248, 0.78);
--stage-line: rgba(60, 78, 64, 0.12);
--stage-shadow: 0 28px 80px rgba(42, 57, 46, 0.16);
--shell-inset: 14px;
--shell-radius: 22px;
--shell-topbar: 64px;
```

`body` 使用鼠尾草 → 暖白 → 淡紫的静态多层渐变；`body::before` 固定覆盖纹理、`opacity: .055`、`mix-blend-mode: soft-light`、`pointer-events: none`。`.appShell` 仅设置 `position: relative; z-index: 1`，不设置 transform/filter。

- [ ] **Step 6: 运行令牌合同测试**

Run: `npm.cmd test -- --test-name-pattern="luminous atrium tokens"`

Expected: PASS。

- [ ] **Step 7: 保存安全检查点**

Run: `git diff --check -- apps/web/app/layout.tsx apps/web/styles/base.css apps/web/tests/ui-visual-contract.test.ts`

Expected: 无输出。新纹理资产可单独暂存；脏实现文件不提交。

---

### Task 3: 构建明亮中庭壳层、顶部栏和完整历史侧翼

**Files:**
- Modify: `apps/web/styles/shell.css`
- Modify: `apps/web/styles/base.css`
- Modify: `apps/web/tests/ui-visual-contract.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `--stage-*` / `--shell-*` 令牌与现有 `.leftOpen/.leftClosed/.rightOpen/.rightClosed` 类。
- Produces: 宽屏中庭壳层、暖白中央面、半透明左右侧翼、规范历史树；不改变 React 组件结构。

- [ ] **Step 1: 写壳层结构测试**

```ts
test("desktop shell uses the approved atrium proportions", () => {
  const shell = text("styles/shell.css");
  assert.match(shell, /\.appShell\s*\{[^}]*width:\s*calc\(100vw - \(var\(--shell-inset\) \* 2\)\)/s);
  assert.match(shell, /grid-template-columns:\s*260px minmax\(0, 1fr\) 312px/);
  assert.match(shell, /border-radius:\s*var\(--shell-radius\)/);
  assert.match(shell, /\.historyTree\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto/s);
  assert.match(shell, /\.sessionRow:(?:hover|focus-within)[^}]*grid-template-columns:/s);
});
```

- [ ] **Step 2: 运行壳层测试确认失败**

Run: `npm.cmd test -- --test-name-pattern="desktop shell uses"`

Expected: FAIL，当前网格仍为 `236px … 320px`。

- [ ] **Step 3: 重构宽屏应用壳层**

将 `.appShell` 宽屏核心改为：

```css
.appShell {
  width: calc(100vw - (var(--shell-inset) * 2));
  height: calc(100dvh - (var(--shell-inset) * 2));
  margin: var(--shell-inset);
  grid-template-columns: 260px minmax(0, 1fr) 312px;
  grid-template-rows: var(--shell-topbar) minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: var(--shell-radius);
  background: rgba(252, 253, 249, 0.9);
  box-shadow: var(--stage-shadow);
}
```

同步调整 closed 状态列宽为 `0 minmax(0,1fr) 312px`、`260px minmax(0,1fr) 0` 和 `0 minmax(0,1fr) 0`，保留 200ms grid transition。

- [ ] **Step 4: 重构顶部与侧翼表面**

顶部使用 `rgba(252,253,249,.82)`、`backdrop-filter: blur(16px)`、细底线；左/右侧栏只用 `background: var(--stage-wing)`、8–10px 背景模糊和细分隔线。保留现有产品标识与账户 DOM，不新增熊猫图形；把排版、控件尺寸和对比度统一到批准构图。

- [ ] **Step 5: 强化“试卷 → 题目”树**

将 `.historyTree` 改为三行网格 `auto minmax(0,1fr) auto`；`.paperGroupButton` 负责试卷层，`.paperQuestionList` 保持缩进连线，`.sessionRow:hover, .sessionRow:focus-within, .sessionRow.active` 都展开删除列。为 `.historyDangerZone` 和 `.clearSessionsButton` 增加分隔、危险色、44px 点击区域，不改变节点顺序。

- [ ] **Step 6: 保持卡签几何块不变**

修改 `shell.css` 时不得改变 `.cardShelfTabs` 的 `top/right/width` 之外任何布局几何；尤其保留按钮 `66×128px`、`margin-top:-28px`、`.firstKnowledgeTab margin-top:32px`、写字方向和旋转变量。若壳层内缩导致视觉偏移，只允许把容器 `right` 调整到中央面边缘，合同测试必须继续通过。

- [ ] **Step 7: 运行目标测试**

Run: `npm.cmd test -- --test-name-pattern="desktop shell uses|workspace sidebars|card shelf geometry"`

Expected: PASS。

- [ ] **Step 8: 保存安全检查点**

Run: `git diff --check -- apps/web/styles/base.css apps/web/styles/shell.css apps/web/tests/ui-visual-contract.test.ts`

Expected: 无输出。

---

### Task 4: 重构中央阅读舞台、欢迎态与输入器

**Files:**
- Modify: `apps/web/styles/conversation.css`
- Modify: `apps/web/tests/ui-visual-contract.test.ts`

**Interfaces:**
- Consumes: 现有 `.messageViewport > .messageColumn` DOM、`ResizeObserver` 避让计算、`.conversationComposerStage` 与 `.composerDock`。
- Produces: 最亮的中央阅读面、层次清楚的消息与输入器；不改变消息 DOM、测量类名或卡片 dock 动画。

- [ ] **Step 1: 写中央舞台合同测试**

```ts
test("conversation keeps measurement hooks while using the bright stage", () => {
  const css = text("styles/conversation.css");
  assert.match(css, /\.messageViewport\s*\{[^}]*background:\s*var\(--stage-canvas\)/s);
  assert.match(css, /\.messageColumn\s*\{[^}]*width:\s*min\(920px, 100%\)/s);
  assert.match(css, /\.composerCard\s*\{[^}]*backdrop-filter:\s*blur\(16px\)/s);
  assert.match(css, /\.activeKnowledgeCardDock\.shelfTransitionDock\s*\{[^}]*animation:\s*none/s);
});
```

- [ ] **Step 2: 运行中央舞台测试确认失败**

Run: `npm.cmd test -- --test-name-pattern="conversation keeps"`

Expected: FAIL，当前 message viewport 使用 radial-gradient 与 neutral 背景。

- [ ] **Step 3: 重构阅读面与消息层级**

将 `.messageViewport` 设为稳定的 `var(--stage-canvas)`，只在顶部使用低透明晨光；`.messageColumn` 设为 `width:min(920px,100%)`、更一致的 24/32px 节奏。保持 `.messageViewport`、`.chatMessage`、`.timelineEntry`、data 属性和 ResizeObserver 依赖结构不变。

AI 消息以无边界正文为主，学生消息使用低饱和鼠尾草暖灰气泡；公式、题图、检查点和 action tag 保持语义与可滚动性。

- [ ] **Step 4: 重构欢迎态但不新增内容**

保留现有 eyebrow、标题、说明与三种输入方式。把 `.knowledgeOrbit` 现有元素改造成低对比的横向晨光/纸面层次：不增加 DOM，不增加角色或插画，不使用持续动画。

- [ ] **Step 5: 重构输入器**

`.composerDock` 保持原定位；`.composerCard` 使用 `rgba(252,253,249,.82)`、16px blur、细鼠尾草边框和双层轻阴影。保留 textarea、图片、语音、年级、模型、推理、发送/停止逻辑与 DOM 顺序；所有按钮 focus-visible 清晰，发送按钮使用深林绿色而非渐变文字。

- [ ] **Step 6: 不改卡片 dock 与关键帧块**

保留 `.activeKnowledgeCardDock`、`.shelfTransitionDock`、三个 phase 选择器、`@keyframes shelfCardOpen`、`shelfCardClose` 和 `activeCardDockEnter` 的属性与数值。只允许周围背景改变。

- [ ] **Step 7: 运行目标测试**

Run: `npm.cmd test -- --test-name-pattern="conversation keeps|card shelf geometry|floating knowledge cards"`

Expected: PASS。

- [ ] **Step 8: 保存安全检查点**

Run: `git diff --check -- apps/web/styles/conversation.css apps/web/tests/ui-visual-contract.test.ts`

Expected: 无输出。

---

### Task 5: 在不改变收纳/滑动形式的前提下重做卡片视觉

**Files:**
- Modify: `apps/web/lib/card-theme.ts`
- Modify: `apps/web/styles/cards.css`
- Modify: `apps/web/styles/dialogs.css`
- Modify: `apps/web/styles/shell.css`
- Modify: `apps/web/tests/workspace-components.test.tsx`
- Modify: `apps/web/tests/ui-visual-contract.test.ts`

**Interfaces:**
- Consumes: `cardVisualTheme(card, themeVariant?)`、`cardThemeProperties()` 和现有六个 `--flashcard-*` 变量。
- Produces: 稳定的低饱和知识卡主题、暖色题目卡主题、统一的正反面视觉；函数签名和变量名不变。

- [ ] **Step 1: 把新卡片色板写成失败测试**

保留稳定性和三个 shelf 变体唯一性测试，把题目卡期望改为新暖燕麦背景，并增加低饱和/对比断言：

```ts
assert.equal(cardVisualTheme(problemCardFixture).background, "#d7c596");
assert.equal(cardVisualTheme(problemCardFixture).ink, "#473e2d");
for (const themeVariant of [0, 1, 2]) {
  const theme = cardVisualTheme(cardFixture, themeVariant);
  assert.match(theme.background, /^#[0-9a-f]{6}$/i);
  assert.notEqual(theme.panel, theme.panelStrong);
  assert.equal(theme.ink, "#26372b");
}
```

继续运行 Task 1 的 geometry/timing 合同测试。

- [ ] **Step 2: 运行卡片主题测试确认失败**

Run: `npm.cmd test -- --test-name-pattern="card themes|card shelf geometry"`

Expected: theme 测试 FAIL，geometry 测试 PASS。

- [ ] **Step 3: 实现稳定低饱和主题数组**

在 `card-theme.ts` 保留导出函数名，使用四个固定知识卡主题：鼠尾草、雾绿、灰绿、淡薰衣草。显式 `themeVariant` 使用 `Math.abs(themeVariant) % palettes.length`；默认使用 `stableCardThemeIndex(card.id) % palettes.length`。题目卡固定为：

```ts
const PROBLEM_THEME: CardVisualTheme = {
  background: "#d7c596",
  panel: "#efe6cd",
  panelStrong: "#fbf7ea",
  ink: "#473e2d",
  accent: "#8b6c35",
  shadow: "rgba(84, 68, 38, 0.18)"
};
```

`cardThemeProperties` 继续输出相同六个 CSS 变量。

- [ ] **Step 4: 重做右栏卡片条目但保留 DOM/功能**

在 `cards.css` 中只改 `.cardItem`、`.cardOpenButton`、`.cardIcon`、文字、文件夹工具和状态表面。使用暖白/雾绿分层、细线、克制 hover；不改 `.cardOpenButton` 的事件、文件夹/剪贴板/删除结构。

- [ ] **Step 5: 重做完整闪卡表面**

在 `dialogs.css` 的 `.flashcardPresentation` 区域：

- 保持 width、max-height、flex、overflow 与 dock 适配；
- 用 `var(--flashcard-bg)` 作为柔和底层，叠加 `/ambient-grain.webp` 的 4% 纹理；
- 标题、summary、step、connection、final answer 用更明确的字级/细线/半透明面板；
- 知识卡与题目卡保持不同 accent；
- `.flashcardFlipBar` 继续位于底部并触发原 `showBack`；
- 不改 `StudyCardModal.tsx`，不改变正反面字段映射。

- [ ] **Step 6: 保持竖向收纳形式，仅同步主题表面**

在 `shell.css` 的 shelf 按钮中只允许调整基于 `--flashcard-*` 的 border 混合比例、表面渐变和阴影透明度；按钮宽高、负 margin、书写方向、旋转、offset、z-index 和 source hidden 状态全部保持。

- [ ] **Step 7: 运行卡片测试**

Run: `npm.cmd test -- --test-name-pattern="card themes|card shelf|card behavior|card save"`

Expected: PASS，包含源文件哈希、geometry/timing、主题映射和正反面/文件夹相关既有测试。

- [ ] **Step 8: 保存安全检查点**

Run: `git diff --check -- apps/web/lib/card-theme.ts apps/web/styles/cards.css apps/web/styles/dialogs.css apps/web/styles/shell.css apps/web/tests/workspace-components.test.tsx apps/web/tests/ui-visual-contract.test.ts`

Expected: 无输出。

---

### Task 6: 完成中屏/手机抽屉、自适应高度与 Electron 首帧

**Files:**
- Modify: `apps/web/styles/responsive.css`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/desktop/src/main.cjs`
- Modify: `apps/web/tests/ui-visual-contract.test.ts`

**Interfaces:**
- Consumes: `.responsiveReady`、`.leftOpen/.leftClosed/.rightOpen/.rightClosed` 和现有 `.mobileScrim`。
- Produces: 761–1319px 完整左右抽屉、<=760px 手机布局、断点监听和一致的 Electron 背景。

- [ ] **Step 1: 写响应式失败测试**

```ts
test("medium widths use full drawers instead of hiding the history tree", () => {
  const css = text("styles/responsive.css");
  const page = text("app/page.tsx");
  assert.match(css, /@media \(max-width: 1319px\) and \(min-width: 761px\)/);
  assert.match(css, /\.sessionSidebar\s*\{[^}]*position:\s*fixed;[^}]*width:\s*min\(292px, 88vw\)/s);
  assert.doesNotMatch(css, /@media \(max-width: 1319px\)[\s\S]*?\.historyTree\s*\{[^}]*display:\s*none/s);
  assert.match(page, /matchMedia\("\(max-width: 1319px\)"\)/);
  assert.match(css, /height:\s*100dvh/);
});
```

- [ ] **Step 2: 运行响应式测试确认失败**

Run: `npm.cmd test -- --test-name-pattern="medium widths"`

Expected: FAIL，当前断点为 1199px 且隐藏 `.historyTree`。

- [ ] **Step 3: 重写中屏断点为完整抽屉**

在 `761–1319px`：栅格只保留中央列；左右侧栏分别 fixed 到壳层内容区，宽 `min(292px,88vw)` / `min(330px,88vw)`；closed 状态使用原方向的 `translateX(105%)`；打开时显示 `.mobileScrim`。不得隐藏 `.historyTree`、搜索、题目或侧栏 footer。

- [ ] **Step 4: 同步断点状态**

把首次响应式 effect 改成带清理的媒体监听：

```ts
useEffect(() => {
  const compact = window.matchMedia("(max-width: 1319px)");
  const syncCompactState = (matches: boolean) => {
    if (matches) {
      setLeftOpen(false);
      setRightOpen(false);
    }
    setResponsiveReady(true);
  };
  syncCompactState(compact.matches);
  const onChange = (event: MediaQueryListEvent) => syncCompactState(event.matches);
  compact.addEventListener("change", onChange);
  return () => compact.removeEventListener("change", onChange);
}, []);
```

选题后不调用 `closeNavigationOnMobile()`，因此用户仍决定何时关闭抽屉。

- [ ] **Step 5: 完成手机与低高度布局**

在 <=760px 或高度 <=760px 时取消壳层外边距/圆角，使用 `100dvh`；保留 `100vh` 回退。消息列、composer、弹层不横向溢出，工具栏自身可横向滚动。保持手机 `.activeKnowledgeCardDock` 和翻面控件结构。

- [ ] **Step 6: 同步 Electron 首帧背景**

把 `apps/desktop/src/main.cjs` 中 BrowserWindow 的 `backgroundColor` 从 `#f6f7fb` 改为 `#eef3ec`，不改窗口大小、安全设置或加载逻辑。

- [ ] **Step 7: 运行响应式与卡片合同测试**

Run: `npm.cmd test -- --test-name-pattern="medium widths|card shelf geometry|workspace sidebars"`

Expected: PASS。

- [ ] **Step 8: 保存安全检查点**

Run: `git diff --check -- apps/web/styles/responsive.css apps/web/app/page.tsx apps/desktop/src/main.cjs apps/web/tests/ui-visual-contract.test.ts`

Expected: 无输出。

---

### Task 7: 完整验证、两轮视觉复查与设计文档

**Files:**
- Create: `DESIGN.md`
- Modify when findings require: only files already listed in Tasks 1–6

**Interfaces:**
- Consumes: 完整 UI、所有合同测试、本地 Web/API 服务、批准构图与原始用户要求。
- Produces: 可复现的验证证据、最终截图、终审结论和维护文档。

- [ ] **Step 1: 运行全部前端质量命令**

Run in `apps/web`:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected: 四条命令均 exit 0；不得用修改断言、跳过测试或删除行为合同来换取通过。

- [ ] **Step 2: 验证冻结文件 SHA-256**

Run: `npm.cmd test -- --test-name-pattern="card behavior sources"`

Expected: PASS；六个行为/结构文件与规格基线完全一致。

- [ ] **Step 3: 第一轮浏览器视觉复查**

在 1440×900、1280×800、1024×768、768×900、390×844、375×812 逐一截图并检查：欢迎态、已有会话、长数学回复、历史试卷/题目树、左右抽屉、卡片库和 composer。记录所有溢出、断层、低对比、错误遮挡和焦点问题并立即修复。

- [ ] **Step 4: 第一轮卡片交互复查**

使用当前 session 的右侧收纳卡签验证：源卡签隐藏 → 480ms 自然滑出 → 正面 → 背面 → 翻回 → 440ms 返回 → 源卡签恢复。另验证完整右栏 `.cardOpenButton` 仍直接打开、无来源卡签时直接关闭。前后对比收纳数量、顺序、66×128px 形式和轨迹，不要求卡片视觉与旧版相同。

- [ ] **Step 5: 第二轮视觉复查**

修复第一轮问题后重新截取同样六个尺寸，重点检查中等宽度历史树、手机 `dvh`、卡片长背面滚动、键盘 focus、reduced motion 和 Electron 首帧。第二轮不得复用第一轮截图作为证据。

- [ ] **Step 6: 运行最新 Web Interface Guidelines 审计**

加载 `web-design-guidelines` skill，获取其要求的最新 Vercel Web Interface Guidelines，只审计本次改动的 UI 文件；按 `file:line` 修复高优先级问题。冻结的收纳几何若被通用规则误报，记录为用户明确保留的产品行为，不改合同。

- [ ] **Step 7: 运行 Impeccable 完成审查**

执行一次 detector；随后把批准构图、原始请求、两轮最新截图、规格和 craft-floor 交给一个全新 finish reviewer。修复其高/中优先级发现后，再交给全新 documenter 生成 `DESIGN.md`，记录令牌、表面、响应式、卡片视觉和冻结的收纳/滑动合同。

- [ ] **Step 8: 按 verification-before-completion 做最终证据复核**

加载 `verification-before-completion` skill，重新运行其要求的最新验证命令，检查 `git diff --check`、冻结哈希、浏览器关键路径和规格逐项证据；只在最新输出全部支持时声明完成。

- [ ] **Step 9: 提交仅由本任务新建且不夹带用户改动的文档/资产**

仅暂存 `DESIGN.md`、`apps/web/public/ambient-grain.webp` 和本计划/规格侧车中尚未提交的新文件；对任务前已脏的实现文件保持未暂存，并在交付说明中明确列出。
