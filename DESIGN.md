# 熊猫析题 UI 设计与实现合同

状态：当前实现基线（2026-08-05）

本文记录根路由答疑工作台的视觉系统、响应式规则与不可破坏的交互合同。产品能力和业务边界以 [`PRODUCT.md`](PRODUCT.md) 为准；批准方向见 [`docs/superpowers/specs/2026-08-05-ui-visual-polish-design.md`](docs/superpowers/specs/2026-08-05-ui-visual-polish-design.md)，批准的 C4 明亮高彩色彩增强见 [`docs/superpowers/specs/2026-08-05-c4-bright-color-design.md`](docs/superpowers/specs/2026-08-05-c4-bright-color-design.md)，构图基准见 [`.impeccable/mocks/focus-light-a-luminous-atrium.png`](.impeccable/mocks/focus-light-a-luminous-atrium.png)。视觉稿表达气质和布局，不替代真实组件、字段或状态。

## 1. 设计命题与世界观

设计命题是「专注光场 · 明亮中庭」：把题目、诊断对话和输入器放在同一块连续、明亮的学习舞台上；左右侧翼承载管理工具并在视觉上后退。C4 在这一构图上提高绿色与向日葵黄的饱和度，并使用高明度、低饱和的薰衣草紫补光；它不是由许多漂浮小卡拼成的仪表盘。

空间世界观来自清晨剧场的环形天幕：左侧高彩鲜绿晨光、中央暖白纸面、右侧明亮低饱和薰衣草补光，配合低对比纸雾颗粒。色彩比初版更清透鲜活，但中央正文仍保持暖白与深色文字，确保可以长时间阅读；装饰不能与数学正文争夺注意力。现有熊猫标记只作为产品标识，不扩展为角色、贴纸、吉祥物或插画系统。

[`apps/web/app/layout.tsx`](apps/web/app/layout.tsx) 中的 `directionContract` 是可检索的方向标记，批准构图标识为 `focus-light-a-luminous-atrium` / `31d2d748`。

## 2. 视觉令牌

令牌源文件是 [`apps/web/styles/base.css`](apps/web/styles/base.css)。工作台视觉使用 `--stage-*` / `--shell-*`；卡片主题使用独立的 `--flashcard-*`，不要把两组命名空间混用。

### 2.1 颜色与语义

| 令牌 | 当前值 | 用途 |
| --- | --- | --- |
| `--stage-ink` | `#12371f` | 主标题、最高层级文字 |
| `--stage-forest` | `#2f7542` | 品牌绿、主操作、强调文字 |
| `--stage-sage` | `#63ad50` | 焦点、边界与次级强调 |
| `--stage-sage-soft` | `#d0eeb9` | 柔和选中面、学生消息 |
| `--stage-lavender` | `#b7a8d4` | 高明度、低饱和的薰衣草补光 |
| `--stage-lavender-deep` | `#9e8bc4` | 紫色卡签与需要更清晰边界的紫色强调 |
| `--stage-lavender-soft` | `#eae4f5` | 紫色环境底面与浅状态面 |
| `--stage-yellow` | `#e9b72d` | 向日葵黄文件夹与题目强调 |
| `--stage-yellow-soft` | `#fff0a8` | 黄色浅表面 |
| `--stage-yellow-ink` | `#765400` | 黄色表面上的可读文字与图标 |
| `--stage-canvas` | `#fffef8` | 中央暖白阅读画布 |
| `--stage-wing` | `rgba(249, 255, 245, 0.84)` | 左右半透明侧翼 |
| `--stage-line` | `rgba(30, 94, 43, 0.14)` | 壳层和侧翼细线 |
| `--stage-shadow` | `0 28px 80px rgba(35, 92, 46, 0.2)` | 工作台外壳柔影 |

