"use client";

import { useCallback, useMemo, useState } from "react";
import {
  deleteAllCards as deleteAllCardsRequest,
  deleteCard as deleteCardRequest,
  fetchCards,
  type StudyCard
} from "../lib/api";

type StudyCardFilter = "all" | "knowledge_card" | "problem_card";

type Options = {
  onError: (message: string) => void;
  onClearError: () => void;
};

export function useStudyCards({ onError, onClearError }: Options) {
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [filter, setFilter] = useState<StudyCardFilter>("all");
  const [viewingCard, setViewingCard] = useState<StudyCard | null>(null);
  const [cardBusyId, setCardBusyId] = useState("");
  const [deleteAllCardsBusy, setDeleteAllCardsBusy] = useState(false);

  const filteredCards = useMemo(
    () => cards.filter((card) => filter === "all" || card.card_type === filter),
    [cards, filter]
  );

  const refreshCards = useCallback(async () => {
    try {
      setCards(await fetchCards());
    } catch (error) {
      onError(error instanceof Error ? error.message : "学习卡片加载失败");
    }
  }, [onError]);

  function upsertCard(card: StudyCard) {
    setCards((current) => [card, ...current.filter((item) => item.id !== card.id)]);
  }

  const deleteCard = useCallback(async (card: StudyCard) => {
    if (cardBusyId || !window.confirm(`删除卡片“${card.content.title}”？删除后无法恢复。`)) return;
    setCardBusyId(card.id);
    onClearError();
    try {
      await deleteCardRequest(card.id);
      setCards((current) => current.filter((item) => item.id !== card.id));
      setViewingCard((current) => current?.id === card.id ? null : current);
    } catch (error) {
      onError(error instanceof Error ? error.message : "删除学习卡片失败");
    } finally {
      setCardBusyId("");
    }
  }, [cardBusyId, onClearError, onError]);

  const deleteAllCards = useCallback(async () => {
    if (!window.confirm("清空全部学习卡片？会话、消息和日志会保留。")) return;
    setDeleteAllCardsBusy(true);
    onClearError();
    try {
      await deleteAllCardsRequest();
      setCards([]);
      setViewingCard(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : "清空学习卡片失败");
    } finally {
      setDeleteAllCardsBusy(false);
    }
  }, [onClearError, onError]);

  return {
    cards,
    filteredCards,
    filter,
    setFilter,
    viewingCard,
    setViewingCard,
    cardBusyId,
    deleteAllCardsBusy,
    refreshCards,
    upsertCard,
    deleteCard,
    deleteAllCards
  };
}
