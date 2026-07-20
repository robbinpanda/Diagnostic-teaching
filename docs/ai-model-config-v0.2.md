# AI 模型配置说明

方案版本：v0.3
文档状态：现行实现说明
最后核对：2026-07-20
适用项目：诊断式数学答疑 MVP

## 1. 结论

前端已提供“添加模型配置”按钮。用户填写一套供应商名称、`base_url` 和 `api_key` 后，可以通过 Model name 旁的加号一次加入多个模型；保存后每个 model name 仍是独立 profile，session 继续绑定到具体 profile。

应用可像 OpenCode 一样读取 `https://models.dev/api.json`：在 `opencode` provider 中保留未废弃、输入价格为 0 且协议受本项目支持的模型。它们会自动成为 SQLite 中的只读托管 profile，名称统一为 `opencodefree-<model-id>`，无需用户填写 API key。普通本地运行默认同步在线目录；Windows 安装版固定设置 `OPENCODE_CATALOG_REFRESH_ENABLED=0`，只使用随包内置快照、不请求 `models.dev`。

但不建议把这些内容写进 `.env`。更合适的 MVP 方案是：

> 前端填写配置 -> 后端校验与测试连接 -> 后端保存到本地 SQLite -> API key 加密存储 -> 每次答疑前从已保存模型中选择一个。

`.env` 只保留应用级配置，例如数据库路径、密钥文件路径和 session 日志目录。

## 2. 为什么不建议用 `.env` 保存用户添加的模型

`.env` 的问题：

1. 它适合启动配置，不适合运行时从 UI 频繁新增、修改、删除。
2. 修改 `.env` 后，服务通常需要重启才最稳。
3. 多模型配置是结构化数据，用 `.env` 会变成一堆难维护的变量。
4. `.env` 容易被误提交、误复制、误截图。
5. API key 如果进了 `.env`，后续做“删除模型”“替换 key”“测试连接状态”都比较别扭。

`.env` 可以继续用于：

```env
DATABASE_URL=sqlite:///./data/app.db
APP_SECRET_PATH=./data/app-secret.key
SESSION_LOG_DIR=./logs/sessions
```

## 3. 推荐保存方式

| 内容 | 保存位置 | 是否包含密钥 | 说明 |
|---|---|---:|---|
| 用户新增模型 | SQLite `model_profiles` 表 | 否 | 保存名称、供应商、base URL、model name |
| API key | SQLite 加密字段 | 是 | 只后端可解密，前端不可读取明文 |
| 加密主密钥 | `data/app-secret.key` | 是 | 首次启动生成，`data/` 加入 `.gitignore` |
| 模型预设 | `config/model-profiles.example.json` | 否 | 只放可选模板，不放真实 key |
| 应用配置 | `.env` | 尽量否 | 只放运行参数 |
| OpenCode 免费模型目录缓存 | `data/opencode-models.json` | 否 | 在线刷新成功后保存；离线时使用最近缓存或内置快照 |

本地 MVP 的目标是避免 key 进入浏览器存储、日志和 git。它不是企业级密钥管理方案；后续正式部署应接入云厂商 Secret Manager、KMS 或平台环境变量。

## 4. 前端交互

模型选择区：

1. 页面加载时请求 `GET /api/model-profiles`。
2. 如果只有一个可用模型，前端自动选中；如果有多个，用户必须明确选择一个。
3. 如果没有可用模型，显示“添加模型配置”。
4. 创建答疑 session 前必须有 `model_profile_id`。
5. 用户添加的模型显示为“供应商名称 · model name”，例如“火山方舟 · doubao-seed-1-6”；托管免费模型直接显示为 `opencodefree-<model-id>`。

“添加模型配置”弹窗字段：

1. 供应商名称：例如“火山方舟”。
2. 供应商类型：OpenAI-compatible / OpenAI / Anthropic Messages / Local demo。
3. Base URL。
4. API key。
5. Model name 列表；点加号最多可加入 20 个，每项必须唯一。
6. Max output tokens，默认 8000。
7. Timeout，默认 30000 ms。
8. Temperature，默认 0.2。
9. 每个 model name 独立的“是否支持图片识别”，默认关闭；勾选后可用于题图识别和含原图的正式答疑。

当前 UI 不开放标签编辑，保存时固定写入 `math` 标签；后端 API 仍支持 `tags` 字段。

OpenCode 托管免费模型可从同一个设置入口查看，但供应商、Base URL、model name、公共凭据、运行参数和多模态复选框均为只读。多模态复选框读取目录中的 `modalities.input`；存在 `image` 才勾选，不在模型下拉或聊天页额外显示能力徽标。

### 4.1 双协议调用

- `openai_compatible` / `openai`：请求 `<base_url>/chat/completions`，使用 Bearer API key，解析 OpenAI chat completions SSE。
- `anthropic`：请求 `<base_url>/messages`，使用 `x-api-key` 和 `anthropic-version: 2023-06-01`，把 system message 移到顶层 `system`，并解析 Anthropic Messages SSE。
- 图片在应用内部仍使用统一的 OpenAI 风格 `image_url`；Anthropic 请求前会把 data URL 转成 `type=image + source.type=base64`，因此图片分析和含原图答疑共用同一业务链路。

