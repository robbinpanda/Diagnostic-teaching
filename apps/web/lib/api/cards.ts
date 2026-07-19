import { API_BASE, JSON_HEADERS, responseError } from "./http";
import type { StudyCard } from "./types";

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

export async function saveCard(cardId: string, sessionId: string): Promise<StudyCard> {
  const response = await fetch(`${API_BASE}/api/cards/${cardId}/save`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ session_id: sessionId })
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
