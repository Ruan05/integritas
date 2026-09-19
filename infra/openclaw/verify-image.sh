#!/usr/bin/env bash
set -euo pipefail

IMAGE="${OPENCLAW_IMAGE:-}"

if [[ -z "${IMAGE}" ]]; then
  echo "Set OPENCLAW_IMAGE to an immutable image reference, e.g. ghcr.io/openclaw/openclaw:<version>-browser@sha256:<digest>" >&2
  exit 2
fi

if [[ "${IMAGE}" != *@sha256:* ]]; then
  echo "Refusing mutable image reference. OPENCLAW_IMAGE must contain @sha256:<digest>." >&2
  exit 3
fi

case "${IMAGE}" in
  ghcr.io/openclaw/openclaw:*) ;;
  *)
    echo "Unexpected image repository: ${IMAGE}" >&2
    exit 4
    ;;
esac

docker pull "${IMAGE}"

ARCH="$(docker image inspect "${IMAGE}" --format '{{.Architecture}}')"
OS="$(docker image inspect "${IMAGE}" --format '{{.Os}}')"
DIGESTS="$(docker image inspect "${IMAGE}" --format '{{json .RepoDigests}}')"

if [[ "${OS}" != "linux" ]]; then
  echo "Image OS is ${OS}; expected linux." >&2
  exit 5
fi

if [[ "${ARCH}" != "arm64" ]]; then
  echo "Image architecture is ${ARCH}; Oracle A1 requires arm64." >&2
  exit 6
fi

echo "Verified immutable OpenClaw image"
echo "Reference: ${IMAGE}"
echo "OS/Arch: ${OS}/${ARCH}"
echo "RepoDigests: ${DIGESTS}"
echo "Next: run the disposable OpenClaw smoke test before adopting this digest."
