# Format Conversion Test Suite

This repository provides a reproducible build test for model format conversion
using the [SBML Semantic Test Suite](https://github.com/sbmlteam/sbml-test-suite).

[![Heta project](https://img.shields.io/badge/%CD%B1-Heta_project-blue)](https://hetalang.github.io/)
[![GitHub issues](https://img.shields.io/github/issues/hetalang/format-conversion-test-suite.svg)](https://github.com/hetalang/format-conversion-test-suite/issues/)
[![GitHub license](https://img.shields.io/github/license/hetalang/format-conversion-test-suite.svg)](https://github.com/hetalang/format-conversion-test-suite/blob/master/LICENSE)

```text
SBML → Heta → canonical JSON + DynMS
```

Each selected SBML case is built with `heta-compiler`. The suite records whether
the build produced its canonical JSON and DynMS artifacts; it does not compare
generated files with stored baselines and does not validate numerical
simulations.

## Report viewer

The dependency-free [Report viewer](https://hetalang.github.io/format-conversion-test-suite/report/)
loads a local `report.json` or a public report URL. Its files are in
[`viewer/`](viewer/); see [`viewer/README.md`](viewer/README.md) for usage.

## Configuration

[`config/options.json`](config/options.json) is the source of truth for the
SBML Semantic Test Suite version, archive URL, checksum, and extraction target.

Check that this configuration is valid and that the archive URL is reachable:

```sh
npm run verify:config
```

## Prepare cases

Download and verify the configured SBML archive:

```sh
npm run fetch:sbml
```

Create `cases/index.json` from the downloaded suite:

```sh
npm run index:sbml
```

The index contains available SBML paths, source metadata, and the pinned
test-suite identity. Both `cases/` and `results/` are generated and ignored by
Git.

## Build a report

```sh
npx fcts sbml-report --source=cases/index --input-field=sbmlL3V2Path \
  --target=results/candidate --concurrency=1 --skip=0 --limit=10
```

The target directory is recreated for each run. `report.json` records the
conversion description, generator and run metadata, command parameters, build
status for every selected case, and relative paths to artifacts from successful
builds. After a successful compiler build, canonical JSON and DynMS artifacts
are validated against the `heta-compiler/heta-json-schema` and
`heta-compiler/dynms-schema` exports. A schema violation marks the case as
`failed` while preserving `buildStatus: "success"` and validation errors.
The target also receives `badge.json`, which is compatible with the
[Shields endpoint badge](https://shields.io/badges/endpoint-badge). It contains
successful assessed cases over all assessed cases; `not-evaluated` cases are
excluded.

`--input-field` accepts `sbmlL3V2Path` (default) or `sbmlL2V5Path`. To build
cases while excluding selected tags from assessment, use
`--skip-component-tags` and `--skip-test-tags`; matching cases keep their build
result but receive status `not-evaluated`.

## GitHub Actions

The manual **Verify heta-compiler conversion** workflow downloads and indexes
the SBML suite, builds L3V2 and L2V5 reports for the chosen heta-compiler ref,
and fails if any selected case has status `failed`. It uploads the generated
build reports for inspection.

## License

See [LICENSE](LICENSE).
