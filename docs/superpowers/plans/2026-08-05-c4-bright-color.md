# C4 Bright Color Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已批准的 C4 高彩绿色、向日葵黄和明亮低饱和薰衣草紫应用到现有答疑工作台，同时保持所有布局、信息层级和卡片交互合同不变。

**Architecture:** 颜色真相集中在 `base.css` 的工作台令牌与 `card-theme.ts` 的五组卡片主题；壳层、对话区、卡片库和学习卡只消费这些令牌或使用明确的浅/深层级。测试先冻结 C4 色值与现有卡片行为，再逐层替换旧灰绿、米棕和低彩表面，最后用真实浏览器验证视觉与交互。

**Tech Stack:** Next.js 15、React 19、TypeScript、CSS Modules-style global class sheets、Node test runner、Codex in-app browser。

## Global Constraints

- 设计合同以 `docs/superpowers/specs/2026-08-05-c4-bright-color-design.md` 为唯一 C4 色彩真相。
- 保留左侧「试卷 → 题目」层级及全部搜索、展开、恢复和删除能力。
- 保留右缘卡签 `66 × 128px`、`-28px` 重叠、排序、筛选与数量。
- 保留 `idle → preparing → opening → open → closing → idle` 状态机、`480ms` 打开、`440ms` 关闭、来源矩形往返与正反翻面。
- 保留现有响应式断点、手机安全区、`100dvh` 回退和 reduced-motion 合同。
- 不修改 `StudyCardModal.tsx`、`CardShelfTabs.tsx`、`StudyCardSidebar.tsx`、`useStudyCards.ts`、`useSessionRuntime.ts`、`page.tsx` 或 API/数据结构的行为逻辑。
- 不增加熊猫、插画、贴纸、渐变文字、持续动画或 mock-only 控件。
- 高饱和色只用于环境光、状态面、按钮、文件夹和卡片外壳；中央正文保持暖白与深色文字。
- 当前工作区包含用户所有的未提交修改。实施阶段不执行 reset、checkout、clean，也不自动 stage/commit 生产文件；每个任务以显式路径 diff 与测试结果作为检查点。
- 视觉检查遵守 Impeccable 的有界两轮上限：第一轮批量检查桌面与手机，集中修复一次，只允许一轮确认。

## File Map

- `apps/web/styles/base.css`：全局主色、工作台 C4 令牌、环境渐变和焦点/选区颜色。
- `apps/web/styles/shell.css`：壳层、顶栏、左右侧翼、历史树和右缘卡签容器的表面色。
- `apps/web/styles/conversation.css`：中央暖白舞台、欢迎光场、消息和输入器的 C4 消费方式。
- `apps/web/styles/cards.css`：卡片库筛选、知识/题目图标、文件夹和导出文件夹的绿色/黄色映射。
- `apps/web/styles/dialogs.css`：学习卡 CSS 变量缺省值；不触碰翻面、滚动和验证状态结构。
- `apps/web/lib/card-theme.ts`：题目卡和四组知识卡的准确 C4 主题对象。
- `apps/web/tests/ui-visual-contract.test.ts`：工作台令牌、环境渐变、文件夹色和冻结交互合同。
- `apps/web/tests/workspace-components.test.tsx`：五组卡片主题的完整对象断言。
- `DESIGN.md`：当前实现基线中的 C4 令牌、材质、卡片主题和验证说明。

---

### Task 1: 先写 C4 色彩合同测试

**Files:**
- Modify: `apps/web/tests/ui-visual-contract.test.ts:56-73`
- Modify: `apps/web/tests/workspace-components.test.tsx:520-542`

**Interfaces:**
- Consumes: `text(path)` 源码读取帮助器、`cardVisualTheme(card, themeVariant)` 现有 API。
- Produces: C4 工作台/文件夹正则合同与五个 `CardVisualTheme` 完整对象合同；后续任务以这些失败断言为实现目标。

- [ ] **Step 1: 将工作台测试改为 C4 精确令牌与环境渐变**

在 `ui-visual-contract.test.ts` 中把 `luminous atrium tokens and ambient grain are wired` 改名为 `C4 bright atrium tokens, folders, and ambient grain are wired`，并使用以下断言：