| 基础语义令牌 | 当前值 |
| --- | --- |
| `--primary-50 / 100 / 200` | `#f3fbe9 / #e5f7d5 / #d0efb7` |
| `--primary-500 / 600 / 700 / 800` | `#69b94c / #4fa03a / #357f2f / #1d512b` |
| `--neutral-25 / 50 / 100 / 200 / 300` | `#fffef9 / #f7faf3 / #edf4e8 / #d9e6d4 / #c3d3bd` |
| `--neutral-500 / 600 / 900` | `#7d8d7b / #526451 / #172419` |
| `--success / --success-soft` | `#4f855c / #e8f3e9` |
| `--warning / --warning-soft` | `#b88100 / #fff3bf` |
| `--danger / --danger-soft` | `#b45d5d / #f9e8e7` |
| `--info / --info-soft` | `#587b91 / #e8f0f4` |

状态不得改用装饰渐变，也不得只靠颜色传达。

### 2.2 材质与光场

- `body` 使用三层静态背景：左上 `rgba(105, 204, 105, 0.68)` 高彩绿色径向光、右下 `rgba(183, 168, 212, 0.58)` 明亮薰衣草径向光，以及 `linear-gradient(122deg, #c6edc3 0%, #fffce9 51%, #eae4f5 100%)` 线性底色。
- `.appShell` 是 `rgba(255, 255, 248, 0.92)` 的完整壳层，带白色细边和大范围柔影；顶部栏与会话栏分别使用 `rgba(255, 255, 248, 0.86)` 和 `rgba(255, 255, 248, 0.94)`。壳层在桌面端从视口内缩，而非贴满纯白画面。
- `.sessionSidebar`、`.cardSidebar` 使用 `--stage-wing` 和 `blur(10px)`；顶部栏使用近暖白表面和 `blur(16px)`。模糊只用于局部侧翼/栏面。
- `.conversationPanel` 与 `.messageViewport` 始终是最亮、对比最高的连续阅读面；消息舞台使用 `--stage-canvas`，叠加 `rgba(208, 238, 185, 0.48)` 的顶部柔光。内容主要靠留白、细线和明度分层，避免把每一段都包装成浮卡。
- 输入器是主要浮层：半透明暖白、细边、`blur(16px)` 和双层柔影；普通列表不复制这种阴影强度。
- 高饱和色只用于环境光、状态面、按钮、文件夹和卡片外壳；中央正文继续使用暖白底与深色文字。环境渐变不做持续漂移动画，不使用渐变文字，也不把大面积高饱和色带带入正文。

### 2.3 字体与字级

不加载网络字体。实际字体栈为：

```css
"Segoe UI Variable", "HarmonyOS Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif
```

主要字级：产品名 `18px`（手机 `17px`），右栏标题 `16px`，会话标题 `14px`，消息正文 `14.5px`，输入正文 `15px`，元数据 `9–12px`；学习卡标题 `22px`、卡片区块标题/正文 `14px`。层级主要依赖字重、字号、留白和明度，不使用全大写、大字距或渐变文字。数学内容继续由 KaTeX / `MathText` 渲染，并保留公式横向滚动能力。

### 2.4 间距、圆角与阴影

间距以 `4px` 为基线：`--space-1/2/3/4/5/6/8/10/12` 分别为 `4/8/12/16/20/24/32/40/48px`。优先使用该序列，不增加相邻的任意值。

| 类别 | 当前值 |
| --- | --- |
| 小/中/大/超大圆角 | `8 / 12 / 16 / 20px` |
| 胶囊圆角 | `999px` |
| 桌面壳层圆角 | `--shell-radius: 22px` |
| 普通卡片/输入器 | 以 `12–16px` 为主 |
| 壳层阴影 | `0 28px 80px rgba(35, 92, 46, 0.2)` |
| 普通卡片阴影 | `0 4px 16px rgba(41, 55, 41, 0.06)` |
| 浮层阴影 | `0 8px 24px rgba(41, 55, 41, 0.1)` |
| 标准缓动 | `cubic-bezier(0.2, 0, 0, 1)` |

阴影只强化外壳、抽屉、输入器和被打开的学习卡；普通行项目优先使用细线、背景差和 hover 位移。

## 3. 工作台结构与响应式

布局实现在 [`apps/web/styles/shell.css`](apps/web/styles/shell.css) 和 [`apps/web/styles/responsive.css`](apps/web/styles/responsive.css)。中央区 DOM 与测量结构不得为了视觉重排而替换。

### 3.1 宽屏：`>= 1320px`

