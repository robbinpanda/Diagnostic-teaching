import type { CardFolder, StudyCard } from "./api";


export const OTHER_PROBLEM_GROUP_ID = "other-problem-cards";


export type ProblemPaperGroup = {
  id: string;
  name: string;
  cards: StudyCard[];
  updatedAt: string;
  managed: boolean;
};


function cardTime(card: StudyCard) {
  return card.saved_at || card.created_at;
}


export function buildProblemPaperGroups(
  cards: readonly StudyCard[],
  folders: readonly CardFolder[]
): ProblemPaperGroup[] {
  const managedFolders = new Map(
    folders
      .filter((folder) => folder.managed_kind === "paper_archive")
      .map((folder) => [folder.id, folder])
  );
  const grouped = new Map<string, ProblemPaperGroup>();

  for (const card of cards) {
    if (card.card_type !== "problem_card" || !card.saved_at) continue;
    const managedFolder = card.folder_id ? managedFolders.get(card.folder_id) : undefined;
    const id = managedFolder?.id ?? OTHER_PROBLEM_GROUP_ID;
    const group = grouped.get(id) ?? {
      id,
      name: managedFolder?.name ?? "其他题目卡片",
      cards: [],
      updatedAt: cardTime(card),
      managed: Boolean(managedFolder)
    };
    group.cards.push(card);
    if (cardTime(card).localeCompare(group.updatedAt) > 0) group.updatedAt = cardTime(card);
    grouped.set(id, group);
  }

  return [...grouped.values()]
    .map((group) => ({
      ...group,
      cards: [...group.cards].sort((left, right) => cardTime(right).localeCompare(cardTime(left)))
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)
      || left.name.localeCompare(right.name, "zh-CN"));
}
