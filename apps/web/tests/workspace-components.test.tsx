import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CheckpointModal } from "../components/CheckpointModal";
import { LearningCardExportDialog } from "../components/LearningCardExportDialog";
import { LearningCardPrintView } from "../components/LearningCardPrintView";
import { MistakeSetPrintDocument } from "../components/MistakeSetPrintView";
import { FolderLocationSelect } from "../components/FolderLocationSelect";
import { StudyCardModal } from "../components/StudyCardModal";
import { ConversationHeader } from "../components/workspace/ConversationHeader";
import { HistoryWorkspace } from "../components/workspace/HistoryWorkspace";
import { KnowledgeWorkspace } from "../components/workspace/KnowledgeWorkspace";
import { MistakeSetWorkspace } from "../components/workspace/MistakeSetWorkspace";
import {
  anchoredInteractionScrollTop,
  MessageTimeline,
  shouldCollapseAnchoredInteraction
} from "../components/workspace/MessageTimeline";
import { ModelProfilePicker } from "../components/workspace/ModelProfilePicker";
import { PandaAvatar, PandaHeroArtwork } from "../components/workspace/PandaArtwork";
import { PandaWelcome } from "../components/workspace/PandaWelcome";
import { TutorComposer } from "../components/workspace/TutorComposer";
import { boxFromPoints, ProblemImageSelector } from "../components/ProblemImageSelector";
import { clampImageScale, ProblemImageViewer } from "../components/ProblemImageViewer";
import { CardShelfTabs } from "../components/workspace/CardShelfTabs";
import { SessionSidebar } from "../components/workspace/SessionSidebar";
import { StudyCardSidebar } from "../components/workspace/StudyCardSidebar";
import { getPastedImageFiles } from "../components/workspace/TutorComposer";
import type { CardFolder, MistakeSet, ModelProfile, SessionHistoryItem, StudyCard } from "../lib/api";
import { cardVisualTheme, stableCardThemeIndex } from "../lib/card-theme";
import { cardFixture, checkpointFixture, knowledgeFolderFixture } from "./fixtures";

const profile: ModelProfile = {
  id: "profile-1",
  display_name: "本地演示",
  provider: "local_demo",
  base_url: "local://demo",
  base_url_host: "demo",
  model: "demo-model",
  tags: [],
  status: "active",
  key_state: "saved",
  masked_api_key: "",
  timeout_ms: 1000,
  temperature: 0.2,
  max_output_tokens: 1000,
  is_multimodal: false,
  reasoning_effort: "low",
  reasoning_effort_options: ["none", "low", "high"],
  reasoning_control: "none",
  reasoning_control_description: "本地演示模型不使用推理预算。"
};

const problemCardFixture: StudyCard = {
  id: "problem-card-1",
  session_id: "session-a",
  card_type: "problem_card",
  source_action_id: "problem-action-1",
  source_message_id: "problem-message-1",
  folder_id: "folder_default_problem",
  content: {
    type: "problem_card",
    title: "皮带轮半径题",
    problem_summary: "已知两个皮带轮的直径与转数关系，求另一个轮子的半径。",
    solution_overview: "先用周长乘转数相等求直径，再换算半径。",
    solution_steps: [{ step: 1, title: "建立关系", reasoning: "皮带不打滑。", result: "d₁n₁=d₂n₂" }],
    how_to_think: ["先找不变量"],
    pitfalls: ["不要混淆直径与半径"],
    final_answer: "24 cm"
  },
  created_at: "2026-07-18T00:00:00Z",
  saved_at: "2026-07-18T00:00:01Z"
};

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

function historyProblemCard(sessionId: string, title: string, savedAt: string): StudyCard {
  return {
    id: `problem-card-${sessionId}`,
    session_id: sessionId,
    card_type: "problem_card",
    source_action_id: `action-${sessionId}`,
    source_message_id: `message-${sessionId}`,
    folder_id: "paper-a",
    content: {
      type: "problem_card",
      title,
      problem_summary: `${title}的题目摘要`,
      solution_overview: "先识别关系，再完成计算。",
      solution_steps: [{ step: 1, title: "建立关系", reasoning: "根据题意。", result: "得到关键等式" }],
      how_to_think: ["先找不变量"],
      pitfalls: ["注意单位"],
      final_answer: "答案"
    },
    created_at: savedAt,
    saved_at: savedAt
  };
}

const historyProblemCards = [
  historyProblemCard("session-current", "当前题目", "2026-08-03T00:00:00Z"),
  historyProblemCard("session-delete", "可删除题目", "2026-08-01T00:00:00Z")
];

const historyProblemFolder: CardFolder = {
  id: "paper-a",
  name: "期中数学卷",
  parent_id: "paper-archive-root",
  is_system: false,
  default_card_type: null,
  managed_kind: "paper_archive",
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-03T00:00:00Z"
};

const historyWorkspaceProps = {
  cards: historyProblemCards,
  folders: [historyProblemFolder],
  overviewQuery: "",
  sortMode: "recent" as const,
  actionError: "",
  leftOpen: true,
  cardBusyId: "",
  onExpandLeft: () => {},
  onOverviewQueryChange: () => {},
  onSortModeChange: () => {},
  onOpenPaper: () => {},
  onBackToOverview: () => {},
  onOpenCard: () => {},
  onDeleteCard: () => {},
  onStartNewChat: () => {},
  onClearActionError: () => {}
};

function historyDeleteButton(markup: string, title: string) {
  const match = markup.match(new RegExp(
    `<button(?=[^>]*class="historyQuestionDelete")(?=[^>]*aria-label="删除题目卡片：${title}")[^>]*>`
  ));
  assert.ok(match);
  return match[0];
}

test("history navigation owns a three-state central view and separate load errors", () => {
  const pageSource = readFileSync(resolve(__dirname, "../../../app/page.tsx"), "utf8");

  assert.match(pageSource, /useState<HistoryView>\(null\)/);
  assert.match(pageSource, /useState<HistorySortMode>\("recent"\)/);
  assert.match(pageSource, /const \[historyLoadError, setHistoryLoadError\]/);
  assert.match(pageSource, /<HistoryWorkspace/);

  const refreshStart = pageSource.indexOf("async function refreshHistory()");
  const refreshEnd = pageSource.indexOf("async function refreshExamPapers()", refreshStart);
  assert.ok(refreshStart >= 0);
  assert.ok(refreshEnd > refreshStart);
  const refreshSource = pageSource.slice(refreshStart, refreshEnd);
  assert.match(refreshSource, /setHistoryLoadError\(""\)/);
  const refreshCatchStart = refreshSource.indexOf("catch (nextError)");
  const refreshFinallyStart = refreshSource.indexOf("finally", refreshCatchStart);
  assert.ok(refreshCatchStart >= 0);
  assert.ok(refreshFinallyStart > refreshCatchStart);
  assert.match(
    refreshSource.slice(refreshCatchStart, refreshFinallyStart),
    /setHistoryLoadError/
  );
  assert.doesNotMatch(refreshSource, /runtime\.setError/);

  const openHistorySessionStart = pageSource.indexOf("function handleOpenHistorySession(");
  const startNewChatStart = pageSource.indexOf("function handleStartNewChat()", openHistorySessionStart);
  assert.ok(openHistorySessionStart >= 0);
  assert.ok(startNewChatStart > openHistorySessionStart);
  const openHistorySessionSource = pageSource.slice(openHistorySessionStart, startNewChatStart);
  const clearHistoryViewIndex = openHistorySessionSource.indexOf("setHistoryView(null)");
  const openSessionIndex = openHistorySessionSource.indexOf("handleOpenSession(targetSessionId)");
  assert.ok(clearHistoryViewIndex >= 0);
  assert.ok(openSessionIndex > clearHistoryViewIndex);
  assert.match(openHistorySessionSource, /setContentNavigation\("history"\)/);
  assert.match(openHistorySessionSource, /closeNavigationOnMobile/);
  assert.equal(
    (pageSource.match(/onOpenSession=\{handleOpenHistorySession\}/g) ?? []).length,
    1
  );
});

