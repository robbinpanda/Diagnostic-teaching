"use client";

import { useCallback, useMemo, useState } from "react";
import {
  deleteModelProfiles,
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
  const [deleteBusy, setDeleteBusy] = useState(false);

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

  function openSelectedProfileDialog() {
    setEditingProfile(selectedProfile ?? null);
    setDialogOpen(true);
  }

  function openNewProfileDialog() {
    setEditingProfile(null);
    setDialogOpen(true);
  }

  const deleteProfiles = useCallback(async (profileIds: string[]) => {
    if (activeSessionId || profileIds.length === 0) return false;
    const selectedProfiles = profileIds
      .map((profileId) => profiles.find((profile) => profile.id === profileId))
      .filter((profile): profile is ModelProfile => Boolean(profile));
    if (
      selectedProfiles.length !== profileIds.length
      || selectedProfiles.some((profile) => profile.managed)
    ) {
      onError("所选模型中包含不可删除的配置，请刷新后重试");
      return false;
    }
    const names = selectedProfiles.map(modelProfileLabel);
    const prompt = names.length === 1
      ? `删除模型配置“${names[0]}”？`
      : `确认删除选中的 ${names.length} 个模型配置？\n\n${names.map((name) => `• ${name}`).join("\n")}`;
    if (!window.confirm(prompt)) return false;
    setDeleteBusy(true);
    onClearError();
    try {
      await deleteModelProfiles(profileIds);
      await refreshProfiles();
      return true;
    } catch (error) {
      onError(error instanceof Error ? error.message : "删除模型配置失败");
      return false;
    } finally {
      setDeleteBusy(false);
    }
  }, [activeSessionId, onClearError, onError, profiles, refreshProfiles]);

  return {
    profiles,
    selectedProfileId,
    setSelectedProfileId,
    selectedProfile,
    multimodalProfiles,
    dialogOpen,
    closeProfileDialog: () => setDialogOpen(false),
    editingProfile,
    deleteBusy,
    refreshProfiles,
    openNewProfileDialog,
    openSelectedProfileDialog,
    deleteProfiles
  };
}
