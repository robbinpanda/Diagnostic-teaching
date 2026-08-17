# Windows 安装包

当前发布版本为 0.6.1，面向 Windows 10/11 x64。终端用户只需运行 `Diagnostic-Teaching-Setup-0.6.1-x64.exe`，不需要另装 Node.js、Python、Conda、SQLite 或浏览器运行时。Electron Builder 沿用相同 `appId` 和 GUID 执行正常覆盖升级。

## 用户安装

从 [GitHub Releases](https://github.com/robbinpanda/Diagnostic-teaching/releases/latest) 下载安装包，双击后选择目录并完成安装。NSIS 默认按当前用户安装，不要求管理员权限，并创建桌面与开始菜单快捷方式。

当前安装包约 341 MiB，安装后约占 1.5 GiB；SenseVoiceSmall 和 FSMN-VAD 不随包分发，第一次使用麦克风时才下载到用户缓存。应用数据位于：

```text
%APPDATA%\DiagnosticTeaching\data\app.db
%APPDATA%\DiagnosticTeaching\data\app-secret.key
%APPDATA%\DiagnosticTeaching\session-logs\
%APPDATA%\DiagnosticTeaching\logs\desktop.log
```

**破坏性升级合同：**第一次安装 0.5.0 会在 NSIS 安装阶段递归删除整个 `%APPDATA%\DiagnosticTeaching`。SQLite 主库、`-wal`、`-shm`、加密主密钥、会话、卡片、模型配置、Electron 本地状态和诊断日志都会永久清除，无法恢复；需要保留时必须在安装前备份。

清理失败时安装器会中止，避免新程序继续读取残留旧库。清理成功后写入 `.data-reset-v0.5.0` 标记；Electron 首次启动执行同一合同的兜底检查，然后创建全新的 SQLite 和密钥。

该标记保证修复安装或重复安装同一个 0.5.0 时不会再次删除 0.5.0 产生的新数据。标记被手工删除或损坏时，下一次启动会按未完成迁移处理并重新清理。

单独卸载 0.5.0 仍保留当前数据；本次强制清理只属于 0.5.0 的一次性升级迁移。

## 安装版架构

1. Electron 负责单实例窗口、随机本机端口、麦克风权限边界和 sidecar 生命周期。
2. PyInstaller `onedir` sidecar 包含 FastAPI、Python 运行时、Alembic migrations、FunASR 和 CPU 版语音依赖。
3. Next.js 静态导出由 FastAPI 同源提供，生产前端不需要独立 Node 服务。

桌面窗口启用 Chromium sandbox、关闭 Node 集成和开发者工具，拒绝外部导航、弹窗、摄像头和其他权限；只允许当前本机应用页面申请纯音频麦克风。API key 只在后端加密存储，不进入前端持久化或桌面日志。

安装包不携带模型目录、预设模型或公共 API 凭据。模型相关外网访问只会发生在用户主动测试或调用自己配置的 API；SenseVoice/FSMN-VAD 会在第一次使用语音时下载。
NSIS 的 `customInstall` 宏和 Electron 的 `resetLegacyUserData()` 使用同一版本标记。两处都把清理范围固定为 `%APPDATA%\DiagnosticTeaching`；任何其他目录都不在删除范围内。


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
dist/windows/installer/win-unpacked/                   未安装检查目录
dist/windows/installer/Diagnostic-Teaching-Setup-*.exe NSIS 安装包
```

## 发布门禁

发布前至少完成：

1. 校验安装包文件名、版本、大小和 SHA-256。
2. 静默或交互安装到干净目录，确认主程序版本为 0.6.1。
3. 启动桌面应用，从日志解析随机端口并请求 `/api/health`。
4. 请求 `/api/speech/status`，确认语音依赖可用且模型按需加载。
5. 新建本地演示会话，刷新页面并确认输入与消息恢复且没有重复记录。
6. 测试真实模型、显式停止、题图上传、麦克风输入和卡片导出。
7. 正常退出，确认 Electron 会请求 sidecar 关闭而不是留下后台进程。
8. 先准备包含旧 SQLite、WAL/SHM、密钥和日志的 0.4.0 用户目录，再安装 0.5.0；确认旧文件全部消失、新库为空、重置标记存在，并确认重复安装 0.5.0 不会再次删除新数据。

## 代码签名

本地构建默认未签名，Windows SmartScreen 可能显示“未知发布者”。正式公开分发前应配置受信任的 Windows 代码签名证书，让 Electron 主程序、PyInstaller sidecar 和 NSIS 安装包都进入签名流程。证书不得提交到仓库。
