#!/usr/bin/env bash
# Run on Lightsail as root. Only Aether containers are replaced.
set -Eeuo pipefail
APP=aether-ai
PREVIOUS=aether-ai-previous
BASE=/opt/aether

exists() { docker container inspect "$1" >/dev/null 2>&1; }
rollback() {
    if ! exists "$PREVIOUS"; then echo "No previous Aether container is available." >&2; return 1; fi
    if exists "$APP"; then docker rm -f "$APP" >/dev/null; fi
    docker rename "$PREVIOUS" "$APP"
    docker start "$APP" >/dev/null
    echo "Previous Aether container restored. Check http://127.0.0.1:8016/api/health"
}
if [[ "${1:-}" == --rollback ]]; then rollback; exit; fi
TAG="${1:?Usage: sudo bash /opt/aether/deploy.sh YYYYMMDD-HHMMSS}"
[[ "$TAG" =~ ^[0-9]{8}-[0-9]{6}$ ]] || { echo "Invalid release tag" >&2; exit 1; }
IMAGE="aether-ai:$TAG"
docker image inspect "$IMAGE" >/dev/null
test -f "$BASE/app.env"
install -d -m 0750 -o 10001 -g 10001 "$BASE/state"
# Dotenv reads the mounted file itself: quotes, CRLF and dollar signs stay correct.
# This checks permissions/imports without calling any billed model endpoint.
docker run --rm --mount "type=bind,src=$BASE/app.env,dst=/app/.env,readonly" -e APP_ROOT_PATH=/aether -e HARNESS_EXECUTION_MODE=numerical --entrypoint python "$IMAGE" -c 'import os,json; from pathlib import Path; from backend.main import app; from backend.agent import configured_provider; print(json.dumps({"provider":configured_provider(),"key_configured":bool(os.getenv("OPENAI_API_KEY")),"root_path":app.root_path,"execution_mode":os.getenv("HARNESS_EXECUTION_MODE")})); assert configured_provider()!="openai" or os.getenv("OPENAI_API_KEY"), "OpenAI provider needs a server-side key"; assert "/aether/assets/" in Path("/app/dist/index.html").read_text(), "Rebuild with --build-arg APP_BASE_PATH=/aether/"'
if exists "$APP"; then
    if exists "$PREVIOUS"; then docker rm -f "$PREVIOUS" >/dev/null; fi
    docker stop "$APP" >/dev/null
    docker rename "$APP" "$PREVIOUS"
fi
if ! docker run -d --name "$APP" --restart unless-stopped --init --security-opt no-new-privileges:true --cap-drop ALL --pids-limit 128 --log-opt max-size=10m --log-opt max-file=3 --mount "type=bind,src=$BASE/app.env,dst=/app/.env,readonly" --mount "type=bind,src=$BASE/state,dst=/app/.aether" -e APP_ROOT_PATH=/aether -e HARNESS_EXECUTION_MODE=numerical --add-host host.docker.internal:host-gateway -p 127.0.0.1:8016:8000 "$IMAGE"; then
    echo "Container creation failed; restoring previous Aether if available" >&2
    if exists "$PREVIOUS"; then rollback; elif exists "$APP"; then docker rm -f "$APP" >/dev/null; fi
    exit 1
fi
for attempt in {1..30}; do
    if curl --fail --silent --show-error http://127.0.0.1:8016/api/health; then
        echo
        echo "Aether $TAG is healthy. Existing app on port 8002 was not changed."
        exit 0
    fi
    sleep 1
done
docker logs --tail 80 "$APP" >&2 || true
echo "Health check failed; restoring previous Aether if available" >&2
if exists "$PREVIOUS"; then rollback; else docker rm -f "$APP" >/dev/null; fi
exit 1
