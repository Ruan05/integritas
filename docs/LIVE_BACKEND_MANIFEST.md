# Integritas Live Backend Manifest

This file records non-secret deployment metadata for drift detection only. It intentionally does **not** include Edge Function source, credentials, environment variables, case data, or private investigation material because this repository is public.

Captured from the live Supabase project `leuixjgmlueptefintgo` on 2026-09-13.

| Function | Version | verify_jwt | Source hash (ezbr_sha256) |
| --- | ---: | :---: | --- |
| integritas-opencode-bridge | 3 | false | `b169c3fe4d40c6b256a41b0d463b7778fe783f96d7d8f3f7d8f9a53b0d5d96d4` |
| opencode-bridge-health | 1 | true | `a3483e7df36a928f5a83622dc7f413bb17f3d58a258b02ceda2ac02de5dff44c` |
| opencode-worker | 5 | false | `0eb9feb5812ddb438d27b035ff9b870d2906efc699b72b1863b2b894bce9f0e2` |
| opencode-selftest | 1 | true | `391cfd66ac4a71e0278af2e787650a67c802a24946f621b306c1cd90be141c7d` |
| opencode-selftest-v2 | 1 | true | `32f960a982947a57f9d5c9fdd4a4e4671c3f68ef36567bd52319442c677a951e` |
| opencode-mcp | 1 | false | `774e83bad9dce25bb3604a28885deb43b5db5bf92a0990fa20da5e09d2fba29d` |
| oauth-ui | 1 | false | `ad6f0c3621f23d780ac42b97fa9414c11a9a33b80f98e490b707aa6557f8fd40` |
| opencode-efficiency-test | 2 | false | `8e22c3080b56e98a4ec20b0d5cde1e905ac38d3452edb2f511c901fc04d8cf70` |
| opencode-architecture-review | 1 | false | `0ff380a656a65aa0edad5ff52b71284a405a9173e35cffe1867d5b5ebe7a054f` |
| integritas-admin-api | 14 | false | `4848c5defb709b98ba15285077ddaf333fb88f5ee56f3a550e0d08856e736f5c` |
| publish-integritas-admin-ui | 3 | true | `0863220fe0d720cecccf66a2856ab814feb1e22cd01760872b8c22bb89a1bbc5` |
| publish-integritas-admin-appjs | 2 | true | `b4f106af9e1f619038a8cc7336d70c9762a2cd23293808fb36d0e8b74a26b641` |
| publish-integritas-admin-static | 4 | false | `bf762ddd98f56ff8c6940b4ae26c6d6225538f6ed69d47c156889db5093d6519` |
| integritas-admin-app | 5 | false | `bd0d6e457d3b5dcd70cee0b4412373bd85c442d99b1350cdc3c4afd06b8f4dd6` |
| integritas-netlify-publisher | 1 | false | `9e350f6135961dd4b5a113e7f6a5007c9c11ddd8c7a3497cfbd83f1150e97c3f` |
| integritas-e2e-selftest | 4 | false | `c7a9f967bb6c043ddb3a62ed65e9448ffdd898285e8d3948a8a4f61ed86a7b9f` |

## Rules

- Treat this manifest as an observation, not as deployment authority.
- Before changing a live function, re-read the live function metadata and confirm the version/hash has not drifted.
- Do not commit live function source to this public repository until repository visibility and the backend-source disclosure policy are explicitly approved.
- Functions with `verify_jwt=false` may implement custom authentication internally; do not flip that flag blindly without reviewing the live function contract.
