import type { CardFolder, StudyCard } from "./api";


export const OTHER_KNOWLEDGE_GROUP_ID = "other-knowledge-cards";


export type KnowledgePaperGroup = {
  id: string;
  name: string;
  cards: StudyCard[];
  updatedAt: string;
  managed: boolean;
};


function cardTime(card: StudyCard) {
  return card.saved_at || card.created_at;
}


export function buildKnowledgePaperGroups(
  cards: readonly StudyCard[],
  folders: readonly CardFolder[]
): KnowledgePaperGroup[] {
  const managedFolders = new Map(
    folders
      .filter((folder) => folder.managed_kind === "paper_archive")
      .map((folder) => [folder.id, folder])
  );
  const grouped = new Map<string, KnowledgePaperGroup>();

  for (const card of cards) {
    if (card.card_type !== "knowledge_card" || !card.saved_at) continue;
    const managedFolder = card.folder_id ? managedFolders.get(card.folder_id) : undefined;
    const id = managedFolder?.id ?? OTHER_KNOWLEDGE_GROUP_ID;
    const group = grouped.get(id) ?? {
      id,
      name: managedFolder?.name ?? "其他知识卡",
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
