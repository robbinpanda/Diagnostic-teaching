# 诊断式数学答疑

> Windows 优先、数据留在本机的诊断式数学答疑应用：先找到学生真正卡住的地方，再提问、讲解、检查和总结。

[![版本](https://img.shields.io/badge/版本-0.6.0-4c7dff)](https://github.com/robbinpanda/Diagnostic-teaching/releases/tag/v0.6.0)
[![平台](https://img.shields.io/badge/平台-Windows-0078d4)](https://github.com/robbinpanda/Diagnostic-teaching/releases)
[![存储](https://img.shields.io/badge/存储-SQLite-0f80cc)](./docs/database.md)
[![Docker](https://img.shields.io/badge/Docker-可用-2496ed)](./compose.local.yml)

前端使用 Next.js，后端使用 FastAPI。SQLite 保存可恢复业务状态，JSONL/Markdown 只记录诊断信息。Windows 安装版、源码模式和 Docker 共用同一套教学协议与数据结构。

## 主要能力

- 文字单题/多题拆分，以及 PNG/JPEG/WebP 题图检测、框选、裁剪和批量建会话。
- 六种受约束的教学动作：追问、诊断选择题、局部讲解、原理讲解、检查点反馈和总结。
- 用户自行配置的 OpenAI Responses、OpenAI-compatible Chat Completions 与 Anthropic Messages 模型；应用不提供预设模型或公共 API 凭据。
- 可恢复的多会话并发、持久化 run、中断、幂等输入和 durable event 重放。
- 知识卡片、题目卡片、试卷归档、错题卡片库、错题集及双列 PDF/练习模式。
- 本地 SenseVoiceSmall 语音输入、SQLite 历史恢复和逐 session 诊断日志。

完整能力边界和端到端数据流见 [系统总览](./docs/system-overview.md)。

## 快速开始

### Windows 安装版

普通用户可从 [GitHub Releases](https://github.com/robbinpanda/Diagnostic-teaching/releases/latest) 下载 `Diagnostic-Teaching-Setup-0.6.0-x64.exe`。安装版包含前后端、Python 运行时和语音依赖，不要求另装 Node.js、Python、Conda 或 SQLite。

> 0.5.0 引入的一次性旧数据清理合同仍然有效；已经运行过 0.5.0 的用户升级到 0.6.0 不会再次清理。安装包尚未商业签名，SmartScreen 可能提示“未知发布者”。详见 [Windows 安装说明](./docs/windows-installer.md)。

### 源码模式

要求 Windows、Miniconda/Anaconda、Node.js 20+ 和 npm：

```powershell
git clone https://github.com/robbinpanda/Diagnostic-teaching.git
cd Diagnostic-teaching
git switch main
conda create -n ai4edu-tutor python=3.11 -y
conda run -n ai4edu-tutor python scripts/install-python-deps.py dev
npm --prefix apps/web install
.\scripts\start-dev.cmd
```

浏览器打开 <http://127.0.0.1:3000>。启动、关闭、环境变量、语音与故障排查见 [本地运行指南](./docs/how-to-run.md)。

后端核心依赖由 `apps/api/requirements-core.in` 声明、由带哈希的 `requirements-core.txt` 锁定。核心、语音与开发工具必须由 `scripts/install-python-deps.py` 分成独立 pip 调用安装，不能把无哈希的可选层与核心锁放进同一次解析。更新直接依赖时，先安装 `apps/api/requirements-lock.txt` 中固定版本的锁定工具，再运行 `scripts\lock-python-deps.cmd`；不要手工编辑生成的锁文件。

### Docker

不需要本地语音时使用轻量版：

```powershell
docker compose -f compose.local.yml up -d --build
```

需要 CPU 语音识别时叠加语音配置：

```powershell
docker compose -f compose.local.yml -f compose.speech.yml up -d --build
```

Docker 默认只监听本机 `127.0.0.1:3000`。当前 API 不提供用户认证，不应把端口改为全网卡绑定或直接暴露到局域网/公网。

## 核心逻辑

一轮正式答疑遵循以下稳定边界：

1. 文字或题图先拆成一题一个 session；拆题只决定 session 数量，不决定教学动作。
2. 学生输入先以稳定幂等键写入 `session_inputs` 和 `messages`，再启动生成。
3. `session_runs` 串行管理同一 session 的生成生命周期，不同 session 可以并行。
4. 模型返回 `TutorTurn`；后端校验 action、上下文和附属卡片，并推导 `wait_for_student`。
5. 完整 action、卡片/checkpoint 副作用和 durable events 在 SQLite 事务中提交；未完整解析的流式半成品不进入历史。

只有以下六种教学 action：

| action | 职责 | 是否等待学生 |
|---|---|---|
| `ASK_OPEN_QUESTION` | 获取不能由选项替代的学生证据 | 是 |
| `ASK_MULTIPLE_CHOICE` | 用三个诊断选项定位理解或误区 | 是 |
| `EXPLAIN_LOCAL` | 只修复一个具体步骤或局部连接 | 否 |
| `EXPLAIN_PRINCIPLE` | 只讲一个可迁移原理 | 否 |
| `RESPOND_TO_CHECKPOINT` | 对检查点结果提供简短反馈 | 否 |
| `SUMMARIZE` | 在目标确已处理后收束并生成题目卡 | 否 |

状态机、上下文、恢复、事件与数据库合同分别见 [教学状态机](./docs/state-machine.md)、[上下文管理](./docs/context-management.md)、[Session 事件](./docs/session-events.md) 和 [数据库](./docs/database.md)。

## 仓库结构

```text
apps/api/       FastAPI、教学控制、模型适配、SQLite 仓储与迁移
apps/web/       Next.js 工作台、前端状态机、流控制和打印视图
config/         内置模型配置
docs/           当前架构、运行手册、接口合同与历史记录
scripts/        Windows 开发、诊断和打包脚本
data/           本地 SQLite 与加密密钥（Git 忽略）
logs/           JSONL/Markdown 诊断日志（Git 忽略）
runtime/        Docker 持久化数据与模型缓存（Git 忽略）
```

产品边界见 [PRODUCT.md](./PRODUCT.md)，当前视觉与交互合同见 [DESIGN.md](./DESIGN.md)。文档导航见 [docs/README.md](./docs/README.md)。

## 开发验证

后端：

```powershell
cd apps/api
python -m ruff check .
python -m pytest -q
```

前端：

```powershell
cd apps/web
npm run lint
npm run typecheck
npm test
```

涉及构建、路由、样式合同或发布时，再运行 `npm run build`。修改 action、API、环境变量或数据表时，必须同步更新对应现行文档；重要行为变化记录到 [docs/changelog.md](./docs/changelog.md)。

## 数据与密钥

SQLite 是 session 恢复的唯一权威来源。`logs/sessions/` 下的 JSONL 与 Markdown 都是只追加诊断日志，不能用于业务恢复。模型 API key 只在后端加密保存，不应进入前端持久化、日志或 Git。