```ts
test("C4 bright atrium tokens, folders, and ambient grain are wired", () => {
  const layout = text("app/layout.tsx");
  const base = text("styles/base.css");
  const shell = text("styles/shell.css");
  const cards = text("styles/cards.css");

  assert.match(layout, /31d2d748/);
  assert.match(base, /--stage-ink:\s*#12371f/i);
  assert.match(base, /--stage-sage:\s*#63ad50/i);
  assert.match(base, /--stage-lavender:\s*#b7a8d4/i);
  assert.match(base, /--stage-lavender-deep:\s*#9e8bc4/i);
  assert.match(base, /--stage-lavender-soft:\s*#eae4f5/i);
  assert.match(base, /--stage-yellow:\s*#e9b72d/i);
  assert.match(base, /--stage-yellow-soft:\s*#fff0a8/i);
  assert.match(base, /--stage-yellow-ink:\s*#765400/i);
  assert.match(base, /rgba\(105, 204, 105, 0\.68\)/);
  assert.match(base, /rgba\(183, 168, 212, 0\.58\)/);
  assert.match(base, /linear-gradient\(122deg, #c6edc3 0%, #fffce9 51%, #eae4f5 100%\)/i);
  assert.match(base, /url\(["']?\/ambient-grain\.webp/);
  assert.match(
    cards,
    /\.cardIcon\.problem\s*\{[\s\S]*?color:\s*var\(--stage-yellow-ink\);[\s\S]*?background:\s*var\(--stage-yellow-soft\);/
  );
  assert.match(
    cards,
    /\.cardFolderItem\s*\{[\s\S]*?border:\s*1px solid color-mix\(in srgb, var\(--stage-yellow\) 34%, white\);[\s\S]*?background:\s*color-mix\(in srgb, var\(--stage-yellow-soft\) 72%, white\);/
  );
  assert.doesNotMatch(shell, /\.appShell\s*\{[^}]*\b(?:transform|filter):/);
  assert.doesNotMatch(shell, /\.conversationPanel\s*\{[^}]*\b(?:transform|filter):/);
});
```

- [ ] **Step 2: 将卡片主题测试改为完整对象断言**

在 `workspace-components.test.tsx` 中保留稳定索引检查，使用以下主题数组替换旧的统一墨色断言：

```ts
const expectedKnowledgeThemes = [
  {
    background: "#8fce77", panel: "#d9f1cb", panelStrong: "#f7fcf3",
    ink: "#173820", accent: "#3d8138", shadow: "rgba(32, 83, 31, 0.18)"
  },
  {
    background: "#82cbb8", panel: "#d5f0e8", panelStrong: "#f4fbf8",
    ink: "#123d33", accent: "#357f6c", shadow: "rgba(21, 77, 64, 0.17)"
  },
  {
    background: "#a9cf7f", panel: "#e3f1cf", panelStrong: "#f8fbf2",
    ink: "#2d3d1c", accent: "#597d38", shadow: "rgba(59, 83, 31, 0.17)"
  },
  {
    background: "#cfc3e6", panel: "#ece6f6", panelStrong: "#fbf9fd",
    ink: "#332a45", accent: "#8b78ad", shadow: "rgba(65, 52, 92, 0.17)"
  }
];

for (const [themeVariant, expected] of expectedKnowledgeThemes.entries()) {
  assert.deepEqual(cardVisualTheme(cardFixture, themeVariant), expected);
}

assert.deepEqual(cardVisualTheme(problemCardFixture), {
  background: "#f2d15f", panel: "#fbe9a5", panelStrong: "#fff9df",
  ink: "#4b3905", accent: "#9a7000", shadow: "rgba(112, 83, 0, 0.2)"
});
```

- [ ] **Step 3: 运行测试并确认只因旧色值失败**

Run: `npm.cmd test`

Workdir: `apps/web`

Expected: FAIL；失败信息包含 `#26372b`、`#e8e4f2`、`#d7c596` 或缺少 `--stage-yellow`，而冻结哈希、卡签几何和动画时序测试仍通过。

- [ ] **Step 4: 检查任务差异，不提交生产文件**

Run: `git diff -- apps/web/tests/ui-visual-contract.test.ts apps/web/tests/workspace-components.test.tsx`

Expected: 只有上述 C4 断言发生变化；保留工作区未提交状态。

---

### Task 2: 应用工作台 C4 令牌与明亮舞台

**Files:**
- Modify: `apps/web/styles/base.css:1-96`
- Modify: `apps/web/styles/shell.css:1-40, 374-386, 641-660`
- Modify: `apps/web/styles/conversation.css:1-10, 114-210, 226-266, 487-515`

