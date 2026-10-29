# Home weather

Home reads weather from the private, read-only system adapter at `GET /api/system/weather`. The browser receives only a place label, current condition, temperature, optional wind speed, timestamps and a stale flag. Coordinates stay on the server; there is no client API key.

Configure the adapter process with:

- `WIZARD_WEATHER_LATITUDE`: coarse latitude, required with longitude.
- `WIZARD_WEATHER_LONGITUDE`: coarse longitude, required with latitude.
- `WIZARD_WEATHER_LABEL`: optional owner-facing place label, defaults to `Local`.
- `WIZARD_WEATHER_ALLOWED_LOGIN`: exact Tailscale login allowed to read weather; required for the route to return weather.

The adapter rounds coordinates to a coarse 0.1-degree grid (roughly 11 km north-south) before use. Open-Meteo receives those rounded coordinates over HTTPS; the browser never receives them. With neither coordinate set, the endpoint returns `{ "configured": false }` and Home leaves the weather row hidden. A partial or invalid coordinate configuration fails adapter startup rather than silently reading the wrong place.

The adapter uses Open-Meteo over HTTPS, times out each provider read after five seconds, caches a successful reading for ten minutes, and may serve that last reading as stale for up to six hours when the provider is unavailable. Concurrent refreshes share one provider request. After a failed refresh, the adapter serves the stale reading without retrying Open-Meteo more than once per ten-minute refresh interval. It never blocks the rest of Home.

The private gateway must authenticate the exact `/api/system/weather` path, strip caller-supplied identity, and reverse-proxy it to the same loopback adapter as the existing system resource routes. The adapter then compares that verified identity with `WIZARD_WEATHER_ALLOWED_LOGIN` and fails closed when the owner login is absent or different. `tools/system-resources.Caddyfile` carries the route template.

Deployment is two-part and must stay version-aligned: the Wizard UX release supplies the browser module, while the private host adapter supplies `tools/system-resources.mjs` and `tools/system-weather.mjs` plus the gateway route. Pin both adapter files to the same source revision, restart the loopback adapter, verify the authenticated route, then roll out the matching UX image. The image does not run the host adapter itself. A mixed or unconfigured deployment fails quietly with no weather row; it never blocks the rest of Home.
