# Format Conversion Test Suite

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
npx fcts report --source=cases/index --target=results/candidate --concurrency=1 --skip=0 --limit=10
```

The target directory is replaced for each run. `report.json` records every
case's build status and, for successful cases, the relative paths to canonical
JSON and DynMS output files.

## Report viewer

The dependency-free static report viewer is in [`viewer/`](viewer/). It loads a
local report through a file picker or a public report URL through the `ref`
query parameter. See [`viewer/README.md`](viewer/README.md) for usage and
GitHub Pages publishing notes.

For historical context on the removed predecessor, see
[`docs/legacy-cases-visualization.md`](docs/legacy-cases-visualization.md).

## License

See [LICENSE](LICENSE).