**Interfaces:**
- Consumes: Task 1 的 C4 CSS 源码断言。
- Produces: `--stage-lavender-deep`、`--stage-lavender-soft`、`--stage-yellow`、`--stage-yellow-soft`、`--stage-yellow-ink` 新令牌，供卡片库和文档使用。

- [ ] **Step 1: 更新基础色阶、工作台令牌与语义 warning**

在 `base.css :root` 中使用以下值；保留 spacing、radius、shadow 和 backward-compatible alias 的名称与结构：

```css
--primary-50: #f3fbe9;
--primary-100: #e5f7d5;
--primary-200: #d0efb7;
--primary-500: #69b94c;
--primary-600: #4fa03a;
--primary-700: #357f2f;
--primary-800: #1d512b;
--neutral-25: #fffef9;
--neutral-50: #f7faf3;
--neutral-100: #edf4e8;
--neutral-200: #d9e6d4;
--neutral-300: #c3d3bd;
--neutral-500: #7d8d7b;
--neutral-600: #526451;
--neutral-900: #172419;
--warning: #b88100;
--warning-soft: #fff3bf;

--stage-ink: #12371f;
--stage-forest: #2f7542;
--stage-sage: #63ad50;
--stage-sage-soft: #d0eeb9;
--stage-lavender: #b7a8d4;
--stage-lavender-deep: #9e8bc4;
--stage-lavender-soft: #eae4f5;
--stage-yellow: #e9b72d;
--stage-yellow-soft: #fff0a8;
--stage-yellow-ink: #765400;
--stage-canvas: #fffef8;
--stage-wing: rgba(249, 255, 245, 0.84);
--stage-line: rgba(30, 94, 43, 0.14);
--stage-shadow: 0 28px 80px rgba(35, 92, 46, 0.2);
```

- [ ] **Step 2: 更新 `body` 的批准环境渐变**

```css
body {
  background:
    radial-gradient(circle at 6% 2%, rgba(105, 204, 105, 0.68), transparent 38%),
    radial-gradient(circle at 96% 100%, rgba(183, 168, 212, 0.58), transparent 40%),
    linear-gradient(122deg, #c6edc3 0%, #fffce9 51%, #eae4f5 100%);
}
```

保留 `/ambient-grain.webp`、`soft-light` 和 `0.055` opacity，不生成新纹理。

- [ ] **Step 3: 提亮壳层与顶栏表面，不触碰几何**

在 `shell.css` 仅替换颜色：

```css
.appShell { background: rgba(255, 255, 248, 0.92); }
.appTopbar { background: rgba(255, 255, 248, 0.86); }
.historySearch:focus-within { box-shadow: 0 0 0 3px rgba(105, 185, 76, 0.18); }
.conversationHeader { background: rgba(255, 255, 248, 0.94); }
```

不得改动 `.appShell` 的 grid columns/rows、inset、radius 或 sidebar visibility。

- [ ] **Step 4: 把欢迎舞台、学生消息与输入器映射到新令牌**

在 `conversation.css` 使用：

```css
.messageViewport {
  background: var(--stage-canvas);
  background-image:
    radial-gradient(circle at 50% -18%, rgba(208, 238, 185, 0.48), transparent 42%),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.62), transparent 24%);
}

.knowledgeOrbit {
  background:
    radial-gradient(ellipse at 50% 76%, rgba(208, 238, 185, 0.82), transparent 58%),
    linear-gradient(to bottom, rgba(183, 168, 212, 0.3), transparent 48%);
}

.orbit { border-color: rgba(99, 173, 80, 0.34); }
.orbitDot { box-shadow: 0 0 0 4px rgba(229, 247, 213, 0.72); }
.messageAvatar { background: rgba(229, 247, 213, 0.9); }
.chatMessage.student .messageBody { background: rgba(208, 238, 185, 0.72); }
.composerCard { background: rgba(255, 255, 248, 0.88); }
.composerCard:focus-within { box-shadow: 0 0 0 3px rgba(99, 173, 80, 0.18), 0 22px 56px rgba(47, 117, 66, 0.16); }
```

保留 `.messageColumn` 宽度、active card dock、keyframes、composer 尺寸与响应式规则。

- [ ] **Step 5: 运行合同测试**

Run: `npm.cmd test`

Workdir: `apps/web`

