export function toggleMistakeCardSelection(selectedIds: readonly string[], cardId: string) {
  return selectedIds.includes(cardId)
    ? selectedIds.filter((id) => id !== cardId)
    : [...selectedIds, cardId];
}


export function toggleMistakeCardGroupSelection(
  selectedIds: readonly string[],
  groupCardIds: readonly string[]
) {
  const groupIds = new Set(groupCardIds);
  const allSelected = groupCardIds.length > 0
    && groupCardIds.every((id) => selectedIds.includes(id));
  if (allSelected) return selectedIds.filter((id) => !groupIds.has(id));
  return [
    ...selectedIds,
    ...groupCardIds.filter((id) => !selectedIds.includes(id))
  ];
}
