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

- [ ] `CHANGELOG.md` updated for the release version
- [ ] `package.json` `version` bumped
- [ ] `PLUGIN_OVERVIEW.md` matches `bb.description` and current surfaces
- [ ] GitHub repo public; no secrets in tree
- [ ] `git-id` (or correct org identity) for release commits

## Git release (preferred source)

BB managed installs use **semver tags** on the default branch:

```sh
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin main
git push origin v0.1.0
```

Users install with:

```sh
bb plugin install git:github.com/Limitless-Enterprise/bb-plugin-firstmate-control-plane@^0.1.0 --yes
```

Do **not** move an existing tag; publish fixes as `v0.1.1`, etc.

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

Git installs can build from source. npm distribution requires a **prebuilt `dist/`** in the published tarball. Prefer Git semver releases unless you already publish npm packages for BB plugins.
