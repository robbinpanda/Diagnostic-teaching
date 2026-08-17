const assert = require("node:assert/strict");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  DATA_RESET_MARKER,
  DATA_RESET_VERSION,
  resetLegacyUserData,
} = require("../src/data-reset.cjs");

test("0.5.0 first start removes every legacy user-data file exactly once", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "diagnostic-teaching-reset-"));
  const userData = path.join(root, "DiagnosticTeaching");
  try {
    mkdirSync(path.join(userData, "data"), { recursive: true });
    mkdirSync(path.join(userData, "session-logs"), { recursive: true });
    writeFileSync(path.join(userData, "data", "app.db"), "legacy-db");
    writeFileSync(path.join(userData, "data", "app.db-wal"), "legacy-wal");
    writeFileSync(path.join(userData, "data", "app.db-shm"), "legacy-shm");
    writeFileSync(path.join(userData, "data", "app-secret.key"), "legacy-secret");
    writeFileSync(path.join(userData, "session-logs", "legacy.jsonl"), "legacy-log");

    assert.equal(resetLegacyUserData(userData), true);
    assert.equal(existsSync(path.join(userData, "data", "app.db")), false);
    assert.equal(existsSync(path.join(userData, "data", "app.db-wal")), false);
    assert.equal(existsSync(path.join(userData, "data", "app.db-shm")), false);
    assert.equal(existsSync(path.join(userData, "data", "app-secret.key")), false);
    assert.equal(existsSync(path.join(userData, "session-logs", "legacy.jsonl")), false);
    assert.equal(readFileSync(path.join(userData, DATA_RESET_MARKER), "utf8").trim(), DATA_RESET_VERSION);

    mkdirSync(path.join(userData, "data"), { recursive: true });
    writeFileSync(path.join(userData, "data", "app.db"), "new-0.5.0-db");
    assert.equal(resetLegacyUserData(userData), false);
    assert.equal(readFileSync(path.join(userData, "data", "app.db"), "utf8"), "new-0.5.0-db");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("data reset refuses any directory outside the fixed product user-data name", () => {
  const unsafe = path.join(os.tmpdir(), "some-other-app");
  assert.throws(() => resetLegacyUserData(unsafe), /拒绝清理非 DiagnosticTeaching 用户目录/);
});
