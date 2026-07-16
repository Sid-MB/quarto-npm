#!/usr/bin/env node
"use strict";

// CLI entry point for `@lillies/quarto`. Forwards all arguments to the vendored
// Quarto launcher and mirrors its exit code, so `npx quarto ...` behaves exactly
// like a native `quarto` install.
//
// Self-healing: if the binary is missing (e.g. the package was installed with
// `--ignore-scripts`, so postinstall never ran), we download it on first run
// before executing. This keeps the tool usable even when install scripts are
// disabled.

const { spawnSync } = require("child_process");
const fs = require("fs");
const { resolveTarget } = require("../lib/platform");

async function main() {
  let target = resolveTarget();

  if (!fs.existsSync(target.binPath)) {
    const { install } = require("../lib/download");
    target = await install();
  }

  // Inherit stdio so interactive prompts, colors, and piping all work. The
  // launcher is a POSIX shell script on mac/linux (executable) and quarto.exe on
  // Windows, so it can be spawned directly without a shell on any platform.
  const result = spawnSync(target.binPath, process.argv.slice(2), {
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`@lillies/quarto: failed to run quarto: ${result.error.message}`);
    process.exit(1);
  }
  // Propagate signal-based termination as a conventional 128+signal exit code.
  if (result.signal) {
    process.exit(1);
  }
  process.exit(result.status == null ? 0 : result.status);
}

main().catch((err) => {
  console.error(`@lillies/quarto: ${err.message}`);
  process.exit(1);
});
