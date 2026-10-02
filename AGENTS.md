# AGENTS.md

## Project purpose

This repository is a reproducible format-conversion build test suite. Its
current scope is conversion of the [SBML Semantic Test Suite](https://github.com/sbmlteam/sbml-test-suite)
by `heta-compiler`:

```text
SBML → Heta → canonical JSON + DynMS
```

It verifies that conversion builds produce the required artifacts. It does not
compare generated files with baselines and does not run or validate numerical
simulations.

Future work may add other source formats or build-test types. Keep stages
independent.

## Technology and conventions

- Use Node.js 24 or newer and CommonJS. Prefer Node.js code over shell scripts.
- Code, code comments, report field names, and documentation must be English.
- `heta` is an external executable available on `PATH` (`heta` or the platform
  equivalent). Do not assume a local `heta-compiler/bin/heta.js` installation.
- Invoke external commands without a shell. `cross-spawn` is used for the Heta
  CLI so that the workflow remains cross-platform.
- Paths stored in JSON reports and indexes are repository-relative, use forward
  slashes, and must not escape their intended directory.
- Prefer explicit configuration and deterministic generation. Do not introduce
  hidden caches or implicit state.

## Repository layout

```text
config/options.json       Pinned SBML archive definition
scripts/                  Acquisition, indexing, reporting, and configuration validation
bin/fcts.js               CLI entry point (`fcts sbml-report`)
cases/                    Downloaded SBML suite and generated index (gitignored)
results/                  Disposable report runs (gitignored)
viewer/                   Dependency-free static report viewer published to Pages
.github/workflows/        Configuration verification and manual build workflow
```

`config/options.json` is the source of truth for the downloaded test-suite
version, archive URL, checksum, and extraction target. Do not duplicate these
values in scripts.

## Case preparation

### Fetch the SBML suite

```sh
npm run fetch:sbml
```

The script downloads the configured archive, verifies its SHA-256 digest, and
extracts it to the configured target. It deliberately replaces downloaded
`cases/` content on every successful run; this is disposable external input.

### Index cases

```sh
npm run index:sbml
```

The indexer writes `cases/index.json`, with one record per case. A record may
contain `sbmlL2V5Path` and/or `sbmlL3V2Path`; an unavailable version has no
path. It also reads the corresponding `*-model.m` file and records
`componentTags` and `testTags` as arrays. Keep this parser deliberately simple
and tied to the test-suite metadata format.

The index records the pinned test-suite identity, including archive URL and
checksum. It is generated input, not a versioned baseline artifact.

## Building reports

Use the package CLI:

```sh
npx fcts sbml-report --source=cases/index --input-field=sbmlL3V2Path \
  --target=results/candidate --concurrency=1 --skip=0 --limit=10
```

Supported input fields are `sbmlL3V2Path` (the default) and `sbmlL2V5Path`.
The target is always deleted and recreated at the start of a run, so report
runs must use a dedicated target directory.

Every selected case is attempted even if another case fails. For each case the
runner creates `<caseId>/input.heta`, invokes `heta build`, and stores compiler
logs as `<caseId>/build.log` when Heta creates them. A successful case records
paths to canonical JSON and DynMS artifacts relative to the report directory.
Both artifacts are then validated against their corresponding public
`heta-compiler` schema exports; a schema violation marks the case as `failed`
with `buildStatus: "success"`. L2V5 builds add standard unit definitions before
including SBML; L3V2 builds do not.

Cases can be excluded from assessment without skipping their build:

```sh
npx fcts sbml-report --source=cases/index --input-field=sbmlL2V5Path \
  --target=results/candidate --skip-component-tags=CSymbolDelay,EventWithDelay \
  --skip-test-tags=FastReaction,VolumeConcentrationRates
```

Matching cases have `status: "not-evaluated"`, retain their generated artifacts
and compiler result in `buildStatus`, and record matching tags. Valid primary
statuses are `success`, `failed`, and `not-evaluated`.

`report.json` is machine-readable. Its `generator` block records the
report-generator type and FCTS package identity; `environment` records the Heta
version and test-suite identity. It also records run metadata, command
parameters, and per-case results. Do not persist a top-level `summary`:
consumers must derive counts from `report.cases`.

Each report target also contains `badge.json` in the Shields endpoint badge
schema. It stores derived successful and assessed case counts only; do not add
them as a report summary.

## Viewer and GitHub Pages

`viewer/` contains a dependency-free static report application. It can load a
local `report.json` or a public report URL through `?ref=<url>` (the remote host
must allow CORS). It displays report metadata and derived case counts, and
renders `not-evaluated` cases in gray, including their exclusion tags.

`.github/workflows/deploy-viewer.yml` publishes `viewer/` to GitHub Pages.
Keep the viewer static: it must work locally without a build step and on Pages.

## CI and verification

- `npm run verify:config` checks that the configured archive URL is reachable
  and validates its pinned configuration. It does not execute Heta or require
  downloaded cases.
- Configuration verification runs on pushes, pull requests, and manual runs.
- CI uses Node.js 24 and current major GitHub Actions versions.
- `Verify heta-compiler conversion` is a manual workflow for a selected
  `heta-compiler` ref. It generates L2V5 and L3V2 reports, fails when any case
  fails to build, and uploads the reports for inspection.
- For changes to reporting scripts, at minimum run Node syntax checks and a
  small report target if Heta and downloaded cases are available.
- For changes to configuration validation, run `npm run verify:config`.

## Rules for agents

- Preserve deterministic behavior and keep stages independently executable.
- Do not modify downloaded cases or generated report results beyond the scope
  explicitly requested by the user.
- Keep reports machine-readable and backward-compatible where practical.
- When adding report fields, update the viewer and validation only when they
  genuinely consume the field; do not duplicate derived data.
- Update `README.md` and `viewer/README.md` when user-facing commands,
  configuration, or viewer behavior change.
