from __future__ import annotations

import asyncio
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

import httpx

OPENCODE_MODELS_URL = "https://models.dev/api.json"
OPENCODE_FREE_TAG = "opencodefree"
OPENCODE_PUBLIC_API_KEY = "public"
CATALOG_TIMEOUT_SECONDS = 10.0
CATALOG_REFRESH_SECONDS = 60 * 60

SupportedProvider = Literal["openai_compatible", "anthropic"]


@dataclass(frozen=True)
class OpenCodeFreeModel:
    model: str
    name: str
    provider: SupportedProvider
    base_url: str
    is_multimodal: bool

    @property
    def display_name(self) -> str:
        return f"opencodefree-{self.model}"


# The bundled snapshot makes the models usable on an offline first launch. The
# Windows installer disables catalog refresh and therefore exposes exactly this
# curated pair. Development builds may still replace it from models.dev.
BUILTIN_FREE_MODELS = (
    OpenCodeFreeModel(
        model="hy3",
        name="HY3",
        provider="openai_compatible",
        base_url="https://opencode.ai/zen/v1",
        is_multimodal=False,
    ),
    OpenCodeFreeModel(
        model="mimo-v2.5-free",
        name="MiMo V2.5 Free",
        provider="openai_compatible",
        base_url="https://opencode.ai/zen/v1",
        is_multimodal=True,
    ),
)


def parse_opencode_free_models(payload: Any) -> tuple[OpenCodeFreeModel, ...]:
    if not isinstance(payload, dict):
        raise ValueError("models.dev 目录不是 JSON object")
    provider = payload.get("opencode")
    if not isinstance(provider, dict):
        raise ValueError("models.dev 目录缺少 opencode provider")
    provider_models = provider.get("models")
    if not isinstance(provider_models, dict):
        raise ValueError("opencode provider 缺少 models")

    parsed: list[OpenCodeFreeModel] = []
    for catalog_id, raw_model in provider_models.items():
        if not isinstance(raw_model, dict):
            continue
        if raw_model.get("status") in {"alpha", "deprecated"}:
            continue
        cost = raw_model.get("cost")
        # OpenCode normalizes missing catalog cost to zero before applying the
        # unauthenticated `cost.input === 0` filter, so keep the same behavior.
        input_cost = cost.get("input", 0) if isinstance(cost, dict) else 0
        if input_cost != 0:
            continue

        model_provider = raw_model.get("provider")
        model_provider = model_provider if isinstance(model_provider, dict) else {}
        npm = model_provider.get("npm") or provider.get("npm")
        protocol = _supported_protocol(npm)
        if protocol is None:
            continue
        base_url = model_provider.get("api") or provider.get("api")
        if not isinstance(base_url, str) or not base_url.strip():
            continue

        model_id = raw_model.get("id") or catalog_id
        if not isinstance(model_id, str) or not model_id.strip():
            continue
        modalities = raw_model.get("modalities")
        input_modalities = modalities.get("input", []) if isinstance(modalities, dict) else []
        is_multimodal = "image" in input_modalities if isinstance(input_modalities, list) else False
        if not modalities:
            is_multimodal = raw_model.get("attachment") is True
        parsed.append(
            OpenCodeFreeModel(
                model=model_id.strip(),
                name=str(raw_model.get("name") or model_id).strip(),
                provider=protocol,
                base_url=base_url.rstrip("/"),
                is_multimodal=is_multimodal,
            )
        )
    return tuple(sorted(parsed, key=lambda item: item.model))


def _supported_protocol(npm: Any) -> SupportedProvider | None:
    if npm == "@ai-sdk/openai-compatible":
        return "openai_compatible"
    if npm == "@ai-sdk/anthropic":
        return "anthropic"
    return None


class OpenCodeFreeModelCatalog:
    def __init__(self, cache_path: Path):
        self.cache_path = cache_path
        self._models = self._load_cache() or BUILTIN_FREE_MODELS
        self._lock = asyncio.Lock()
        self.last_error: str | None = None

    def current(self) -> tuple[OpenCodeFreeModel, ...]:
        return self._models

    async def refresh(self) -> tuple[OpenCodeFreeModel, ...]:
        async with self._lock:
            try:
                timeout = httpx.Timeout(CATALOG_TIMEOUT_SECONDS)
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.get(
                        OPENCODE_MODELS_URL,
                        headers={"User-Agent": "diagnostic-math-tutor/0.3"},
                    )
                    response.raise_for_status()
                    models = parse_opencode_free_models(response.json())
                if not models:
                    raise ValueError("models.dev 没有返回受支持的 OpenCode 免费模型")
                self._models = models
                self._write_cache(models)
                self.last_error = None
            except (httpx.HTTPError, json.JSONDecodeError, OSError, ValueError) as exc:
                self.last_error = str(exc) or exc.__class__.__name__
            return self._models

    def _load_cache(self) -> tuple[OpenCodeFreeModel, ...] | None:
        try:
            raw = json.loads(self.cache_path.read_text(encoding="utf-8"))
            items = raw.get("models") if isinstance(raw, dict) else None
            if not isinstance(items, list):
                return None
            models = tuple(OpenCodeFreeModel(**item) for item in items if isinstance(item, dict))
            return models or None
        except (OSError, TypeError, ValueError, json.JSONDecodeError):
            return None

    def _write_cache(self, models: tuple[OpenCodeFreeModel, ...]) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self.cache_path.with_suffix(f"{self.cache_path.suffix}.tmp")
        temp_path.write_text(
            json.dumps({"models": [asdict(model) for model in models]}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temp_path.replace(self.cache_path)
