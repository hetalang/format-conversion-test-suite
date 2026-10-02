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
test-suite identity. Each case also has normalized simulation settings,
including time grids where a case defines one, tolerances, selected
amount/concentration variables, and repository-relative paths to the original
settings file and reference CSV. Steady-state cases have no `timeCourse` field.
For each available SBML version, `simulation.speciesOutputsByInputField` records
each requested species' compartment, its value type in the model, and the value
type requested by the reference CSV. The model type is amount when
`hasOnlySubstanceUnits="true"` or the compartment has `spatialDimensions="0"`;
otherwise it is concentration.
The reference values themselves remain in the downloaded Semantic Test Suite.
Both `cases/` and `results/` are generated and ignored by Git.

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

`--input-field` accepts `sbmlL3V2Path` (default), `sbmlL3V1Path`, or
`sbmlL2V5Path`. To build cases while excluding selected tags from assessment, use
`--skip-component-tags` and `--skip-test-tags`; matching cases keep their build
result but receive status `not-evaluated`. Excluded cases do not affect the
overall report status: a report is `success` when every assessed case succeeds.

## Simulate DynMS output

The simulation command creates the same per-case Heta project structure
as the conversion report, then passes that project to DynMSR `heta_load()`.
DynMSR performs the Heta-to-DynMS import, runs mrgsolve with the indexed time
grid, and compares the result with the Semantic Test Suite CSV. The solver uses
one tenth of the case's absolute and relative tolerances; comparison uses the
original case tolerances.
Output times are compared with a fixed absolute tolerance of `1e-6`.
The mrgsolve solver uses `hmax = 0.01` and `maxsteps = 100000` for every
simulation.
When the reference requests a different species value type, the runner uses the
compartment size at each output time to convert amount to concentration or vice
versa. The generated `simulation.csv` uses the reference's variable names and
value types:

```sh
npx fcts sbml-dynms-simulation --source=cases/index --input-field=sbmlL3V2Path \
  --target=results/simulation --concurrency=1 --limit=10
```

Before it begins, the command checks that DynMSR is installed in the active R
library and records the installed DynMSR and DynMS format versions. The command
supports `sbmlL2V5Path` (the default), `sbmlL3V1Path`, and `sbmlL3V2Path`.
Each simulated variable also receives a PNG plot that overlays the reference
and DynMSR/mrgsolve result; plots are retained even when comparison fails.

## GitHub Actions

The manual **Verify heta-compiler conversion** workflow downloads and indexes
the SBML suite, builds L3V2 and L2V5 reports for the chosen heta-compiler ref,
and fails if any selected case has status `failed`. It uploads the generated
build reports for inspection.

## License

See [LICENSE](LICENSE).
