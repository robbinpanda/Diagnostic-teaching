# Windows 安装包

当前发布版本为 0.1.0，面向 Windows 10/11 x64。终端用户只需运行 `Diagnostic-Teaching-Setup-0.1.0-x64.exe`，不需要另装 Node.js、Python、Conda、SQLite 或浏览器运行时。

## 用户安装

从 [GitHub Releases](https://github.com/robbinpanda/Diagnostic-teaching/releases/latest) 下载安装包，双击后选择目录并完成安装。NSIS 默认按当前用户安装，不要求管理员权限，并创建桌面与开始菜单快捷方式。

当前安装包约 341 MiB，安装后约占 1.5 GiB；SenseVoiceSmall 和 FSMN-VAD 不随包分发，第一次使用麦克风时才下载到用户缓存。应用数据位于：

```text
%APPDATA%\DiagnosticTeaching\data\app.db
%APPDATA%\DiagnosticTeaching\data\app-secret.key
%APPDATA%\DiagnosticTeaching\data\bundled-model-seed-state.json
%APPDATA%\DiagnosticTeaching\session-logs\
%APPDATA%\DiagnosticTeaching\logs\desktop.log
```

覆盖安装会保留 SQLite 会话、卡片和用户模型配置。卸载默认也保留上述数据，避免误删；需要彻底清理时，在确认不再需要历史数据后手工删除该目录。

## 安装版架构

1. Electron 负责单实例窗口、随机本机端口、麦克风权限边界和 sidecar 生命周期。
2. PyInstaller `onedir` sidecar 包含 FastAPI、Python 运行时、Alembic migrations、FunASR 和 CPU 版语音依赖。
3. Next.js 静态导出由 FastAPI 同源提供，生产前端不需要独立 Node 服务。

桌面窗口启用 Chromium sandbox、关闭 Node 集成和开发者工具，拒绝外部导航、弹窗、摄像头和其他权限；只允许当前本机应用页面申请纯音频麦克风。API key 只在后端加密存储，不进入前端持久化或桌面日志。

桌面版固定关闭 OpenCode 公共目录的后台刷新。外网访问只会发生在用户主动测试/调用模型，或第一次下载 SenseVoice/FSMN-VAD 时。

## 构建环境

- Windows x64；
- Node.js 20 或更高版本；
- Python 3.11—3.13；
- npm 和 pnpm；
- 至少 8 GiB 可用内存和约 8 GiB 临时磁盘空间。

在仓库根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-windows-installer.ps1
```

指定运行时：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-windows-installer.ps1 `
  -NodePath C:\path\to\node.exe `
  -PythonPath C:\path\to\python.exe
```

依赖已经准备好时可增加 `-SkipDependencyInstall`。脚本依次完成：

1. 创建隔离 Python 构建环境；
2. 构建 Next.js 静态前端；
3. 构建 PyInstaller sidecar；
4. 用 Electron Builder 生成 NSIS 安装包。

产物：

```text
dist/windows/api/                                      PyInstaller sidecar
dist/windows/seed/                                     可选加密模型预置
dist/windows/installer/win-unpacked/                   未安装检查目录
dist/windows/installer/Diagnostic-Teaching-Setup-*.exe NSIS 安装包
```

## 可选模型预置

默认构建不携带任何个人模型或 API key。需要制作内部预置包时，把示例复制到 Git 忽略目录并只在本机构建：

```powershell
Copy-Item docs\windows-model-profiles.example.json .secrets\windows-model-profiles.json
powershell -ExecutionPolicy Bypass -File scripts\build-windows-installer.ps1 `
  -ModelProfileSeedPath .secrets\windows-model-profiles.json
```

构建脚本会测试文字连接和图片能力，把密钥加密写入随包 SQLite；明文 JSON 不会复制到 `dist/`。也可通过 `-ModelProfileSeedBundlePath` 复用已验证的 `app.db + app-secret.key`，两个预置参数互斥。

只有在明确接受某个模型当前不可用时才使用 `-AllowUnavailableModelProfiles`。证书、个人密钥、明文预置和构建缓存都不能提交到 Git。

## 发布门禁

发布前至少完成：

1. 校验安装包文件名、版本、大小和 SHA-256。
2. 静默或交互安装到干净目录，确认主程序版本为 0.1.0。
3. 启动桌面应用，从日志解析随机端口并请求 `/api/health`。
4. 请求 `/api/speech/status`，确认语音依赖可用且模型按需加载。
5. 新建本地演示会话，刷新页面并确认输入与消息恢复且没有重复记录。
6. 测试真实模型、显式停止、题图上传、麦克风输入和卡片导出。
7. 正常退出，确认 Electron 会请求 sidecar 关闭而不是留下后台进程。
8. 在干净 Windows 10 x64 和 Windows 11 x64 环境复测安装、覆盖安装和卸载保留数据。

## 代码签名

本地构建默认未签名，Windows SmartScreen 可能显示“未知发布者”。正式公开分发前应配置受信任的 Windows 代码签名证书，让 Electron 主程序、PyInstaller sidecar 和 NSIS 安装包都进入签名流程。证书不得提交到仓库。
