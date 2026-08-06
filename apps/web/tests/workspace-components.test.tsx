import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CheckpointModal } from "../components/CheckpointModal";
import { LearningCardExportDialog } from "../components/LearningCardExportDialog";
import { FolderLocationSelect } from "../components/FolderLocationSelect";
import { StudyCardModal } from "../components/StudyCardModal";
import { ConversationHeader } from "../components/workspace/ConversationHeader";
import { HistoryWorkspace } from "../components/workspace/HistoryWorkspace";
import {
  anchoredInteractionScrollTop,
  MessageTimeline,
  shouldCollapseAnchoredInteraction
} from "../components/workspace/MessageTimeline";
import { ModelProfilePicker } from "../components/workspace/ModelProfilePicker";
import { TutorComposer } from "../components/workspace/TutorComposer";
import { boxFromPoints, ProblemImageSelector } from "../components/ProblemImageSelector";
import { clampImageScale, ProblemImageViewer } from "../components/ProblemImageViewer";
import { CardShelfTabs } from "../components/workspace/CardShelfTabs";
import { SessionSidebar } from "../components/workspace/SessionSidebar";
import { StudyCardSidebar } from "../components/workspace/StudyCardSidebar";
import { getPastedImageFiles } from "../components/workspace/TutorComposer";
import type { CardFolder, ModelProfile, SessionHistoryItem, StudyCard } from "../lib/api";
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
  managed: false,
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
    2
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

