# OpenClaw rollback runbook

The Oracle host-native installer records the last successfully installed OpenClaw version at:

`/var/lib/openclaw/integritas/previous-version`

Rollback is intentionally **not** exposed through the routine OCI Run Command allowlist. It is an authenticated operator action performed from OCI Cloud Shell or another approved console session after checking that the older release is compatible with the current OpenClaw state.

On the Oracle host, read the recorded version and rerun the same pinned installer with that exact target:

```bash
PREVIOUS="$(sudo cat /var/lib/openclaw/integritas/previous-version)"
sudo OPENCLAW_TARGET_VERSION="${PREVIOUS}" bash /opt/integritas/openclaw/install-native.sh
```

The installer validates the version format, installs that exact OpenClaw release with the supported pinned Node runtime, rebuilds the matching official sandbox images, validates configuration, restarts the systemd Gateway, and requires deep RPC health before reporting success.

If the current release changed persistent data in an incompatible way, restore a verified OpenClaw backup before starting the older Gateway. Do not force a downgrade across an incompatible state/schema migration.

Rollback does not alter Supabase production data, Integritas RLS, the public website, or repository history.
