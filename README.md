# Format Conversion Test Suite

The repository is designed to test Heta format conversion on the
[SBML Semantic Test Suite](https://github.com/sbmlteam/sbml-test-suite).

[![Heta project](https://img.shields.io/badge/%CD%B1-Heta_project-blue)](https://hetalang.github.io/)
[![GitHub issues](https://img.shields.io/github/issues/hetalang/format-conversion-test-suite.svg)](https://github.com/hetalang/format-conversion-test-suite/issues/)
[![GitHub license](https://img.shields.io/github/license/hetalang/format-conversion-test-suite.svg)](https://github.com/hetalang/format-conversion-test-suite/blob/master/LICENSE)

A reproducible test framework for validating model format-conversion pipelines.

The initial workflow is:

```text
SBML → Heta → canonical JSON + DynMS
```

This project checks conversion, canonicalization, structural correctness, and
reproducibility. It does not validate numerical simulations.

## Goals

- Detect unintended changes in converter output.
- Compare normalized generated files with approved reference outputs.
- Support long-term regression testing of model converters.

## Report viewer

<https://hetalang.github.io/format-conversion-test-suite/>

The dependency-free static report viewer is in [`viewer/`](viewer/). It loads a
local report through a file picker or a public report URL.
See [`viewer/README.md`](viewer/README.md) for usage.

For references use:
- [SBML L3V2 Reference Report](https://hetalang.github.io/format-conversion-test-suite?ref=https://raw.githubusercontent.com/hetalang/format-conversion-test-suite/refs/heads/main/references/sbml-L3V2-3.5.0/master/report.json)
- [SBML L2V5 Reference Report](https://hetalang.github.io/format-conversion-test-suite?ref=https://raw.githubusercontent.com/hetalang/format-conversion-test-suite/refs/heads/main/references/sbml-L2V5-3.5.0/master/report.json)


## Cases preparation

### Download SBML Semantic Test Suite

Repository-wide settings are stored in
[`config/options.json`](config/options.json). The initial configuration records
the SBML Semantic Test Suite version, archive URL, expected SHA-256 digest, and
the extracted `semantic` directory (`targetDir`). The digest must be verified
before an archive is used.

```sh
npm run fetch:sbml
```

The archive is checked before extraction and its contents are placed in
`cases/`. Each run replaces the existing downloaded test suite. The archive's
`semantic` directory is therefore available as `cases/semantic`.

### Verify configuration and references

Verify the configured archive URL, reference reports, and reference artifacts:

```sh
npm run verify:config
```

The command uses an HTTP `HEAD` request (with a small range-request fallback)
to confirm that the archive is available without downloading or extracting it.
It also checks that every configured reference report matches the configured
test-suite version, checksum, input field, and expected output artifacts.

### Create index

To create an index of the downloaded cases, including all SBML Level 3 Version
2 files, run:

```sh
npm run index:sbml
```

This command writes a reproducible `cases/index.json` with one record per case,
relative paths to available SBML L2V5 and L3V2 files, and summary counts.

### Build master report

Build the indexed SBML L3V2 cases and write converter outputs with a JSON
report:

```sh
npx fcts sbml-report --source=cases/index --input-field=sbmlL3V2Path --target=results/candidate --concurrency=1 --skip=0 --limit=10
```

The target directory is replaced for each run. `report.json` records every
case's build status and, for successful cases, the relative paths to canonical
JSON and DynMS output files. The optional `--input-field` selects the SBML path
field from each case: `sbmlL3V2Path` (the default) or `sbmlL2V5Path`. The
selected field and its SBML format are recorded in `report.json`.

To build all cases but exclude selected component or test tags from evaluation,
use `--skip-component-tags` and `--skip-test-tags`. Matching cases have status
`not-evaluated`; their artifacts and actual compiler result are still kept in
the report.

```sh
npx fcts sbml-report --source=cases/index --input-field=sbmlL2V5Path --target=results/candidate --skip-component-tags=CSymbolDelay,EventWithDelay --skip-test-tags=FastReaction
```

Each case is built through a generated `input.heta` stored beside its outputs.
For L2V5, this wrapper defines the standard `volume`, `area`, `length`,
`substance`, and `time` units before including the SBML source. L3V2 uses the
same wrapper flow without adding those L2-specific definitions.

For an SBML L2V5 run, use:

```sh
npx fcts sbml-report --source=cases/index --input-field=sbmlL2V5Path --target=results/candidate-l2v5 --concurrency=1
```

## Compare reports

The initial comparison command checks whether every case in a candidate report
is also present in a reference report. It writes `compare.json` beside the
candidate report and prints status counts and separate canonical JSON and DynMS
artifact statistics for both reports. It does not yet compare individual
artifact contents.

```sh
npx fcts compare \
  --reference=references/sbml-L3V2-3.5.0/master \
  --candidate=results/sbml-L3V2-3.5.0/heta-0.13.0
```

Both arguments can be a report directory or a direct path to `report.json`.
Use `--output=<path>` to write the comparison to another location. An
incompatible candidate is recorded in `compare.json` with
`candidateIsSubsetOfReference: false`; this is a comparison result, not a
command error.

## License

See [LICENSE](LICENSE).