test("history workspace renders overview and paper detail from real session metadata", () => {
  const overview = renderToStaticMarkup(
    <HistoryWorkspace {...historyWorkspaceProps} view={{ mode: "overview" }} />
  );
  const detail = renderToStaticMarkup(
    <HistoryWorkspace {...historyWorkspaceProps} view={{ mode: "paper", paperId: "paper-a" }} />
  );
  const backButton = detail.match(
    /<button class="historyWorkspaceBack"[\s\S]*?<\/button>/
  )?.[0] ?? "";

  assert.match(overview, /错题合集/);
  assert.match(overview, /按试卷回看与整理答疑题目/);
  assert.doesNotMatch(overview, /<h1>历史搜题<\/h1>/);
  assert.match(overview, /搜索试卷或题目/);
  assert.match(overview, /最近更新/);
  assert.match(overview, /名称排序/);
  assert.doesNotMatch(overview, /<img/);
  assert.doesNotMatch(overview, /historyQuestionDelete/);
  assert.match(detail, /historyWorkspaceHeader historyWorkspaceHeaderDetail/);
  assert.match(backButton, /aria-label="返回全部试卷"/);
  assert.match(backButton, /title="返回全部试卷"/);
  assert.match(backButton, /<svg/);
  assert.doesNotMatch(backButton, /<span>/);
  assert.match(detail, /返回全部试卷/);
  assert.match(detail, /正在思考/);
  assert.match(detail, /3 条消息/);
  assert.match(detail, /1 个检查点/);
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
      items: [{
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
      overviewQuery: "",
      sortMode: "recent",
      selectedPaperName: "午夜试卷",
      historyBusy: false,
      historyLoadError: "",
      actionError: "",
      leftOpen: true,
      activeSessionId: "",
      runningSessionIds: [],
      openSessionBusyId: "",
      deleteSessionBusyId: "",
      onExpandLeft: noop,
      onOverviewQueryChange: noop,
      onSortModeChange: noop,
      onOpenPaper: noop,
      onBackToOverview: noop,
      onOpenSession: noop,
      onDeleteSession: noop,
      onStartNewChat: noop,
      onRetry: noop,
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

test("workspace sidebar formats SSR dates in Asia Shanghai", () => {
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
  assert.match(result.stdout, /2026年8月6日/);
  assert.doesNotMatch(result.stdout, /2026年8月5日/);
});

test("history workspace renders loading empty no-result error and emptied-paper states", () => {
  const loading = renderToStaticMarkup(<HistoryWorkspace {...historyWorkspaceProps} items={[]} historyBusy view={{ mode: "overview" }} />);
  const empty = renderToStaticMarkup(<HistoryWorkspace {...historyWorkspaceProps} items={[]} view={{ mode: "overview" }} />);
  const noResult = renderToStaticMarkup(<HistoryWorkspace {...historyWorkspaceProps} overviewQuery="不存在" view={{ mode: "overview" }} />);
  const failed = renderToStaticMarkup(<HistoryWorkspace {...historyWorkspaceProps} items={[]} historyLoadError="连接失败" view={{ mode: "overview" }} />);
  const emptiedPaper = renderToStaticMarkup(<HistoryWorkspace {...historyWorkspaceProps} items={[]} view={{ mode: "paper", paperId: "paper-a" }} />);

  assert.equal((loading.match(/class="historyPaperSkeleton"/g) ?? []).length, 6);
  assert.match(empty, /还没有收录题目/);
  assert.match(empty, /开始答疑/);
  assert.match(noResult, /没有匹配的试卷或题目/);
  assert.match(noResult, /清除搜索/);
  assert.match(failed, /重新加载/);
  assert.match(emptiedPaper, /这份试卷暂无收录题目/);
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
      onToggleCards={() => {}}
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
      onToggleCards={() => {}}
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
  assert.match(dialogStyles, /\.studyCardDialog\.knowledgeFlashcard\.flashcardPresentation\s*\{[^}]*max-height:\s*min\(430px,[^}]*background-color:\s*color-mix\([^}]*46%[^}]*background-image:\s*linear-gradient[^}]*backdrop-filter:\s*blur\(12px\) saturate\(1\.12\);/);
  assert.doesNotMatch(dialogStyles, /\.studyCardDialog\.knowledgeFlashcard\.flashcardPresentation\s*\{[^}]*ambient-grain/);
  assert.match(dialogStyles, /\.knowledgeFlashcard\.flashcardPresentation \.studyCardBody section\s*\{[^}]*border-color:\s*rgba\(255, 255, 255, 0\.52\);[^}]*color:\s*color-mix\([^}]*86%[^}]*background:\s*color-mix\([^}]*38%/);
  assert.match(dialogStyles, /\.knowledgeFlashcard\.flashcardPresentation \.cardStepList li,[\s\S]*?\.cardConnection\s*\{[^}]*border-color:[^}]*42%[^}]*background:[^}]*44%/);
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
  assert.ok(sessions.indexOf("historyTree") < sessions.indexOf('title="知识库"'));
  assert.match(sessions, /主要导航/);
  assert.match(sessions, /开始答疑/);
  assert.match(sessions, /历史搜题/);
  assert.match(sessions, /知识库/);
  assert.match(sessions, /错题合集/);
  assert.match(sessions, /错题库/);
  assert.match(sessions, /搜索历史答疑/);
  assert.match(sessions, /3 条消息/);
  assert.match(sessions, /正在思考/);

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
  const clearEnd = pageSource.indexOf("function readFileAsDataUrl", clearStart);
  const clearSource = pageSource.slice(clearStart, clearEnd);

  assert.match(clearSource, /const clearingFromCollection = historyView !== null/);
  assert.match(clearSource, /setHistoryView\(clearingFromCollection \? \{ mode: "overview" \} : null\)/);
  assert.match(clearSource, /setContentNavigation\(clearingFromCollection \? "mistake_collection" : "start"\)/);
  assert.doesNotMatch(clearSource, /setCardLibraryNavigation/);
  assert.match(clearSource, /setRightOpen\(false\)/);
});

