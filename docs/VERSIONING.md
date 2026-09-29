# Versioning

This repository follows [Limitless Enterprise CalVer](https://github.com/Limitless-Enterprise/guidelines/blob/main/docs/05-technology/03-calver-versioning.md) ([ADR-0026](https://github.com/Limitless-Enterprise/guidelines/blob/main/decisions/ADR-0026-calver-lockstep-versioning.md)).

## Format

| | |
| --- | --- |
| **Stable version** | `YYYY.MM.MICRO` (UTC month **not** zero-padded) |
| **Git tag** | `vYYYY.MM.MICRO` |
| **Pre-release** | `YYYY.MM.MICRO-rc.N`, `-beta.N`, `-alpha.N` (do not consume stable `MICRO`) |

Examples: `2026.9.0`, tag `v2026.9.0`; next release same UTC month → `2026.9.1`; new UTC month → `2026.10.0`.

## This repo

- **`package.json` `version`** is the intended stable CalVer for the next production release (lockstep: single publishable unit).
- **Source of truth after release:** immutable `vYYYY.MM.MICRO` tags on `main`.
- **BB installs:** `bb plugin install git:…@^2026.9.0` resolves Git tags with numeric version precedence (same shape as SemVer ranges).

## Choosing the next stable version

1. Use the UTC date of the release (year + month).
2. List existing `vYYYY.MM.*` tags on `main` for that month.
3. If none, `MICRO = 0`; else increment `MICRO` by 1 (including `9` → `10`).

See the [choosing the next version](https://github.com/Limitless-Enterprise/guidelines/blob/main/docs/05-technology/03-calver-versioning.md#choosing-the-next-version) table in the org guideline.

## Release flow

Documented in [PUBLISHING.md](./PUBLISHING.md). Do not retag; publish fixes as the next stable CalVer in sequence.
