# AGENTS.md

## Project purpose

This repository is a reproducible format-conversion test suite. Its current
scope is conversion of the [SBML Semantic Test Suite](https://github.com/sbmlteam/sbml-test-suite)
by `heta-compiler`:

```text
SBML → Heta → canonical JSON + DynMS
```

It validates conversion outputs, their structure, and reproducibility. It does
not run or validate numerical simulations.

The repository has two complementary roles:

- acquire and index a pinned external SBML test suite;
- keep manually approved converter outputs as versioned baselines for future
  comparison.

Future work may add normalization, output comparison, other conversion paths,
and other source formats. Keep these stages independent.

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
config/options.json       Pinned SBML archive and approved reference definitions
scripts/                  Acquisition, indexing, reporting, and validation scripts
bin/fcts.js               CLI entry point (`fcts sbml-report`, `fcts compare`)
cases/                    Downloaded SBML suite and generated index (gitignored)
results/                  Disposable candidate report runs (gitignored)
references/               Versioned, manually approved baseline outputs
viewer/                   Dependency-free static report viewer published to Pages
.github/workflows/        Configuration verification and viewer deployment
```

`config/options.json` is the source of truth for the downloaded test-suite
version, archive URL, checksum, extraction target, and registered references.
Do not duplicate these values in scripts.

## Case preparation

### Fetch the SBML suite

```sh
npm run fetch:sbml
```

The script downloads the configured archive, verifies its SHA-256 digest, and
extracts it to the configured target. It deliberately replaces the downloaded
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

The index is generated input and is not a baseline artifact.

## Building reports

Use the package CLI:

```sh
npx fcts sbml-report --source=cases/index --input-field=sbmlL3V2Path \
  --target=results/candidate --concurrency=1 --skip=0 --limit=10
```

Supported input fields are `sbmlL3V2Path` (the default) and `sbmlL2V5Path`.
The selected field and its format are recorded in the report. The target is
always deleted and recreated at the start of a run, so report runs must use a
dedicated target directory.

Every selected case is attempted even if another case fails. For each case the
runner creates `<caseId>/input.heta`, invokes `heta build`, and stores compiler
logs as `<caseId>/build.log` when Heta creates them. Successful cases reference
their canonical JSON and DynMS artifacts by paths relative to the report
directory. L2V5 builds add standard unit definitions before including SBML;
L3V2 builds do not.

Cases can be excluded from assessment without skipping their build:

```sh
npx fcts sbml-report --source=cases/index --input-field=sbmlL2V5Path \
  --target=results/candidate --skip-component-tags=CSymbolDelay,EventWithDelay \
  --skip-test-tags=FastReaction
```

Matching cases have `status: "not-evaluated"`, retain their generated artifacts
and compiler result in `buildStatus`, and record the matched component and/or
test tags. Valid primary statuses are `success`, `failed`, and
`not-evaluated`.

`report.json` is the machine-readable report. Its `generator` block records
the report-generator type (`sbml-report`) and the FCTS package version. It also
records run metadata, command parameters, selected input format, the runtime
environment, pinned test-suite identity, and per-case results. Do not persist a
top-level `summary`: consumers must derive counts from `report.cases` so that
manually edited statuses remain consistent automatically.

`fcts compare --reference=<directory> --candidate=<directory>` is the first
comparison stage. It checks that a candidate contains no case IDs absent from
the reference, writes `compare.json` beside the candidate report, and prints
independent status and artifact-presence statistics for canonical JSON and
DynMS. An incompatible candidate is recorded in that file rather than treated
as a command failure. Its `generator` block identifies the comparison generator
and package version; reference and candidate generator types are recorded but
are not required to match. It does not yet compare individual artifact contents
or calculate a score.

## References

`references/` contains approved baselines, such as the L2V5 and L3V2 master
reports defined in `config/options.json`. These files are part of the repository
and may be reviewed or corrected manually.

Never generate directly into a reference directory and never automatically
replace approved reference files. A developer must explicitly approve and copy
candidate results into a reference. Preserve manual status decisions, notably
`not-evaluated` for deliberately unsupported features.

`npm run verify:config` is the lightweight repository check used in CI. It
checks that the configured archive URL is reachable without downloading it and
validates each registered reference report, its suite identity, selected input
field, statuses, and required output artifacts. It does not execute Heta or
require `cases/` to be downloaded.

## Viewer and GitHub Pages

`viewer/` is a dependency-free static application. It can load a local
`report.json` or a public report URL through `?ref=<url>` (the remote host must
allow CORS). It calculates overview counts from case records and renders
`not-evaluated` cases in gray, including their exclusion tags.

`.github/workflows/deploy-viewer.yml` publishes `viewer/` to GitHub Pages.
Keep the viewer static: it must work locally without a build step and on Pages.

## CI and verification

- Configuration verification runs on pushes, pull requests, and manual runs.
- CI uses Node.js 24 and current major GitHub Actions versions.
- Do not add Heta conversion runs to the default CI workflow: the full suite is
  external, slow, and intended for explicit baseline or candidate runs.
- For changes to reporting scripts, at minimum run Node syntax checks and a
  small non-reference report target if Heta and downloaded cases are available.
- For changes to configuration or reference validation, run
  `npm run verify:config`. Report unrelated missing baseline artifacts rather
  than silently altering a reference to make the check pass.

## Rules for agents

- Preserve deterministic behavior and keep stages independently executable.
- Do not modify downloaded cases, generated candidate results, or approved
  references beyond the scope explicitly requested by the user.
- Do not make a generated output become a baseline implicitly.
- Keep reports machine-readable and backward-compatible where practical.
- When adding report fields, update the viewer and validation only when they
  genuinely consume the field; do not duplicate derived data.
- Update `README.md` and `viewer/README.md` when user-facing commands,
  configuration, or viewer behavior change.