### 4.2 OpenCode 免费模型同步

实现与 OpenCode 源码的无密钥路径一致：目录来自 `models.dev/api.json`，无账户时使用公共值 `public`，只保留 `cost.input == 0` 的模型；本项目再排除 `alpha/deprecated` 和当前不支持的协议。普通本地运行启动时立即在线刷新，并每 60 分钟刷新一次；设置 `OPENCODE_CATALOG_REFRESH_ENABLED=0` 后改用最近磁盘缓存或内置快照。Windows 安装版固定禁用刷新，但用户选择托管免费模型时仍会把答疑请求发送到其 LLM API 地址。

2026-07-19 内置快照如下；在线目录变化后会自动增删托管项：

| 显示名 | 协议 | 设置中的“支持图片识别” |
|---|---|---:|
| `opencodefree-big-pickle` | OpenAI-compatible | 否 |
| `opencodefree-deepseek-v4-flash-free` | OpenAI-compatible | 否 |
| `opencodefree-mimo-v2.5-free` | OpenAI-compatible | 是 |
| `opencodefree-north-mini-code-free` | OpenAI-compatible | 否 |
| `opencodefree-nemotron-3-ultra-free` | OpenAI-compatible | 否 |

同步会复用已有托管 profile ID，避免 session 外键漂移；退出免费目录的 profile 只会从新建会话列表隐藏，历史 SQLite 行仍保留。公共值 `public` 也按普通 API key 加密保存，前端只能看到掩码。

OpenCode 官方说明这些免费端点中的部分请求可能被记录并用于改进模型；North Mini Code 与 Nemotron 还明确不应接收个人或机密数据。模型设置弹窗会提示不要向免费模型提交个人或敏感信息。

按钮：

1. “并行测试”：不保存；同一供应商配置中的 model name 最多四项同时测试，每项先发短文本验证连通性，再发送后端即时生成的两组随机颜色/图形挑战。先完成的行先显示结果；只有模型返回与图片一致的顺序才算图片探测成功，仅接受图片参数、忽略图片后返回 `OK` 或其他文字不算通过。
2. 未勾选多模态时，图片内容识别正确会自动勾选；图片探测失败但文本连接成功时仍作为文本模型通过。若用户已手动勾选多模态，图片探测失败则该模型测试失败并取消多模态勾选，避免继续误存为图片模型。
3. 新增时“保存 N 个模型”：后端以一个事务创建所有 profile，并默认选中第一项。
4. 编辑时“保存修改”：更新当前具体 profile 并保持选中。

安全要求：

1. 前端不把 API key 存到 localStorage、sessionStorage、IndexedDB。
2. 前端不在日志里打印 API key。
3. 保存后再次打开编辑弹窗时，API key 输入框保持空白；留空会沿用已加密保存的 key，模型列表 API 只返回掩码。
4. 修改 key 时只能重新输入完整 key，不能读取旧 key 明文。

## 5. 后端 API

### 5.1 获取模型列表

```http
GET /api/model-profiles
```

响应：

```json
{
  "profiles": [
    {
      "id": "prof_01hxyz",
      "display_name": "我的豆包模型",
      "provider": "openai_compatible",
      "base_url": "https://example-provider.com/v1",
      "base_url_host": "example-provider.com",
      "model": "provider-model-name",
      "tags": ["国内低延迟"],
      "status": "available",
      "key_state": "saved",
      "masked_api_key": "****...abcd",
      "timeout_ms": 30000,
      "temperature": 0.2,
      "max_output_tokens": 8000,
      "is_multimodal": false,
      "managed": false,
      "last_test_status": null,
      "last_test_latency_ms": 1280
    }
  ],
  "require_user_selection": true
}
```

当前实现会返回完整 `base_url` 供编辑，并额外返回 `base_url_host` 供简洁展示；永远不返回明文 API key。不要把密钥放进 URL 查询参数。

`managed=true` 表示该 profile 由 OpenCode 免费目录维护；对它调用 PATCH 或 DELETE 会返回 `409`。

### 5.2 测试模型连接

```http
POST /api/model-profiles/test
```

请求：

```json
{
  "provider": "openai_compatible",
  "base_url": "https://example-provider.com/v1",
  "api_key": "user-pasted-api-key",
  "model": "provider-model-name",
  "probe_multimodal": true,
  "require_multimodal": false
}
```

响应：

```json
{
  "ok": true,
  "latency_ms": 1280,
  "message": "连接成功；图片探测通过",
  "multimodal_ok": true,
  "multimodal_latency_ms": 1520,
  "multimodal_message": "图片内容识别正确"
}
```

`latency_ms` 记录文本测试从发起请求到收到第一个非空可见文本 chunk 的首字延迟（TTFT），不等待完整回复结束。前端传 `probe_multimodal=true` 时，后端会即时生成两个随机排列的 PNG 视觉挑战作为 `image_url` 再请求一次，并校验完整回复中的颜色、形状和顺序；图片探测的 `max_tokens` 沿用模型配置并保证至少 1024、最多 8192，避免推理模型在输出可见答案前被原先固定的 128 token 截断。`require_multimodal=true` 表示图片探测失败应让整项测试失败。

