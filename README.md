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
- Produce reproducible JSON and Markdown reports with logs, versions, timings,
  and summary statistics.
- Support long-term regression testing of model converters.

## Configuration

Repository-wide settings are stored in
[`config/options.json`](config/options.json). The initial configuration records
the SBML Semantic Test Suite version, archive URL, expected SHA-256 digest, and
the extracted `semantic` directory (`targetDir`). The digest must be verified
before an archive is used.

To download and prepare the configured SBML cases, run:

```sh
npm run fetch:sbml
```

The archive is checked before extraction and its contents are placed in
`cases/`. Each run replaces the existing downloaded test suite. The archive's
`semantic` directory is therefore available as `cases/semantic`.

To create an index of the downloaded cases, including all SBML Level 3 Version
2 files, run:

```sh
npm run index:sbml
```

This command writes a reproducible `cases/index.json` with one record per case,
relative paths to available SBML L2V5 and L3V2 files, and summary counts.

## License

See [LICENSE](LICENSE).
