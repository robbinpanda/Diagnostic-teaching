import assert from "node:assert/strict";
import test from "node:test";

import type { SessionHistoryItem } from "../lib/api";
import {
  buildHistoryPaperGroups,
  filterHistoryPaperGroups,
  filterHistoryQuestions,
  SESSION_MENU_TITLE_MAX_LENGTH,
  sortHistoryPaperGroups,
  stableHistoryPaperAccent,
  summarizeSessionMenuTitle
} from "../lib/history-view";

function historyItem(overrides: Partial<SessionHistoryItem> = {}): SessionHistoryItem {
  return {
    session_id: "session-default",
    paper_id: "paper-default",
    paper_name: "默认试卷",
    title: "默认题目",
    grade_band: "junior",
    model_profile_id: "profile-1",
    model_display_name: "本地演示",
    message_count: 1,
    checkpoint_count: 0,
    state_hint: "diagnosing",
    context_status: "ready",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides
  };
}

test("history groups sessions into papers and derives latest metadata", () => {
  const groups = buildHistoryPaperGroups([
    historyItem({
      session_id: "old",
      paper_id: "paper-a",
      paper_name: "期中数学卷",
      title: "一次函数",
      grade_band: "junior",
      updated_at: "2026-08-01T00:00:00Z"
    }),
    historyItem({
      session_id: "legacy",
      paper_id: null,
      paper_name: null,
      title: "旧版方程题",
      updated_at: "2026-08-02T00:00:00Z"
    }),
    historyItem({
      session_id: "new",
      paper_id: "paper-a",
      paper_name: "期中数学卷",
      title: "等差数列",
      grade_band: "senior",
      updated_at: "2026-08-03T00:00:00Z"
    }),
    historyItem({
      session_id: "middle",
      paper_id: "paper-a",
      paper_name: "期中数学卷",
      title: "二次函数",
      grade_band: "junior",
      updated_at: "2026-08-02T12:00:00Z"
    })
  ]);

  const paper = groups.find((group) => group.id === "paper-a");
  const legacy = groups.find((group) => group.id === "unclassified");
  assert.deepEqual(paper?.items.map((item) => item.session_id), ["new", "middle", "old"]);
  assert.equal(paper?.updatedAt, "2026-08-03T00:00:00Z");
  assert.deepEqual(paper?.gradeBands, ["junior", "senior"]);
  assert.equal(legacy?.name, "未分类题目");
});

test("history search keeps matching papers whole and narrows detail questions", () => {
  const groups = buildHistoryPaperGroups([
    historyItem({ session_id: "function", paper_id: "paper-a", paper_name: "期中数学卷", title: "一次函数" }),
    historyItem({ session_id: "sequence", paper_id: "paper-a", paper_name: "期中数学卷", title: "等差数列" }),
    historyItem({ session_id: "geometry", paper_id: "paper-b", paper_name: "二模试卷", title: "圆锥曲线" })
  ]);

  assert.deepEqual(filterHistoryPaperGroups(groups, " 二模 ").map((group) => group.id), ["paper-b"]);
  const byQuestion = filterHistoryPaperGroups(groups, "一次函数");
  assert.deepEqual(byQuestion.map((group) => group.id), ["paper-a"]);
  assert.deepEqual(byQuestion[0].items.map((item) => item.session_id), ["function", "sequence"]);
  assert.deepEqual(filterHistoryQuestions(byQuestion[0].items, "数列").map((item) => item.session_id), ["sequence"]);
});

test("history sorting supports recent and stable zh-CN name modes without mutation", () => {
  const groups = buildHistoryPaperGroups([
    historyItem({ session_id: "z", paper_id: "paper-z", paper_name: "综合卷", updated_at: "2026-08-04T00:00:00Z" }),
    historyItem({ session_id: "a-old", paper_id: "paper-a-old", paper_name: "阿卷", updated_at: "2026-08-02T00:00:00Z" }),
    historyItem({ session_id: "a-new", paper_id: "paper-a-new", paper_name: "阿卷", updated_at: "2026-08-03T00:00:00Z" })
  ]);
  const original = groups.map((group) => group.id);

  assert.deepEqual(sortHistoryPaperGroups(groups, "recent").map((group) => group.id), ["paper-z", "paper-a-new", "paper-a-old"]);
  assert.deepEqual(sortHistoryPaperGroups(groups, "name").map((group) => group.id), ["paper-a-new", "paper-a-old", "paper-z"]);
  assert.deepEqual(groups.map((group) => group.id), original);
});

test("history paper accents are stable C4 token choices", () => {
  assert.equal(stableHistoryPaperAccent("unclassified"), "yellow");
  assert.equal(stableHistoryPaperAccent("paper-a"), "lavender");
  assert.equal(stableHistoryPaperAccent("paper-b"), "sage");
  assert.equal(stableHistoryPaperAccent("paper-a"), stableHistoryPaperAccent("paper-a"));
});

test("session menu titles use a compact first-clause summary of at most ten characters", () => {
  assert.equal(summarizeSessionMenuTitle("  已知一次函数，求它与坐标轴围成的面积。  "), "已知一次函数，求它与");
  assert.equal(summarizeSessionMenuTitle("求三角形面积。再说明理由"), "求三角形面积");
  assert.equal(summarizeSessionMenuTitle(""), "未命名题目");
  assert.ok(Array.from(summarizeSessionMenuTitle("😀😀😀😀😀😀😀😀😀😀😀")).length <= SESSION_MENU_TITLE_MAX_LENGTH);
});
