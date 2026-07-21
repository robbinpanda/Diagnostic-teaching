# Windows 安装包

当前安装包面向 Windows 10/11 x64。终端用户只需要运行生成的 `.exe`，不需要安装 Node.js、Python、Conda、SQLite 或浏览器运行时。

## 架构

安装内容分为三层：

1. Electron 主进程负责单实例、窗口、本机随机端口、sidecar 生命周期和退出清理。
2. PyInstaller `onedir` sidecar 包含 FastAPI、Python 运行时、Alembic migrations 和后端静态资源。
3. Next.js `output: export` 产物由 FastAPI 同源提供，前端 API 地址在生产构建中使用相对路径。

Electron 不提供登录、遥测、自动更新或打开外部网页的能力。窗口启用 Chromium sandbox、关闭 Node 集成和开发者工具，拒绝权限请求、弹窗、外部导航及所有非当前本机 sidecar 的网络请求。静态页面还带有 `connect-src 'self'` CSP。

后端的运行时外网出口只有 `app/llm/provider.py` 中的模型连接测试与 LLM 调用。桌面主进程固定设置 `OPENCODE_CATALOG_REFRESH_ENABLED=0`，所以不会请求 `models.dev`；安装版只保留随包快照中的 `hy3` 和 `mimo-v2.5-free`，只有用户真正选择模型进行测试或答疑时才访问对应 LLM API。

## 构建

构建机需要：

- Windows x64；
- Node.js 20 或更高版本；
- Python 3.11 或 3.12；
- npm（前端首次装依赖）和 pnpm（桌面依赖）。

在仓库根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-windows-installer.ps1
```

脚本会在 `.build/windows-python` 创建隔离构建环境，在 `.build/electron-builder-cache` 保存可复用的 NSIS 工具缓存，安装 `apps/api/requirements-build.txt`，然后依次构建静态前端、PyInstaller sidecar 和 NSIS 安装包。可通过 `-NodePath`、`-PythonPath` 指定运行时；依赖已经准备好时可使用 `-SkipDependencyInstall`。

需要预置个人模型时，复制 `docs/windows-model-profiles.example.json` 到 Git 忽略的 `.secrets/windows-model-profiles.json`，只在本机填写 API key，然后执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-windows-installer.ps1 `
  -ModelProfileSeedPath .secrets\windows-model-profiles.json
```

构建脚本最多并行检查四个模型：先验证文字连接，再用代码生成的随机颜色/图形图片验证多模态能力。任一模型文字连接失败时构建立即终止；图片探针失败则把该模型保存为非多模态。明文输入文件不会复制到 `dist/`，安装包只携带 `app.db` 中的加密密文和配套密钥。首次启动时仅在用户数据库与密钥都不存在的情况下复制预置数据，升级安装不会覆盖用户已有配置。

产物：

```text
dist/windows/api/                                      PyInstaller sidecar
dist/windows/seed/app.db                               加密的首次安装模型预置库（可选）
dist/windows/seed/app-secret.key                       预置库密钥（可选）
dist/windows/installer/win-unpacked/                   未安装的检查目录
dist/windows/installer/Diagnostic-Teaching-Setup-*.exe NSIS 安装包
```

## 安装与数据

NSIS 默认为当前用户安装，不请求管理员权限，允许选择安装目录，并创建桌面与开始菜单快捷方式。应用数据默认位于：

```text
%APPDATA%\DiagnosticTeaching\data\app.db
%APPDATA%\DiagnosticTeaching\data\app-secret.key
%APPDATA%\DiagnosticTeaching\session-logs\
%APPDATA%\DiagnosticTeaching\logs\desktop.log
```

卸载默认保留数据，避免误删会话和 API key；需要彻底清理时，用户可在卸载后手动删除上述应用数据目录。

## 发布前验证

至少在一台干净的 Windows 10 x64 和一台 Windows 11 x64 虚拟机执行：

1. 安装、开始菜单启动和桌面快捷方式启动。
2. 不安装 Python/Node 的情况下打开首页、创建模型配置并重启应用。
3. 确认 SQLite 会话和加密配置在升级安装后保留。
4. 测试 OpenAI-compatible 与 Anthropic 各一个模型、流式中断、题图上传和学习卡片打印。
5. 断网启动，确认应用本身正常打开且没有 `models.dev`、登录、遥测或更新请求。
6. 卸载后确认程序文件删除、用户数据保留。

## 代码签名

本地构建的安装包默认未签名，Windows SmartScreen 可能显示“未知发布者”。正式分发前应配置受信任的 Windows 代码签名证书，让 `electron-builder` 对应用和 NSIS 安装包签名；同时确认 PyInstaller sidecar 也纳入签名流程。证书不应提交到仓库。