- 壳层内缩 `14px`，尺寸为 `calc(100vw - 28px) × calc(100dvh - 28px)`，顶部栏高 `64px`。
- 主栅格为 `260px minmax(0, 1fr) 312px`：左侧学习空间、中央答疑、右侧卡片库。
- 左/右栏关闭时对应列变为 `0`，中央自然扩展；右栏默认关闭，当前会话的竖向收纳卡签仍是首要卡片入口。
- 中央消息列最大宽 `920px`；输入器同为最大 `920px`，保持稳定阅读行长。

### 3.2 中屏：`761–1319px`

- 栅格变为单列，中央优先占满；左右栏变为完整抽屉，不能压缩成只剩图标的窄栏。
- 左抽屉宽 `min(292px, 88vw)`、层级 `z-index: 13`；右抽屉宽 `min(330px, 88vw)`、层级 `z-index: 12`。
- 关闭位移分别为 `translateX(-105%)` 与 `translateX(105%)`，打开任一抽屉时显示遮罩；遮罩点击关闭两侧。
- [`apps/web/app/page.tsx`](apps/web/app/page.tsx) 通过 `matchMedia("(max-width: 1319px)")` 在进入紧凑断点时关闭两栏，并以 `responsiveReady` 避免首帧抽屉闪现。
- `761–900px` 时 `.activeKnowledgeCardDock` 改为文档流内相对定位，宽 `min(560px, calc(100% - 28px))`，避免覆盖过窄的消息列。

### 3.3 手机：`<= 760px`

- 壳层全屏，使用 `100vh` 回退和 `100dvh`；边框、圆角、外壳阴影与外部内缩归零。
- 顶栏为 `60px + safe-area-inset-top`；左右栏为互斥抽屉。左栏宽 `min(280px, 88vw)`，右栏宽 `min(330px, 92vw)`。
- `.cardShelfTabs` 隐藏；打开的学习卡进入输入器上方文档流，宽 `calc(100% - 20px)`。
- 输入器底部、遮罩、卡片查看层和抽屉均计入 `safe-area-inset-top/bottom`；工具栏可在自身区域横向滚动，页面不能横向溢出。
- `<= 480px` 进一步隐藏次要会话元数据、思考状态与部分按钮文字；题图查看器变为全屏，欢迎页标题降为 `27px`。
- 视口高度 `<= 760px` 时即使宽屏也取消壳层外部内缩，优先保证可用高度。

## 4. 信息架构

### 4.1 顶部与中央

顶部只承载产品标识、AI 工具入口和账户区域。中央顺序固定为：会话标题/状态 → 当前会话收纳卡签 → 消息时间线、检查点和对话内卡片 → 输入器。题图、公式、教学动作、生成/停止、错误、检查点和语音状态均属于现有产品能力，视觉精简不得删除。

### 4.2 历史导航与中央工作区

一级导航顺序固定：开始答疑 → 历史搜题 → 知识库 → 错题库 → 本地安全存储提示。左侧会话栏保留从真实历史派生的“试卷 → 题目”快速树：搜索同时匹配试卷名和题目名，旧会话归入“未分类题目”，题目行可打开原会话或执行单题删除。运行、加载、空列表与无匹配结果状态均须保留。“清空全部会话”由左侧树独占，中央历史页不得重复该危险操作；清空处理中、存在生成中会话或历史为空时禁用。

点击“历史搜题”后，中央在同一根路由中依次提供“历史试卷总览 → 单份试卷题目列表 → 原答疑会话”。总览仅从真实 `SessionHistoryItem[]` 在前端派生试卷组，以 A「内容化纸张预览」显示真实学段、试卷名、最近 2–3 道题标题、题目数和最近更新时间；试卷卡片网格在视口宽度 `> 1100px`、`761–1100px` 和 `≤ 760px` 时分别为 3、2、1 列。搜索同时匹配试卷名和题目名，排序支持“最近更新”和按中文试卷名升序的“名称排序”。

