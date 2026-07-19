"use client";

import { useCallback, useMemo, useState } from "react";
import {
  deleteModelProfile,
  fetchProfiles,
  modelProfileLabel,
  type ModelProfile
} from "../lib/api";

type Options = {
  activeSessionId: string;
  onError: (message: string) => void;
  onClearError: () => void;
};

export function useModelProfiles({ activeSessionId, onError, onClearError }: Options) {
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ModelProfile | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState("");

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId),
    [profiles, selectedProfileId]
  );
  const multimodalProfiles = useMemo(
    () => profiles.filter((profile) => profile.is_multimodal),
    [profiles]
  );

  const refreshProfiles = useCallback(async (selectId?: string) => {
    try {
      const nextProfiles = await fetchProfiles();
      setProfiles(nextProfiles);
      const desiredId = selectId ?? selectedProfileId;
      if (desiredId && nextProfiles.some((profile) => profile.id === desiredId)) {
        setSelectedProfileId(desiredId);
        return;
      }
      if (nextProfiles.length === 1) {
        setSelectedProfileId(nextProfiles[0].id);
        return;
      }
      if (!nextProfiles.some((profile) => profile.id === selectedProfileId)) setSelectedProfileId("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "模型列表加载失败");
    }
  }, [onError, selectedProfileId]);

  function openProfileDialog() {
    setEditingProfile(selectedProfile ?? null);
    setDialogOpen(true);
  }

  const deleteSelectedProfile = useCallback(async () => {
    if (!selectedProfile || selectedProfile.managed || activeSessionId) return;
    if (!window.confirm(`删除模型配置“${modelProfileLabel(selectedProfile)}”？`)) return;
    setDeleteBusyId(selectedProfile.id);
    onClearError();
    try {
      await deleteModelProfile(selectedProfile.id);
      await refreshProfiles();
    } catch (error) {
      onError(error instanceof Error ? error.message : "删除模型配置失败");
    } finally {
      setDeleteBusyId("");
    }
  }, [activeSessionId, onClearError, onError, refreshProfiles, selectedProfile]);

  return {
    profiles,
    selectedProfileId,
    setSelectedProfileId,
    selectedProfile,
    multimodalProfiles,
    dialogOpen,
    closeProfileDialog: () => setDialogOpen(false),
    editingProfile,
    deleteBusyId,
    refreshProfiles,
    openProfileDialog,
    deleteSelectedProfile
  };
}