Expected: 工作台 C4 令牌与渐变断言通过；卡片主题断言仍因 Task 3 尚未实现而失败。冻结交互合同继续通过。

- [ ] **Step 6: 检查任务差异，不提交生产文件**

Run: `git diff -- apps/web/styles/base.css apps/web/styles/shell.css apps/web/styles/conversation.css`

Expected: 只有颜色/阴影值变化；没有尺寸、DOM、keyframes、transition duration 或 media query 变化。

---

### Task 3: 应用向日葵文件夹与五组明亮卡片主题

**Files:**
- Modify: `apps/web/lib/card-theme.ts:13-55`
- Modify: `apps/web/styles/cards.css:38-126, 166-188, 288-326, 716-733`
- Modify: `apps/web/styles/dialogs.css:1239-1524`
- Test: `apps/web/tests/ui-visual-contract.test.ts`
- Test: `apps/web/tests/workspace-components.test.tsx`

**Interfaces:**
- Consumes: Task 2 新增的 `--stage-yellow*` 和 C4 card contract tests。
- Produces: `cardVisualTheme()` 返回准确的五组主题；卡片库与学习卡通过 CSS variables 使用相同色彩真相。

- [ ] **Step 1: 替换 `PROBLEM_THEME` 和 `KNOWLEDGE_THEMES`**

在 `card-theme.ts` 保留 `KNOWLEDGE_THEME_VARIANTS`、stable hash、variant modulo 和 CSS property name，主题对象替换为：

```ts
const PROBLEM_THEME: CardVisualTheme = {
  background: "#f2d15f",
  panel: "#fbe9a5",
  panelStrong: "#fff9df",
  ink: "#4b3905",
  accent: "#9a7000",
  shadow: "rgba(112, 83, 0, 0.2)"
};

const KNOWLEDGE_THEMES: readonly CardVisualTheme[] = [
  { background: "#8fce77", panel: "#d9f1cb", panelStrong: "#f7fcf3", ink: "#173820", accent: "#3d8138", shadow: "rgba(32, 83, 31, 0.18)" },
  { background: "#82cbb8", panel: "#d5f0e8", panelStrong: "#f4fbf8", ink: "#123d33", accent: "#357f6c", shadow: "rgba(21, 77, 64, 0.17)" },
  { background: "#a9cf7f", panel: "#e3f1cf", panelStrong: "#f8fbf2", ink: "#2d3d1c", accent: "#597d38", shadow: "rgba(59, 83, 31, 0.17)" },
  { background: "#cfc3e6", panel: "#ece6f6", panelStrong: "#fbf9fd", ink: "#332a45", accent: "#8b78ad", shadow: "rgba(65, 52, 92, 0.17)" }
];
```

- [ ] **Step 2: 把卡片库的知识/题目图标与文件夹改为绿色/向日葵黄**

在 `cards.css` 使用：

```css
.cardFilters { background: rgba(208, 238, 185, 0.62); }
.cardFilters button.active { background: rgba(255, 255, 248, 0.96); }
.cardIcon.knowledge { color: var(--stage-forest); background: var(--stage-sage-soft); }
.cardIcon.problem { color: var(--stage-yellow-ink); background: var(--stage-yellow-soft); }
.cardFileToolbar { background: rgba(229, 247, 213, 0.78); }

.cardFolderItem {
  border: 1px solid color-mix(in srgb, var(--stage-yellow) 34%, white);
  background: color-mix(in srgb, var(--stage-yellow-soft) 72%, white);
}
.cardFolderOpen { color: var(--stage-yellow-ink); }

.exportFolderTile {
  border-color: color-mix(in srgb, var(--stage-yellow) 34%, white);
  color: var(--stage-yellow-ink);
  background: color-mix(in srgb, var(--stage-yellow-soft) 72%, white);
}
```

删除这些选择器中的旧值 `#866a38`、`rgba(239, 230, 205, 0.84)`、`#e5dfcf`、`#8a682b`、`#e7dfcd`、`#906d2d`，但不更改 danger/delete、成功/错误状态或深色图片查看器。

- [ ] **Step 3: 更新学习卡 CSS fallback，不改结构或翻面规则**

在 `dialogs.css` 的 `.flashcardPresentation` 范围内把缺省值同步为主题 0：

