#!/usr/bin/env node
"use strict";

// Checks the latest Quarto release on GitHub and, if it is newer than the version
// in package.json, rewrites package.json to match. Used by the weekly
// update-quarto GitHub workflow to keep `@lillies/quarto` in sync with upstream.
//
// Outputs (when run in GitHub Actions, i.e. GITHUB_OUTPUT is set):
//   updated=<true|false>
//   version=<latest quarto version>
//   previous=<version before the bump>
//
// Exits 0 whether or not an update was needed; only hard failures (network,
// parse) exit non-zero.

const fs = require("fs");
const path = require("path");

const PKG_PATH = path.join(__dirname, "..", "package.json");

// Parse a dotted numeric version ("1.9.38") into comparable integer parts.
function parseVersion(v) {
  return v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10));
}

// Returns > 0 if a > b, < 0 if a < b, 0 if equal. Compares part-by-part so
// 1.10.0 correctly sorts above 1.9.38.
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Emit a key=value pair to the GitHub Actions step output file, if present.
function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) fs.appendFileSync(file, `${key}=${value}\n`);
}

async function main() {
  const res = await fetch("https://api.github.com/repos/quarto-dev/quarto-cli/releases/latest", {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "lillies-quarto-sync",
      // GITHUB_TOKEN (auto-provided in Actions) lifts the anonymous rate limit.
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status} ${res.statusText}`);

  const release = await res.json();
  const latest = String(release.tag_name || "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(latest)) {
    throw new Error(`unexpected latest tag: "${release.tag_name}"`);
  }

  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf8"));
  const current = pkg.version;

  setOutput("previous", current);
  setOutput("version", latest);

  if (compareVersions(latest, current) <= 0) {
    console.log(`Already up to date (current ${current}, latest ${latest}).`);
    setOutput("updated", "false");
    return;
  }

  pkg.version = latest;
  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`Updated ${current} -> ${latest}.`);
  setOutput("updated", "true");
}

main().catch((err) => {
  console.error(`sync-version failed: ${err.message}`);
  process.exit(1);
});
