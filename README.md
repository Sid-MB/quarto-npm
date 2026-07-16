# @lillies/quarto

Distributes the [Quarto](https://quarto.org) CLI as an npm package, so you can run
it through `npx`/`pnpx`/`bunx` or add it as a project dev dependency — no separate system
install required.

```sh
npx @lillies/quarto --version
npx @lillies/quarto render report.qmd
```

Or add it to a project:

```sh
npm install --save-dev @lillies/quarto
npx quarto render report.qmd
```

## How it works

Quarto is not a single static binary — each release is a 130–230 MB directory
tree bundling Deno, Pandoc, Typst, dart-sass, and Quarto's own `share/` data.
Publishing that into npm (or per-platform packages) would be enormous, so this
package is a thin wrapper instead:

- **On install**, a `postinstall` script detects your platform/architecture,
  downloads the matching artifact from
  [Quarto's GitHub Releases](https://github.com/quarto-dev/quarto-cli/releases),
  verifies its SHA-256, and extracts it into `vendor/` inside the package.
- **`npx quarto`** resolves to a small shim (`bin/quarto.js`) that forwards all
  arguments and stdio to the vendored Quarto launcher and mirrors its exit code.
- The shim is **self-healing**: if the binary is missing (e.g. installed with
  `--ignore-scripts`), it downloads Quarto lazily on first run.

The npm package version mirrors the Quarto version it installs, so
`@lillies/quarto@1.9.38` gives you Quarto 1.9.38.

## Supported platforms

| OS      | Architecture | Artifact                       |
| ------- | ------------ | ------------------------------ |
| macOS   | x64 / arm64  | `quarto-<v>-macos.tar.gz`      |
| Linux   | x64          | `quarto-<v>-linux-amd64.tar.gz`|
| Linux   | arm64        | `quarto-<v>-linux-arm64.tar.gz`|
| Windows | x64          | `quarto-<v>-win.zip`           |

## Environment variables

- `QUARTO_SKIP_DOWNLOAD=1` — skip the install-time download; Quarto is fetched
  lazily on first run instead.

## Authorship
Package created by [@Sid-MB](https://sidmb.com).

[@lillies/quarto](https://www.npmjs.com/package/@lillies/quarto) on NPM.
