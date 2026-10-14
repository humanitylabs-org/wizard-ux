# QA targets

QA scripts never carry a real Wizard's address. They read it from the environment and fall back to neutral
example names (reserved, never resolvable in practice):

| Variable | Default | Used for |
|---|---|---|
| `WIZARD_QA_ORIGIN` | `https://wizard.example.ts.net` | The Wizard under test: Playwright target/host-resolver mapping, native QA reachability probes and request audits. For native (emulator) QA it must equal the APK's `wizardOrigin` Gradle property. |
| `WIZARD_QA_LEGACY_HOST` | `old-name.example.com` | An older name of the same Wizard (the APK's first `wizardLegacyHosts` entry), for the carry/fallback suites. |
| `WIZARD_QA_PREVIEW_DOMAIN` | `staging.example.com` | Preview hosts are `<name>.<this>`; anything containing `.staging.` is treated as a preview by the shell. |

Keep your own values in `qa.local.env` at the repo root (gitignored):

```sh
WIZARD_QA_ORIGIN=https://<machine>.<tailnet>.ts.net
WIZARD_QA_LEGACY_HOST=<old-name>
WIZARD_QA_PREVIEW_DOMAIN=staging.<your-domain>
```

and load it with `set -a; . ./qa.local.env; set +a`.

Browser suites that map the host to a local fake (`--host-resolver-rules=MAP <host> 127.0.0.1:<port>`) work with the
example defaults. Suites that read real data (`QA_REAL`, `QA_LIVE`) need the real origin.

`node qa-tailnet-defaults.cjs` checks that every QA script reads these variables, and
`node tests/no-private-config.test.mjs` fails if a private address appears anywhere in the tree.
