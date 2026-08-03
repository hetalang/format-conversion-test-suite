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

## License

See [LICENSE](LICENSE).
