"use strict";

// Downloads and installs the Quarto release artifact for the current platform.
//
// Flow: fetch the checksums manifest -> download the artifact to a temp file ->
// verify its SHA-256 -> extract into VENDOR_DIR via the system `tar`. We shell
// out to `tar` rather than taking a JS unzip/untar dependency because every
// supported host can already extract its own artifact: GNU/bsd `tar` handles the
// `.tar.gz` on macOS/Linux, and the bsdtar bundled with Windows 10+ handles the
// `.zip`. That keeps this package dependency-free.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { VENDOR_DIR, resolveTarget } = require("./platform");

// Fetch a URL following redirects (GitHub Releases redirect to a CDN). Returns
// the Response; caller decides how to consume the body.
async function httpGet(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`request failed ${res.status} ${res.statusText} for ${url}`);
  }
  return res;
}

// Look up the expected SHA-256 for `asset` from Quarto's checksums.txt. Each line
// is "<sha256>  <filename>". Returns null if the manifest can't be fetched so we
// can proceed with a warning rather than hard-failing on a transient network blip.
async function fetchExpectedChecksum(checksumsUrl, asset) {
  try {
    const res = await httpGet(checksumsUrl);
    const text = await res.text();
    for (const line of text.split("\n")) {
      const [sum, name] = line.trim().split(/\s+/);
      if (name === asset) return sum;
    }
  } catch (err) {
    console.warn(`@lillies/quarto: could not fetch checksums (${err.message}); skipping verification.`);
  }
  return null;
}

// Stream a download to `dest` while computing its SHA-256 in one pass. Also
// guards against a silently truncated transfer: if the server advertised a
// Content-Length, we require the written byte count to match it, so a dropped
// connection fails loudly here instead of producing a partial archive that tar
// extracts incompletely (which surfaced downstream as "launcher not found").
async function downloadToFile(url, dest) {
  const res = await httpGet(url);
  const expectedBytes = Number(res.headers.get("content-length")) || null;
  const hash = crypto.createHash("sha256");
  const out = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  let written = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    written += value.length;
    hash.update(value);
    if (!out.write(value)) {
      await new Promise((resolve) => out.once("drain", resolve));
    }
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  if (expectedBytes && written !== expectedBytes) {
    throw new Error(`incomplete download: got ${written} of ${expectedBytes} bytes for ${url}`);
  }
  return hash.digest("hex");
}

// Extract `archive` into `dir` using the system tar (auto-detects gzip/zip). We
// deliberately do NOT pass `--strip-components`: some `tar` builds (e.g. certain
// busybox variants seen in CI base images) silently ignore it, which left the
// launcher stranded at `<dir>/quarto-<version>/bin/quarto`. install() instead
// hoists the real root afterward, so extraction here is layout-agnostic.
function extract(archive, dir) {
  const result = spawnSync("tar", ["-xf", archive, "-C", dir], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`tar exited with code ${result.status}`);
}

// Locate the extraction root inside `dir`: the directory that actually contains
// the launcher at `binRel`. Quarto's artifacts land it either at the top level
// (macOS/Windows) or inside a single `quarto-<version>/` wrapper (Linux), so we
// check `dir` itself first, then its immediate subdirectories. Returns the
// absolute root path, or null if the launcher is nowhere to be found.
function findExtractedRoot(dir, binRel) {
  if (fs.existsSync(path.join(dir, binRel))) return dir;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(dir, entry.name);
    if (fs.existsSync(path.join(candidate, binRel))) return candidate;
  }
  return null;
}

// Install Quarto into VENDOR_DIR. Idempotent: if the launcher already exists and
// `force` is false, this is a no-op so repeat installs / first-run checks are cheap.
async function install({ force = false, log = console.error } = {}) {
  const target = resolveTarget();

  if (!force && fs.existsSync(target.binPath)) {
    return target;
  }

  const parentDir = path.dirname(VENDOR_DIR);
  fs.mkdirSync(parentDir, { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lillies-quarto-"));
  const archive = path.join(tmpDir, target.asset);
  // Stage extraction as a sibling of VENDOR_DIR (same filesystem) so the final
  // hoist is an atomic rename rather than a cross-device copy — os.tmpdir() is
  // frequently on a different mount than node_modules (e.g. on Vercel).
  const stagingDir = fs.mkdtempSync(path.join(parentDir, ".vendor-staging-"));

  try {
    log(`@lillies/quarto: downloading Quarto ${target.version} (${target.asset})...`);
    const expected = await fetchExpectedChecksum(target.checksumsUrl, target.asset);
    const actual = await downloadToFile(target.url, archive);
    if (expected && expected.toLowerCase() !== actual.toLowerCase()) {
      throw new Error(`checksum mismatch for ${target.asset}: expected ${expected}, got ${actual}`);
    }

    log(`@lillies/quarto: extracting to ${VENDOR_DIR}...`);
    extract(archive, stagingDir);

    const root = findExtractedRoot(stagingDir, target.binRel);
    if (!root) {
      const contents = fs.readdirSync(stagingDir).join(", ") || "(empty)";
      throw new Error(`launcher not found in extracted archive (looked for ${target.binRel}); extracted top-level entries: ${contents}`);
    }

    // Hoist the located root into place. Rename can't overwrite a non-empty dir,
    // so clear VENDOR_DIR first; both paths are on `parentDir`'s filesystem.
    fs.rmSync(VENDOR_DIR, { recursive: true, force: true });
    fs.renameSync(root, VENDOR_DIR);

    if (!fs.existsSync(target.binPath)) {
      throw new Error(`launcher missing after install at ${target.binPath}`);
    }
    // Ensure the launcher is executable on POSIX hosts.
    if (process.platform !== "win32") {
      fs.chmodSync(target.binPath, 0o755);
    }
    log(`@lillies/quarto: installed Quarto ${target.version}.`);
    return target;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

module.exports = { install };
