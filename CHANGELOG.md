# Changelog

Notable changes are listed here. Versions follow [Limitless Enterprise CalVer](https://github.com/Limitless-Enterprise/guidelines/blob/main/docs/05-technology/03-calver-versioning.md) (`YYYY.MM.MICRO`, Git tag `vYYYY.MM.MICRO`). See [docs/VERSIONING.md](./docs/VERSIONING.md).

## [Unreleased]

## [2026.10.0] - TBD

### Added

- Fleet **`experimental_sidebar`**: while the Fleet panel is open, the BB thread list is replaced by the mate/crew tree; Tree + Chat in the main panel is chat-only (no duplicate tree column).

### Changed

- Minimum **`bbPluginSdk`** `>=0.6.53` for `experimental_sidebar` on `navPanel`.

## [2026.9.0] - TBD

### Added

- CalVer alignment with org guidelines; publishing docs and CI.

First public BB plugin release: Firstmate Fleet control plane (mate homes, `bb fleet` CLI, Fleet panel, Firstmate integration overlay, M1 capability set).

Install (after `v2026.9.0` tag exists):

```sh
bb plugin install git:github.com/Limitless-Enterprise/bb-plugin-firstmate-control-plane@^2026.9.0 --yes
```

[Unreleased]: https://github.com/Limitless-Enterprise/bb-plugin-firstmate-control-plane/compare/v2026.10.0...HEAD
[2026.10.0]: https://github.com/Limitless-Enterprise/bb-plugin-firstmate-control-plane/compare/v2026.9.0...v2026.10.0
[2026.9.0]: https://github.com/Limitless-Enterprise/bb-plugin-firstmate-control-plane/releases/tag/v2026.9.0