```css
.studyCardDialog.flashcardPresentation {
  color: var(--flashcard-ink, #173820);
  background-color: var(--flashcard-bg, #8fce77);
}

.flashcardPresentation .studyCardBody section {
  background: color-mix(in srgb, var(--flashcard-panel, #d9f1cb) 88%, transparent);
}
```

把 problem fallback 同步为：

```css
.problemFlashcard .problemStepTitle > span {
  background: var(--flashcard-accent, #9a7000);
}

.problemFlashcard .stepReason {
  color: color-mix(in srgb, var(--flashcard-ink, #4b3905) 80%, white);
}

.problemFlashcard .stepResult,
.problemFlashcard .studyCardBody .cardFinalAnswer {
  color: var(--flashcard-ink, #4b3905);
  background: var(--flashcard-panel-strong, #fff9df);
}
```

只替换 fallback 色值；不得改动 `.flashcardFlipBar`、`.cardStepList`、`.stepResult` 的 border 结构、尺寸、DOM 或显示条件。

- [ ] **Step 4: 运行完整 web 测试**

Run: `npm.cmd test`

Workdir: `apps/web`

Expected: 66 tests pass；C4 token/theme tests、冻结哈希、卡签几何、开合时序和焦点合同全部通过。

- [ ] **Step 5: 检查旧灰绿与米棕只在非目标历史/语义区域保留**

Run:

```powershell
rg -n -- "#d7c596|#efe6cd|#8b6c35|#abc0ac|#b8c9c0|#aeb9aa|#c7c1d4|#866a38|#8a682b|#906d2d" apps/web/styles apps/web/lib apps/web/tests
```

Expected: 无命中；若命中只允许出现在明确的迁移说明文本，不能存在于生产 CSS/TypeScript 或断言中。

- [ ] **Step 6: 检查任务差异，不提交生产文件**

Run: `git diff -- apps/web/lib/card-theme.ts apps/web/styles/cards.css apps/web/styles/dialogs.css apps/web/tests/ui-visual-contract.test.ts apps/web/tests/workspace-components.test.tsx`

Expected: 只有主题对象、色值、fallback 与测试预期变化；卡片组件/状态文件未出现在 diff 中。

---

### Task 4: 更新当前实现设计合同

**Files:**
- Modify: `DESIGN.md:3-39, 128-142, 211-232`

**Interfaces:**
- Consumes: Task 2 的工作台令牌、Task 3 的完整卡片主题。
- Produces: 与生产代码一一对应的当前实现文档，供后续设计与维护使用。

- [ ] **Step 1: 在文档开头链接 C4 批准规格**

把现有批准方向说明扩展为：

```md
批准构图见 `2026-08-05-ui-visual-polish-design.md`；批准色彩增强见
`docs/superpowers/specs/2026-08-05-c4-bright-color-design.md`。
```

- [ ] **Step 2: 用 Task 2 的准确值替换颜色令牌表**

记录 `--stage-lavender / deep / soft`、`--stage-yellow / soft / ink` 和新的主色阶、warning 色。材质段明确环境渐变为高彩绿色、暖白与明亮低饱和薰衣草；正文面仍是暖白。

- [ ] **Step 3: 用 Task 3 的五行完整对象替换卡片主题表**

主题名固定为：题目卡·向日葵黄、知识卡·鲜叶绿、知识卡·清水青、知识卡·嫩芽绿、知识卡·明亮薰衣草。每行记录 background、panel、panelStrong、ink、accent、shadow。

- [ ] **Step 4: 自检文档与代码完全一致**

Run:

```powershell
rg -n -- "#12371f|#b7a8d4|#9e8bc4|#e9b72d|#f2d15f|#cfc3e6|480ms|440ms|66 × 128px" DESIGN.md apps/web/styles/base.css apps/web/lib/card-theme.ts
```

Expected: C4 工作台与卡片色值同时出现在文档和生产源；交互尺寸/时序仍记录在 `DESIGN.md`。

- [ ] **Step 5: 检查任务差异，不提交生产文件**

Run: `git diff -- DESIGN.md`

Expected: 只更新当前色彩基线、材料描述和卡片主题；信息架构、响应式和交互合同文字未删改。

---

### Task 5: 有界浏览器视觉与交互验证

**Files:**
- Create: `.impeccable/review/c4-1440x900.png`
- Create: `.impeccable/review/c4-1024x768.png`
- Create: `.impeccable/review/c4-768x900.png`
- Create: `.impeccable/review/c4-390x844.png`
- Create: `.impeccable/review/c4-375x812.png`
- Create: `.impeccable/review/c4-card-front-375x812.png`
- Create: `.impeccable/review/c4-card-back-375x812.png`