试卷详情显示真实题目标题、消息数、检查点数、运行状态和最近更新时间；点击题目复用既有打开链路读取原 session，不调用恢复接口复制会话。`HistoryView` 独立于 `activeNavigation`：前者区分总览、试卷详情和退出历史浏览，后者只标记一级导航归属，因此打开历史会话后仍可保持“历史搜题”高亮而渲染原答疑会话。目标是当前打开会话、正在运行，或任一打开/单题删除请求执行中时，单题删除必须禁用；中央不提供试卷级删除。

试卷实体/API、`paper_id` / `paper_name` 和左侧快速树属于继承的试卷前置，图片批量建会话仍须先选择已有试卷或创建新试卷。中央历史工作区不新增缩略图字段或 API，不逐题/逐卷下载完整 session 形成 N+1 请求，也不改变会话数据模型、右侧学习卡片系统或第 6 节冻结的卡片交互合同。

## 5. 右侧卡片系统

右侧卡片库继续承载知识卡、题目卡、文件夹、剪贴板、编辑、移动、删除、导出和清空。知识库/错题库只是同一右栏的类型过滤，不拆成新页面。列表视觉见 [`apps/web/styles/cards.css`](apps/web/styles/cards.css)，完整卡片与弹层视觉见 [`apps/web/styles/dialogs.css`](apps/web/styles/dialogs.css)。

### 5.1 主题映射

主题由 [`apps/web/lib/card-theme.ts`](apps/web/lib/card-theme.ts) 统一输出以下 CSS 变量：`--flashcard-bg`、`--flashcard-panel`、`--flashcard-panel-strong`、`--flashcard-ink`、`--flashcard-accent`、`--flashcard-shadow`。

知识卡使用 `card.id` 的稳定哈希映射到四个明亮、可读的 C4 主题；显式 `themeVariant` 使用绝对值后对四取模。不要改为随机色，否则同一卡片在收纳卡签、打开态和重载后会漂色。

| 类型 | 背景 | 面板 | 强面板 | 墨色 | 强调 | 阴影 |
| --- | --- | --- | --- | --- | --- | --- |
| 题目卡·向日葵黄 | `#f2d15f` | `#fbe9a5` | `#fff9df` | `#4b3905` | `#9a7000` | `rgba(112, 83, 0, 0.2)` |
| 知识卡·鲜叶绿 | `#8fce77` | `#d9f1cb` | `#f7fcf3` | `#173820` | `#3d8138` | `rgba(32, 83, 31, 0.18)` |
| 知识卡·清水青 | `#82cbb8` | `#d5f0e8` | `#f4fbf8` | `#123d33` | `#357f6c` | `rgba(21, 77, 64, 0.17)` |
| 知识卡·嫩芽绿 | `#a9cf7f` | `#e3f1cf` | `#f8fbf2` | `#2d3d1c` | `#597d38` | `rgba(59, 83, 31, 0.17)` |
| 知识卡·明亮薰衣草 | `#cfc3e6` | `#ece6f6` | `#fbf9fd` | `#332a45` | `#8b78ad` | `rgba(65, 52, 92, 0.17)` |

打开的 `.flashcardPresentation` 圆角 `14px`，标题 `22px`，内容区块标题/正文 `14px`，最大高度为 `min(460px, calc(100vh - 320px))`；卡体内部滚动，不能因视觉改造截断背面内容。正面像学习索引，背面像结构化复盘页；允许优化色彩、纸感、区块和阴影，但不允许改变字段语义。

## 6. 不可变的卡片交互合同

这是后续视觉改造的硬边界。实现链路位于 [`apps/web/app/page.tsx`](apps/web/app/page.tsx)、[`apps/web/components/workspace/CardShelfTabs.tsx`](apps/web/components/workspace/CardShelfTabs.tsx)、[`apps/web/components/StudyCardModal.tsx`](apps/web/components/StudyCardModal.tsx)、[`apps/web/styles/shell.css`](apps/web/styles/shell.css)、[`apps/web/styles/conversation.css`](apps/web/styles/conversation.css) 和 [`apps/web/styles/responsive.css`](apps/web/styles/responsive.css)。

### 6.1 右侧竖向收纳

