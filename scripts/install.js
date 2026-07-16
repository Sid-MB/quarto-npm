#!/usr/bin/env node
"use strict";

// postinstall hook: eagerly download + extract Quarto for the current platform
// so the very first `quarto` invocation is instant.
//
// Failures here are non-fatal by design. A postinstall that hard-fails would
// break `npm install` in offline/sandboxed CI. Instead we warn; the bin shim
// (bin/quarto.js) will retry the download lazily on first run.
//
// Set QUARTO_SKIP_DOWNLOAD=1 to opt out of the eager download entirely.

if (process.env.QUARTO_SKIP_DOWNLOAD === "1") {
  console.error("@lillies/quarto: QUARTO_SKIP_DOWNLOAD=1 set; skipping download (will fetch on first run).");
  process.exit(0);
}

const { install } = require("../lib/download");

install().catch((err) => {
  console.warn(`@lillies/quarto: install-time download failed (${err.message}).`);
  console.warn("@lillies/quarto: Quarto will be downloaded automatically on first use.");
  process.exit(0);
});
