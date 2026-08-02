import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CheckpointModal } from "../components/CheckpointModal";
import { LearningCardExportDialog } from "../components/LearningCardExportDialog";
import { StudyCardModal } from "../components/StudyCardModal";
import { ConversationHeader } from "../components/workspace/ConversationHeader";
import { MessageTimeline } from "../components/workspace/MessageTimeline";
import { ModelProfilePicker } from "../components/workspace/ModelProfilePicker";
import { TutorComposer } from "../components/workspace/TutorComposer";
import { boxFromPoints, ProblemImageSelector } from "../components/ProblemImageSelector";
import { SessionSidebar } from "../components/workspace/SessionSidebar";
import { StudyCardSidebar } from "../components/workspace/StudyCardSidebar";
import type { ModelProfile, SessionHistoryItem } from "../lib/api";
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

test("workspace header and timeline preserve teaching context labels", () => {
  const header = renderToStaticMarkup(
    <ConversationHeader
      leftOpen
      title="一次函数"
      sessionId="session-a"
      gradeBand="junior"
      selectedProfile={profile}
      streamBusy
      onExpandLeft={() => {}}
      onToggleCards={() => {}}
    />
  );
  assert.match(header, /一次函数/);
  assert.match(header, /初中数学/);
  assert.match(header, /正在思考/);

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

test("checkpoint and pending card interactions render inside the conversation without backdrops", () => {
  const checkpoint = renderToStaticMarkup(
    <CheckpointModal checkpoint={checkpointFixture} onSubmit={() => {}} />
  );
  assert.match(checkpoint, /对话中的检查点/);
  assert.match(checkpoint, /提交答案/);
  assert.match(checkpoint, /aria-pressed="false"/);
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
  assert.match(card, /保存到卡片库/);
  assert.match(card, /舍弃/);
  assert.doesNotMatch(card, /modalBackdrop/);

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
  assert.match(cardSource, /discardConfirmation \? "确认舍弃" : "舍弃"/);
  assert.match(dialogStyles, /\.cardViewerLayer\s*\{[^}]*justify-content:\s*flex-end;[^}]*pointer-events:\s*none;/);
  assert.match(dialogStyles, /\.studyCardDialog\.cardViewerDialog\s*\{[^}]*overflow-y:\s*auto;[^}]*pointer-events:\s*auto;/);

  const timeline = renderToStaticMarkup(
    <MessageTimeline
      messages={[{ id: "message-1", role: "assistant", text: "先看这一步" }]}
      messageEndRef={{ current: null }}
      interaction={<span className="inlineInteraction">内嵌交互</span>}
    />
  );
  assert.match(timeline, /先看这一步[\s\S]*内嵌交互/);

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

test("workspace sidebars render active sessions and filtered cards", () => {
  const history: SessionHistoryItem[] = [{
    session_id: "session-a",
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
  assert.match(sessions, /3 条消息/);
  assert.match(sessions, /正在思考/);

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

test("scrolling grid lists keep intrinsic row heights", () => {
  const shellStyles = readFileSync(resolve(__dirname, "../../../styles/shell.css"), "utf8");
  const cardStyles = readFileSync(resolve(__dirname, "../../../styles/cards.css"), "utf8");

  assert.match(shellStyles, /\.sessionList\s*\{[^}]*grid-auto-rows:\s*max-content;/);
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
  assert.match(saveDialog, /保存位置/);
  assert.match(saveDialog, /默认知识卡片/);

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
      originalProblemImage={null}
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
  const selector = renderToStaticMarkup(
    <ProblemImageSelector
      imageUrl="data:image/png;base64,AAAA"
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
  assert.match(selector, /handle-nw/);
  assert.match(dialogStyles, /\.problemRegion\.selected/);
  assert.match(dialogStyles, /\.problemSelectorCanvas\.adding/);
  assert.match(dialogStyles, /\.problemRegionDraft/);
  assert.match(dialogStyles, /\.handle-e[^}]*cursor:\s*ew-resize/);
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
  assert.match(pageSource, /batchStartImageSessions/);
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
});
test("local demo configuration never asks users for real credentials", () => {
  const dialogSource = readFileSync(resolve(__dirname, "../../../components/ModelConfigDialog.tsx"), "utf8");

  assert.match(dialogSource, /const isLocalDemo = provider === "local_demo"/);
  assert.match(dialogSource, /base_url: isLocalDemo \? "local:\/\/demo"/);
  assert.match(dialogSource, /api_key: isLocalDemo \? "local-demo"/);
  assert.match(dialogSource, /disabled=\{isManaged \|\| isLocalDemo\}/);
  assert.match(dialogSource, /本地演示完全离线，不需要 Base URL 或 API key/);
});
