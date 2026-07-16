"use strict";

// Maps the host platform/architecture to the matching Quarto release artifact.
//
// Quarto is not a single static binary: each release ships as a ~130-230MB
// directory tree (bundled Deno + Pandoc + Typst + dart-sass + a `share/` data
// dir). Releases are published per-platform on GitHub. This module is the single
// source of truth for "which asset do I need, and where is the launcher inside
// it once extracted".

const path = require("path");

// Absolute path to where the extracted Quarto tree lives inside this package.
// `vendor/` is npmignored, so it only exists after install/first-run download.
const VENDOR_DIR = path.join(__dirname, "..", "vendor");

// Strip any wrapper-only suffix from an npm version to get the Quarto version it
// distributes. The package version mirrors the Quarto version, but wrapper-only
// fixes shipped between Quarto releases carry a prerelease/build suffix (e.g.
// "1.9.38-patch.1"); the Quarto artifact to download is always the base "x.y.z".
function quartoBaseVersion(version) {
  return String(version).replace(/^v/, "").split(/[-+]/)[0];
}

// Resolve the Quarto version to download from our own package version, so
// `npx @lillies/quarto@1.9.38` deterministically yields Quarto 1.9.38 and
// `@1.9.38-patch.1` still yields Quarto 1.9.38.
function quartoVersion() {
  return quartoBaseVersion(require("../package.json").version);
}

// Describe the artifact + extracted layout for the current host. Throws with a
// clear message on unsupported platform/arch combinations so failures are legible.
function resolveTarget(version = quartoVersion()) {
  const platform = process.platform;
  const arch = process.arch;

  // asset: release file name. binRel: path to the launcher relative to the
  // extracted root (VENDOR_DIR). stripComponents: leading path components to drop
  // during extraction so every platform normalizes to `vendor/bin/...` — the
  // artifacts are inconsistent: macOS and Windows extract to `bin/` at the root,
  // but the Linux tarballs are wrapped in a `quarto-<version>/` directory.
  let asset;
  let binRel;
  let stripComponents = 0;

  if (platform === "darwin") {
    // The macOS tarball is universal (contains both x86_64 and aarch64 tools).
    asset = `quarto-${version}-macos.tar.gz`;
    binRel = path.join("bin", "quarto");
  } else if (platform === "linux" && arch === "x64") {
    asset = `quarto-${version}-linux-amd64.tar.gz`;
    binRel = path.join("bin", "quarto");
    stripComponents = 1; // drop the leading `quarto-<version>/` wrapper dir
  } else if (platform === "linux" && arch === "arm64") {
    asset = `quarto-${version}-linux-arm64.tar.gz`;
    binRel = path.join("bin", "quarto");
    stripComponents = 1; // drop the leading `quarto-<version>/` wrapper dir
  } else if (platform === "win32" && arch === "x64") {
    asset = `quarto-${version}-win.zip`;
    // Use the native `quarto.exe` (not `quarto.cmd`): an .exe can be spawned
    // directly without a shell, avoiding shell-quoting issues with paths or args
    // that contain spaces.
    binRel = path.join("bin", "quarto.exe");
  } else {
    throw new Error(
      `@lillies/quarto: unsupported platform "${platform}/${arch}". ` +
        `Quarto provides binaries for darwin (x64/arm64), linux (x64/arm64), and win32 (x64).`
    );
  }

  const url = `https://github.com/quarto-dev/quarto-cli/releases/download/v${version}/${asset}`;
  return {
    version,
    asset,
    url,
    binRel,
    stripComponents,
    binPath: path.join(VENDOR_DIR, binRel),
    checksumsUrl: `https://github.com/quarto-dev/quarto-cli/releases/download/v${version}/quarto-${version}-checksums.txt`,
  };
}

module.exports = { VENDOR_DIR, quartoVersion, quartoBaseVersion, resolveTarget };
