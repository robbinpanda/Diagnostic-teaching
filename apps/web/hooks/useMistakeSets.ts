"use client";

import { useCallback, useRef, useState } from "react";

import { createMistakeSet, deleteMistakeSets as deleteMistakeSetsRequest, fetchMistakeSets, type MistakeSet } from "../lib/api";


type Options = {
  onError: (message: string) => void;
  onClearError: () => void;
};


export function useMistakeSets({ onError, onClearError }: Options) {
  const [mistakeSets, setMistakeSets] = useState<MistakeSet[]>([]);
  const [mistakeSetsBusy, setMistakeSetsBusy] = useState(false);
  const [mistakeSetSaveBusy, setMistakeSetSaveBusy] = useState(false);
  const [mistakeSetDeleteBusy, setMistakeSetDeleteBusy] = useState(false);
  const requestRef = useRef(0);
  const mutationRef = useRef(0);

  const refreshMistakeSets = useCallback(async () => {
    const requestId = ++requestRef.current;
    const mutationId = mutationRef.current;
    setMistakeSetsBusy(true);
    try {
      const nextSets = await fetchMistakeSets();
      if (requestId !== requestRef.current || mutationId !== mutationRef.current) return;
      setMistakeSets(nextSets);
    } catch (error) {
      if (requestId !== requestRef.current) return;
      onError(error instanceof Error ? error.message : "错题集加载失败");
    } finally {
      if (requestId === requestRef.current) setMistakeSetsBusy(false);
    }
  }, [onError]);

  const saveMistakeSet = useCallback(async (name: string, cardIds: string[]) => {
    onClearError();
    setMistakeSetSaveBusy(true);
    try {
      const created = await createMistakeSet({ name, card_ids: cardIds });
      mutationRef.current += 1;
      setMistakeSets((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      return created;
    } catch (error) {
      onError(error instanceof Error ? error.message : "错题集保存失败");
      return null;
    } finally {
      setMistakeSetSaveBusy(false);
    }
  }, [onClearError, onError]);

  const deleteMistakeSets = useCallback(async (mistakeSetIds: string[]) => {
    if (
      mistakeSetDeleteBusy
      || mistakeSetIds.length === 0
      || !window.confirm(`删除选中的 ${mistakeSetIds.length} 个错题集？删除后无法恢复。`)
    ) return false;
    setMistakeSetDeleteBusy(true);
    onClearError();
    try {
      await deleteMistakeSetsRequest(mistakeSetIds);
      const deletedIds = new Set(mistakeSetIds);
      mutationRef.current += 1;
      setMistakeSets((current) => current.filter((item) => !deletedIds.has(item.id)));
      return true;
    } catch (error) {
      onError(error instanceof Error ? error.message : "批量删除错题集失败");
      return false;
    } finally {
      setMistakeSetDeleteBusy(false);
    }
  }, [mistakeSetDeleteBusy, onClearError, onError]);

  return {
    mistakeSets,
    mistakeSetsBusy,
    mistakeSetSaveBusy,
    mistakeSetDeleteBusy,
    refreshMistakeSets,
    saveMistakeSet,
    deleteMistakeSets
  };
}
