
## Releasing a new version

Releases are automated by `.github/workflows/update-quarto.yml`, which runs
weekly (Mondays 07:00 UTC): it checks for a newer Quarto release, bumps
`package.json` to match, tags it, and publishes to npm.

Publishing uses **npm Trusted Publishing (OIDC)** — no npm token is stored or
rotated. One-time setup:

1. Do the first `npm publish` manually so the package exists on npm.
2. On npmjs.com, open the package → **Settings → Trusted Publishing**, add a
   GitHub Actions publisher pointing at this repo and the
   `update-quarto.yml` workflow.

After that, the weekly workflow (and manual `workflow_dispatch` runs) publish
token-free. To ship manually instead, bump `version` in `package.json` and run
`npm publish`.
