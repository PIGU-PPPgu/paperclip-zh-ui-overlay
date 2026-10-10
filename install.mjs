import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const version = "2026.916.1";
const expectedBaselineSha256 = "dc6047ad8c7d8623f5ede70133108090bbe698b2fa0eabb9e0c122f64e374a24";
const paperclipHome = process.env.PAPERCLIP_HOME || path.join(os.homedir(), ".paperclip");
const dist = process.env.PAPERCLIP_UI_DIST || path.join(
  paperclipHome,
  "cli/installs/npm",
  version,
  "node_modules/@paperclipai/server/ui-dist",
);
const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const backupRoot = process.env.PAPERCLIP_ZH_BACKUP_ROOT || path.join(paperclipHome, "backups", "paperclip-zh-ui");
const markerStart = "<!-- PAPERCLIP_ZH_UI_START -->";
const markerEnd = "<!-- PAPERCLIP_ZH_UI_END -->";
const files = [
  ["overlay.js", "overlay.js"],
  ["overrides.zh-CN.json", "overrides.zh-CN.json"],
  ["vendor/penclip-zh-CN.json", "zh-CN.community.json"],
  ["vendor/LICENSE.penclip", "LICENSE.penclip"],
];

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function withoutOverlay(html) {
  const start = html.indexOf(markerStart);
  if (start < 0) return html;
  const end = html.indexOf(markerEnd, start);
  if (end < 0) throw new Error("Existing Chinese UI marker has no closing marker");
  const lineStart = html.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = html.indexOf("\n", end + markerEnd.length);
  if (lineEnd < 0) throw new Error("Existing Chinese UI marker is not line terminated");
  return html.slice(0, lineStart) + html.slice(lineEnd + 1);
}

async function atomicWrite(target, contents) {
  const temp = `${target}.paperclip-zh-${process.pid}.tmp`;
  await writeFile(temp, contents);
  await rename(temp, target);
}

async function install() {
  const indexPath = path.join(dist, "index.html");
  const current = await readFile(indexPath, "utf8");
  if (!current.includes("/assets/") || !current.includes("</head>")) {
    throw new Error(`Unexpected Paperclip static UI index at ${indexPath}`);
  }
  const baseline = withoutOverlay(current);
  if (digest(baseline) !== expectedBaselineSha256 && process.env.PAPERCLIP_ZH_ALLOW_CUSTOM_INDEX !== "1") {
    throw new Error("Static UI index does not match Paperclip v2026.916.1. Set PAPERCLIP_ZH_ALLOW_CUSTOM_INDEX=1 only after inspecting the difference.");
  }
  const sourceBuffers = await Promise.all(files.map(([source]) => readFile(path.join(sourceDir, source))));
  const assetHash = digest(Buffer.concat(sourceBuffers)).slice(0, 12);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(backupRoot, timestamp);
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(backupDir, "previous-index.html"), current);
  await writeFile(path.join(backupDir, "baseline-index.html"), baseline);
  await writeFile(path.join(backupDir, "metadata.json"), JSON.stringify({
    paperclipVersion: version,
    previousIndexSha256: digest(current),
    baselineIndexSha256: digest(baseline),
    overlayAssetSha256Prefix: assetHash,
    uiDist: dist,
    savedAt: new Date().toISOString(),
  }, null, 2));

  const assetsDir = path.join(dist, "paperclip-zh");
  await mkdir(assetsDir, { recursive: true });
  for (const [source, destination] of files) {
    await copyFile(path.join(sourceDir, source), path.join(assetsDir, destination));
  }
  const snippet = [
    `    ${markerStart}`,
    `    <script defer src="/paperclip-zh/overlay.js?v=${assetHash}"></script>`,
    `    ${markerEnd}`,
    "",
  ].join("\n");
  const updated = baseline.replace(/^([ \t]*)<\/head>/m, (_match, indent) => `${snippet}${indent}</head>`);
  if (updated === baseline) throw new Error("Could not inject UI script into index.html");
  await atomicWrite(indexPath, updated);
  const served = await readFile(indexPath, "utf8");
  if (!served.includes(`overlay.js?v=${assetHash}`)) throw new Error("Chinese UI script was not saved");
  console.log(JSON.stringify({
    action: "installed",
    paperclipVersion: version,
    indexPath,
    backupDir,
    baselineIndexSha256: digest(baseline),
    overlayAssetSha256Prefix: assetHash,
  }, null, 2));
}

async function restore(backupDir) {
  if (!backupDir || !path.isAbsolute(backupDir) || !backupDir.startsWith(`${backupRoot}${path.sep}`)) {
    throw new Error(`Provide an absolute backup directory under ${backupRoot}`);
  }
  const metadata = JSON.parse(await readFile(path.join(backupDir, "metadata.json"), "utf8"));
  if (metadata.uiDist !== dist || metadata.paperclipVersion !== version) {
    throw new Error("Backup does not match this Paperclip UI installation");
  }
  const baseline = await readFile(path.join(backupDir, "baseline-index.html"), "utf8");
  if (digest(baseline) !== metadata.baselineIndexSha256) throw new Error("Backup checksum mismatch");
  const indexPath = path.join(dist, "index.html");
  const current = await readFile(indexPath, "utf8");
  if (!current.includes(markerStart)) throw new Error("Chinese UI overlay is not present");
  await atomicWrite(indexPath, baseline);
  console.log(JSON.stringify({ action: "restored", indexPath, backupDir, baselineIndexSha256: digest(baseline) }, null, 2));
}

async function check() {
  const indexPath = path.join(dist, "index.html");
  const current = await readFile(indexPath, "utf8");
  const baselineSha256 = digest(withoutOverlay(current));
  console.log(JSON.stringify({
    paperclipVersion: version,
    indexPath,
    installed: current.includes(markerStart),
    baselineSha256,
    versionMatch: baselineSha256 === expectedBaselineSha256,
  }, null, 2));
}

if (process.argv[2] === "restore") await restore(process.argv[3]);
else if (process.argv[2] === "check") await check();
else if (process.argv.length === 2 || process.argv[2] === "install") await install();
else throw new Error("Usage: node install.mjs [check | install | restore <absolute-backup-dir>]");
