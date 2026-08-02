const { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const DATA_RESET_VERSION = "0.5.0";
const DATA_RESET_MARKER = `.data-reset-v${DATA_RESET_VERSION}`;

function assertSafeUserDataPath(userData) {
  const resolved = path.resolve(userData);
  if (path.basename(resolved).toLowerCase() !== "diagnosticteaching") {
    throw new Error(`拒绝清理非 DiagnosticTeaching 用户目录：${resolved}`);
  }
  return resolved;
}

function resetLegacyUserData(userData) {
  const safeUserData = assertSafeUserDataPath(userData);
  const markerPath = path.join(safeUserData, DATA_RESET_MARKER);
  if (existsSync(markerPath)) {
    try {
      if (readFileSync(markerPath, "utf8").trim() === DATA_RESET_VERSION) return false;
    } catch {
      // A damaged marker is not proof that the destructive migration completed.
    }
  }

  rmSync(safeUserData, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  mkdirSync(safeUserData, { recursive: true });

  const temporaryMarker = `${markerPath}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryMarker, `${DATA_RESET_VERSION}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(temporaryMarker, markerPath);
  } catch (error) {
    rmSync(temporaryMarker, { force: true });
    throw error;
  }
  return true;
}

module.exports = {
  DATA_RESET_MARKER,
  DATA_RESET_VERSION,
  resetLegacyUserData,
};
