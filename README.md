# 诊断式数学答疑

> Windows 优先、数据留在本机的数学答疑产品：先定位学生真正卡住的地方，再提问、讲解、检查和总结。

[![版本](https://img.shields.io/badge/版本-0.1.0-4c7dff)](https://github.com/robbinpanda/Diagnostic-teaching/releases/tag/v0.1.0)
[![平台](https://img.shields.io/badge/平台-Windows-0078d4)](https://github.com/robbinpanda/Diagnostic-teaching/releases)
[![存储](https://img.shields.io/badge/存储-SQLite-0f80cc)](./docs/database.md)
[![Docker](https://img.shields.io/badge/Docker-可用-2496ed)](./compose.local.yml)

同一套教学核心提供 Windows 安装版、源码模式和 Docker 三种运行方式。它们共用六类教学动作、SQLite 数据结构和恢复机制。

## 三种快速开始

### 方式一：Windows 安装版（推荐普通用户）

1. 从 [GitHub Releases](https://github.com/robbinpanda/Diagnostic-teaching/releases/latest) 下载 `Diagnostic-Teaching-Setup-0.1.0-x64.exe`。
2. 双击安装并启动“诊断式数学答疑”。
3. 添加模型服务，或选择本地演示模式体验流程。

安装版已包含前后端、Python 运行时和语音识别依赖，不要求另装 Node.js、Python、Conda 或 SQLite。SenseVoice 模型在第一次使用麦克风时下载，之后从本机缓存加载。

安装包当前未做商业代码签名，Windows SmartScreen 可能显示“未知发布者”。请确认下载来源为本仓库 Release。数据默认保存在 `%APPDATA%\DiagnosticTeaching`，卸载应用不会自动删除会话。

### 方式二：本地命令行（推荐开发者）

需要 Windows、Miniconda/Anaconda、Node.js 20+ 和 npm。

```powershell
git clone https://github.com/robbinpanda/Diagnostic-teaching.git
cd Diagnostic-teaching
git switch dev/local
conda create -n ai4edu-tutor python=3.11 -y
conda run -n ai4edu-tutor python -m pip install -r apps/api/requirements-dev.txt
npm --prefix apps/web install
.\scripts\start-dev.cmd
```

打开 <http://127.0.0.1:3000>。关闭服务：

```powershell
.\scripts\stop-dev.cmd
```

需要自定义 SQLite、密钥或日志目录时，先执行 `Copy-Item .env.example .env`。完整说明见 [本地运行指南](./docs/how-to-run.md)。

### 方式三：Docker

需要 Docker Desktop，建议使用 WSL2 后端。

轻量核心版不安装语音依赖：

```powershell
git clone https://github.com/robbinpanda/Diagnostic-teaching.git
cd Diagnostic-teaching
git switch dev/local
docker compose -f compose.local.yml up -d --build
```

打开 <http://127.0.0.1:3000>。查看状态：

```powershell
docker compose -f compose.local.yml ps
docker compose -f compose.local.yml logs -f app
```

需要本地语音识别时，改用 CPU 语音版：

```powershell
docker compose -f compose.local.yml -f compose.speech.yml up -d --build
```

停止服务：

```powershell
docker compose -f compose.local.yml -f compose.speech.yml down
```

核心镜像实测约 81 MiB，CPU 语音镜像约 711 MiB。语音版只安装 CPU 版 `torch/torchaudio`，不包含 NVIDIA/CUDA 运行时；模型缓存位于 `runtime/models/`。

## 为什么不是普通聊天机器人

普通问答容易直接给答案，却不一定知道学生卡在哪。本项目把教学过程约束为六种动作：

- `ASK_OPEN_QUESTION`：追问缺失信息或学生思路。
- `ASK_MULTIPLE_CHOICE`：用选择题检查关键理解。
- `EXPLAIN_LOCAL`：只修复当前局部卡点。
- `EXPLAIN_PRINCIPLE`：讲清可迁移的原理并生成知识卡片。
- `RESPOND_TO_CHECKPOINT`：针对检查结果反馈。
- `SUMMARIZE`：收束方法、步骤与易错点并生成题目卡片。

模型决定下一步教学动作，后端负责合同校验、等待规则、原子写入、幂等控制和失败兜底。`wait_for_student` 始终由后端按动作推导，不能交给模型自由决定。

## 主要能力

- 文字、图片和本地语音输入；文字/图片多题可拆成独立会话。
- OpenAI-compatible 与 Anthropic Messages 双协议，API key 仅在后端加密保存。
- `none / low / high` 推理强度逐模型探测，不按模型名称猜能力。
- 检查点选择题、知识卡片、题目卡片、文件夹管理和 PDF 导出。
- KaTeX 数学公式、初中/高中教学口径、多会话并行生成。
- SQLite 历史恢复、严格幂等输入、可查询/中断的生成生命周期。
- 刷新页面后恢复未完成请求；已接纳输入不会因断流或刷新丢失。

## 数据可靠性

SQLite 是会话恢复的唯一权威来源。普通消息、检查点答案和卡片继续命令会先以稳定幂等键写入 `session_inputs`，再开始生成；同一会话的生成由 `session_runs` 串行管理。浏览器刷新后，前端会恢复未完成请求并与后端已接纳状态对账。

| 运行方式 | SQLite 与密钥 | 诊断日志 | 模型缓存 |
|---|---|---|---|
| 源码 | `data/` | `logs/sessions/` | 系统默认缓存 |
| Docker | `runtime/data/` | `runtime/logs/` | `runtime/models/`（语音版） |
| 安装版 | `%APPDATA%\DiagnosticTeaching\data\` | `%APPDATA%\DiagnosticTeaching\session-logs\` | 用户缓存目录 |

JSONL 和 Markdown 日志只用于诊断，不参与业务恢复。数据库约束、WAL 和备份说明见 [SQLite 说明](./docs/database.md)。

## 架构与目录

```text
浏览器 / Electron
        │
        ▼
Next.js 界面 ── FastAPI ── 教学合同与运行协调器
                            │
               ┌────────────┼────────────┐
               ▼            ▼            ▼
            SQLite       模型 API     SenseVoice
          权威业务态      流式生成      本地语音
```

```text
apps/api/                 FastAPI、教学核心、SQLite、语音识别
apps/web/                 Next.js、会话工作台、卡片与恢复逻辑
apps/desktop/             Electron Windows 桌面壳
docs/                     现行设计、运行和存储文档
scripts/                  Windows 启停、诊断和安装器构建脚本
Dockerfile                核心版/语音版多阶段镜像
compose.local.yml         默认轻量部署
compose.speech.yml        CPU 语音扩展
```

## 配置模型

打开页面右上角模型设置，可添加：

- OpenAI-compatible：填写 Base URL、API key 和 model name。
- Anthropic Messages：选择 Anthropic 协议后填写对应地址、密钥和模型。
- 本地演示：无需 Base URL 与 API key，用于离线体验流程，不代表真实模型质量。

题图会发送给所选多模态模型；API key 不会进入前端持久化、诊断日志或 Git。仓库不附带任何个人密钥。

## 开发与验证

```powershell
cd apps\api
python -m ruff check .
python -m pytest -q
cd ..\web
npm run lint
npm run typecheck
npm test
npm run build
```

构建 Windows 0.1.0 安装包：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-windows-installer.ps1
```

产物位于 `dist/windows/installer/`。构建要求与发布检查见 [Windows 安装包说明](./docs/windows-installer.md)。

## 深入阅读

- [教学状态机与动作合同](./docs/state-machine.md)
- [上下文、幂等与恢复](./docs/context-management.md)
- [SQLite 与迁移](./docs/database.md)
- [Session 事件协议](./docs/session-events.md)
- [本地运行与排错](./docs/how-to-run.md)
- [变更记录](./docs/changelog.md)

早期设计文档仅作历史参考；行为冲突时，以现行代码、测试和上述现行文档为准。