test("history bootstrap restoration yields to explicit navigation", () => {
  const pageSource = readFileSync(resolve(__dirname, "../../../app/page.tsx"), "utf8");

  assert.match(pageSource, /const bootstrapNavigationRef = useRef\(0\)/);

  const bootstrapCallIndex = pageSource.indexOf("void restoreWorkspaceAfterRefresh(");
  const bootstrapEffectStart = pageSource.lastIndexOf("useEffect(() => {", bootstrapCallIndex);
  const bootstrapEffectEnd = pageSource.indexOf("}, []);", bootstrapCallIndex);
  assert.ok(bootstrapEffectStart >= 0);
  assert.ok(bootstrapEffectEnd > bootstrapCallIndex);
  const bootstrapEffectSource = pageSource.slice(bootstrapEffectStart, bootstrapEffectEnd);
  const captureIndex = bootstrapEffectSource.indexOf(
    "const bootstrapNavigationToken = bootstrapNavigationRef.current;"
  );
  const restoreWorkspaceCallIndex = bootstrapEffectSource.indexOf(
    "restoreWorkspaceAfterRefresh(bootstrapNavigationToken)"
  );
  assert.ok(captureIndex >= 0);
  assert.ok(restoreWorkspaceCallIndex > captureIndex);

  const restoreWorkspaceStart = pageSource.indexOf(
    "async function restoreWorkspaceAfterRefresh(bootstrapNavigationToken: number)"
  );
  const restoreWorkspaceEnd = pageSource.indexOf(
    "async function refreshHistory()",
    restoreWorkspaceStart
  );
  assert.ok(restoreWorkspaceStart >= 0);
  assert.ok(restoreWorkspaceEnd > restoreWorkspaceStart);
  const restoreWorkspaceSource = pageSource.slice(restoreWorkspaceStart, restoreWorkspaceEnd);
  assert.match(
    restoreWorkspaceSource,
    /restoreSessionAfterRefresh\(activeSessionId, bootstrapNavigationToken\)/
  );

  const restoreSessionStart = pageSource.indexOf(
    "async function restoreSessionAfterRefresh(targetSessionId: string, bootstrapNavigationToken: number)"
  );
  const restoreSessionEnd = pageSource.indexOf(
    "async function resumePendingStudentRequest",
    restoreSessionStart
  );
  assert.ok(restoreSessionStart >= 0);
  assert.ok(restoreSessionEnd > restoreSessionStart);
  const restoreSessionSource = pageSource.slice(restoreSessionStart, restoreSessionEnd);
  const fetchSessionIndex = restoreSessionSource.indexOf(
    "const opened = await fetchSession(targetSessionId);"
  );
  const staleReturnIndex = restoreSessionSource.indexOf(
    "if (bootstrapNavigationRef.current !== bootstrapNavigationToken) return;"
  );
  const loadSessionIndex = restoreSessionSource.indexOf("runtime.loadSession(opened);");
  assert.ok(fetchSessionIndex >= 0);
  assert.ok(staleReturnIndex > fetchSessionIndex);
  assert.ok(loadSessionIndex > staleReturnIndex);
  assert.ok(restoreSessionSource.indexOf("setHistoryView(null)") > staleReturnIndex);
  assert.ok(restoreSessionSource.indexOf('setContentNavigation("history")') > staleReturnIndex);

  const activeRestoreCallIndex = restoreWorkspaceSource.indexOf(
    "restoreSessionAfterRefresh(activeSessionId, bootstrapNavigationToken)"
  );
  const activeRestoreCatchIndex = restoreWorkspaceSource.indexOf(
    "catch (nextError)",
    activeRestoreCallIndex
  );
  const inactiveSessionBranchIndex = restoreWorkspaceSource.lastIndexOf(
    "setInput(loadComposerDraft(window.localStorage, DRAFT_SCOPE));"
  );
  assert.ok(activeRestoreCallIndex >= 0);
  assert.ok(activeRestoreCatchIndex > activeRestoreCallIndex);
  assert.ok(inactiveSessionBranchIndex > activeRestoreCatchIndex);
  const activeRestoreCatchSource = restoreWorkspaceSource.slice(
    activeRestoreCatchIndex,
    inactiveSessionBranchIndex
  );
  const currentTokenGuardIndex = activeRestoreCatchSource.indexOf(
    "if (bootstrapNavigationRef.current === bootstrapNavigationToken)"
  );
  assert.ok(currentTokenGuardIndex >= 0);
  assert.ok(activeRestoreCatchSource.indexOf('saveActiveSessionId(window.localStorage, "")') > currentTokenGuardIndex);
  assert.ok(activeRestoreCatchSource.indexOf("runtime.setError") > currentTokenGuardIndex);

  assert.equal(
    (pageSource.match(/invalidateBootstrapNavigation\(\);/g) ?? []).length,
    3
  );
  const openHistoryStart = pageSource.indexOf("function handleOpenHistorySession(");
  const startNewChatStart = pageSource.indexOf("function handleStartNewChat()", openHistoryStart);
  const deleteSessionStart = pageSource.indexOf("async function handleDeleteSession", startNewChatStart);
  const openSessionStart = pageSource.indexOf("async function handleOpenSession(");
  const openSessionEnd = pageSource.indexOf("function handleOpenHistoryPaper(", openSessionStart);
  const onNavigateStart = pageSource.indexOf("onNavigate={(navigation) => {");
  const onNavigateEnd = pageSource.indexOf("onOpenSession={handleOpenHistorySession}", onNavigateStart);
  assert.ok(openSessionStart >= 0);
  assert.ok(openSessionEnd > openSessionStart);
  const openHistorySource = pageSource.slice(openHistoryStart, startNewChatStart);
  const openSessionSource = pageSource.slice(openSessionStart, openSessionEnd);
  const startNewChatSource = pageSource.slice(startNewChatStart, deleteSessionStart);
  const onNavigateSource = pageSource.slice(onNavigateStart, onNavigateEnd);
  assert.match(
    openHistorySource,
    /setHistoryView\(null\);[\s\S]*?setContentNavigation\("history"\);[\s\S]*?void handleOpenSession\(targetSessionId\);/
  );
  assert.doesNotMatch(openHistorySource, /handleStartNewChat\(/);
  assert.doesNotMatch(openSessionSource, /setContentNavigation\(/);
  assert.ok(openHistorySource.indexOf("invalidateBootstrapNavigation();") < openHistorySource.indexOf("setHistoryView(null)"));
  assert.ok(startNewChatSource.indexOf("invalidateBootstrapNavigation();") < startNewChatSource.indexOf("setHistoryView(null)"));
  assert.ok(onNavigateSource.indexOf("invalidateBootstrapNavigation();") < onNavigateSource.indexOf('navigation === "mistake_collection"'));
  assert.match(onNavigateSource, /setContentNavigation\(navigation\)/);
  assert.match(onNavigateSource, /navigation === "mistake_collection"[\s\S]*?setHistoryView\(\{ mode: "overview" \}\)/);
  assert.match(onNavigateSource, /navigation === "mistake_sets"[\s\S]*?setMistakeSetView\(\{ mode: "overview" \}\)/);
  assert.match(onNavigateSource, /navigation === "knowledge"[\s\S]*?setKnowledgeView\(\{ mode: "overview" \}\)/);
  assert.doesNotMatch(onNavigateSource, /setCardLibraryNavigation/);

  const refreshHistoryStart = pageSource.indexOf("async function refreshHistory()");
  const refreshHistoryEnd = pageSource.indexOf("async function refreshExamPapers()", refreshHistoryStart);
  assert.doesNotMatch(
    pageSource.slice(refreshHistoryStart, refreshHistoryEnd),
    /bootstrapNavigation/
  );
});

test("mistake card workspace only renders archived problem cards", () => {
  const overview = renderToStaticMarkup(
    <HistoryWorkspace {...historyWorkspaceProps} view={{ mode: "overview" }} />
  );
  const detail = renderToStaticMarkup(
    <HistoryWorkspace {...historyWorkspaceProps} view={{ mode: "paper", paperId: "paper-a" }} />
  );
  const backButton = detail.match(
    /<button class="historyWorkspaceBack"[\s\S]*?<\/button>/
  )?.[0] ?? "";

  assert.match(overview, /错题卡片库/);
  assert.match(overview, /卡片入库后永久保留，与答疑会话相互独立/);
  assert.doesNotMatch(overview, /<h1>历史搜题<\/h1>/);
  assert.match(overview, /搜索试卷或题目/);
  assert.match(overview, /最近更新/);
  assert.match(overview, /名称排序/);
  assert.doesNotMatch(overview, /<img/);
  assert.doesNotMatch(overview, /historyQuestionDelete/);
  assert.match(detail, /historyWorkspaceHeader historyWorkspaceHeaderDetail/);
  assert.match(backButton, /aria-label="返回错题卡片库全部试卷"/);
  assert.match(backButton, /title="返回全部试卷"/);
  assert.match(backButton, /<svg/);
  assert.doesNotMatch(backButton, /<span>/);
  assert.match(detail, /返回全部试卷/);
  assert.match(detail, /当前题目的题目摘要/);
  assert.match(detail, /可删除题目的题目摘要/);
  assert.doesNotMatch(detail, /生成中题目/);
  assert.doesNotMatch(detail, /条消息|个检查点|正在思考/);
});

test("mistake card rows open cards instead of reopening tutoring sessions", () => {
  const componentSource = readFileSync(
    resolve(__dirname, "../../../components/workspace/HistoryWorkspace.tsx"),
    "utf8"
  );
  const pageSource = readFileSync(resolve(__dirname, "../../../app/page.tsx"), "utf8");

  assert.match(componentSource, /onClick=\{\(event\) => onOpenCard\(card, event\.currentTarget\.getBoundingClientRect\(\), event\.currentTarget\)\}/);
  assert.doesNotMatch(componentSource, /SessionHistoryItem|onOpenSession|session_id/);
  assert.match(pageSource, /cards=\{problemLibraryCards\}/);
  assert.match(pageSource, /onOpenCard=\{openLibraryCard\}/);
});

test("history workspace formats SSR dates in Asia Shanghai", () => {
  const componentPath = resolve(__dirname, "../components/workspace/HistoryWorkspace.js");
  const result = spawnSync(process.execPath, ["-e", `
    const React = require("react");
    const { renderToStaticMarkup } = require("react-dom/server");
    const { HistoryWorkspace } = require(${JSON.stringify(componentPath)});
    const noop = () => {};
    const markup = renderToStaticMarkup(React.createElement(HistoryWorkspace, {
      view: { mode: "overview" },
      cards: [{
        id: "problem-card-midnight",
        session_id: "session-midnight",
        card_type: "problem_card",
        source_action_id: "action-midnight",
        source_message_id: "message-midnight",
        folder_id: "folder-midnight",
        content: {
          type: "problem_card",
          title: "跨日题目",
          problem_summary: "跨日题目摘要",
          solution_overview: "解题思路",
          solution_steps: [],
          how_to_think: [],
          pitfalls: [],
          final_answer: "答案"
        },
        created_at: "2026-08-05T16:30:00Z",
        saved_at: "2026-08-05T16:30:00Z"
      }],
      folders: [{
        id: "folder-midnight",
        name: "午夜试卷",
        parent_id: "paper-archive-root",
        is_system: false,
        default_card_type: null,
        managed_kind: "paper_archive",
        created_at: "2026-08-05T16:00:00Z",
        updated_at: "2026-08-05T16:30:00Z"
      }],
      overviewQuery: "",
      sortMode: "recent",
      actionError: "",
      leftOpen: true,
      cardBusyId: "",
      onExpandLeft: noop,
      onOverviewQueryChange: noop,
      onSortModeChange: noop,
      onOpenPaper: noop,
      onBackToOverview: noop,
      onOpenCard: noop,
      onDeleteCard: noop,
      onStartNewChat: noop,
      onClearActionError: noop
    }));
    process.stdout.write(markup);
  `], {
    cwd: resolve(__dirname, "../../.."),
    encoding: "utf8",
    env: { ...process.env, TZ: "UTC" }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2026年8月6日/);
  assert.doesNotMatch(result.stdout, /2026年8月5日/);
});

test("workspace sidebar omits session dates and message counts", () => {
  const componentPath = resolve(__dirname, "../components/workspace/SessionSidebar.js");
  const result = spawnSync(process.execPath, ["-e", `
    const React = require("react");
    const { renderToStaticMarkup } = require("react-dom/server");
    const { SessionSidebar } = require(${JSON.stringify(componentPath)});
    const noop = () => {};
    const markup = renderToStaticMarkup(React.createElement(SessionSidebar, {
      historyItems: [{
        session_id: "session-midnight",
        paper_id: "paper-midnight",
        paper_name: "午夜试卷",
        title: "跨日题目",
        grade_band: "junior",
        model_profile_id: "profile-1",
        model_display_name: "本地演示",
        message_count: 1,
        checkpoint_count: 0,
        state_hint: "diagnosing",
        context_status: "ready",
        created_at: "2026-08-05T16:00:00Z",
        updated_at: "2026-08-05T16:30:00Z"
      }],
      activeSessionId: "session-midnight",
      historyBusy: false,
      openSessionBusyId: "",
      deleteSessionBusyId: "",
      deleteAllSessionsBusy: false,
      runningSessionIds: [],
      activeNavigation: "history",
      onCollapse: noop,
      onNewChat: noop,
      onNavigate: noop,
      onOpenSession: noop,
      onDeleteSession: noop,
      onDeleteAllSessions: noop
    }));
    process.stdout.write(markup);
  `], {
    cwd: resolve(__dirname, "../../.."),
    encoding: "utf8",
    env: { ...process.env, TZ: "UTC" }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /跨日题目/);
  assert.doesNotMatch(result.stdout, /2026年|2026-08|条消息/);
});

test("knowledge card library selects cards before opening the export dialog", () => {
  const idleMarkup = renderToStaticMarkup(
    <KnowledgeWorkspace
      view={{ mode: "overview" }}
      cards={[cardFixture]}
      folders={[knowledgeFolderFixture]}
      leftOpen
      onExpandLeft={() => {}}
      onOpenGroup={() => {}}
      onBackToOverview={() => {}}
      onOpenCard={() => {}}
      onMoveCard={() => {}}
    />
  );
  const idleExportButton = idleMarkup.match(/<button[^>]*historyExportAction[^>]*>/)?.[0] ?? "";

  const selectedMarkup = renderToStaticMarkup(
    <KnowledgeWorkspace
      view={{ mode: "overview" }}
      cards={[cardFixture]}
      folders={[knowledgeFolderFixture]}
      leftOpen
      selectionMode
      selectedCardIds={[cardFixture.id]}
      onExpandLeft={() => {}}
      onOpenGroup={() => {}}
      onBackToOverview={() => {}}
      onOpenCard={() => {}}
      onMoveCard={() => {}}
      onToggleSelectionMode={() => {}}
      onToggleCardSelection={() => {}}
      onToggleGroupSelection={() => {}}
      onExportSelection={() => {}}
    />
  );
  const selectedExportButton = selectedMarkup.match(/<button[^>]*historyExportAction[^>]*>/)?.[0] ?? "";
  const selectedDeleteButton = selectedMarkup.match(/<button[^>]*historyDeleteSelectionAction[^>]*>/)?.[0] ?? "";

  assert.match(idleMarkup, /知识卡片库/);
  assert.match(idleMarkup, /多选/);
  assert.match(idleExportButton, /disabled=""/);
  assert.match(selectedMarkup, /退出多选/);
  assert.match(selectedMarkup, /导出 \(1\)/);
  assert.match(selectedMarkup, /删除 \(1\)/);
  assert.match(selectedMarkup, /取消整卷/);
  assert.doesNotMatch(selectedExportButton, /disabled=""/);
  assert.doesNotMatch(selectedDeleteButton, /disabled=""/);
});

test("mistake card library exposes confirmed batch deletion beside multi-select", () => {
  const markup = renderToStaticMarkup(
    <HistoryWorkspace
      {...historyWorkspaceProps}
      view={{ mode: "overview" }}
      selectionMode
      selectedCardIds={[historyProblemCards[0].id]}
    />
  );
  assert.match(markup, /退出多选/);
  assert.match(markup, /删除 \(1\)/);
  assert.match(markup, /导出 \(1\)/);
});

test("mistake-set library selects and batch deletes saved snapshots", () => {
  const mistakeSet: MistakeSet = {
    id: "mistake-set-1",
    name: "错题复习",
    items: [{
      id: "mistake-item-1",
      source_session_id: null,
      source_paper_name: "代数卷",
      title: "这是一个需要单行省略显示的很长题目标题",
      problem_text: "题目摘要",
      problem_image_data_url: null,
      problem_card: problemCardFixture.content.type === "problem_card" ? problemCardFixture.content : null,
      position: 0,
      created_at: "2026-08-07T00:00:00Z"
    }],
    created_at: "2026-08-07T00:00:00Z",
    updated_at: "2026-08-07T00:00:00Z"
  };
  const markup = renderToStaticMarkup(
    <MistakeSetWorkspace
      view={{ mode: "overview" }}
      mistakeSets={[mistakeSet]}
      busy={false}
      leftOpen
      selectionMode
      selectedSetIds={[mistakeSet.id]}
      onExpandLeft={() => {}}
      onOpenSet={() => {}}
      onBackToOverview={() => {}}
      onPrint={() => {}}
    />
  );
  assert.match(markup, /mistakeSetLibraryWorkspace/);
  assert.match(markup, /退出多选/);
  assert.match(markup, /删除 \(1\)/);
  assert.match(markup, /取消选择：错题复习/);
});

test("mistake card workspace renders empty no-result and removed-folder states", () => {
  const empty = renderToStaticMarkup(<HistoryWorkspace {...historyWorkspaceProps} cards={[]} view={{ mode: "overview" }} />);
  const noResult = renderToStaticMarkup(<HistoryWorkspace {...historyWorkspaceProps} overviewQuery="不存在" view={{ mode: "overview" }} />);
  const removedFolder = renderToStaticMarkup(<HistoryWorkspace {...historyWorkspaceProps} view={{ mode: "paper", paperId: "paper-missing" }} />);

  assert.match(empty, /还没有题目卡片/);
  assert.match(empty, /完成答疑并归档题目卡片后/);
  assert.match(empty, /未生成或未入库的题目不会显示/);
  assert.match(empty, /开始答疑/);
  assert.match(noResult, /没有匹配的试卷或题目卡片/);
  assert.match(removedFolder, /这份题目卡片归档已经不存在/);
  assert.match(removedFolder, /返回错题卡片库/);
});

test("mistake card workspace deletes cards without touching sessions", () => {
  const detail = renderToStaticMarkup(
    <HistoryWorkspace {...historyWorkspaceProps} view={{ mode: "paper", paperId: "paper-a" }} />
  );
  assert.doesNotMatch(historyDeleteButton(detail, "当前题目"), /disabled=""/);
  assert.doesNotMatch(historyDeleteButton(detail, "可删除题目"), /disabled=""/);

  const deleting = renderToStaticMarkup(
    <HistoryWorkspace {...historyWorkspaceProps} cardBusyId={historyProblemCards[0].id} view={{ mode: "paper", paperId: "paper-a" }} />
  );
  assert.match(historyDeleteButton(deleting, "可删除题目"), /disabled=""/);
});

test("workspace header and timeline preserve teaching context labels", () => {
  const header = renderToStaticMarkup(
    <ConversationHeader
      leftOpen
      title="一次函数"
      sessionId="session-a"
      gradeBand="junior"
      selectedProfile={profile}
      streamBusy
      problemImageUrl="data:image/png;base64,AAAA"
      onExpandLeft={() => {}}
      onViewProblemImage={() => {}}
    />
  );
  assert.match(header, /一次函数/);
  assert.match(header, /初中数学/);
  assert.match(header, /正在思考/);
  assert.match(header, /查看题目/);

  const progressHeader = renderToStaticMarkup(
    <ConversationHeader
      leftOpen
      title="一次函数"
      sessionId="session-a"
      gradeBand="junior"
      selectedProfile={profile}
      streamBusy
      progressLabel="正在核对你的思路"
      onExpandLeft={() => {}}
      onViewProblemImage={() => {}}
    />
  );
  assert.match(progressHeader, /正在核对你的思路/);

  const timeline = renderToStaticMarkup(
    <MessageTimeline
      messages={[{ id: "message-1", role: "assistant", text: "先看等式两边", action: "EXPLAIN_PRINCIPLE" }]}
      messageEndRef={{ current: null }}
    />
  );
  assert.match(timeline, /先看等式两边/);
  assert.match(timeline, /原理讲解/);
  assert.match(timeline, /data-panda-avatar="true"/);
  assert.doesNotMatch(timeline, /lucide-bot/);
});

test("panda artwork separates the chat avatar from book and shadow layers", () => {
  const avatar = renderToStaticMarkup(<PandaAvatar />);
  const hero = renderToStaticMarkup(<PandaHeroArtwork />);

  assert.match(avatar, /data-panda-avatar="true"/);
  assert.match(avatar, /data-panda-part="body"/);
  assert.doesNotMatch(avatar, /data-panda-part="book"/);
  assert.doesNotMatch(avatar, /data-panda-part="book-shadow"/);
  assert.doesNotMatch(avatar, /data-panda-part="panda-shadow"/);
  assert.match(hero, /data-panda-part="book"/);
  assert.match(hero, /data-panda-part="book-shadow"/);
  assert.match(hero, /data-panda-part="panda-shadow"/);
});

test("panda welcome renders the approved copy, bamboo trio, and glyph sequence", () => {
  const welcome = renderToStaticMarkup(
    <PandaWelcome phase="visible" characterRef={{ current: null }} />
  );

  assert.match(welcome, /data-panda-welcome="visible"/);
  assert.doesNotMatch(welcome, /pandaWelcomeLabel/);
  assert.match(welcome, /今天你想要解决什么问题？/);
  assert.match(welcome, /上传题目图片，熊猫会帮你理清当时错误思路，/);
  assert.match(welcome, /陪你梳理真实思考逻辑顺序！/);
  assert.equal((welcome.match(/bambooPlant /g) ?? []).length, 3);
  assert.equal((welcome.match(/pandaTitleGlyph/g) ?? []).length, Array.from("今天你想要解决什么问题？").length);
});

test("assistant panda hop is limited to the newest streaming message", () => {
  const timeline = renderToStaticMarkup(
    <MessageTimeline
      messages={[
        { id: "assistant-old", role: "assistant", text: "上一条", streamState: "complete" },
        { id: "assistant-new", role: "assistant", text: "新回复", streamState: "streaming" }
      ]}
      messageEndRef={{ current: null }}
    />
  );

  assert.equal((timeline.match(/pandaAvatarHop/g) ?? []).length, 1);
  assert.equal((timeline.match(/data-panda-avatar="true"/g) ?? []).length, 2);
});

test("problem image viewer exposes persistent access and bounded zoom controls", () => {
  const viewer = renderToStaticMarkup(
    <ProblemImageViewer imageUrl="data:image/png;base64,AAAA" onClose={() => {}} />
  );
  const timeline = renderToStaticMarkup(
    <MessageTimeline
      messages={[{
        id: "student-image",
        role: "student",
        text: "上传了一张题目图片",
        imageUrl: "data:image/png;base64,AAAA"
      }]}
      messageEndRef={{ current: null }}
      onOpenImage={() => {}}
    />
  );

  assert.match(viewer, /题目图片/);
  assert.match(viewer, /缩小图片/);
  assert.match(viewer, /放大图片/);
  assert.match(viewer, /重置图片视图/);
  assert.match(timeline, /放大查看题目图片/);
  assert.equal(clampImageScale(0.25), 1);
  assert.equal(clampImageScale(3), 3);
  assert.equal(clampImageScale(8), 5);
});

test("failed student turn exposes a retry control beside the original message", () => {
  const timeline = renderToStaticMarkup(
    <MessageTimeline
      messages={[{ id: "failed-student", role: "student", text: "我的思路是先配方" }]}
      messageEndRef={{ current: null }}
      retryableMessageId="failed-student"
      onRetryMessage={() => {}}
    />
  );

  assert.match(timeline, /重试本轮/);
  assert.match(timeline, /重试这条消息对应的答疑/);
  const timelineSource = readFileSync(
    resolve(__dirname, "../../../components/workspace/MessageTimeline.tsx"),
    "utf8"
  );
  const conversationCss = readFileSync(
    resolve(__dirname, "../../../styles/conversation.css"),
    "utf8"
  );
  assert.doesNotMatch(timelineSource, /floatingObstacle|avoidsKnowledgeCard|knowledge-card-avoidance-width/);
  assert.doesNotMatch(conversationCss, /avoidsKnowledgeCard|knowledge-card-avoidance-width/);
});

test("checkpoint and pending card interactions render inside the conversation without backdrops", () => {
  const checkpoint = renderToStaticMarkup(
    <CheckpointModal checkpoint={checkpointFixture} onSubmit={() => {}} />
  );
  assert.match(checkpoint, /对话中的检查点/);
  assert.match(checkpoint, /提交答案/);
  assert.match(checkpoint, /aria-pressed="false"/);
  assert.match(checkpoint, /我想自己输入回答/);
  assert.equal((checkpoint.match(/class="optionButton/g) ?? []).length, 5);
  assert.doesNotMatch(checkpoint, /modalBackdrop/);

  const answeredCheckpoint = renderToStaticMarkup(
    <CheckpointModal
      checkpoint={checkpointFixture}
      answer={{ selected_option_id: "B", is_correct: false }}
    />
  );
  assert.match(answeredCheckpoint, /我的检查点作答/);
  assert.match(answeredCheckpoint, /optionButton selected incorrect/);
  assert.doesNotMatch(answeredCheckpoint, /回答错误|你选择了/);
  assert.doesNotMatch(answeredCheckpoint, /提交答案/);

  const correctCheckpoint = renderToStaticMarkup(
    <CheckpointModal
      checkpoint={checkpointFixture}
      answer={{ selected_option_id: "A", is_correct: true }}
    />
  );
  assert.match(correctCheckpoint, /optionButton selected correct/);
  assert.doesNotMatch(correctCheckpoint, /回答正确|你选择了/);

  const card = renderToStaticMarkup(
    <StudyCardModal card={cardFixture} editable onSave={() => {}} onDiscard={() => {}} />
  );
  assert.match(card, /对话中的知识卡片/);
  assert.match(card, /修改内容/);
  assert.match(card, /翻到背面/);
  assert.match(card, /cardFaceFront/);
  assert.match(card, /保存为知识卡片/);
  assert.match(card, /舍弃/);
  assert.doesNotMatch(card, /modalBackdrop/);

  const flashcard = renderToStaticMarkup(
    <StudyCardModal
      card={cardFixture}
      appearance="flashcard"
      editable
      onSave={() => {}}
      onDiscard={() => {}}
    />
  );
  assert.match(flashcard, /flashcardPresentation/);
  assert.match(flashcard, /flashcardPin/);
  assert.match(flashcard, /关键关系/);
  assert.match(flashcard, /核心原理/);
  assert.match(flashcard, /翻转查看推导与应用/);
  assert.match(flashcard, /保存为知识卡片/);
  assert.doesNotMatch(flashcard, /对话中的知识卡片/);

  const archivedFlashcard = renderToStaticMarkup(
    <StudyCardModal
      card={{ ...cardFixture, saved_at: "2026-07-21T00:00:00Z" }}
      appearance="flashcard"
      libraryView
      editable
      onSave={() => {}}
      onClose={() => {}}
    />
  );
  assert.match(archivedFlashcard, /flashcardPresentation/);
  assert.match(archivedFlashcard, /aria-label="关闭卡片"/);
  assert.doesNotMatch(archivedFlashcard, /cardViewerDialog/);

  const problemFlashcard = renderToStaticMarkup(
    <StudyCardModal card={problemCardFixture} appearance="flashcard" onSave={() => {}} />
  );
  assert.match(problemFlashcard, /problemFlashcard flashcardPresentation/);
  assert.match(problemFlashcard, /题目摘要/);
  assert.match(problemFlashcard, /翻转查看解题步骤/);
  assert.match(problemFlashcard, /保存为题目卡片/);
  assert.doesNotMatch(problemFlashcard, /先独立想一想/);

  const libraryCard = renderToStaticMarkup(
    <StudyCardModal
      card={{ ...cardFixture, saved_at: "2026-07-21T00:00:00Z" }}
      displayMode="viewer"
      libraryView
      editable
      onSave={() => {}}
      onClose={() => {}}
    />
  );
  assert.match(libraryCard, /cardViewerDialog/);
  assert.match(libraryCard, /卡片库中的知识卡片/);
  assert.match(libraryCard, /修改内容/);
  assert.match(libraryCard, /保存修改/);
  assert.doesNotMatch(libraryCard, /inlineInteraction/);

  const cardSource = readFileSync(resolve(__dirname, "../../../components/StudyCardModal.tsx"), "utf8");
  const dialogStyles = readFileSync(resolve(__dirname, "../../../styles/dialogs.css"), "utf8");
  const conversationStyles = readFileSync(resolve(__dirname, "../../../styles/conversation.css"), "utf8");
  assert.match(cardSource, /discardConfirmation \? "确认舍弃" : "舍弃"/);
  assert.match(cardSource, /folders\.length > 0 && !saveLocationExpanded/);
  assert.match(cardSource, /folders\.length > 0 && saveLocationExpanded \? \(/);
  assert.match(dialogStyles, /\.cardViewerLayer\s*\{[^}]*justify-content:\s*flex-end;[^}]*pointer-events:\s*none;/);
  assert.match(dialogStyles, /\.studyCardDialog\.cardViewerDialog\s*\{[^}]*overflow-y:\s*auto;[^}]*pointer-events:\s*auto;/);
  assert.match(dialogStyles, /\.studyCardDialog\.knowledgeFlashcard\.flashcardPresentation\s*\{[^}]*max-height:\s*min\(430px,[^}]*background-color:\s*color-mix\([^}]*64%[^}]*0\.72[^}]*radial-gradient[^}]*linear-gradient[^}]*backdrop-filter:\s*blur\(26px\) saturate\(1\.16\);[^}]*box-shadow:/);
  assert.doesNotMatch(dialogStyles, /\.studyCardDialog\.knowledgeFlashcard\.flashcardPresentation\s*\{[^}]*ambient-grain/);
  assert.match(dialogStyles, /\.knowledgeFlashcard\.flashcardPresentation \.studyCardBody section\s*\{[^}]*border-color:\s*rgba\(255, 255, 255, 0\.52\);[^}]*color:\s*color-mix\([^}]*86%[^}]*background:[^}]*48%[^}]*backdrop-filter:\s*blur\(12px\)/);
  assert.match(dialogStyles, /\.knowledgeFlashcard\.flashcardPresentation \.cardStepList li,[\s\S]*?\.cardConnection\s*\{[^}]*border-color:[^}]*42%[^}]*background:[^}]*52%[^}]*backdrop-filter:\s*blur\(10px\)/);
  assert.match(conversationStyles, /\.activeKnowledgeCardDock:has\(\.knowledgeFlashcard\) > \.draggableCardWindow\s*\{[^}]*background:\s*rgba\(244, 250, 240, 0\.52\);[^}]*backdrop-filter:\s*blur\(36px\) saturate\(1\.08\);/);
  assert.match(conversationStyles, /\.activeKnowledgeCardDock:has\(\.knowledgeFlashcard\)\s*\{[^}]*width:\s*min\(520px,/);
  assert.match(dialogStyles, /\.flashcardHeading h2,[^}]*font-size:\s*22px;/);
  assert.match(dialogStyles, /\.flashcardPresentation \.studyCardBody section\s*\{[^}]*color:\s*var\(--flashcard-ink,[^;]+;[^}]*font-size:\s*14px;/);
  assert.match(dialogStyles, /\.flashcardPresentation \.cardStepList li\s*\{[^}]*border:\s*1px solid color-mix\(in srgb, var\(--flashcard-accent,/);
  assert.match(dialogStyles, /\.flashcardPresentation \.cardStepList li strong\s*\{[^}]*font-size:\s*15px;/);
  assert.match(dialogStyles, /\.problemFlashcard \.problemStepTitle > span\s*\{[^}]*var\(--flashcard-accent,/);

  const timeline = renderToStaticMarkup(
    <MessageTimeline
      messages={[{ id: "message-1", role: "assistant", text: "先看这一步" }]}
      messageEndRef={{ current: null }}
      interaction={<span className="inlineInteraction">内嵌交互</span>}
    />
  );
  assert.match(timeline, /先看这一步[\s\S]*内嵌交互/);

  const anchoredTimeline = renderToStaticMarkup(
    <MessageTimeline
      messages={[
        { id: "message-1", role: "assistant", text: "卡片来源", actionId: cardFixture.source_action_id },
        { id: "message-2", role: "student", text: "后续插嘴" }
      ]}
      messageEndRef={{ current: null }}
      anchoredInteractions={[{
        id: cardFixture.id,
        sourceActionId: cardFixture.source_action_id,
        title: cardFixture.content.title,
        cardType: cardFixture.card_type,
        render: (autoCollapsed) => <span>原位卡片 {String(autoCollapsed)}</span>
      }]}
    />
  );
  assert.match(anchoredTimeline, /卡片来源[\s\S]*原位卡片 false[\s\S]*后续插嘴/);

  const pinnedCard = renderToStaticMarkup(
    <StudyCardModal
      card={{ ...cardFixture, deferred_at: "2026-08-03T00:00:00Z" }}
      autoCollapsed
      onExpandCollapsed={() => {}}
    />
  );
  assert.match(pinnedCard, /aria-label="回到卡片位置并展开"/);
  assert.match(pinnedCard, /studyCardDialog knowledgeCard knowledgeFlashcard collapsed/);
  assert.equal(anchoredInteractionScrollTop(500, 100, 350), 730);
  assert.equal(anchoredInteractionScrollTop(5, 100, 50), 0);
  assert.equal(shouldCollapseAnchoredInteraction(110, 500), false);
  assert.equal(shouldCollapseAnchoredInteraction(110, 110), false);
  assert.equal(shouldCollapseAnchoredInteraction(110, 109), true);

  const answeredTimeline = renderToStaticMarkup(
    <MessageTimeline
      messages={[{
        id: "checkpoint-answer-1",
        role: "student",
        text: "我在检查点里选了 B",
        action: "CHECKPOINT_RESPONSE",
        checkpointResult: {
          checkpoint: checkpointFixture,
          selected_option_id: "B",
          is_correct: false
        }
      }]}
      messageEndRef={{ current: null }}
    />
  );
  assert.match(answeredTimeline, /checkpointResponseMessage/);
  assert.match(answeredTimeline, /哪一步正确？/);
  assert.doesNotMatch(answeredTimeline, /我在检查点里选了 B/);
});

test("session sidebar keeps the complete title in markup for CSS ellipsis", () => {
  const fullTitle = "Complete session title that must remain intact beyond ten characters";
  const markup = renderToStaticMarkup(
    <SessionSidebar
      historyItems={[{ ...historyWorkspaceItems[0], title: fullTitle }]}
      activeSessionId="session-current"
      historyBusy={false}
      openSessionBusyId=""
      deleteSessionBusyId=""
      deleteAllSessionsBusy={false}
      runningSessionIds={[]}
      onCollapse={() => {}}
      onNewChat={() => {}}
      onOpenSession={() => {}}
      onDeleteSession={() => {}}
      onDeleteAllSessions={() => {}}
    />
  );

  assert.match(markup, new RegExp(fullTitle));
  assert.match(markup, new RegExp(`title="${fullTitle}"`));
});

test("workspace sidebars disable deletion for the active session independently", () => {
  const activeSession = renderToStaticMarkup(
    <SessionSidebar
      historyItems={[historyWorkspaceItems[0]]}
      activeSessionId="session-current"
      historyBusy={false}
      openSessionBusyId=""
      deleteSessionBusyId=""
      deleteAllSessionsBusy={false}
      runningSessionIds={[]}
      onCollapse={() => {}}
      onNewChat={() => {}}
      onOpenSession={() => {}}
      onDeleteSession={() => {}}
      onDeleteAllSessions={() => {}}
    />
  );
  const deleteButtons = activeSession.match(
    /<button[^>]*class="sessionDeleteButton"[^>]*>/g
  ) ?? [];

  assert.equal(deleteButtons.length, 1);
  assert.match(deleteButtons[0], /disabled=""/);
});

test("workspace sidebars render active sessions and filtered cards", () => {
  const history: SessionHistoryItem[] = [{
    session_id: "session-a",
    paper_id: "paper-a",
    paper_name: "期中数学卷",
    title: "方程题",
    grade_band: "junior",
    model_profile_id: profile.id,
    model_display_name: profile.display_name,
    message_count: 3,
    checkpoint_count: 1,
    state_hint: "diagnosing",
    context_status: "ready",
    created_at: "2026-07-18T00:00:00Z",
    updated_at: "2026-07-18T00:00:00Z"
  }, {
    session_id: "session-b",
    paper_id: null,
    paper_name: null,
    title: "未分类题",
    grade_band: "junior",
    model_profile_id: profile.id,
    model_display_name: profile.display_name,
    message_count: 1,
    checkpoint_count: 0,
    state_hint: "diagnosing",
    context_status: "ready",
    created_at: "2026-07-17T00:00:00Z",
    updated_at: "2026-07-17T00:00:00Z"
  }];
  const sessions = renderToStaticMarkup(
    <SessionSidebar
      historyItems={history}
      activeSessionId="session-a"
      historyBusy={false}
      openSessionBusyId=""
      deleteSessionBusyId=""
      deleteAllSessionsBusy={false}
      runningSessionIds={["session-a"]}
      onCollapse={() => {}}
      onNewChat={() => {}}
      onOpenSession={() => {}}
      onDeleteSession={() => {}}
      onDeleteAllSessions={() => {}}
    />
  );
  assert.match(sessions, /sessionRow active/);
  assert.match(sessions, /期中数学卷/);
  assert.match(sessions, /未分类题目/);
  assert.ok(sessions.indexOf("期中数学卷") < sessions.indexOf("方程题"));
  assert.match(sessions, /paperGroupButton/);
  assert.doesNotMatch(sessions, /试卷与题目/);
  assert.match(sessions, /clearSessionsButton/);
  assert.match(sessions, /清空全部会话/);
  assert.doesNotMatch(sessions, /lucide-folder/);
  assert.match(sessions, /historyNavigationGroup expanded/);
  assert.ok(sessions.indexOf("historyTree") > sessions.indexOf("historyNavigationRow"));
  assert.ok(sessions.indexOf("historyTree") < sessions.indexOf('title="知识卡片库"'));
  assert.match(sessions, /主要导航/);
  assert.match(sessions, /开始答疑/);
  assert.match(sessions, /历史搜题/);
  assert.match(sessions, /知识卡片库/);
  assert.match(sessions, /错题卡片库/);
  assert.match(sessions, /错题集/);
  assert.match(sessions, /搜索历史答疑/);
  assert.doesNotMatch(sessions, /条消息/);
  assert.doesNotMatch(sessions, /2026|2025|2024/);
  assert.match(sessions, /sessionRunningIcon/);
  assert.match(sessions, /aria-label="正在思考"/);

  const openingSession = renderToStaticMarkup(
    <SessionSidebar
      historyItems={[history[1]]}
      activeSessionId="session-b"
      historyBusy={false}
      openSessionBusyId="session-b"
      deleteSessionBusyId=""
      deleteAllSessionsBusy={false}
      runningSessionIds={[]}
      onCollapse={() => {}}
      onNewChat={() => {}}
      onOpenSession={() => {}}
      onDeleteSession={() => {}}
      onDeleteAllSessions={() => {}}
    />
  );
  assert.match(
    openingSession,
    /<button[^>]*class="sessionDeleteButton"[^>]*disabled=""[^>]*aria-label="删除会话：未分类题"/
  );

  const pageSource = readFileSync(resolve(__dirname, "../../../app/page.tsx"), "utf8");
  const onOpenSessionStart = pageSource.indexOf("function handleOpenHistorySession(");
  const onOpenSessionEnd = pageSource.indexOf("function handleStartNewChat()", onOpenSessionStart);
  assert.ok(onOpenSessionStart >= 0);
  assert.ok(onOpenSessionEnd > onOpenSessionStart);
  assert.match(
    pageSource.slice(onOpenSessionStart, onOpenSessionEnd),
    /closeNavigationOnMobile/
  );

  const cards = renderToStaticMarkup(
    <StudyCardSidebar
      cards={[cardFixture]}
      folders={[knowledgeFolderFixture]}
      currentFolderId={knowledgeFolderFixture.id}
      visibleFolders={[]}
      visibleCards={[cardFixture]}
      clipboard={null}
      cardBusyId=""
      folderBusyId=""
      pasteBusy={false}
      deleteAllCardsBusy={false}
      composerBlocked={false}
      onCollapse={() => {}}
      onOpenFolder={() => {}}
      onCreateFolder={async () => true}
      onRenameFolder={async () => true}
      onDeleteFolder={() => {}}
      onOpenCard={() => {}}
      onCopyCard={() => {}}
      onCutCard={() => {}}
      onClearClipboard={() => {}}
      onPasteCard={() => {}}
      onMoveCard={() => {}}
      onDeleteCard={() => {}}
      onExport={() => {}}
      onDeleteAllCards={() => {}}
    />
  );
  assert.match(cards, /1 张已归档/);
  assert.match(cards, /知识卡片/);
  assert.match(cards, /aria-label="收起卡片栏"/);
  assert.match(cards, /aria-label="当前位置"/);
  assert.match(cards, new RegExp(`data-library-card-id="${cardFixture.id}"`));
  assert.match(cards, new RegExp(`aria-label="复制卡片：${cardFixture.content.title}"`));
});

test("floating cards leave message width untouched", () => {
  const timelineSource = readFileSync(
    resolve(__dirname, "../../../components/workspace/MessageTimeline.tsx"),
    "utf8"
  );
  const conversationCss = readFileSync(resolve(__dirname, "../../../styles/conversation.css"), "utf8");

  assert.match(timelineSource, /viewportRef\?: RefObject<HTMLDivElement \| null>/);
  assert.doesNotMatch(timelineSource, /ResizeObserver|MutationObserver|floatingCardAvoidanceWidth/);
  assert.doesNotMatch(conversationCss, /avoidsKnowledgeCard|knowledge-card-avoidance-width/);
});

test("clearing sessions keeps collection ownership or returns a history session to start", () => {
  const pageSource = readFileSync(resolve(__dirname, "../../../app/page.tsx"), "utf8");
  const clearStart = pageSource.indexOf("async function handleDeleteAllSessions()");
  const clearEnd = pageSource.indexOf("async function finishSessionBatchStart", clearStart);
  const clearSource = pageSource.slice(clearStart, clearEnd);

  assert.match(clearSource, /const clearingFromCollection = historyView !== null/);
  assert.match(clearSource, /setHistoryView\(clearingFromCollection \? \{ mode: "overview" \} : null\)/);
  assert.match(clearSource, /setContentNavigation\(clearingFromCollection \? "mistake_collection" : "start"\)/);
  assert.doesNotMatch(clearSource, /setCardLibraryNavigation/);
  assert.doesNotMatch(clearSource, /setRightOpen/);
});

test("history quick tree remains while card libraries are canonical top-level destinations", () => {
  const markup = renderToStaticMarkup(
    <SessionSidebar
      historyItems={historyWorkspaceItems}
      activeSessionId=""
      historyBusy={false}
      openSessionBusyId=""
      deleteSessionBusyId=""
      deleteAllSessionsBusy={false}
      runningSessionIds={[]}
      activeNavigation="mistake_collection"
      onCollapse={() => {}}
      onNewChat={() => {}}
      onNavigate={() => {}}
      onOpenSession={() => {}}
      onDeleteSession={() => {}}
      onDeleteAllSessions={() => {}}
    />
  );

  assert.match(markup, /历史搜题/);
  assert.match(markup, /知识卡片库/);
  assert.match(markup, /错题卡片库/);
  assert.match(markup, /错题集/);
  assert.match(markup, /<div class="primaryNavButton historyNavigationMain" aria-label="历史搜题导航">/);
  assert.doesNotMatch(markup, /<button[^>]*historyNavigationMain/);
  assert.doesNotMatch(markup, /mistakeNavigationGroup|mistakeNavigationChildren|错题库分组/);
  assert.equal((markup.match(/aria-current="page"/g) ?? []).length, 1);
});

test("typed card libraries share managed folders without exposing destructive folder actions", () => {
  const archiveRoot: CardFolder = {
    id: "folder-paper-root",
    name: "按试卷归档",
    parent_id: null,
    is_system: false,
    default_card_type: null,
    managed_kind: "paper_archive_root",
    created_at: "2026-08-06T00:00:00Z",
    updated_at: "2026-08-06T00:00:00Z"
  };
  const paperFolder: CardFolder = {
    ...archiveRoot,
    id: "folder-paper-a",
    name: "期中数学卷",
    parent_id: archiveRoot.id,
    managed_kind: "paper_archive"
  };
  const legacyFolder: CardFolder = {
    ...paperFolder,
    id: "folder-legacy-child",
    name: "待整理",
    managed_kind: null
  };
  const markup = renderToStaticMarkup(
    <StudyCardSidebar
      cards={[{ ...problemCardFixture, folder_id: paperFolder.id }]}
      folders={[archiveRoot, paperFolder, legacyFolder]}
      currentFolderId={archiveRoot.id}
      visibleFolders={[paperFolder, legacyFolder]}
      visibleCards={[]}
      clipboard={null}
      cardBusyId=""
      folderBusyId=""
      pasteBusy={false}
      deleteAllCardsBusy={false}
      composerBlocked={false}
      libraryMode="problem"
      onCollapse={() => {}}
      onOpenFolder={() => {}}
      onCreateFolder={async () => true}
      onRenameFolder={async () => true}
      onDeleteFolder={() => {}}
      onOpenCard={() => {}}
      onCopyCard={() => {}}
      onCutCard={() => {}}
      onClearClipboard={() => {}}
      onPasteCard={() => {}}
      onMoveCard={() => {}}
      onDeleteCard={() => {}}
      onExport={() => {}}
      onDeleteAllCards={() => {}}
    />
  );

  assert.match(markup, /期中数学卷/);
  assert.match(markup, /1 张卡片/);
  assert.match(markup, /试卷归档根目录由系统管理/);
  assert.match(markup, /导出全部学习卡片/);
  assert.doesNotMatch(markup, /重命名文件夹：期中数学卷/);
  assert.doesNotMatch(markup, /删除文件夹：期中数学卷/);
  assert.doesNotMatch(markup, /重命名文件夹：待整理/);
  assert.match(markup, /删除文件夹：待整理/);
  assert.doesNotMatch(markup, /清空全部卡片/);
});

test("card shelf tabs only render saved cards from the active source session", () => {
  const secondKnowledgeCard = {
    ...cardFixture,
    id: "knowledge-card-second",
    saved_at: "2026-07-18T00:00:03Z",
    content: { ...cardFixture.content, title: "一次函数图像与斜率的对应关系" }
  };
  const cards = [
    cardFixture,
    problemCardFixture,
    secondKnowledgeCard,
    {
      ...cardFixture,
      id: "card-other-session",
      session_id: "session-b",
      content: { ...cardFixture.content, title: "另一道题的卡片" }
    }
  ];

  const activeSessionShelf = renderToStaticMarkup(
    <CardShelfTabs cards={cards} sessionId="session-a" onOpenCard={() => {}} />
  );
  assert.match(activeSessionShelf, /<nav class="cardShelfTabs" aria-label="最近收纳的学习卡片">/);
  assert.match(activeSessionShelf, new RegExp(cardFixture.content.title));
  assert.match(activeSessionShelf, />题目卡片</);
  assert.match(activeSessionShelf, new RegExp(`aria-label="查看知识卡片：${cardFixture.content.title}"`));
  assert.match(activeSessionShelf, new RegExp(`aria-label="查看题目卡片：${problemCardFixture.content.title}"`));
  assert.match(activeSessionShelf, new RegExp(`>${secondKnowledgeCard.content.title}<`));
  assert.ok(activeSessionShelf.indexOf(">题目卡片<") < activeSessionShelf.indexOf(`>${secondKnowledgeCard.content.title}<`));
  assert.match(activeSessionShelf, /knowledgeTab firstKnowledgeTab/);
  assert.match(activeSessionShelf, /--shelf-angle:/);
  assert.doesNotMatch(activeSessionShelf, /知识卡片 1/);
  assert.doesNotMatch(activeSessionShelf, /另一道题的卡片/);

  const shelfWithOpenCard = renderToStaticMarkup(
    <CardShelfTabs
      cards={cards}
      sessionId="session-a"
      activeCardId={cardFixture.id}
      onOpenCard={() => {}}
    />
  );
  assert.match(shelfWithOpenCard, /knowledgeTab shelfCardSourceHidden/);
  assert.match(shelfWithOpenCard, new RegExp(`data-shelf-card-id="${cardFixture.id}"`));

  const homeShelf = renderToStaticMarkup(
    <CardShelfTabs cards={cards} sessionId="" onOpenCard={() => {}} />
  );
  assert.equal(homeShelf, "");
});

test("card themes are stable and match the C4 palette", () => {
  assert.equal(stableCardThemeIndex(cardFixture.id), stableCardThemeIndex(cardFixture.id));
  const firstKnowledgeTheme = cardVisualTheme(cardFixture);
  const secondKnowledgeTheme = cardVisualTheme({ ...cardFixture, id: "card-matcha-variant" });
  assert.notEqual(firstKnowledgeTheme.background, secondKnowledgeTheme.background);
  const shelfKnowledgeColors = [0, 1, 2].map((themeVariant) => cardVisualTheme(cardFixture, themeVariant).background);
  assert.equal(new Set(shelfKnowledgeColors).size, shelfKnowledgeColors.length);

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
});

test("card shelf separates the problem card, clips natural titles, and launches cards fully offscreen", () => {
  const shellStyles = readFileSync(resolve(__dirname, "../../../styles/shell.css"), "utf8");
  const conversationStyles = readFileSync(resolve(__dirname, "../../../styles/conversation.css"), "utf8");

  assert.match(shellStyles, /\.cardShelfTabs button\.firstKnowledgeTab\s*\{[^}]*margin-top:\s*32px;/);
  assert.match(shellStyles, /\.cardShelfTabs button\s*\{[^}]*height:\s*128px;[^}]*overflow:\s*hidden;/);
  assert.match(shellStyles, /\.cardShelfTabs button > span\s*\{[^}]*white-space:\s*nowrap;/);
  assert.match(shellStyles, /\.cardShelfTabs button\.shelfCardSourceHidden\s*\{[^}]*visibility:\s*hidden;/);
  assert.doesNotMatch(shellStyles, /translateX\(calc\(var\(--shelf-offset\) - 14px\)\)/);
  assert.match(conversationStyles, /\.activeKnowledgeCardDock\.shelfTransitionDock\s*\{[^}]*animation:\s*none;/);
  assert.match(conversationStyles, /@keyframes shelfCardOpen[\s\S]*var\(--shelf-motion-x\)/);
  assert.match(conversationStyles, /@keyframes shelfCardClose[\s\S]*var\(--shelf-motion-x\)/);
  assert.match(conversationStyles, /@keyframes activeCardDockEnter[\s\S]*translate3d\(100vw,/);
  assert.doesNotMatch(conversationStyles, /translate3d\(150px,/);
});

test("scrolling grid lists keep intrinsic row heights", () => {
  const shellStyles = readFileSync(resolve(__dirname, "../../../styles/shell.css"), "utf8");
  const cardStyles = readFileSync(resolve(__dirname, "../../../styles/cards.css"), "utf8");

  assert.match(shellStyles, /\.sessionList\s*\{[^}]*grid-auto-rows:\s*max-content;/);
  assert.match(shellStyles, /\.sessionEntry\s*\{[^}]*min-height:\s*32px;[^}]*padding:\s*4px 8px;/);
  assert.match(shellStyles, /\.sessionEntry > strong\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*font-size:\s*12px;/);
  assert.match(shellStyles, /\.sessionEntry > strong > \.titleMathText\s*\{[^}]*text-overflow:\s*ellipsis;/);
  assert.match(cardStyles, /\.cardList\s*\{[^}]*grid-auto-rows:\s*max-content;/);
  assert.match(cardStyles, /\.cardFileList\s*\{[^}]*grid-auto-rows:\s*max-content;/);
  assert.match(cardStyles, /\.knowledgeExportBody\s*\{[^}]*grid-auto-rows:\s*max-content;/);
});

test("card exports use compact fixed double columns and optional answer masking", () => {
  const saveDialog = renderToStaticMarkup(
    <StudyCardModal
      card={cardFixture}
      folders={[knowledgeFolderFixture]}
      onSave={() => {}}
    />
  );
  assert.match(saveDialog, /aria-expanded="false"/);
  assert.doesNotMatch(saveDialog, /保存位置/);
  assert.doesNotMatch(saveDialog, /默认知识卡片/);

  const exportDialog = renderToStaticMarkup(
    <LearningCardExportDialog
      open
      cards={[cardFixture]}
      onClose={() => {}}
      onExport={() => {}}
    />
  );
  assert.match(exportDialog, /从知识卡片库导出/);
  assert.match(exportDialog, /已选中 1 张知识卡片/);
  assert.match(exportDialog, /固定 A4 纵向双列/);
  assert.match(exportDialog, /将导出 <strong>1<\/strong> 张知识卡片/);
  assert.doesNotMatch(exportDialog, /导出文件夹|type="checkbox"|type="radio"|单列|三列|默认知识卡片/);

  const knowledgePrint = renderToStaticMarkup(<LearningCardPrintView cards={[cardFixture]} />);
  assert.match(knowledgePrint, /printLayout-double/);
  assert.match(knowledgePrint, /column-count:2/);
  assert.match(knowledgePrint, /关键关系/);
  assert.match(knowledgePrint, /核心原理/);

  if (problemCardFixture.content.type !== "problem_card") throw new Error("problem card fixture mismatch");
  const mistakeItems = [{
    id: "mistake-1",
    source_paper_name: "代数卷",
    title: problemCardFixture.content.title,
    problem_text: problemCardFixture.content.problem_summary,
    problem_image_data_url: null,
    problem_card: problemCardFixture.content,
    position: 0
  }];
  const answerPrint = renderToStaticMarkup(
    <MistakeSetPrintDocument name="错题复习" items={mistakeItems} practiceMode={false} />
  );
  const practicePrint = renderToStaticMarkup(
    <MistakeSetPrintDocument name="错题复习" items={mistakeItems} practiceMode />
  );
  assert.match(answerPrint, /解题思路/);
  assert.match(answerPrint, /关键步骤/);
  assert.match(answerPrint, /如何想到这些步骤/);
  assert.match(answerPrint, /易错提醒/);
  assert.match(answerPrint, /最终答案/);
  assert.match(practicePrint, /题目摘要/);
  assert.match(practicePrint, /练习模式 · 解析已遮住/);
  assert.doesNotMatch(practicePrint, /解题思路|最终答案/);
});

test("model picker exposes image capability and batch management controls", () => {
  const visionProfile: ModelProfile = {
    ...profile,
    id: "profile-vision-with-a-long-name",
    display_name: "视觉模型供应商",
    model: "vision-model-with-a-very-long-version-name",
    is_multimodal: true
  };
  const picker = renderToStaticMarkup(
    <ModelProfilePicker
      profiles={[profile, visionProfile]}
      selectedProfileId={visionProfile.id}
      disabled={false}
      canManage
      deleteBusy={false}
      onChange={() => {}}
      onAdd={() => {}}
      onDelete={async () => true}
    />
  );

  assert.match(picker, /支持上传图片/);
  assert.match(picker, /新增模型/);
  assert.match(picker, /管理/);
  assert.match(picker, /aria-haspopup="listbox"/);
  assert.match(picker, /style="width:430px"/);

  const conversationStyles = readFileSync(resolve(__dirname, "../../../styles/conversation.css"), "utf8");
  const pickerSource = readFileSync(resolve(__dirname, "../../../components/workspace/ModelProfilePicker.tsx"), "utf8");
  assert.match(pickerSource, /删除选中/);
  assert.match(pickerSource, /MAX_BATCH_DELETE_PROFILES = 20/);
  assert.match(pickerSource, /aria-multiselectable/);
  assert.match(conversationStyles, /\.modelPickerCurrentLabel\s*\{[^}]*text-overflow:\s*ellipsis;/);
  assert.match(conversationStyles, /\.modelPicker\s*\{[^}]*max-width:/);
});

test("composer omits the grade picker and exposes complete reasoning effort labels", () => {
  const protocolProfile: ModelProfile = {
    ...profile,
    id: "profile-prompt-effort",
    provider: "openai_compatible",
    base_url: "https://example.com/v1",
    base_url_host: "example.com",
    model: "vendor-chat-model",
    reasoning_effort: "none",
    reasoning_effort_options: ["none", "low", "high"],
    reasoning_control: "openai_compatible_reasoning_effort",
    reasoning_control_description: "按协议发送 reasoning_effort。"
  };
  const composer = renderToStaticMarkup(
    <TutorComposer
      error={null}
      sessionId=""
      pendingImageUrl={null}
      input=""
      composerBlocked={false}
      imageInputRef={{ current: null }}
      imageBusy={false}
      selectedProfileId={protocolProfile.id}
      selectedProfile={protocolProfile}
      profiles={[protocolProfile]}
      deleteBusy={false}
      reasoningBusy={false}
      streamBusy={false}
      stopBusy={false}
      startBusy={false}
      speechPhase="idle"
      speechElapsedSeconds={0}
      onClearError={() => {}}
      onRemoveImage={() => {}}
      onInputChange={() => {}}
      onSend={() => {}}
      onImageFile={() => {}}
      onPasteImages={() => {}}
      onProfileChange={() => {}}
      onAddProfile={() => {}}
      onEditProfile={() => {}}
      onDeleteProfiles={async () => true}
      onReasoningEffortChange={async () => true}
      onStop={() => {}}
      onToggleSpeech={() => {}}
    />
  );

  const tutorComposerSource = readFileSync(
    resolve(__dirname, "../../../components/workspace/TutorComposer.tsx"),
    "utf8"
  );
  const conversationStyles = readFileSync(resolve(__dirname, "../../../styles/conversation.css"), "utf8");

  assert.doesNotMatch(composer, /学习阶段|初中|高中/);
  assert.doesNotMatch(tutorComposerSource, /GradeBandPicker|onGradeBandChange|gradeBand:/);
  assert.doesNotMatch(composer, /<select[^>]*aria-label="年级"/);
  assert.match(composer, /aria-label="推理强度：关闭"/);
  assert.match(composer, /aria-haspopup="listbox"/);
  assert.match(composer, /推理 · <strong>关闭<\/strong>/);
  assert.match(composer, /请求供应商关闭推理/);
  assert.match(composer, /较少推理，兼顾回复速度与必要复核/);
  assert.match(composer, /充分推理并仔细检查，优先回答质量/);
  assert.match(composer, /reasoningRecommendedBadge/);
  assert.doesNotMatch(composer, /<select[^>]*aria-label="推理强度"/);
  assert.doesNotMatch(composer, /composerHint|Enter 发送/);
  assert.match(composer, /role="status" aria-live="polite"/);
  assert.match(conversationStyles, /\.reasoningPicker\s*\{[^}]*min-width:\s*128px;/);
  assert.match(conversationStyles, /\.reasoningPickerCurrentLabel\s*\{[^}]*flex:\s*0\s+0\s+auto;/);
  assert.doesNotMatch(
    conversationStyles.match(/\.reasoningPickerCurrentLabel\s*\{[^}]*\}/)?.[0] ?? "",
    /text-overflow:\s*ellipsis|overflow:\s*hidden/
  );
});

