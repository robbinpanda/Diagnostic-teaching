const { randomBytes } = require("node:crypto");
const { appendFileSync, mkdirSync } = require("node:fs");
const { createServer } = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, dialog, session } = require("electron");

const APP_USER_MODEL_ID = "cn.ai4edu.diagnostic-teaching";
const API_START_TIMEOUT_MS = 30_000;
const API_STOP_TIMEOUT_MS = 5_000;

let apiProcess = null;
let apiUrl = "";
let mainWindow = null;
let readyToQuit = false;
let shutdownToken = "";

app.setPath("userData", path.join(app.getPath("appData"), "DiagnosticTeaching"));
app.setAppUserModelId(APP_USER_MODEL_ID);

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function writeLog(message) {
  const logDirectory = path.join(app.getPath("userData"), "logs");
  mkdirSync(logDirectory, { recursive: true });
  appendFileSync(
    path.join(logDirectory, "desktop.log"),
    `${new Date().toISOString()} ${message}\n`,
    { encoding: "utf8" },
  );
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("无法分配本机端口"));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForApi(child) {
  const deadline = Date.now() + API_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`本地服务提前退出（代码 ${child.exitCode}）`);
    try {
      const response = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The sidecar is still starting. Keep the retry loop quiet.
    }
    await wait(200);
  }
  throw new Error("本地服务启动超时");
}

async function startApi() {
  const port = await reservePort();
  const resources = process.resourcesPath;
  const userData = app.getPath("userData");
  const dataDirectory = path.join(userData, "data");
  const logDirectory = path.join(userData, "session-logs");
  mkdirSync(dataDirectory, { recursive: true });
  mkdirSync(logDirectory, { recursive: true });

  apiUrl = `http://127.0.0.1:${port}`;
  shutdownToken = randomBytes(32).toString("hex");
  const executable = path.join(resources, "api", "diagnostic-teaching-api.exe");
  apiProcess = spawn(executable, [], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      APP_SECRET_PATH: path.join(dataDirectory, "app-secret.key"),
      BUNDLED_MODEL_SEED_DATABASE_PATH: path.join(resources, "seed", "app.db"),
      BUNDLED_MODEL_SEED_SECRET_PATH: path.join(resources, "seed", "app-secret.key"),
      BUNDLED_MODEL_SEED_VERSION: app.getVersion(),
      DATABASE_URL: `sqlite:///${path.join(dataDirectory, "app.db")}`,
      DESKTOP_SHUTDOWN_TOKEN: shutdownToken,
      DESKTOP_WEB_ROOT: path.join(resources, "web"),
      DIAGNOSTIC_TEACHING_PORT: String(port),
      OPENCODE_CATALOG_REFRESH_ENABLED: "0",
      PYTHONUTF8: "1",
      SESSION_LOG_DIR: logDirectory,
    },
  });
  apiProcess.stdout.on("data", (chunk) => writeLog(`[api] ${String(chunk).trimEnd()}`));
  apiProcess.stderr.on("data", (chunk) => writeLog(`[api] ${String(chunk).trimEnd()}`));
  apiProcess.once("error", (error) => writeLog(`[api:error] ${error.stack || error.message}`));
  apiProcess.once("exit", (code, signalName) => {
    writeLog(`[api:exit] code=${code} signal=${signalName || "none"}`);
    if (!readyToQuit && app.isReady()) {
      dialog.showErrorBox("本地服务已停止", "诊断式数学答疑的本地服务意外退出，请重新启动应用。");
      app.quit();
    }
  });
  await waitForApi(apiProcess);
}

function restrictRendererNetwork() {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith(`${apiUrl}/`)
      || details.url.startsWith("data:")
      || details.url.startsWith("blob:");
    callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f6f7fb",
    title: "诊断式数学答疑",
    webPreferences: {
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!targetUrl.startsWith(`${apiUrl}/`)) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(apiUrl);
}

async function stopApi() {
  if (!apiProcess || apiProcess.exitCode !== null) return;
  const child = apiProcess;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    await fetch(`${apiUrl}/api/desktop/shutdown`, {
      method: "POST",
      headers: { "X-Desktop-Shutdown-Token": shutdownToken },
      signal: AbortSignal.timeout(2_000),
    });
  } catch (error) {
    writeLog(`[shutdown] graceful request failed: ${error.message}`);
  }
  await Promise.race([exited, wait(API_STOP_TIMEOUT_MS)]);
  if (child.exitCode === null) child.kill();
}

app.whenReady().then(async () => {
  try {
    await startApi();
    restrictRendererNetwork();
    createWindow();
  } catch (error) {
    writeLog(`[startup] ${error.stack || error.message}`);
    dialog.showErrorBox("启动失败", `无法启动诊断式数学答疑：${error.message}`);
    readyToQuit = true;
    if (apiProcess?.exitCode === null) apiProcess.kill();
    app.quit();
  }
});

app.on("activate", () => {
  if (!mainWindow && apiUrl) createWindow();
});

app.on("window-all-closed", () => app.quit());

app.on("before-quit", (event) => {
  if (readyToQuit || !apiProcess || apiProcess.exitCode !== null) return;
  event.preventDefault();
  readyToQuit = true;
  void stopApi().finally(() => app.quit());
});
