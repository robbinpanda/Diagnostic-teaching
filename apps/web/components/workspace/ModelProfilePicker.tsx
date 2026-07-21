"use client";

import {
  Check,
  ChevronDown,
  Image as ImageIcon,
  Loader2,
  Plus,
  Settings2,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelProfile } from "../../lib/api";
import { modelProfileLabel } from "../../lib/api";

type Props = {
  profiles: ModelProfile[];
  selectedProfileId: string;
  disabled: boolean;
  canManage: boolean;
  deleteBusy: boolean;
  onChange: (profileId: string) => void;
  onAdd: () => void;
  onDelete: (profileIds: string[]) => Promise<boolean>;
};

const MAX_BATCH_DELETE_PROFILES = 20;

function pickerWidth(profile?: ModelProfile) {
  const labelLength = profile ? Array.from(modelProfileLabel(profile)).length : 8;
  const capabilitySpace = profile?.is_multimodal ? 100 : 0;
  return Math.min(430, Math.max(148, 70 + labelLength * 11 + capabilitySpace));
}

export function ModelProfilePicker({
  profiles,
  selectedProfileId,
  disabled,
  canManage,
  deleteBusy,
  onChange,
  onAdd,
  onDelete
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [manageMode, setManageMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId),
    [profiles, selectedProfileId]
  );
  const deletableIds = useMemo(
    () => profiles.filter((profile) => !profile.managed).map((profile) => profile.id),
    [profiles]
  );
  const batchSelectableIds = useMemo(
    () => deletableIds.slice(0, MAX_BATCH_DELETE_PROFILES),
    [deletableIds]
  );
  const allBatchIdsChecked = (
    checkedIds.length === batchSelectableIds.length
    && batchSelectableIds.every((id) => checkedIds.includes(id))
  );

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (disabled) closeMenu();
  }, [disabled]);

  useEffect(() => {
    setCheckedIds((current) => current.filter((id) => deletableIds.includes(id)));
  }, [deletableIds]);

  function closeMenu() {
    setOpen(false);
    setManageMode(false);
    setCheckedIds([]);
  }

  function toggleChecked(profileId: string) {
    setCheckedIds((current) => (
      current.includes(profileId)
        ? current.filter((id) => id !== profileId)
        : current.length >= MAX_BATCH_DELETE_PROFILES
          ? current
          : [...current, profileId]
    ));
  }

  function toggleAll() {
    setCheckedIds(allBatchIdsChecked ? [] : batchSelectableIds);
  }

  async function deleteChecked() {
    if (await onDelete(checkedIds)) closeMenu();
  }

  return (
    <div
      className={`modelPicker${open ? " open" : ""}`}
      ref={rootRef}
      style={{ width: `${pickerWidth(selectedProfile)}px` }}
    >
      <button
        className="modelPickerTrigger"
        type="button"
        disabled={disabled}
        aria-label="答疑模型"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={selectedProfile ? modelProfileLabel(selectedProfile) : "选择答疑模型"}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="modelPickerCurrent">
          <span className={`modelPickerStatus${selectedProfile ? " selected" : ""}`} aria-hidden="true" />
          <span className="modelPickerCurrentLabel">
            {selectedProfile ? modelProfileLabel(selectedProfile) : "选择模型"}
          </span>
          {selectedProfile?.is_multimodal && (
            <span className="modelCapabilityBadge compact">
              <ImageIcon size={12} />
              支持上传图片
            </span>
          )}
        </span>
        <ChevronDown className="modelPickerChevron" size={15} aria-hidden="true" />
      </button>

      <div className="modelPickerMenu" hidden={!open}>
        <div className="modelPickerMenuHeader">
          <div className="modelPickerHeaderCopy">
            <strong>{manageMode ? "管理模型配置" : "选择答疑模型"}</strong>
            <span>{manageMode ? `可同时勾选最多 ${MAX_BATCH_DELETE_PROFILES} 个自定义模型删除` : `${profiles.length} 个可用模型`}</span>
          </div>
          {manageMode ? (
            <button className="modelPickerHeaderButton" type="button" onClick={() => { setManageMode(false); setCheckedIds([]); }}>
              <X size={14} />
              完成
            </button>
          ) : canManage ? (
            <div className="modelPickerHeaderActions">
              <button
                className="modelPickerHeaderButton"
                type="button"
                onClick={() => {
                  closeMenu();
                  onAdd();
                }}
              >
                <Plus size={14} />
                新增模型
              </button>
              {deletableIds.length > 0 && (
                <button className="modelPickerHeaderButton" type="button" onClick={() => setManageMode(true)}>
                  <Settings2 size={14} />
                  管理
                </button>
              )}
            </div>
          ) : null}
        </div>

        {manageMode && deletableIds.length > 1 && (
          <button className="modelPickerSelectAll" type="button" onClick={toggleAll}>
            {allBatchIdsChecked
              ? "取消全选"
              : deletableIds.length > MAX_BATCH_DELETE_PROFILES
                ? `选择前 ${MAX_BATCH_DELETE_PROFILES} 项（共 ${deletableIds.length} 项）`
                : `全选可删除项（${deletableIds.length}）`}
          </button>
        )}

        <div className="modelPickerOptions" role="listbox" aria-multiselectable={manageMode || undefined}>
          {profiles.length === 0 && <div className="modelPickerEmpty">还没有模型配置，请先点击右侧加号添加。</div>}
          {profiles.map((profile) => {
            const selected = profile.id === selectedProfileId;
            const checked = checkedIds.includes(profile.id);
            const label = modelProfileLabel(profile);
            return (
              <button
                className={`modelPickerOption${selected ? " selected" : ""}${checked ? " checked" : ""}`}
                key={profile.id}
                type="button"
                role="option"
                aria-selected={manageMode ? checked : selected}
                disabled={
                  deleteBusy
                  || (manageMode && profile.managed)
                  || (manageMode && !checked && checkedIds.length >= MAX_BATCH_DELETE_PROFILES)
                }
                title={label}
                onClick={() => {
                  if (manageMode) {
                    toggleChecked(profile.id);
                    return;
                  }
                  onChange(profile.id);
                  closeMenu();
                }}
              >
                {manageMode && !profile.managed ? (
                  <span className={`modelPickerCheckbox${checked ? " checked" : ""}`} aria-hidden="true">
                    {checked && <Check size={12} />}
                  </span>
                ) : (
                  <span className={`modelPickerOptionMark${selected ? " selected" : ""}`} aria-hidden="true">
                    {selected && <Check size={13} />}
                  </span>
                )}
                <span className="modelPickerOptionBody">
                  <span className="modelPickerOptionLabel">{label}</span>
                  <span className="modelPickerOptionMeta">
                    <span>{profile.base_url_host || profile.provider}</span>
                    {profile.is_multimodal && (
                      <span className="modelCapabilityBadge">
                        <ImageIcon size={12} />
                        支持上传图片
                      </span>
                    )}
                    {profile.managed && <span className="managedModelBadge">自动同步</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {manageMode && (
          <div className="modelPickerDeleteBar">
            <span>{checkedIds.length ? `已选择 ${checkedIds.length} 个` : "请选择要删除的模型"}</span>
            <button type="button" onClick={() => void deleteChecked()} disabled={deleteBusy || checkedIds.length === 0}>
              {deleteBusy ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
              删除选中
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
