import type { CardFolder, Checkpoint, StudyCard } from "../lib/api";

export const knowledgeFolderFixture: CardFolder = {
  id: "folder_default_knowledge",
  name: "默认知识卡片",
  parent_id: null,
  is_system: true,
  default_card_type: "knowledge_card",
  created_at: "2026-07-18T00:00:00Z",
  updated_at: "2026-07-18T00:00:00Z"
};

export const checkpointFixture: Checkpoint = {
  id: "chk_1",
  question: "哪一步正确？",
  options: [
    { id: "A", text: "选项 A" },
    { id: "B", text: "选项 B" },
    { id: "C", text: "选项 C" }
  ],
  unknown_option: { id: "UNKNOWN", text: "不知道" },
  tested_point: "移项",
  difficulty: "easy"
};

export const cardFixture: StudyCard = {
  id: "card_1",
  session_id: "session-a",
  card_type: "knowledge_card",
  source_action_id: "action_1",
  source_message_id: "message_1",
  folder_id: knowledgeFolderFixture.id,
  content: {
    type: "knowledge_card",
    title: "移项",
    knowledge_point: "等式性质",
    core_idea: "等式两边做相同运算",
    derivation_steps: [],
    when_to_use: ["解方程"],
    common_mistakes: ["只改一边"],
    connection_to_problem: "用于当前方程"
  },
  created_at: "2026-07-18T00:00:00Z",
  saved_at: "2026-07-18T00:00:01Z"
};
