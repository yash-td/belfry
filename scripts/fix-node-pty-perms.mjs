#!/usr/bin/env node
// node-pty ships prebuilt native binaries plus a `spawn-helper` shim used
// during process fork. When the tarball is extracted by some npm clients,
// the executable bit on spawn-helper gets stripped, which causes every PTY
// spawn to fail with `posix_spawnp failed`. There is no way to know whether
// this happens on a given machine short of running a PTY, so we just
// unconditionally chmod +x the helper on postinstall.
//
// If node-pty is not installed (e.g. someone forked the frontend only),
// this script is a no-op.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prebuildsDir = path.resolve(
  __dirname,
  "..",
  "node_modules",
  "node-pty",
  "prebuilds"
);

if (!fs.existsSync(prebuildsDir)) {
  process.exit(0);
}

const platformDirs = fs
  .readdirSync(prebuildsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => path.join(prebuildsDir, e.name));

let fixed = 0;
for (const dir of platformDirs) {
  const helper = path.join(dir, "spawn-helper");
  if (!fs.existsSync(helper)) continue;
  try {
    const stat = fs.statSync(helper);
    const needsChmod = (stat.mode & 0o111) === 0;
    if (needsChmod) {
      fs.chmodSync(helper, stat.mode | 0o755);
      fixed++;
    }
  } catch (err) {
    console.warn(`[claude-station] failed to chmod ${helper}:`, err);
  }
}

if (fixed > 0) {
  console.log(
    `[claude-station] fixed executable bit on ${fixed} node-pty spawn-helper binar${fixed === 1 ? "y" : "ies"}`
  );
}
