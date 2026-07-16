
## How releases work

`package.json`'s `version` is the single source of truth. Everything is handled
by one workflow, `.github/workflows/publish.yml`, which publishes via
**npm Trusted Publishing (OIDC)** — no npm token is stored or rotated. It is a
single workflow on purpose: npm binds trusted publishing to one workflow
filename, so all publishes must originate from this file.

It runs on three triggers and does two jobs:

- **Publish-on-change (every trigger).** It checks whether the `version` in
  `package.json` is already on npm; if not, it publishes and tags `v<version>`.
  Unchanged pushes (docs, CI, refactors) are a no-op. So to cut a release you
  just bump `version`, commit, and push to `main` — no manual `npm publish`.
- **Weekly Quarto tracking (schedule / manual `workflow_dispatch`).** Mondays
  07:00 UTC it checks for a newer Quarto; if found it bumps `version`, pushes,
  and the publish step above ships it. The scheduled run publishes within the
  same job (rather than relying on its own push to re-trigger the workflow)
  because a push made with the built-in `GITHUB_TOKEN` does not trigger new
  workflow runs.

One-time setup (already done for the initial `1.9.38` publish): register the
GitHub Actions trusted publisher on npmjs.com → the package → **Settings →
Trusted Publishing**, pointing at this repo and the `publish.yml` workflow. CI publishes fail until this is configured, since OIDC needs a
registered publisher.

## Wrapper-only patch releases

Published npm versions are immutable, so a fix to the wrapper itself (not a
Quarto upgrade) needs a new version number. Because `package.json`'s `version`
mirrors the Quarto version, append a prerelease suffix rather than inventing a
new Quarto version:

```
1.9.38          # tracks Quarto 1.9.38
1.9.38-patch.1  # wrapper fix, still installs Quarto 1.9.38
1.9.38-patch.2  # another wrapper fix
```

The installer strips the suffix (`quartoBaseVersion` in `lib/platform.js`), so
any `1.9.38-*` version still downloads the Quarto 1.9.38 artifact. The weekly
sync compares against the base version, so it treats `1.9.38-patch.1` as "on
1.9.38" and won't overwrite your patch.

To ship one, bump `version` to `1.9.38-patch.N`, commit, and push to `main` —
the release workflow publishes it automatically. Two caveats of prerelease
versions:

- `npm publish` still moves the `latest` tag, so `npx @lillies/quarto` and a
  plain `npm install @lillies/quarto` **do** pick up the patch.
- Prerelease versions are excluded from semver **range** installs, so a
  dependant pinned to `@^1.9.38` or exactly `@1.9.38` will **not** auto-receive
  the patch — they get it at the next plain (Quarto) release.
