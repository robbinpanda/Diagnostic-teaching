"use client";

import { Loader2, PlugZap, Save, X } from "lucide-react";
import { useState } from "react";
import { createModelProfile, testModelProfile } from "../lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (profileId: string) => void;
};

export function ModelConfigDialog({ open, onClose, onCreated }: Props) {
  const [displayName, setDisplayName] = useState("我的模型");
  const [provider, setProvider] = useState<"openai" | "openai_compatible" | "local_demo">("openai_compatible");
  const [baseUrl, setBaseUrl] = useState("https://example-provider.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function handleTest() {
    setBusy(true);
    setStatus("正在测试连接...");
    try {
      const result = await testModelProfile({ provider, base_url: baseUrl, api_key: apiKey, model });
      setStatus(result.ok ? `连接成功，耗时 ${result.latency_ms ?? "-"} ms` : `连接失败：${result.message}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "连接测试失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    setStatus("正在保存...");
    try {
      const result = await createModelProfile({
        display_name: displayName,
        provider,
        base_url: baseUrl,
        api_key: apiKey,
        model,
        tags: ["math"]
      });
      setStatus("已保存");
      onCreated(result.id);
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true">
      <div className="modelDialog">
        <div className="dialogHeader">
          <div>
            <h2>添加模型配置</h2>
            <p>API key 保存在本机后端，页面不会再次显示明文。</p>
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
          </select>
        </label>
        <label>
          Base URL
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://example.com/v1" />
        </label>
        <label>
          API key
          <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" />
        </label>
        <label>
          Model name
          <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="provider-model-name" />
        </label>

        <div className="dialogActions">
          <button className="secondaryButton" type="button" onClick={handleTest} disabled={busy || !apiKey || !model}>
            {busy ? <Loader2 size={16} className="spin" /> : <PlugZap size={16} />}
            测试连接
          </button>
          <button className="primaryButton" type="button" onClick={handleSave} disabled={busy || !apiKey || !model || !baseUrl}>
            {busy ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
            保存并选择
          </button>
        </div>
        {status && <p className="dialogStatus">{status}</p>}
      </div>
    </div>
  );
}
