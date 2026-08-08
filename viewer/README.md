# FCTS Viewers

Dependency-free static pages for viewing FCTS reports and comparisons.

- [`report/`](report/) displays an FCTS `report.json`.
- [`compare/`](compare/) displays an FCTS `compare.json` for canonical JSON or
  DynMS.

The viewer recognizes `success`, `failed`, and `not-evaluated` case statuses.
Use `not-evaluated` for cases intentionally excluded from assessment; they are
shown in gray and can be filtered separately.
When a report was run with `--skip-component-tags` or `--skip-test-tags`, the
selected tags appear in the overview and the matching tags appear in each
affected case's details.

## Report viewer

Open `report/index.html` in a browser and choose a local `report.json` file.
This mode also works without a web server.

To load a hosted report, enter its URL in the page or add it as a query
parameter:

```text
https://example.org/viewer/report/?ref=https://example.org/reports/master/report.json
```

The report host must permit cross-origin browser requests (CORS).

## Comparison viewer

Open `compare/index.html` and choose a local `compare.json`, or load it from a
URL with `?ref=<url>`. It shows the case availability status and, for
`success-success` cases, whether the selected JSON artifacts are equal or
different. When a comparison is loaded from a URL, its diff files are loaded on
demand from paths stored in `compare.json`; the hosting site must permit CORS.

## Publishing

The `viewer/` directory is published to GitHub Pages by
`.github/workflows/deploy-viewer.yml`. It deploys changes merged into `main`
and can also be started manually from the Actions tab. Enable GitHub Pages with
the `GitHub Actions` source in the repository settings before the first deploy.
