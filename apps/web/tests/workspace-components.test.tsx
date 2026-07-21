import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationHeader } from "../components/workspace/ConversationHeader";
import { LearningCardExportDialog } from "../components/LearningCardExportDialog";
import { StudyCardModal } from "../components/StudyCardModal";
import { MessageTimeline } from "../components/workspace/MessageTimeline";
import { ModelProfilePicker } from "../components/workspace/ModelProfilePicker";
import { SessionSidebar } from "../components/workspace/SessionSidebar";
import { StudyCardSidebar } from "../components/workspace/StudyCardSidebar";
import type { ModelProfile, SessionHistoryItem } from "../lib/api";
import { cardFixture, knowledgeFolderFixture } from "./fixtures";

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
  managed: false
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

  const timeline = renderToStaticMarkup(
    <MessageTimeline
      messages={[{ id: "message-1", role: "assistant", text: "先看等式两边", action: "EXPLAIN_PRINCIPLE" }]}
      messageEndRef={{ current: null }}
    />
  );
  assert.match(timeline, /先看等式两边/);
  assert.match(timeline, /原理讲解/);
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
  assert.doesNotMatch(cards, /筛选学习卡片/);
});

test("scrolling grid lists keep intrinsic row heights", () => {
  const shellStyles = readFileSync(resolve(__dirname, "../../../styles/shell.css"), "utf8");
  const cardStyles = readFileSync(resolve(__dirname, "../../../styles/cards.css"), "utf8");

  assert.match(shellStyles, /\.sessionList\s*\{[^}]*grid-auto-rows:\s*max-content;/);
  assert.match(cardStyles, /\.cardFileList\s*\{[^}]*grid-auto-rows:\s*max-content;/);
  assert.match(cardStyles, /\.knowledgeExportBody\s*\{[^}]*grid-auto-rows:\s*max-content;/);
  assert.match(cardStyles, /\.knowledgeExportCardList\s*\{[^}]*grid-auto-rows:\s*max-content;/);
});

test("card save and export dialogs expose folder-based navigation", () => {
  const saveDialog = renderToStaticMarkup(
    <StudyCardModal
      card={cardFixture}
      folders={[knowledgeFolderFixture]}
      onClose={() => {}}
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
