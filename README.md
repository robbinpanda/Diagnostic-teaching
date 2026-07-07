# Diagnostic Teaching MVP

诊断式数学答疑 MVP：面向初高中数学题，先诊断学生卡点，再用讲解和检查点选择题推进。

## 本地启动

双击：

```txt
scripts/start-dev.cmd
```

打开：

```txt
http://127.0.0.1:3000
```

关闭：

```txt
scripts/stop-dev.cmd
```

更详细说明见：

```txt
docs/how-to-run.md
```

## 技术栈

- Frontend: Next.js + React + TypeScript
- Backend: FastAPI
- Database: SQLite
- Model API: OpenAI-compatible chat completions

## 目录

```txt
apps/api   FastAPI 后端
apps/web   Next.js 前端
docs       文档
scripts    Windows 启动、关闭、调试脚本
config     模型配置预设示例
```

## 注意

本地运行数据、日志和 API key 加密文件不会提交到 Git：

```txt
data/
logs/
apps/web/node_modules/
apps/web/.next/
```
