import { API_BASE, JSON_HEADERS, responseError } from "./http";
import type { CardFolder, StudyCard } from "./types";

export async function fetchCards(
  cardType?: "knowledge_card" | "problem_card"
): Promise<StudyCard[]> {
  const params = new URLSearchParams();
  if (cardType) params.set("card_type", cardType);
  const query = params.toString();
  const response = await fetch(`${API_BASE}/api/cards${query ? `?${query}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw await responseError(response, "学习卡片加载失败");
  const payload = await response.json();
  return payload.cards;
}

export async function saveCard(
  cardId: string,
  sessionId: string,
  folderId?: string | null
): Promise<StudyCard> {
  const response = await fetch(`${API_BASE}/api/cards/${cardId}/save`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ session_id: sessionId, folder_id: folderId || null })
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function fetchCardFolders(): Promise<CardFolder[]> {
  const response = await fetch(`${API_BASE}/api/card-folders`, { cache: "no-store" });
  if (!response.ok) throw await responseError(response, "卡片文件夹加载失败");
  const payload = await response.json();
  return payload.folders;
}

export async function createCardFolder(input: {
  name: string;
  parent_id?: string | null;
}): Promise<CardFolder> {
  const response = await fetch(`${API_BASE}/api/card-folders`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function updateCardFolder(
  folderId: string,
  input: { name?: string; parent_id?: string | null }
): Promise<CardFolder> {
  const response = await fetch(`${API_BASE}/api/card-folders/${folderId}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function deleteCardFolder(folderId: string) {
  const response = await fetch(`${API_BASE}/api/card-folders/${folderId}`, {
    method: "DELETE"
  });
  if (!response.ok) throw await responseError(response);
}

export async function moveCard(cardId: string, folderId: string): Promise<StudyCard> {
  const response = await fetch(`${API_BASE}/api/cards/${cardId}/move`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ folder_id: folderId })
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function copyCard(cardId: string, folderId: string): Promise<StudyCard> {
  const response = await fetch(`${API_BASE}/api/cards/${cardId}/copy`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ folder_id: folderId })
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function deleteCard(cardId: string) {
  const response = await fetch(`${API_BASE}/api/cards/${cardId}`, {
    method: "DELETE"
  });
  if (!response.ok) throw await responseError(response);
}

export async function deleteAllCards() {
  const response = await fetch(`${API_BASE}/api/cards`, {
    method: "DELETE"
  });
  if (!response.ok) throw await responseError(response);
}
