# FCTS Viewers

Dependency-free static page for viewing FCTS reports.

- [`report/`](report/) displays an FCTS `report.json`.

The viewer recognizes `success`, `failed`, and `not-evaluated` case statuses.
Use `not-evaluated` for cases intentionally excluded from assessment; they are
shown in gray and can be filtered separately.
When a report was run with `--skip-component-tags` or `--skip-test-tags`, the
selected tags appear in the overview and the matching tags appear in each
affected case's details.

## Report viewer

Open `report/index.html` in a browser and choose a local `report.json` file.
This mode also works without a web server.

The viewer shows the report description, status, start and completion times, and
all available `generator`, `command`, and `environment` fields as key-value
pairs. Older reports without a description remain supported.

To load a hosted report, enter its URL in the page or add it as a query
parameter:

```text
https://example.org/viewer/report/?ref=https://example.org/reports/master/report.json
```

The report host must permit cross-origin browser requests (CORS).

## Publishing

The `viewer/` directory is published to GitHub Pages by
`.github/workflows/deploy-viewer.yml`. It deploys changes merged into `main`
and can also be started manually from the Actions tab. Enable GitHub Pages with
the `GitHub Actions` source in the repository settings before the first deploy.
