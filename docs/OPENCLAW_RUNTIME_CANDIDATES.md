# OpenClaw runtime candidate review

Captured 2026-09-13 for the Oracle handoff. Re-check immediately before production deployment because OpenClaw releases and issue severity can change quickly.

## Current stable candidate

- Stable release observed: `2026.9.4`.
- Official browser image: `ghcr.io/openclaw/openclaw:2026.9.4-browser`.
- Official GHCR package currently exposes a Linux ARM64 pull reference for that tag at:
  `ghcr.io/openclaw/openclaw:2026.9.4-browser@sha256:3d955ef55280c7f9118a1b351268613d5d9a56396b7206ae375e9f4c72fb1501`
- Multi-platform package digest shown for the browser tag at capture time:
  `sha256:0862ab9a097166049800a6c86026b035b768af0949f651d0e73222555b28fbbd`

Treat these as discovery evidence only until the Oracle host independently pulls/inspects the image and `infra/openclaw/verify-image.sh` verifies the selected immutable ARM64 reference.

## Extended Stable candidate

- Extended Stable/LTS observed: `2026.6.35`.
- Release notes describe it as the final June 2026 Extended Stable release, with safer provider/channel boundaries and more reliable long-running retry/cancellation behavior.
- Prefer smoke-testing its official `-browser` image alongside current stable if the production priority is conservative runtime continuity.
- Resolve and record its current ARM64 digest from official GHCR on the Oracle host before use; do not guess a digest and do not deploy a moving `extended-stable-browser` tag by itself.

## Current risk signal

The 2026.9.x line has fresh reports involving update/recovery and continuity behavior, including P0-labelled update failures and a reported 2026.9.3 continuity regression. Therefore `2026.9.4-browser` is a **candidate for disposable smoke testing, not an automatic production selection**.

## Selection gate

On the real Oracle ARM64 host, compare at minimum:

1. current stable browser image;
2. current Extended Stable browser image.

For each candidate prove:

- immutable digest and `linux/arm64` platform;
- Gateway startup and health;
- provider model completion;
- session creation and continuity after restart;
- sandbox execution with the approved restrictions;
- managed Chromium launch and Playwright navigation;
- no unexpected privileged/public listening port;
- clean shutdown/restart;
- recovery from one deliberately interrupted job;
- rollback to the second recorded digest.

Choose the production digest only from this live evidence. Record both the selected production digest and known-good rollback digest in the execution ledger before final approval.
