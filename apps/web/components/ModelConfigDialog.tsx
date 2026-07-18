"use client";

import { CheckCircle2, CircleX, Loader2, Minus, Plus, PlugZap, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createModelProfiles, ModelProfile, testModelProfile, updateModelProfile } from "../lib/api";

type Props = {
  open: boolean;
  profile?: ModelProfile | null;
  onClose: () => void;
  onSaved: (profileId: string) => void;
};

type TestState = "idle" | "testing" | "success" | "error";

type ModelEntry = {
  id: string;
  model: string;
  isMultimodal: boolean;
  testState: TestState;
  testMessage: string;
};

function emptyModelEntry(id: string): ModelEntry {
  return { id, model: "", isMultimodal: false, testState: "idle", testMessage: "" };
}

export function ModelConfigDialog({ open, profile, onClose, onSaved }: Props) {
  const [displayName, setDisplayName] = useState("我的供应商");
  const [provider, setProvider] = useState<"openai" | "openai_compatible" | "anthropic" | "local_demo">("openai_compatible");
  const [baseUrl, setBaseUrl] = useState("https://example-provider.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<ModelEntry[]>([emptyModelEntry("model-0")]);
  const [maxOutputTokens, setMaxOutputTokens] = useState(8000);
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [temperature, setTemperature] = useState(0.2);
  const [status, setStatus] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const isEdit = Boolean(profile);
  const isManaged = profile?.managed === true;
  const busy = testing || saving;
  const invalid = (
    !displayName.trim()
    || !baseUrl.trim()
    || models.some((entry) => !entry.model.trim())
    || (!isEdit && !apiKey.trim())
  );

  useEffect(() => {
    if (!open) return;
    setDisplayName(profile?.display_name ?? "我的供应商");
    setProvider(profile?.provider ?? "openai_compatible");
    setBaseUrl(profile?.base_url ?? "https://example-provider.com/v1");
    setApiKey("");
    setModels([
      profile
        ? {
            id: profile.id,
            model: profile.model,
            isMultimodal: profile.is_multimodal,
            testState: "idle",
            testMessage: ""
          }
        : emptyModelEntry("model-0")
    ]);
    setMaxOutputTokens(profile?.max_output_tokens ?? 8000);
    setTimeoutMs(profile?.timeout_ms ?? 30000);
    setTemperature(profile?.temperature ?? 0.2);
    setStatus("");
    setTesting(false);
    setSaving(false);
  }, [open, profile]);

  if (!open) return null;

  function updateModelEntry(id: string, changes: Partial<ModelEntry>, resetTest = false) {
    setModels((current) => current.map((entry) => (
      entry.id === id
        ? {
            ...entry,
            ...changes,
            ...(resetTest ? { testState: "idle" as const, testMessage: "" } : {})
          }
        : entry
    )));
  }

  function addModelEntry() {
    setModels((current) => [...current, emptyModelEntry(crypto.randomUUID())]);
  }

  function removeModelEntry(id: string) {
    setModels((current) => current.filter((entry) => entry.id !== id));
  }

  async function handleTest() {
    setTesting(true);
    setStatus(`正在逐个测试 ${models.length} 个模型…`);
    let successful = 0;
    for (const entry of models) {
      updateModelEntry(entry.id, { testState: "testing", testMessage: "正在测试文本连接和图片能力…" });
      try {
        const result = await testModelProfile({
          ...(profile ? { profile_id: profile.id } : {}),
          provider,
          base_url: baseUrl,
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
          model: entry.model.trim(),
          timeout_ms: Math.min(timeoutMs, 60000),
          max_output_tokens: maxOutputTokens,
          probe_multimodal: true,
          require_multimodal: entry.isMultimodal
        });
        if (result.ok) successful += 1;
        updateModelEntry(entry.id, {
          testState: result.ok ? "success" : "error",
          testMessage: result.message,
          isMultimodal: entry.isMultimodal || result.multimodal_ok === true
        });
      } catch (error) {
        updateModelEntry(entry.id, {
          testState: "error",
          testMessage: error instanceof Error ? error.message : "连接测试失败"
        });
      }
    }
    setStatus(`测试完成：${successful}/${models.length} 个模型通过。图片探测成功的模型已自动勾选多模态。`);
    setTesting(false);
  }

  async function handleSave() {
    setSaving(true);
    setStatus(isEdit ? "正在更新…" : `正在保存 ${models.length} 个模型…`);
    try {
      const common = {
        display_name: displayName.trim(),
        provider,
        base_url: baseUrl.trim(),
        tags: ["math"],
        timeout_ms: timeoutMs,
        temperature,
        max_output_tokens: maxOutputTokens
      };
      if (isEdit && profile) {
        const entry = models[0];
        const result = await updateModelProfile(profile.id, {
          ...common,
          model: entry.model.trim(),
          is_multimodal: entry.isMultimodal,
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {})
        });
        setStatus("已更新");
        onSaved(result.id);
      } else {
        const result = await createModelProfiles({
          ...common,
          api_key: apiKey.trim(),
          models: models.map((entry) => ({
            model: entry.model.trim(),
            is_multimodal: entry.isMultimodal
          }))
        });
        const firstProfile = result.profiles[0];
        if (!firstProfile) throw new Error("没有创建任何模型配置");
        setStatus(`已保存 ${result.profiles.length} 个模型`);
        onSaved(firstProfile.id);
      }
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : isEdit ? "更新失败" : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true">
      <div className="modelDialog">
        <div className="dialogHeader">
          <div>
            <h2>{isManaged ? "查看模型配置" : isEdit ? "修改模型配置" : "添加供应商模型"}</h2>
            <p>{isManaged ? "OpenCode 免费模型由在线目录自动同步；免费端点可能记录输入，请勿提交个人或敏感信息。" : isEdit ? "API key 留空则沿用当前密钥。" : "一套供应商 URL/API key 可以一次添加多个 model name。"}</p>
          </div>
          <button className="iconButton" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <label>
          供应商名称
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如：OpenAI、火山方舟" disabled={isManaged} />
        </label>
        <label>
          供应商类型
          <select value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)} disabled={isManaged}>
            <option value="openai_compatible">OpenAI-compatible</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic Messages</option>
            <option value="local_demo">Local demo</option>
          </select>
        </label>
        <label>
          Base URL
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://example.com/v1" disabled={isManaged} />
        </label>
        <label>
          API key{isManaged ? "（内置公共凭据）" : isEdit ? "（留空不修改）" : ""}
          <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" disabled={isManaged} placeholder={isManaged ? profile?.masked_api_key : undefined} />
        </label>

        <section className="modelEntriesSection">
          <div className="modelEntriesHeader">
            <div>
              <strong>Model name</strong>
              <span>每个模型单独设置多模态能力并显示测试结果。</span>
            </div>
            {!isEdit && (
              <button className="modelAddButton" type="button" onClick={addModelEntry} disabled={busy || models.length >= 20}>
                <Plus size={15} />
                添加
              </button>
            )}
          </div>
          <div className="modelEntryList">
            {models.map((entry) => (
              <div className="modelEntryCard" key={entry.id}>
                <div className="modelEntryTop">
                  <input
                    value={entry.model}
                    onChange={(event) => updateModelEntry(entry.id, { model: event.target.value }, true)}
                    placeholder="provider-model-name"
                    aria-label="Model name"
                    disabled={isManaged}
                  />
                  <span className={`modelTestIcon ${entry.testState}`} title={entry.testMessage || "尚未测试"}>
                    {entry.testState === "testing" && <Loader2 size={18} className="spin" />}
                    {entry.testState === "success" && <CheckCircle2 size={18} />}
                    {entry.testState === "error" && <CircleX size={18} />}
                    {entry.testState === "idle" && <span aria-hidden="true">·</span>}
                  </span>
                  {!isEdit && models.length > 1 && (
                    <button className="modelRemoveButton" type="button" onClick={() => removeModelEntry(entry.id)} disabled={busy} aria-label={`移除 ${entry.model || "空模型"}`}>
                      <Minus size={15} />
                    </button>
                  )}
                </div>
                <label className="checkboxLabel modelCapabilityToggle">
                  <input
                    checked={entry.isMultimodal}
                    onChange={(event) => updateModelEntry(entry.id, { isMultimodal: event.target.checked }, true)}
                    type="checkbox"
                    disabled={isManaged}
                  />
                  {isManaged ? "支持图片识别（由 OpenCode 目录元数据同步）" : "支持图片识别（默认关闭；测试图片成功后自动开启）"}
                </label>
                {entry.testMessage && <p className={`modelTestMessage ${entry.testState}`}>{entry.testMessage}</p>}
              </div>
            ))}
          </div>
        </section>

        <label>
          Max output tokens
          <input
            value={maxOutputTokens}
            onChange={(event) => setMaxOutputTokens(Number(event.target.value))}
            type="number"
            min={100}
            max={64000}
            step={100}
            disabled={isManaged}
          />
        </label>
        <div className="twoColumnFields">
          <label>
            Timeout ms
            <input
              value={timeoutMs}
              onChange={(event) => setTimeoutMs(Number(event.target.value))}
              type="number"
              min={1000}
              max={120000}
              step={1000}
              disabled={isManaged}
            />
          </label>
          <label>
            Temperature
            <input
              value={temperature}
              onChange={(event) => setTemperature(Number(event.target.value))}
              type="number"
              min={0}
              max={2}
              step={0.1}
              disabled={isManaged}
            />
          </label>
        </div>

        <div className="dialogActions">
          {isManaged ? (
            <button className="primaryButton" type="button" onClick={onClose}>关闭</button>
          ) : (
            <>
              <button className="secondaryButton" type="button" onClick={handleTest} disabled={busy || invalid}>
                {testing ? <Loader2 size={16} className="spin" /> : <PlugZap size={16} />}
                {models.length > 1 ? "逐个测试" : "测试连接"}
              </button>
              <button className="primaryButton" type="button" onClick={handleSave} disabled={busy || invalid}>
                {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                {isEdit ? "保存修改" : `保存 ${models.length} 个模型`}
              </button>
            </>
          )}
        </div>
        {status && <p className="dialogStatus">{status}</p>}
      </div>
    </div>
  );
}