test("history quick tree remains while mistake library exposes two canonical children", () => {
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
  assert.match(markup, /错题合集/);
  assert.match(markup, /aria-label="错题库分组"/);
  assert.match(markup, /aria-label="打开错题集"/);
  assert.match(markup, /<div class="primaryNavButton historyNavigationMain" aria-label="历史搜题导航">/);
  assert.doesNotMatch(markup, /<button[^>]*historyNavigationMain/);
  assert.doesNotMatch(markup, /aria-label="打开错题库"/);
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
  assert.match(activeSessionShelf, new RegExp(cardFixture.content.title));
  assert.match(activeSessionShelf, />题目卡片</);
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
  assert.match(shellStyles, /\.sessionEntry\s*\{[^}]*padding:\s*6px 8px;/);
  assert.match(shellStyles, /\.sessionEntry > strong\s*\{[^}]*font-size:\s*12px;/);
  assert.match(cardStyles, /\.cardList\s*\{[^}]*grid-auto-rows:\s*max-content;/);
  assert.match(cardStyles, /\.cardFileList\s*\{[^}]*grid-auto-rows:\s*max-content;/);
  assert.match(cardStyles, /\.knowledgeExportBody\s*\{[^}]*grid-auto-rows:\s*max-content;/);
  assert.match(cardStyles, /\.knowledgeExportCardList\s*\{[^}]*grid-auto-rows:\s*max-content;/);
});

test("card save and export dialogs expose folder-based navigation", () => {
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
      folders={[knowledgeFolderFixture]}
      onClose={() => {}}
      onExport={() => {}}
    />
  );
  assert.match(exportDialog, /从卡片库导出/);
  assert.match(exportDialog, /全部卡片/);
  assert.match(exportDialog, /默认知识卡片/);
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

test("composer exposes the three probed protocol reasoning effort labels", () => {
  const protocolProfile: ModelProfile = {
    ...profile,
    id: "profile-prompt-effort",
    provider: "openai_compatible",
    base_url: "https://example.com/v1",
    base_url_host: "example.com",
    model: "vendor-chat-model",
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
      gradeBand="junior"
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
      onGradeBandChange={() => {}}
      onProfileChange={() => {}}
      onAddProfile={() => {}}
      onEditProfile={() => {}}
      onDeleteProfiles={async () => true}
      onReasoningEffortChange={async () => true}
      onStop={() => {}}
      onToggleSpeech={() => {}}
    />
  );

  assert.match(composer, /aria-label="学习阶段：初中"/);
  assert.match(composer, /帮助导师调整知识范围与讲解方式/);
  assert.match(composer, /侧重基础概念、直观解释与规范步骤/);
  assert.match(composer, /允许使用高中知识、综合方法与完整推导/);
  assert.doesNotMatch(composer, /<select[^>]*aria-label="年级"/);
  assert.match(composer, /aria-label="推理强度：低"/);
  assert.match(composer, /aria-haspopup="listbox"/);
  assert.match(composer, /推理 · <strong>低<\/strong>/);
  assert.match(composer, /请求供应商关闭推理/);
  assert.match(composer, /较少推理，兼顾回复速度与必要复核/);
  assert.match(composer, /充分推理并仔细检查，优先回答质量/);
  assert.match(composer, /reasoningRecommendedBadge/);
  assert.doesNotMatch(composer, /<select[^>]*aria-label="推理强度"/);
});

test("problem image selector renders movable and resizable regions", () => {
  const selectorSource = readFileSync(
    resolve(__dirname, "../../../components/ProblemImageSelector.tsx"),
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
  assert.match(selector, /新建试卷/);
  assert.match(selector, /aria-haspopup="listbox"/);
  assert.match(selector, /roundedSelectMenu/);
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
});

test("card folder location uses the shared rounded listbox", () => {
  const folderSelect = renderToStaticMarkup(
    <FolderLocationSelect
      folders={[knowledgeFolderFixture]}
      value={knowledgeFolderFixture.id}
      label="Save to"
      onChange={() => {}}
      onCreatePaperFolder={async () => null}
    />
  );

  assert.match(folderSelect, /aria-haspopup="listbox"/);
  assert.match(folderSelect, /class="roundedSelectMenu"/);
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
  assert.match(dialogSource, /disabled=\{isManaged \|\| isLocalDemo\}/);
  assert.match(dialogSource, /本地演示完全离线，不需要 Base URL 或 API key/);
});

test("model connection test sends the current temperature field", () => {
  const dialogSource = readFileSync(resolve(__dirname, "../../../components/ModelConfigDialog.tsx"), "utf8");

  assert.match(dialogSource, /testModelProfile\(\{[\s\S]*?temperature,[\s\S]*?max_output_tokens/);
});