test("empty workspace removes its header row and wires the welcome lifecycle", () => {
  const pageSource = readFileSync(resolve(__dirname, "../../../app/page.tsx"), "utf8");

  assert.match(pageSource, /type WelcomePhase = "visible" \| "leaving" \| "hidden"/);
  assert.match(pageSource, /\{sessionId \? <ConversationHeader/);
  assert.match(pageSource, /welcomePhase=\{welcomePhase\}/);
  assert.match(pageSource, /onWelcomeTransitionComplete=\{\(\) => setWelcomePhase\("hidden"\)\}/);
  assert.match(pageSource, /welcomeConversationPanel/);
});

test("problem image selector renders movable and resizable regions", () => {
  const selectorSource = readFileSync(
    resolve(__dirname, "../../../components/ProblemImageSelector.tsx"),
    "utf8"
  );
  const roundedSelectSource = readFileSync(
    resolve(__dirname, "../../../components/RoundedSelect.tsx"),
    "utf8"
  );
  const selector = renderToStaticMarkup(
    <ProblemImageSelector
      imageUrl="data:image/png;base64,AAAA"
      papers={[{ id: "paper-a", name: "期中数学卷", card_folder_id: "folder-paper-a", session_count: 0, created_at: "2026-07-18T00:00:00Z", updated_at: "2026-07-18T00:00:00Z" }]}
      initialRegions={[
        {
          id: "problem-1",
          label: "题目 1",
          bbox: { x: 0.1, y: 0.2, width: 0.8, height: 0.25 }
        },
        {
          id: "problem-2",
          label: "题目 2",
          bbox: { x: 0.1, y: 0.55, width: 0.8, height: 0.3 }
        }
      ]}
      busy={false}
      onCancel={() => {}}
      onConfirm={() => {}}
    />
  );
  const dialogStyles = readFileSync(resolve(__dirname, "../../../styles/dialogs.css"), "utf8");

  assert.match(selector, /确认要创建的题目/);
  assert.match(selector, /将创建 2 个独立答疑/);
  assert.match(selector, /删除题目 1/);
  assert.match(selector, /新增题目框/);
  assert.match(selector, /aria-pressed="false"/);
  assert.match(selector, /所属试卷/);
  assert.match(selector, /期中数学卷/);
  assert.match(selectorSource, /新建试卷/);
  assert.match(selector, /aria-haspopup="listbox"/);
  assert.match(roundedSelectSource, /createPortal\(/);
  assert.match(roundedSelectSource, /onWheel=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(selectorSource, /papers\.some\(\(paper\) => paper\.id === paperId\)/);
  assert.match(selectorSource, /setPaperMode\("new"\)/);
  assert.match(selector, /paperAssignment paperAssignmentHeader/);
  assert.ok(selector.indexOf("paperAssignmentHeader") < selector.indexOf("problemSelectorWorkspace"));
  assert.match(selector, /handle-nw/);
  assert.match(dialogStyles, /\.problemRegion\.selected/);
  assert.match(dialogStyles, /\.problemSelectorCanvas\.adding/);
  assert.match(dialogStyles, /\.problemRegionDraft/);
  assert.match(dialogStyles, /\.handle-e[^}]*cursor:\s*ew-resize/);
  assert.match(dialogStyles, /\.problemSelectorWorkspace\s*\{[^}]*margin:\s*12px;[^}]*border-radius:\s*14px;/);
  assert.match(dialogStyles, /\.roundedSelectMenu\s*\{[^}]*border-radius:\s*12px;/);
  assert.match(dialogStyles, /\.roundedSelectMenu\s*\{[^}]*position:\s*fixed;[^}]*overflow-y:\s*auto;/);
});