- 只显示当前会话已保存卡片：最多一张题目卡加最近三张知识卡，题目卡在前。
- 容器位于中央面右缘：`top: 96px`、`right: -20px`、宽 `82px`。
- 每张卡签固定 `66 × 128px`，纵向书写；相邻卡签以 `margin-top: -28px` 重叠。有题目卡时第一张知识卡额外 `margin-top: 32px`，形成两个语义组。
- 角度依次为 `-7/5/-4/7deg`，水平偏移依次为 `0/10/3/12px`；层叠由 `calc(8 - var(--shelf-index))` 决定。hover/focus 只把当前卡签扶正，不改变收纳几何。
- 打开的源卡签使用 `.shelfCardSourceHidden` 隐藏且不可点击；不能删除占位、改变尺寸，或用另一套列表替代。

### 6.2 从点击源滑出与滑回

收纳卡签点击必须保留以下状态机：

```text
idle → preparing（同步挂载、先隐藏）
     → opening（测量源/目标矩形并写入 --shelf-motion-*）
     → open
     → closing（重新测量当前源矩形）
     → idle（动画结束后卸载并还原焦点）
```

- `openShelfCard` 保存点击源的 `getBoundingClientRect()` 与触发器焦点，使用 `flushSync` 先挂载目标；`useLayoutEffect` 再测量 dock，计算 `x/y/scaleX/scaleY`。
- 打开动画固定为 `480ms cubic-bezier(0.22, 0.82, 0.24, 1)`；关闭动画固定为 `440ms cubic-bezier(0.4, 0, 0.2, 1)`，路径互为源/目标矩形的自然往返。
- 新生成、非归档卡片走独立的 `activeCardDockEnter 420ms cubic-bezier(0.22, 0.82, 0.24, 1)`，从右侧入场；不能与收纳卡签打开链路合并。
- 右栏 `.cardOpenButton` 保持直接打开。关闭时若找不到当前会话的来源卡签，直接关闭，不伪造返回动画。
- 动画结束只接受 `event.target === event.currentTarget`；关闭阶段容器设为 `inert`。打开后焦点进入“关闭卡片”，关闭后焦点回到原触发卡签。
- `.appShell`、`.conversationPanel`、`.activeKnowledgeCardDock` 的祖先不得新增 `transform`、`scale` 或 `filter`，否则 `getBoundingClientRect()` 坐标系会改变。光场只能通过背景、尺寸、边框和局部 `backdrop-filter` 实现。

### 6.3 正反面与字段映射

`showBack` 是唯一翻面状态，卡片 `id` 改变时重置为正面。顶部 `.cardFlipButton` 与闪卡底部 `.flashcardFlipBar` 都保留 `aria-pressed`、既有文案和点击切换；不得改成 hover、拖拽或自动翻面。

| 卡片 | 正面 | 背面 |
| --- | --- | --- |
| 知识卡 | `title`（头部）、`knowledge_point`（关键关系）、`core_idea`（核心原理） | `derivation_steps[].title/content`、`when_to_use[]`、`common_mistakes[]`、`connection_to_problem` |
| 题目卡 | `title`（头部）、`problem_summary` | `solution_overview`、`solution_steps[].step/title/reasoning/result`、`pitfalls[]`、`final_answer`；非闪卡视图另显示 `how_to_think[]` |

视觉层可以调整 `.cardFaceFront` / `.cardFaceBack` 的表现，但字段不能换面、删减、合并或改名，背面必须继续可滚动。编辑、保存、舍弃、移动、删除和导出流程也不因视觉改造改变。

[`apps/web/tests/ui-visual-contract.test.ts`](apps/web/tests/ui-visual-contract.test.ts) 固化关键源文件哈希、收纳几何、开合时长、焦点交接和响应式定位；修改卡片视觉前先运行该测试，若合同断言变化必须视为产品交互变更，而非普通样式调整。

## 7. 可访问性、动效与安全区域

