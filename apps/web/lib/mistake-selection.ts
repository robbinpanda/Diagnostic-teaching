export function toggleMistakeSelection(selectedIds: readonly string[], sessionId: string) {
  return selectedIds.includes(sessionId)
    ? selectedIds.filter((id) => id !== sessionId)
    : [...selectedIds, sessionId];
}


export function togglePaperMistakeSelection(
  selectedIds: readonly string[],
  paperSessionIds: readonly string[]
) {
  const paperIds = new Set(paperSessionIds);
  const allSelected = paperSessionIds.length > 0
    && paperSessionIds.every((id) => selectedIds.includes(id));
  if (allSelected) return selectedIds.filter((id) => !paperIds.has(id));
  return [
    ...selectedIds,
    ...paperSessionIds.filter((id) => !selectedIds.includes(id))
  ];
}


export function selectedHistoryItems<T extends { session_id: string }>(
  items: readonly T[],
  selectedIds: readonly string[]
) {
  const byId = new Map(items.map((item) => [item.session_id, item]));
  return selectedIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}
