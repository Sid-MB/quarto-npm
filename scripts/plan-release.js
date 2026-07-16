#!/usr/bin/env node
"use strict";

// Decides what version (if any) this CI run should publish and writes it into
// package.json so the subsequent `npm publish` picks it up. Two publish modes:
//
//   * stable  — the base version equals a Quarto release we haven't shipped yet
//               (a scheduled sync bumped package.json to a new upstream version,
//               or it's the very first release). We publish the bare `X.Y.Z`.
//   * wrapper — a push changed the wrapper's own code while the base Quarto
//               version is already on npm. We publish the next prerelease
//               `X.Y.Z-wrapper-patch.N`, so wrapper-only fixes ship without
//               waiting for a new Quarto release. Prerelease keeps artifact
//               resolution intact: quartoBaseVersion() strips the `-suffix`, so
//               `X.Y.Z-wrapper-patch.N` still downloads the Quarto X.Y.Z tarball.
//
// N is derived from the registry (highest existing wrapper-patch for this base,
// plus one), so the repo's package.json never has to carry the suffix — it stays
// at the bare Quarto version, and wrapper versions live only in CI + on npm. That
// also means a wrapper publish needs no commit-back, avoiding a trigger loop.
//
// Nothing is published on a scheduled run that found no upstream update and no
// code change — otherwise the weekly cron would emit a pointless patch each week.
//
// Inputs (env): EVENT_NAME (github.event_name), SYNC_UPDATED (sync step output).
// Outputs (GITHUB_OUTPUT): publish=<true|false>, version=<target>, mode=<stable|wrapper|none>.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { quartoBaseVersion } = require("../lib/platform");

const PKG_PATH = path.join(__dirname, "..", "package.json");

function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) fs.appendFileSync(file, `${key}=${value}\n`);
  console.log(`${key}=${value}`);
}

// Every version of `name` currently on the registry ([] if the package is not
// published yet or the lookup fails, so a first-ever release still works).
function publishedVersions(name) {
  try {
    const out = execFileSync("npm", ["view", name, "versions", "--json"], { encoding: "utf8" });
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

// Highest N among existing `${base}-wrapper-patch.N` releases (0 if none).
function highestWrapperPatch(versions, base) {
  const re = new RegExp(`^${base.replace(/\./g, "\\.")}-wrapper-patch\\.(\\d+)$`);
  let max = 0;
  for (const v of versions) {
    const m = re.exec(v);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf8"));
  const base = quartoBaseVersion(pkg.version);
  const versions = publishedVersions(pkg.name);
  const basePublished = versions.includes(base);

  const eventName = process.env.EVENT_NAME || "";
  const syncUpdated = process.env.SYNC_UPDATED === "true";

  let target = null;
  let mode = "none";

  if (!basePublished || syncUpdated) {
    // The base Quarto version isn't on npm yet (fresh sync bump or first release):
    // ship the bare `X.Y.Z`.
    target = base;
    mode = "stable";
  } else if (eventName === "push") {
    // Wrapper code changed on an already-published Quarto version: ship the next
    // wrapper prerelease.
    target = `${base}-wrapper-patch.${highestWrapperPatch(versions, base) + 1}`;
    mode = "wrapper";
  }

  // Guard against re-publishing an existing (immutable) version.
  if (!target || versions.includes(target)) {
    setOutput("publish", "false");
    setOutput("version", target || pkg.version);
    setOutput("mode", "none");
    return;
  }

  pkg.version = target;
  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");
  setOutput("publish", "true");
  setOutput("version", target);
  setOutput("mode", mode);
}

main();
