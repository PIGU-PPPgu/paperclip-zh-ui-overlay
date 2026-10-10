import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const script = path.join(packageRoot, "install.mjs");
const fixture = '<!DOCTYPE html>\n<html>\n  <head>\n    <link href="/assets/app.css">\n  </head>\n  <body><div id="root"></div></body>\n</html>\n';

function run(args, env) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: packageRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

test("rejects an unmatched UI before writing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-zh-guard-"));
  try {
    const dist = path.join(root, "ui-dist");
    await mkdir(dist);
    const index = path.join(dist, "index.html");
    await writeFile(index, fixture);
    const result = run(["install"], { PAPERCLIP_HOME: root, PAPERCLIP_UI_DIST: dist });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not match Paperclip/);
    assert.equal(await readFile(index, "utf8"), fixture);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installs once, stays idempotent, and restores exact bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-zh-roundtrip-"));
  try {
    const dist = path.join(root, "ui-dist");
    await mkdir(dist);
    const index = path.join(dist, "index.html");
    await writeFile(index, fixture);
    const env = {
      PAPERCLIP_HOME: root,
      PAPERCLIP_UI_DIST: dist,
      PAPERCLIP_ZH_ALLOW_CUSTOM_INDEX: "1",
    };
    const first = run(["install"], env);
    assert.equal(first.status, 0, first.stderr);
    const metadata = JSON.parse(first.stdout);
    assert.equal((await readFile(index, "utf8")).match(/PAPERCLIP_ZH_UI_START/g)?.length, 1);
    assert.match(await readFile(path.join(dist, "paperclip-zh", "overlay.js"), "utf8"), /paperclip\.ui\.locale/);

    const second = run(["install"], env);
    assert.equal(second.status, 0, second.stderr);
    assert.equal((await readFile(index, "utf8")).match(/PAPERCLIP_ZH_UI_START/g)?.length, 1);

    const restored = run(["restore", metadata.backupDir], env);
    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(await readFile(index, "utf8"), fixture);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
