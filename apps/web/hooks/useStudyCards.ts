"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  copyCard as copyCardRequest,
  createCardFolder as createCardFolderRequest,
  deleteAllCards as deleteAllCardsRequest,
  deleteCard as deleteCardRequest,
  deleteCardFolder as deleteCardFolderRequest,
  fetchCardFolders,
  fetchCards,
  moveCard as moveCardRequest,
  updateCardFolder as updateCardFolderRequest,
  type CardFolder,
  type StudyCard
} from "../lib/api";
import { childFolders } from "../lib/card-folders";

export type CardClipboard = {
  card: StudyCard;
  mode: "copy" | "cut";
};

type Options = {
  onError: (message: string) => void;
  onClearError: () => void;
};

export function useStudyCards({ onError, onClearError }: Options) {
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [folders, setFolders] = useState<CardFolder[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [viewingCard, setViewingCard] = useState<StudyCard | null>(null);
  const [movingCard, setMovingCard] = useState<StudyCard | null>(null);
  const [clipboard, setClipboard] = useState<CardClipboard | null>(null);
  const [cardBusyId, setCardBusyId] = useState("");
  const [folderBusyId, setFolderBusyId] = useState("");
  const [pasteBusy, setPasteBusy] = useState(false);
  const [deleteAllCardsBusy, setDeleteAllCardsBusy] = useState(false);
  const cardsRequestRef = useRef(0);
  const cardsMutationRef = useRef(0);
  const foldersMutationRef = useRef(0);

  const visibleFolders = useMemo(
    () => childFolders(folders, currentFolderId),
    [currentFolderId, folders]
  );
  const visibleCards = useMemo(
    () => currentFolderId
      ? cards.filter((card) => card.folder_id === currentFolderId)
      : [],
    [cards, currentFolderId]
  );

  const refreshCards = useCallback(async () => {
    const requestId = ++cardsRequestRef.current;
    const cardsMutationId = cardsMutationRef.current;
    const foldersMutationId = foldersMutationRef.current;
    try {
      const [nextCards, nextFolders] = await Promise.all([
        fetchCards(),
        fetchCardFolders()
      ]);
      if (requestId !== cardsRequestRef.current) return;
      if (cardsMutationId === cardsMutationRef.current) setCards(nextCards);
      if (foldersMutationId === foldersMutationRef.current) {
        setFolders(nextFolders);
        setCurrentFolderId((current) =>
          current && !nextFolders.some((folder) => folder.id === current) ? null : current
        );
      }
    } catch (error) {
      if (requestId !== cardsRequestRef.current) return;
      onError(error instanceof Error ? error.message : "学习卡片加载失败");
    }
  }, [onError]);

  const invalidateCardRefresh = useCallback(() => {
    cardsRequestRef.current += 1;
  }, []);

  const upsertCard = useCallback((card: StudyCard) => {
    cardsMutationRef.current += 1;
    setCards((current) => [card, ...current.filter((item) => item.id !== card.id)]);
    setViewingCard((current) => current?.id === card.id ? card : current);
    setClipboard((current) => current?.card.id === card.id
      ? { ...current, card }
      : current);
  }, []);

  const createFolder = useCallback(async (name: string) => {
    onClearError();
    setFolderBusyId("create");
    try {
      const folder = await createCardFolderRequest({
        name,
        parent_id: currentFolderId
      });
      foldersMutationRef.current += 1;
      setFolders((current) => [...current, folder]);
      return true;
    } catch (error) {
      onError(error instanceof Error ? error.message : "创建文件夹失败");
      return false;
    } finally {
      setFolderBusyId("");
    }
  }, [currentFolderId, onClearError, onError]);

  const renameFolder = useCallback(async (folder: CardFolder, name: string) => {
    onClearError();
    setFolderBusyId(folder.id);
    try {
      const updated = await updateCardFolderRequest(folder.id, { name });
      foldersMutationRef.current += 1;
      setFolders((current) => current.map((item) => item.id === updated.id ? updated : item));
      return true;
    } catch (error) {
      onError(error instanceof Error ? error.message : "重命名文件夹失败");
      return false;
    } finally {
      setFolderBusyId("");
    }
  }, [onClearError, onError]);

  const deleteFolder = useCallback(async (folder: CardFolder) => {
    onClearError();
    setFolderBusyId(folder.id);
    try {
      await deleteCardFolderRequest(folder.id);
      foldersMutationRef.current += 1;
      setFolders((current) => current.filter((item) => item.id !== folder.id));
      setCurrentFolderId((current) => current === folder.id ? folder.parent_id ?? null : current);
    } catch (error) {
      onError(error instanceof Error ? error.message : "删除文件夹失败");
    } finally {
      setFolderBusyId("");
    }
  }, [onClearError, onError]);

  const moveCardToFolder = useCallback(async (card: StudyCard, folderId: string) => {
    onClearError();
    setCardBusyId(card.id);
    try {
      const moved = await moveCardRequest(card.id, folderId);
      upsertCard(moved);
      setMovingCard(null);
      return true;
    } catch (error) {
      onError(error instanceof Error ? error.message : "移动学习卡片失败");
      return false;
    } finally {
      setCardBusyId("");
    }
  }, [onClearError, onError, upsertCard]);

  const pasteCard = useCallback(async () => {
    if (!clipboard || !currentFolderId) return;
    onClearError();
    setPasteBusy(true);
    setCardBusyId(clipboard.card.id);
    try {
      if (clipboard.mode === "copy") {
        const copied = await copyCardRequest(clipboard.card.id, currentFolderId);
        cardsMutationRef.current += 1;
        setCards((current) => [copied, ...current]);
      } else {
        const moved = await moveCardRequest(clipboard.card.id, currentFolderId);
        upsertCard(moved);
        setClipboard(null);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "粘贴学习卡片失败");
    } finally {
      setPasteBusy(false);
      setCardBusyId("");
    }
  }, [clipboard, currentFolderId, onClearError, onError, upsertCard]);

  const deleteCard = useCallback(async (card: StudyCard) => {
    if (cardBusyId || !window.confirm(`删除卡片“${card.content.title}”？删除后无法恢复。`)) return;
    setCardBusyId(card.id);
    onClearError();
    try {
      await deleteCardRequest(card.id);
      cardsMutationRef.current += 1;
      setCards((current) => current.filter((item) => item.id !== card.id));
      setViewingCard((current) => current?.id === card.id ? null : current);
      setClipboard((current) => current?.card.id === card.id ? null : current);
    } catch (error) {
      onError(error instanceof Error ? error.message : "删除学习卡片失败");
    } finally {
      setCardBusyId("");
    }
  }, [cardBusyId, onClearError, onError]);

  const deleteAllCards = useCallback(async () => {
    if (!window.confirm("清空全部学习卡片？文件夹、会话、消息和日志会保留。")) return;
    setDeleteAllCardsBusy(true);
    onClearError();
    try {
      await deleteAllCardsRequest();
      cardsMutationRef.current += 1;
      setCards([]);
      setViewingCard(null);
      setClipboard(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : "清空学习卡片失败");
    } finally {
      setDeleteAllCardsBusy(false);
    }
  }, [onClearError, onError]);

  return {
    cards,
    folders,
    currentFolderId,
    setCurrentFolderId,
    visibleFolders,
    visibleCards,
    viewingCard,
    setViewingCard,
    movingCard,
    setMovingCard,
    clipboard,
    setClipboard,
    cardBusyId,
    folderBusyId,
    pasteBusy,
    deleteAllCardsBusy,
    refreshCards,
    invalidateCardRefresh,
    upsertCard,
    createFolder,
    renameFolder,
    deleteFolder,
    moveCardToFolder,
    pasteCard,
    deleteCard,
    deleteAllCards
  };
}