- 全局 `:focus-visible` 使用 `2px solid var(--primary-600)` 和 `2px` 外偏移。图标按钮必须有可访问名称；主要操作目标尽量达到 `44 × 44px`。
- 正文与背景对比度至少 `4.5:1`。成功、错误、生成中、禁用和确认状态同时使用文字或图标，不只使用色点。
- 消息、公式、卡体和抽屉各自在需要处滚动；使用 `overscroll-behavior: contain`，避免滚动穿透与横向溢出。
- `prefers-reduced-motion: reduce` 下，全局动画/过渡压缩至 `0.01ms`、单次执行并关闭平滑滚动；卡片开合降至 `1ms`，不删除最终状态和焦点交接。
- 手机端通过 `env(safe-area-inset-top, 0px)` 与 `env(safe-area-inset-bottom, 0px)` 保护顶栏、抽屉、遮罩、卡片层和输入器；始终保留 `100vh` 回退与 `100dvh` 实际高度。
- 环境纹理和无语义伪元素必须 `pointer-events: none`，不进入可访问树。

## 8. `ambient-grain.webp`

资产位于 [`apps/web/public/ambient-grain.webp`](apps/web/public/ambient-grain.webp)。它是无语义、可平铺的低对比纸雾颗粒：

- 在 `body::before` 中以 `560 × 560px` 平铺、`soft-light` 混合和 `0.055` 不透明度覆盖环境背景，约等于 5% 视觉强度。
- 在 `.flashcardPresentation` 中以 `520 × 520px` 平铺并用 `background-blend-mode: soft-light` 形成极轻纸感；它属于卡片底材，不应作为正文上方的独立遮罩。
- 不从批准稿截图裁切，不包含物体、文字、纤维、暗角或方向光，也不得影响点击、选择和数学内容清晰度。

重新生成时使用以下提示语，并保持无缝方形纹理与 WebP 输出：

```text
seamless warm white low-contrast paper mist/grain, no objects/text/fibers/vignette/directional light, subtle at 5%
```

## 9. 验证方式

在 [`apps/web`](apps/web) 运行：

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

`npm.cmd test` 必须覆盖 [`apps/web/tests/ui-visual-contract.test.ts`](apps/web/tests/ui-visual-contract.test.ts) 与 [`apps/web/tests/workspace-components.test.tsx`](apps/web/tests/workspace-components.test.tsx)，并核对 C4 工作台令牌、环境渐变、向日葵黄文件夹及五组完整卡片主题对象。如改动卡片合同相关文件，还需核对测试中冻结文件 SHA-256，并确认 `.cardShelfTabs`、`.shelfCardSourceHidden`、`shelfCardOpen`、`shelfCardClose`、`activeCardDockEnter`、`translateX(105%)` 与 reduced-motion 规则未漂移。

浏览器至少检查 `1440 / 1280 / 1024 / 768 / 390 / 375px`：

1. 欢迎态、已有会话、长数学回复、题图、生成中、错误和空状态。
2. 左侧历史搜索、恢复会话、单条删除与清空全部会话。
3. 左右抽屉、遮罩、知识/错题过滤、文件夹、编辑、移动、删除和导出。
4. 收纳卡签从点击源滑出、翻到背面、翻回、沿原路径关闭；同时验证右栏直接打开与无来源直接关闭。
5. 仅用键盘完成打开/关闭/翻面，确认焦点进入卡片并回到来源；开启 reduced motion 后状态仍完整。
6. 手机安全区域、软键盘、`100dvh`、公式横向滚动和工具栏自身滚动，无页面级横向溢出。

视觉复核同时以批准构图的空间关系和 C4 色彩增强规格的亮度、饱和度及语义映射为准，不要求逐像素复制 mock 中的示例内容。绿色与向日葵黄应更鲜活，薰衣草紫应保持高明度、低饱和，中央暖白正文面的可读性不得下降。

## 10. Mock 边界与维护规则

批准稿中的示例题目、会话文案、占位卡片、数量、图标和工具按钮只用于表达构图与氛围，均不是新增产品需求。不得仅因 mock 中出现书签、分享、更多菜单或其他控件就实现相应功能；是否存在功能必须回到 `PRODUCT.md`、现有组件、API 和状态机核对。

维护时遵循以下优先级：产品能力与字段语义 → 本文不可变交互合同 → 响应式与无障碍 → 批准构图的视觉气质。视觉调整优先改令牌和表面样式；若需要改变信息层级、卡片开合几何/时长、翻面触发或字段映射，必须先作为产品交互变更单独评审，并同步更新合同测试与本文。