test("card folder location uses the shared rounded listbox", () => {
  const folderSelect = renderToStaticMarkup(
    <FolderLocationSelect
      folders={[knowledgeFolderFixture]}
      cardType="knowledge_card"
      value={knowledgeFolderFixture.id}
      label="Save to"
      onChange={() => {}}
      onCreatePaperFolder={async () => null}
    />
  );

  assert.match(folderSelect, /aria-haspopup="listbox"/);
  assert.match(folderSelect, /class="folderLocationLabel"/);
  assert.doesNotMatch(folderSelect, /<select/);
});

test("new problem boxes support reverse dragging and stay inside the image", () => {
  assert.deepEqual(boxFromPoints(0.8, 0.7, 0.2, 0.1), {
    x: 0.2,
    y: 0.1,
    width: 0.6000000000000001,
    height: 0.6
  });
  assert.deepEqual(boxFromPoints(-0.2, 0.25, 1.3, 0.9), {
    x: 0,
    y: 0.25,
    width: 1,
    height: 0.65
  });
});

test("workspace keeps text and image multi-problem intake wired", () => {
  const pageSource = readFileSync(resolve(__dirname, "../../../app/page.tsx"), "utf8");
  assert.match(pageSource, /analyzeProblemText/);
  assert.match(pageSource, /batchStartSessions/);
  assert.match(pageSource, /detectProblemImageRegions/);
  assert.match(pageSource, /<ProblemImageSelector/);
  assert.match(pageSource, /createExamPaper\(paperSelection\.name\)/);
  assert.match(pageSource, /batchStartImageSessions/);
  assert.match(pageSource, /paperId: selection\.paperId/);
  assert.match(pageSource, /paper_id: paperId/);
  assert.match(pageSource, /pendingComposerImage/);
  assert.match(pageSource, /handlePastedImages/);
  assert.match(pageSource, /readProblemImageAsDataUrl\(file\)/);
  assert.match(pageSource, /image_data_url: pending\.imageDataUrl/);
  assert.match(pageSource, /activeKnowledgeCardDock/);
  assert.match(pageSource, /appearance="flashcard"/);
  assert.match(pageSource, /anchoredActiveCards/);
  assert.match(pageSource, /displayedDockCard/);
  assert.match(pageSource, /const dockedActiveCard = useMemo/);
  assert.match(pageSource, /card\.card_type === "knowledge_card" \|\| card\.card_type === "problem_card"/);
  assert.doesNotMatch(pageSource, /dockedKnowledgeCard/);
  assert.match(pageSource, /key={`dock-\$\{displayedDockCard\.id\}`}/);
  assert.match(pageSource, /onOpenCard=\{openShelfCard\}/);
  assert.match(pageSource, /onClose=\{displayedDockCardIsArchived \? closeShelfCard/);
  assert.match(pageSource, /data-shelf-transition-phase/);
  assert.doesNotMatch(pageSource, /viewingCard\.card_type === "problem_card"/);
  assert.doesNotMatch(pageSource, /当前答疑暂不支持追加图片/);
});

test("exam paper refresh ignores stale responses", () => {
  const pageSource = readFileSync(resolve(__dirname, "../../../app/page.tsx"), "utf8");
  const refreshStart = pageSource.indexOf("async function refreshExamPapers()");
  const refreshEnd = pageSource.indexOf("function clearCurrentSessionState()", refreshStart);
  const refreshSource = pageSource.slice(refreshStart, refreshEnd);

  assert.ok(refreshStart >= 0);
  assert.ok(refreshEnd > refreshStart);
  assert.match(pageSource, /const examPapersRequestRef = useRef\(0\)/);
  assert.match(
    refreshSource,
    /const requestId = examPapersRequestRef\.current \+ 1;\s*examPapersRequestRef\.current = requestId;/
  );
  assert.match(
    refreshSource,
    /if \(examPapersRequestRef\.current === requestId\) setExamPapers\(nextPapers\)/
  );
  assert.match(
    refreshSource,
    /catch \(nextError\) \{\s*if \(examPapersRequestRef\.current === requestId\)/
  );
});

test("clearing all sessions invalidates pending exam paper loads and clears paper state", () => {
  const pageSource = readFileSync(resolve(__dirname, "../../../app/page.tsx"), "utf8");
  const deleteStart = pageSource.indexOf("async function handleDeleteAllSessions()");
  const deleteEnd = pageSource.indexOf("async function finishSessionBatchStart", deleteStart);
  const deleteSource = pageSource.slice(deleteStart, deleteEnd);

  assert.ok(deleteStart >= 0);
  assert.ok(deleteEnd > deleteStart);
  assert.match(
    deleteSource,
    /await deleteAllSessions\(\);[\s\S]*examPapersRequestRef\.current \+= 1;[\s\S]*setExamPapers\(\[\]\)/
  );
});

test("composer paste handling extracts images without consuming ordinary text", () => {
  const imageFile = { name: "clipboard.png", type: "image/png" } as File;
  const files = getPastedImageFiles([
    { kind: "string", type: "text/plain", getAsFile: () => null },
    { kind: "file", type: "image/png", getAsFile: () => imageFile }
  ]);

  assert.deepEqual(files, [imageFile]);
  assert.deepEqual(getPastedImageFiles([
    { kind: "string", type: "text/plain", getAsFile: () => null }
  ]), []);
});

test("workspace persists recoverable requests before clearing visible text", () => {
  const pageSource = readFileSync(resolve(__dirname, "../../../app/page.tsx"), "utf8");
  const studentPersist = pageSource.indexOf("savePendingStudentRequest(window.localStorage, pending)");
  const studentClear = pageSource.indexOf("clearComposerInput(draftScope(targetSessionId))");
  const batchPersist = pageSource.indexOf("savePendingSessionBatch(window.localStorage, pendingBatch)", studentPersist);
  const batchClear = pageSource.indexOf("clearComposerInput(DRAFT_SCOPE)", batchPersist);

  assert.ok(studentPersist >= 0 && studentPersist < studentClear);
  assert.ok(batchPersist >= 0 && batchPersist < batchClear);
  assert.match(pageSource, /RECOVERABLE_RUN_CODES/);
  assert.match(pageSource, /fetchSessionRunStatus/);
  assert.match(pageSource, /last_committed_action_index/);
  assert.match(pageSource, /restoreWorkspaceAfterRefresh/);
  assert.match(pageSource, /isApiResponseError\(nextError, 404\)/);
  assert.match(pageSource, /clearPendingStudentRequestsForSession\(window\.localStorage, activeSessionId\)/);
  assert.match(pageSource, /saveImageDraft/);
  assert.match(pageSource, /loadImageDraft/);
  assert.match(pageSource, /stage: "detecting"/);
  assert.match(pageSource, /persistedSelection\(startingSelection, "starting"\)/);
  assert.match(pageSource, /stableImageStartItems/);
});
test("local demo configuration never asks users for real credentials", () => {
  const dialogSource = readFileSync(resolve(__dirname, "../../../components/ModelConfigDialog.tsx"), "utf8");

  assert.match(dialogSource, /const isLocalDemo = provider === "local_demo"/);
  assert.match(dialogSource, /base_url: isLocalDemo \? "local:\/\/demo"/);
  assert.match(dialogSource, /api_key: isLocalDemo \? "local-demo"/);
  assert.match(dialogSource, /disabled=\{isLocalDemo\}/);
  assert.match(dialogSource, /本地演示完全离线，不需要 Base URL 或 API key/);
});

test("model connection test sends the current temperature field", () => {
  const dialogSource = readFileSync(resolve(__dirname, "../../../components/ModelConfigDialog.tsx"), "utf8");

  assert.match(dialogSource, /testModelProfile\(\{[\s\S]*?temperature,[\s\S]*?max_output_tokens/);
});
