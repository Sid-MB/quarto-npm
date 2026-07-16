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

// Stream a download to `dest` while computing its SHA-256 in one pass.
async function downloadToFile(url, dest) {
  const res = await httpGet(url);
  const hash = crypto.createHash("sha256");
  const out = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    if (!out.write(value)) {
      await new Promise((resolve) => out.once("drain", resolve));
    }
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  return hash.digest("hex");
}

// Extract `archive` into `dir` using the system tar (auto-detects gzip/zip).
// `stripComponents` drops that many leading path segments so all platforms
// normalize to the same layout under `dir` (see resolveTarget for why).
function extract(archive, dir, stripComponents = 0) {
  const args = ["-xf", archive, "-C", dir];
  if (stripComponents > 0) args.push(`--strip-components=${stripComponents}`);
  const result = spawnSync("tar", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`tar exited with code ${result.status}`);
}

// Install Quarto into VENDOR_DIR. Idempotent: if the launcher already exists and
// `force` is false, this is a no-op so repeat installs / first-run checks are cheap.
async function install({ force = false, log = console.error } = {}) {
  const target = resolveTarget();

  if (!force && fs.existsSync(target.binPath)) {
    return target;
  }

  fs.rmSync(VENDOR_DIR, { recursive: true, force: true });
  fs.mkdirSync(VENDOR_DIR, { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lillies-quarto-"));
  const archive = path.join(tmpDir, target.asset);

  try {
    log(`@lillies/quarto: downloading Quarto ${target.version} (${target.asset})...`);
    const expected = await fetchExpectedChecksum(target.checksumsUrl, target.asset);
    const actual = await downloadToFile(target.url, archive);
    if (expected && expected.toLowerCase() !== actual.toLowerCase()) {
      throw new Error(`checksum mismatch for ${target.asset}: expected ${expected}, got ${actual}`);
    }

    log(`@lillies/quarto: extracting to ${VENDOR_DIR}...`);
    extract(archive, VENDOR_DIR, target.stripComponents);

    if (!fs.existsSync(target.binPath)) {
      throw new Error(`launcher not found after extraction at ${target.binPath}`);
    }
    // Ensure the launcher is executable on POSIX hosts.
    if (process.platform !== "win32") {
      fs.chmodSync(target.binPath, 0o755);
    }
    log(`@lillies/quarto: installed Quarto ${target.version}.`);
    return target;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { install };
