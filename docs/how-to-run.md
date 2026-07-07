# 本地启动与关闭

## 启动

双击：

```txt
scripts/start-dev.cmd
```

它会打开两个常驻窗口：

1. `ai4edu-api`：后端 FastAPI，地址 `http://127.0.0.1:8010`
2. `ai4edu-web`：前端 Next.js，地址 `http://127.0.0.1:3000`

等 `ai4edu-web` 窗口里出现 `Ready` 后，打开：

```txt
http://127.0.0.1:3000
```

如果窗口提示：

```txt
Port 8010 is already in use
Port 3000 is already in use
```

通常说明项目已经启动了，不需要再启动一遍。直接打开：

```txt
http://127.0.0.1:3000
```

如果你想重新启动，先双击 `scripts/stop-dev.cmd`，再双击 `scripts/start-dev.cmd`。

## 关闭

推荐方式：

```txt
双击 scripts/stop-dev.cmd
```

它会关闭本项目占用的两个端口：

1. `3000`
2. `8010`

也可以直接关闭 `ai4edu-api` 和 `ai4edu-web` 两个窗口，或在窗口里按 `Ctrl+C`。

## 查看某个 Session 的过程

如果页面右侧显示 session id，例如：

```txt
sess_c4052d2538a6
```

打开命令行，进入项目目录：

```bat
cd /d C:\Users\robbinpanda\Desktop\ai4edu\产品验证
```

查看最近 10 个 session：

```bat
scripts\inspect-session.cmd
```

查看某一个 session 的完整过程：

```bat
scripts\inspect-session.cmd sess_c4052d2538a6
```

你重点看三张表：

1. `sessions`：当前阶段、题目、模型。
2. `messages`：学生消息、AI 回复、检查点选择记录。
3. `checkpoints`：每个检查点的问题、选项、正确答案、学生选择。

如果某个检查点后只有 `student_checkpoint`，没有新的 `assistant`，说明“检查点答案已经提交成功，但下一轮 AI 回复没有成功写入”。这通常是模型请求/网络卡住，或 `/api/chat/stream` 没有完成。

## 为什么之前会闪退

之前的 `start-dev.cmd` 是后台启动脚本，双击后主窗口会立刻结束，所以看起来像闪退。现在已经改成双击友好模式，会打开两个可见服务窗口。

`run-api.cmd` 和 `run-web.cmd` 是单独启动某一个服务用的脚本。现在如果服务启动失败，窗口也会停住并显示错误。
