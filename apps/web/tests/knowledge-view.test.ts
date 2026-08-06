import assert from "node:assert/strict";
import test from "node:test";

import type { CardFolder, StudyCard } from "../lib/api";
import { buildKnowledgePaperGroups, OTHER_KNOWLEDGE_GROUP_ID } from "../lib/knowledge-view";


const folders: CardFolder[] = [
  {
    id: "folder_paper_a",
    name: "代数卷",
    parent_id: "folder_archive",
    is_system: false,
    managed_kind: "paper_archive",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z"
  },
  {
    id: "folder_custom",
    name: "自定义",
    parent_id: null,
    is_system: false,
    managed_kind: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z"
  }
];


function knowledgeCard(id: string, folderId: string, savedAt: string): StudyCard {
  return {
    id,
    session_id: "sess_a",
    card_type: "knowledge_card",
    source_action_id: "act_a",
    source_message_id: "msg_a",
    folder_id: folderId,
    created_at: savedAt,
    saved_at: savedAt,
    content: {
      type: "knowledge_card",
      title: id,
      knowledge_point: id,
      core_idea: id,
      derivation_steps: [],
      when_to_use: [],
      common_mistakes: [],
      connection_to_problem: id
    }
  };
}


test("knowledge library groups saved knowledge cards by managed paper folder", () => {
  const groups = buildKnowledgePaperGroups([
    knowledgeCard("paper-new", "folder_paper_a", "2026-08-03T00:00:00Z"),
    knowledgeCard("paper-old", "folder_paper_a", "2026-08-02T00:00:00Z"),
    knowledgeCard("custom", "folder_custom", "2026-08-04T00:00:00Z"),
    { ...knowledgeCard("pending", "folder_paper_a", "2026-08-05T00:00:00Z"), saved_at: null },
    { ...knowledgeCard("problem", "folder_paper_a", "2026-08-06T00:00:00Z"), card_type: "problem_card" }
  ], folders);

  assert.deepEqual(groups.map((group) => group.id), [OTHER_KNOWLEDGE_GROUP_ID, "folder_paper_a"]);
  assert.equal(groups[0].name, "其他知识卡");
  assert.deepEqual(groups[1].cards.map((card) => card.id), ["paper-new", "paper-old"]);
});
