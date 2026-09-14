# OpenClaw rollback runbook

The Oracle host-native installer records the last successfully installed OpenClaw version at:

`/var/lib/openclaw/integritas/previous-version`

Rollback is intentionally version-based and operator-controlled. The bounded host helper performs the only supported rollback path:

```bash
sudo /usr/local/sbin/integritas-hostctl rollback
```

The helper validates the recorded version, reinstalls that exact pinned OpenClaw release with the same supported Node runtime, rebuilds the matching official sandbox images, validates configuration, restarts the systemd Gateway, and confirms deep RPC health before reporting success.

If the current release changed persistent data in an incompatible way, restore a verified OpenClaw backup before starting the older Gateway. Do not force a downgrade across an incompatible state/schema migration.

Rollback does not alter Supabase production data, Integritas RLS, the public website, or repository history.
