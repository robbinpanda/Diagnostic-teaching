import type { SessionHistoryItem } from "./api";

export type HistoryView =
  | { mode: "overview" }
  | { mode: "paper"; paperId: string }
  | null;

export type HistorySortMode = "recent" | "name";

export type HistoryPaperAccent = "yellow" | "lavender" | "sage";

export type HistoryPaperGroup = {
  id: string;
  name: string;
  items: SessionHistoryItem[];
  updatedAt: string;
  gradeBands: Array<SessionHistoryItem["grade_band"]>;
};

export const UNCLASSIFIED_PAPER_ID = "unclassified";
export const SESSION_MENU_TITLE_MAX_LENGTH = 10;

export function summarizeSessionMenuTitle(value: string | null | undefined) {
  const normalizedTitle = (value || "未命名题目").replace(/\s+/gu, " ").trim() || "未命名题目";
  const firstClause = normalizedTitle.split(/[。！？!?；;]/u, 1)[0]?.trim() || normalizedTitle;
  return Array.from(firstClause).slice(0, SESSION_MENU_TITLE_MAX_LENGTH).join("");
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN");
}

export function buildHistoryPaperGroups(items: readonly SessionHistoryItem[]) {
  const groups = new Map<string, { id: string; name: string; items: SessionHistoryItem[] }>();

  for (const item of items) {
    const id = item.paper_id || UNCLASSIFIED_PAPER_ID;
    const name = id === UNCLASSIFIED_PAPER_ID
      ? "未分类题目"
      : item.paper_name?.trim() || "未命名试卷";
    const group = groups.get(id) ?? { id, name, items: [] };
    group.items.push(item);
    groups.set(id, group);
  }

  return [...groups.values()].map((group): HistoryPaperGroup => {
    const sortedItems = [...group.items].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    const gradeBands = (["junior", "senior"] as const).filter((grade) =>
      sortedItems.some((item) => item.grade_band === grade)
    );
    return { ...group, items: sortedItems, updatedAt: sortedItems[0].updated_at, gradeBands };
  });
}

export function filterHistoryPaperGroups(groups: readonly HistoryPaperGroup[], query: string) {
  const needle = normalized(query);
  if (!needle) return [...groups];
  return groups.filter((group) =>
    normalized(group.name).includes(needle)
    || group.items.some((item) => normalized(item.title || "未命名题目").includes(needle))
  );
}

export function filterHistoryQuestions(items: readonly SessionHistoryItem[], query: string) {
  const needle = normalized(query);
  if (!needle) return [...items];
  return items.filter((item) => normalized(item.title || "未命名题目").includes(needle));
}

export function sortHistoryPaperGroups(groups: readonly HistoryPaperGroup[], mode: HistorySortMode) {
  return [...groups].sort((left, right) => mode === "recent"
    ? right.updatedAt.localeCompare(left.updatedAt)
    : left.name.localeCompare(right.name, "zh-CN") || right.updatedAt.localeCompare(left.updatedAt));
}

export function stableHistoryPaperAccent(paperId: string): HistoryPaperAccent {
  if (paperId === UNCLASSIFIED_PAPER_ID) return "yellow";
  const accents = ["lavender", "sage", "yellow"] as const;
  let hash = 0;
  for (const character of paperId) hash = (hash + character.codePointAt(0)!) % accents.length;
  return accents[hash];
}
