# AGENTS.md

## Project

This repository implements a reproducible test framework for validating model format conversion pipelines.

The initial workflow is:

```
SBML
  ↓
Heta canonical JSON
  ↓
DynMS
```

Future versions may include additional conversion steps and model formats.

This repository does **not** verify numerical simulations. It verifies only format conversion, canonicalization, structural correctness, and reproducibility.

Simulation validation belongs to separate repositories.

---

## Goals

- Verify that supported model formats are converted reproducibly.
- Detect unintended changes in generated outputs.
- Generate reproducible reports for every tested tool version.
- Provide long-term regression testing for model converters.

---

## Scope

Current scope:

- SBML Semantic Test Suite
- heta-compiler
- Heta canonical JSON
- DynMS

Future scope may include:

- Heta → DynMS
- DynMS → other formats
- Additional converters

---

## Repository architecture

```
SBML Test Suite
        │
        ▼
 Acquire test cases
        │
        ▼
 Run converter
        │
        ▼
 Collect outputs
        │
        ▼
 Normalize outputs
        │
        ▼
 Compare with approved references
        │
        ▼
 Generate reports
```

Every stage should be independent and testable.

---

## Technology

The project should primarily use **Node.js**.

Reasons:

- cross-platform
- good JSON support
- easy process execution
- same ecosystem as heta-compiler

Shell scripts should only be used as thin wrappers.

---

## Reference outputs

Reference outputs are part of the repository.

Generated outputs must **never** automatically replace reference files.

Reference update should be an explicit approval step performed by a developer.

---

## Reports

Each run should generate:

- machine-readable JSON report
- human-readable Markdown report
- execution log
- tool versions
- execution time
- summary statistics

Reports should be reproducible.

---

## Versioning

Every report should record:

- converter name
- converter version
- test suite version
- SBML Test Suite commit
- execution timestamp
- operating system

---

## Design principles

- Keep the pipeline deterministic.
- Prefer explicit configuration over hardcoded behavior.
- Separate conversion from comparison.
- Separate normalization from validation.
- Avoid hidden state.
- Keep every stage independently executable.

---

## Testing

The project itself should have unit tests for:

- downloading test cases
- normalization
- comparison
- report generation
- configuration parsing

Actual model conversion testing is performed by executing external tools.

---

## Future directions

Potential future additions:

- support for additional model formats
- GitHub Pages report publishing
- compatibility dashboard
- automated release testing
- cross-tool comparison
- plugin architecture for converters

---

## Notes for AI agents

When extending the project:

- preserve deterministic behavior;
- do not modify approved reference files automatically;
- keep reports machine-readable;
- avoid tool-specific assumptions inside the core framework;
- keep converters isolated behind a common interface;
- write all code, comments, and documentation in English.