# 模型配置

本文描述当前模型接入合同。应用不提供预设模型、在线模型目录或公共 API 凭据；除本地演示外，用户必须自行填写供应商类型、Base URL、model name 和 API key。

## 1. 支持的协议

| 供应商类型 | 协议 | Base URL 示例 |
|---|---|---|
| `openai` | OpenAI Responses | `https://api.openai.com/v1` |
| `openai_compatible` | OpenAI-compatible Chat Completions | 由用户的供应商提供 |
| `anthropic` | Anthropic Messages | `https://api.anthropic.com/v1` |
| `local_demo` | 仅用于离线界面和教学流程演示 | `local://demo` |

应用不会按供应商名称或模型名称推荐、补全或自动创建 profile。第三方服务的可用性、计费、数据处理条款和 API 合法使用责任由用户与对应供应商确认。

## 2. 存储与安全

SQLite 的 `model_profiles` 是模型配置的权威来源。每个 profile 保存：

- 显示名称、协议类型、Base URL 和 model name；
- 加密后的 API key 及只用于界面显示的掩码；
- timeout、temperature、max output tokens；
- 图片能力与实测可用的推理档位；
- 最近一次连接测试状态和延迟。

API key 只提交到后端，由本机 `APP_SECRET_PATH` 指向的密钥加密后写入 SQLite。列表接口不返回明文密钥，前端持久化、诊断日志和 Git 均不得保存 API key。编辑现有 profile 时，API key 留空表示继续使用原密钥。

## 3. 添加与编辑

模型设置入口支持一套供应商配置批量添加最多 20 个 model name。除 `local_demo` 外，保存新配置前必须填写：

1. 供应商显示名称；
2. 供应商协议类型；
3. Base URL；
4. API key；
5. 至少一个 model name。

创建后的模型统一显示为“供应商名称 · model name”。所有 profile 都由用户管理，可编辑、测试和软删除；批量删除一次最多 20 项。活动会话期间前端禁止删除模型，数据库外键继续保护被历史 session 引用的 profile 记录。

## 4. 能力测试

`POST /api/model-profiles/test` 使用当前表单中的协议、URL、密钥和 model name 发起最小请求。测试会：

- 并发探测 `none / low / high` 推理档位；
- 只保留实际成功的档位；
- 在请求图片探测时验证模型是否真的识别随机图片挑战；
- 返回状态、消息、延迟、推理档位和图片能力。

跳过测试时默认保留协议支持的三个推理档位。图片能力默认关闭，只有用户明确勾选或图片测试成功后才开启。测试成功不代表供应商长期可用，也不替代用户核对服务条款和费用。

## 5. HTTP 合同

### 列表

`GET /api/model-profiles`

返回启用且未删除的 profile。响应包含掩码密钥和运行参数，不包含明文 API key。

### 单个创建

`POST /api/model-profiles`

请求示例：

```json
{
  "display_name": "我的供应商",
  "provider": "openai_compatible",
  "base_url": "https://provider.example/v1",
  "api_key": "用户自己的密钥",
  "model": "model-name",
  "tags": ["math"],
  "timeout_ms": 30000,
  "temperature": 0.2,
  "max_output_tokens": 8000,
  "is_multimodal": false
}
```

### 批量创建

`POST /api/model-profiles/batch`

共享供应商、URL、密钥和运行参数，每个 `models[]` 项单独提供 model name、图片能力和可选推理档位。

### 编辑与删除

- `PATCH /api/model-profiles/{profile_id}`：编辑配置；省略 API key 表示保留原密钥。
- `PATCH /api/model-profiles/{profile_id}/reasoning`：更新该 profile 的推理档位。
- `DELETE /api/model-profiles/{profile_id}`：软删除单项。
- `POST /api/model-profiles/batch-delete`：在同一事务中批量校验并软删除。

## 6. 会话绑定

新建 session 必须引用当前可用的 `model_profile_id`。包含题图的 session 必须绑定 `is_multimodal=true` 的 profile，并保留原始 `problem_image_data_url` 供后续每轮调用。session 创建后继续引用同一个 profile，避免教学过程中静默切换协议或模型。

正式答疑、文字拆题、题图检测和模型测试都通过统一 provider 适配层发送请求：

- OpenAI Responses 使用 `reasoning.effort`；
- OpenAI-compatible Chat Completions 使用顶层 `reasoning_effort`；
- Anthropic Messages 使用 `output_config.effort`。

适配层不按 Host 或模型名猜测私有参数，也不使用提示词模拟供应商推理开关。

## 7. 部署约束

源码、Docker 和 Windows 安装版都以空模型列表启动，安装包构建流程不会嵌入 profile、API key 或模型目录。用户第一次开始答疑前需在模型设置中添加自己的配置。模型 API 的外网访问仅由用户主动测试或实际调用触发。
