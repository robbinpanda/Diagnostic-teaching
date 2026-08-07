"use client";

import { useCallback, useRef, useState } from "react";

import { createMistakeSet, fetchMistakeSets, type MistakeSet } from "../lib/api";


type Options = {
  onError: (message: string) => void;
  onClearError: () => void;
};


export function useMistakeSets({ onError, onClearError }: Options) {
  const [mistakeSets, setMistakeSets] = useState<MistakeSet[]>([]);
  const [mistakeSetsBusy, setMistakeSetsBusy] = useState(false);
  const [mistakeSetSaveBusy, setMistakeSetSaveBusy] = useState(false);
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

  const saveMistakeSet = useCallback(async (name: string, sessionIds: string[]) => {
    onClearError();
    setMistakeSetSaveBusy(true);
    try {
      const created = await createMistakeSet({ name, session_ids: sessionIds });
      mutationRef.current += 1;
      requestRef.current += 1;
      setMistakeSets((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      return created;
    } catch (error) {
      onError(error instanceof Error ? error.message : "错题集保存失败");
      return null;
    } finally {
      setMistakeSetSaveBusy(false);
    }
  }, [onClearError, onError]);

  return {
    mistakeSets,
    mistakeSetsBusy,
    mistakeSetSaveBusy,
    refreshMistakeSets,
    saveMistakeSet
  };
}
