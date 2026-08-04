# FCTS Report Viewer

A dependency-free static page for viewing an FCTS `report.json`.

The viewer recognizes `success`, `failed`, and `not-evaluated` case statuses.
Use `not-evaluated` for cases intentionally excluded from assessment; they are
shown in gray and can be filtered separately.

## Local use

Open `index.html` in a browser and choose a local `report.json` file. This mode
also works without a web server.

To load a hosted report, enter its URL in the page or add it as a query
parameter:

```text
https://example.org/viewer/?ref=https://example.org/reports/master/report.json
```

The report host must permit cross-origin browser requests (CORS).

## Publishing

The `viewer/` directory is ready to publish as a GitHub Pages static site. It
does not require a build step or server-side code.
