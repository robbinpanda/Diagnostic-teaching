"use client";

import { Loader2, PlugZap, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createModelProfile, ModelProfile, testModelProfile, updateModelProfile } from "../lib/api";

type Props = {
  open: boolean;
  profile?: ModelProfile | null;
  onClose: () => void;
  onSaved: (profileId: string) => void;
};

export function ModelConfigDialog({ open, profile, onClose, onSaved }: Props) {
  const [displayName, setDisplayName] = useState("我的模型");
  const [provider, setProvider] = useState<"openai" | "openai_compatible" | "local_demo">("openai_compatible");
  const [baseUrl, setBaseUrl] = useState("https://example-provider.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [maxOutputTokens, setMaxOutputTokens] = useState(8000);
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [temperature, setTemperature] = useState(0.2);
  const [isMultimodal, setIsMultimodal] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(profile);

  useEffect(() => {
    if (!open) return;
    setDisplayName(profile?.display_name ?? "我的模型");
    setProvider(profile?.provider ?? "openai_compatible");
    setBaseUrl(profile?.base_url ?? "https://example-provider.com/v1");
    setApiKey("");
    setModel(profile?.model ?? "");
    setMaxOutputTokens(profile?.max_output_tokens ?? 8000);
    setTimeoutMs(profile?.timeout_ms ?? 30000);
    setTemperature(profile?.temperature ?? 0.2);
    setIsMultimodal(profile?.is_multimodal ?? false);
    setStatus("");
  }, [open, profile]);

  if (!open) return null;

  async function handleTest() {
    setBusy(true);
    setStatus("正在测试连接...");
    try {
      const result = await testModelProfile({
        ...(profile ? { profile_id: profile.id } : {}),
        provider,
        base_url: baseUrl,
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        model,
        max_output_tokens: maxOutputTokens
      });
      setStatus(result.ok ? `连接成功，首字延迟 ${result.latency_ms ?? "-"} ms` : `连接失败：${result.message}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "连接测试失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    setStatus(isEdit ? "正在更新..." : "正在保存...");
    try {
      const input = {
        display_name: displayName,
        provider,
        base_url: baseUrl,
        model,
        tags: ["math"],
        timeout_ms: timeoutMs,
        temperature,
        max_output_tokens: maxOutputTokens,
        is_multimodal: isMultimodal
      };
      const result = isEdit && profile
        ? await updateModelProfile(profile.id, { ...input, ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}) })
        : await createModelProfile({ ...input, api_key: apiKey });
      setStatus(isEdit ? "已更新" : "已保存");
      onSaved(result.id);
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : isEdit ? "更新失败" : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true">
      <div className="modelDialog">
        <div className="dialogHeader">
          <div>
            <h2>{isEdit ? "修改模型配置" : "添加模型配置"}</h2>
            <p>{isEdit ? "API key 留空则沿用当前密钥。" : "API key 保存在本机后端，页面不会再次显示明文。"}</p>
          </div>
          <button className="iconButton" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <label>
          显示名称
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <label>
          供应商类型
          <select value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)}>
            <option value="openai_compatible">OpenAI-compatible</option>
            <option value="openai">OpenAI</option>
            <option value="local_demo">Local demo</option>
          </select>
        </label>
        <label>
          Base URL
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://example.com/v1" />
        </label>
        <label>
          API key{isEdit ? "（留空不修改）" : ""}
          <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" />
        </label>
        <label>
          Model name
          <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="provider-model-name" />
        </label>
        <label>
          Max output tokens
          <input
            value={maxOutputTokens}
            onChange={(event) => setMaxOutputTokens(Number(event.target.value))}
            type="number"
            min={100}
            max={64000}
            step={100}
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
            />
          </label>
        </div>
        <label className="checkboxLabel">
          <input
            checked={isMultimodal}
            onChange={(event) => setIsMultimodal(event.target.checked)}
            type="checkbox"
          />
          支持图片识别（多模态模型）
        </label>

        <div className="dialogActions">
          <button className="secondaryButton" type="button" onClick={handleTest} disabled={busy || (!isEdit && !apiKey) || !model || !baseUrl}>
            {busy ? <Loader2 size={16} className="spin" /> : <PlugZap size={16} />}
            测试连接
          </button>
          <button className="primaryButton" type="button" onClick={handleSave} disabled={busy || (!isEdit && !apiKey) || !model || !baseUrl}>
            {busy ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
            {isEdit ? "保存修改" : "保存并选择"}
          </button>
        </div>
        {status && <p className="dialogStatus">{status}</p>}
      </div>
    </div>
  );
}
