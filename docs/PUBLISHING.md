# Publishing this plugin (maintainers)

This document prepares **Firstmate Fleet** (`firstmate-control-plane`) for BB distribution. It does **not** perform a release by itself.

## Plugin identity

| Field | Value |
| --- | --- |
| npm package name | `bb-plugin-firstmate-control-plane` |
| BB plugin id | `firstmate-control-plane` |
| Verify id | `node scripts/derive-plugin-id.mjs package.json` |

The id must match any BB Community marketplace entry filename and `id` field.

## Pre-release checklist

Run from the repository root (BB on `PATH`, pnpm via Corepack or mise):

```sh
./scripts/release-check.sh
```

That runs `pnpm run typecheck`, `pnpm test`, and `bb plugin build .`.

Optional full gate:

```sh
./scripts/m1-inventory-gate.sh
```

Confirm:

- [ ] `CHANGELOG.md` updated for the release CalVer
- [ ] `package.json` `version` set to the intended stable CalVer (see [VERSIONING.md](./VERSIONING.md))
- [ ] `PLUGIN_OVERVIEW.md` matches `bb.description` and current surfaces
- [ ] GitHub repo public; no secrets in tree
- [ ] `git-id` (or correct org identity) for release commits

## Git release (preferred source)

Versioning follows [Limitless Enterprise CalVer](https://github.com/Limitless-Enterprise/guidelines/blob/main/docs/05-technology/03-calver-versioning.md). See [VERSIONING.md](./VERSIONING.md) for this repo.

1. Pick the next stable `YYYY.MM.MICRO` (UTC month, increment `MICRO` within the month).
2. Set `package.json` `version` to that value and update `CHANGELOG.md`.
3. Run `./scripts/release-check.sh`.
4. Tag and push (immutable; never move tags):

```sh
git tag -a v2026.9.0 -m "Release 2026.9.0"
git push origin main
git push origin v2026.9.0
```

Users install with a range over CalVer tags (BB resolves `vYYYY.MM.MICRO` tags):

```sh
bb plugin install git:github.com/Limitless-Enterprise/bb-plugin-firstmate-control-plane@^2026.9.0 --yes
```

Do **not** move an existing tag. Hotfixes and follow-up releases use the next stable CalVer (for example `2026.9.1`, then `2026.10.0` in a new UTC month).

## BB Community marketplace

Publication is a **separate PR** to [get-bb/marketplace](https://github.com/get-bb/marketplace). Follow the BB **`submit-a-plugin`** skill:

1. Validate plugin and create an immutable Git tag (above).
2. Copy `assets/icon.svg` into the marketplace repo as a vendored icon.
3. Use `docs/marketplace/entry.draft.json` as the starting point for `entries/firstmate-control-plane.json` (adjust description/screenshots per current schema).
4. Copy `PLUGIN_OVERVIEW.md` to `overview/firstmate-control-plane.md`.
5. Capture store screenshots (Fleet tree, inbox, board) per marketplace guidelines.
6. Open a PR from an author account matching `author.github` in the entry.

Until the marketplace PR merges, users can install directly from Git.

## Limitless Enterprise catalog (optional)

To list the plugin on an internal marketplace, host `marketplace.json` and point entries at the same Git source. See BB docs: `bb marketplace add <url>`.

## npm release (optional)

Git installs can build from source. npm distribution requires a **prebuilt `dist/`** in the published tarball. Prefer Git CalVer tags unless you already publish npm packages for BB plugins; npm accepts the canonical `YYYY.MM.MICRO` form per org guidelines.
