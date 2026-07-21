import type { CardFolder, StudyCard } from "./api";

export type FolderOption = CardFolder & { depth: number; path: string };

export function sortCardFolders(folders: CardFolder[]) {
  return [...folders].sort((left, right) => {
    if (left.is_system !== right.is_system) return left.is_system ? -1 : 1;
    return left.name.localeCompare(right.name, "zh-CN");
  });
}

export function childFolders(folders: CardFolder[], parentId: string | null) {
  return sortCardFolders(
    folders.filter((folder) => (folder.parent_id ?? null) === parentId)
  );
}

export function folderBreadcrumbs(folders: CardFolder[], folderId: string | null) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const result: CardFolder[] = [];
  const seen = new Set<string>();
  let cursor = folderId ? byId.get(folderId) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    result.unshift(cursor);
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
  }
  return result;
}

export function flattenCardFolders(folders: CardFolder[]): FolderOption[] {
  const result: FolderOption[] = [];
  function visit(parentId: string | null, depth: number, parentPath: string) {
    for (const folder of childFolders(folders, parentId)) {
      const path = parentPath ? `${parentPath} / ${folder.name}` : folder.name;
      result.push({ ...folder, depth, path });
      visit(folder.id, depth + 1, path);
    }
  }
  visit(null, 0, "");
  return result;
}

export function descendantFolderIds(folders: CardFolder[], folderId: string) {
  const result = new Set<string>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parent_id && result.has(folder.parent_id) && !result.has(folder.id)) {
        result.add(folder.id);
        changed = true;
      }
    }
  }
  return result;
}

export function countCardsInFolderTree(
  cards: StudyCard[],
  folders: CardFolder[],
  folderId: string
) {
  const ids = descendantFolderIds(folders, folderId);
  return cards.filter((card) => card.folder_id && ids.has(card.folder_id)).length;
}

export function defaultFolderForCard(folders: CardFolder[], card: StudyCard) {
  return folders.find((folder) => folder.default_card_type === card.card_type)?.id
    ?? folders[0]?.id
    ?? "";
}