文本和图片探测都使用极短 prompt，避免明显成本。随机挑战图只含纯色几何图形，不含用户数据、API key 或业务题目。

编辑已有配置时可同时提交 `profile_id` 并省略 `api_key`，后端会使用已加密保存的 key 完成测试。

### 5.3 批量新增同一供应商的模型

```http
POST /api/model-profiles/batch
```

请求中的供应商字段只写一次，每个 model name 独立携带多模态标记：

```json
{
  "display_name": "火山方舟",
  "provider": "openai_compatible",
  "base_url": "https://example-provider.com/v1",
  "api_key": "user-pasted-api-key",
  "models": [
    {"model": "text-model", "is_multimodal": false},
    {"model": "vision-model", "is_multimodal": true}
  ],
  "tags": ["math"],
  "timeout_ms": 30000,
  "temperature": 0.2,
  "max_output_tokens": 8000
}
```

后端在同一 SQLite 事务里创建多个 `model_profiles` 行；任一写入失败时整批回滚。各行共享供应商名称、URL、运行参数和同一 API key 的加密值，但拥有独立 ID、model name、多模态标记和测试状态。

### 5.4 单个新增模型配置（兼容接口）

```http
POST /api/model-profiles
```

请求：

```json
{
  "display_name": "我的豆包模型",
  "provider": "openai_compatible",
  "base_url": "https://example-provider.com/v1",
  "api_key": "user-pasted-api-key",
  "model": "provider-model-name",
  "tags": ["国内低延迟"],
  "timeout_ms": 30000,
  "temperature": 0.2,
  "max_output_tokens": 8000,
  "is_multimodal": false
}
```

响应：

```json
{
  "id": "prof_01hxyz",
  "display_name": "我的豆包模型",
  "status": "available",
  "masked_api_key": "****...abcd"
}
```

### 5.5 更新模型配置

```http
PATCH /api/model-profiles/{profile_id}
```

允许修改：

1. `display_name`
2. `provider`
3. `base_url`
4. `model`
5. `tags`
6. `timeout_ms`
7. `temperature`
8. `max_output_tokens`
9. `is_multimodal`，是否支持图片识别
10. `api_key`，仅在用户重新输入时替换

### 5.6 删除模型配置

```http
DELETE /api/model-profiles/{profile_id}
```

删除规则：

1. 当前实现始终软删除：写入 `enabled = false` 和 `deleted_at`，不硬删除数据库行。
2. 新建答疑时不再展示已删除模型。
3. 历史日志仍保留 `model_profile_id`、`provider`、`model` 等非密钥信息。

## 6. SQLite 表设计

下面是字段概览；可执行 schema 以 `apps/api/migrations/versions/` 的 Alembic revision 为准。`sessions.model_profile_id` 外键使用 `ON DELETE RESTRICT`，而配置删除接口只做软删除，因此历史 session 仍能稳定引用原 profile。迁移与 Windows SQLite 运行说明见 `docs/database.md`。

```sql
CREATE TABLE model_profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key_ciphertext TEXT NOT NULL,
  api_key_mask TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  deleted_at TEXT,
  last_test_status TEXT,
  last_test_latency_ms INTEGER,
  timeout_ms INTEGER NOT NULL DEFAULT 30000 CHECK (timeout_ms > 0),
  temperature REAL NOT NULL DEFAULT 0.2,
  max_output_tokens INTEGER NOT NULL DEFAULT 8000 CHECK (max_output_tokens > 0),
  is_multimodal INTEGER NOT NULL DEFAULT 0 CHECK (is_multimodal IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## 7. 加密方案

MVP 推荐：

1. 首次启动时生成 `data/app-secret.key`。
2. 使用该 key 加密 API key 后写入 SQLite。
3. `data/` 整个目录加入 `.gitignore`。
4. 日志和 API 响应中永远不输出明文 key。

更稳的后续方案：

1. Windows Credential Manager。
2. macOS Keychain。
3. 云厂商 Secret Manager。
4. KMS + 数据库密文字段。

## 8. 配置预设

`config/model-profiles.example.json` 只用于提供 UI 预设，不保存真实 key。

示例：

```json
{
  "require_user_selection": true,
  "allow_user_added_profiles": true,
  "presets": [
    {
      "id": "openai_compatible_custom",
      "display_name": "OpenAI Compatible",
      "provider": "openai_compatible",
      "base_url_placeholder": "https://example-provider.com/v1",
      "model_placeholder": "provider-model-name",
      "tags": ["自定义"]
    }
  ]
}
```

## 9. 答疑会话绑定模型

创建 session 时必须提交：

```json
{
  "model_profile_id": "prof_01hxyz"
}
```

会话创建后：

1. 本 session 锁定这个模型。
2. 后续所有 LLM 调用都使用这个 profile。
3. 日志记录 `model_profile_id`、`provider`、`model`。
4. 不记录 API key。

这样后面做实验分析时，能区分“产品逻辑问题”和“某个模型能力/延迟问题”。