**Interfaces:**
- Consumes: Tasks 2–4 完成的真实页面、现有本地 demo 数据与浏览器会话。
- Produces: 五档 viewport、卡片正反面、抽屉和无横向溢出的视觉证据。

- [ ] **Step 1: 启动本地 web 服务并确认页面可用**

Run: `npm.cmd run dev -- --hostname 127.0.0.1 --port 3002`

Workdir: `apps/web`

Expected: `http://127.0.0.1:3002/` 返回页面；只启动本次 QA 的临时进程并记录 PID，结束时停止它。

- [ ] **Step 2: 第一轮一次性检查五个 viewport**

用 in-app browser 依次设置 `1440×900`、`1024×768`、`768×900`、`390×844`、`375×812` 并截图。每档一次性记录：

- 背景绿色明显、右下紫色明亮但不艳丽；
- 中央画布仍是最亮的暖白区域；
- 左右侧翼没有灰雾；
- 文件夹和题目卡明显偏向日葵黄；
- 标题、元数据、黄色表面文字与焦点环清晰；
- `scrollWidth <= clientWidth`。

- [ ] **Step 3: 检查真实卡片合同与正反面**

从右缘来源卡签打开一张知识卡，记录来源矩形、打开中间态、open 终态和 close 归位；翻至背面再返回。确认：

- 来源卡签隐藏/恢复正确；
- 打开约 `480ms`、关闭约 `440ms`；
- 只存在当前正面或背面；
- 打开后焦点进入关闭按钮，关闭后回到来源；
- 手机卡片抽屉、正面和背面文字均可读且可滚动。

- [ ] **Step 4: 集中修复第一轮发现的所有色彩问题**

只允许修改 Tasks 2–3 已列出的 CSS/主题文件。修复必须是颜色、透明度、阴影或对比度调整；若发现布局或交互问题，先证明由本次调色引起，否则不扩大范围。

- [ ] **Step 5: 仅进行一轮确认截图**

重新检查受影响的 viewport 与卡面，确认所有第一轮问题关闭后停止视觉微调。重置浏览器 viewport，并停止本次 QA 临时服务。

---

### Task 6: 完整回归、生产构建与交付检查

**Files:**
- Verify only: `apps/web/**/*`
- Verify only: `DESIGN.md`
- Verify only: `apps/web/out/**/*.html`

**Interfaces:**
- Consumes: 全部实现和 QA 证据。
- Produces: lint、类型、测试、构建、HTML 方向合同、diff 与独立只读审查的完成证据。

- [ ] **Step 1: 并行运行静态检查和测试**

Run in `apps/web`:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
```

Expected: lint 0 warnings/errors；typecheck exit 0；66/66 tests pass。

- [ ] **Step 2: 运行正式生产构建**

Run: `npm.cmd run build`

Workdir: `apps/web`

Expected: Next.js optimized build succeeds；`inject-design-contract.mjs` reports 2 exported HTML files。

- [ ] **Step 3: 验证两个 HTML 的首 body 节点方向合同**

对 `apps/web/out/index.html` 与 `404.html` 验证首 body 节点为注释，且包含 `THESIS:`、`OWN-WORLD:`、`STORY:`、`FIRST VIEWPORT:`、`FORM:`、`focus-light-a-luminous-atrium`、`31d2d748` 和 `FINISH:`。

- [ ] **Step 4: 运行 whitespace、冻结文件与工作区边界检查**

Run:

```powershell
git diff --check
git status --short
```

Expected: `git diff --check` exit 0（允许已有 CRLF 提示）；没有 reset/clean；所有用户原有未提交文件仍存在。

- [ ] **Step 5: 发起一次独立只读审查**

审查者必须核对 C4 规格、最终截图、测试/构建证据和冻结交互合同，并明确给出 `APPROVED` 或唯一一轮 `NEEDS WORK`。如需修复，只处理阻止交付的颜色/对比问题，再运行受影响验证。

- [ ] **Step 6: 交付结果**

最终回复包含：C4 色彩变化、卡片交互保持情况、验证数字、关键文件链接、最终桌面截图和当前分支；说明生产文件仍保留在原有 dirty worktree 中且未覆盖用户改动。
