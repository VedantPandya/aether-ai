# Deploy Aether at https://agent.vedantpandya.com/aether/

Uses your existing Lightsail host **3.9.76.187**, SSH user **ubuntu**, and Caddy domain. Aether runs in a separate container on **127.0.0.1:8016**, alongside your existing app on **8002**. Docker publishes **127.0.0.1:8016:8000**: the Dockerfile's internal server, EXPOSE and health check stay on **8000**. Local Compose also publishes host port **8016**. No DNS changes or new public ports are needed.

Every command block below contains **one physical line**. Run them in order, in the indicated terminal, and stop if any command fails. Start Docker Desktop with Linux containers first.

## Fix 404 responses for /aether/assets/

If the HTML loads but its JavaScript and CSS return 404, the deployed Caddy route may be stripping `/aether` even though FastAPI is configured with `APP_ROOT_PATH=/aether`. Caddy must preserve the prefix for this app. In the Lightsail SSH session, run this one line to back up the route, switch `handle_path` to `handle`, validate and reload. If validation or reload fails, it restores the route file:

```bash
sudo cp /etc/caddy/aether.routes /etc/caddy/aether.routes.pre-path-fix && sudo sed -i 's|handle_path /aether/\*|handle /aether/*|' /etc/caddy/aether.routes && (sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy || { sudo cp /etc/caddy/aether.routes.pre-path-fix /etc/caddy/aether.routes; echo 'Route restored; inspect Caddy before retrying.'; exit 1; })
```

Cloudflare may have cached the 404 responses. After fixing the origin, use Cloudflare **Caching > Configuration > Custom Purge > URL** to purge the affected asset URLs, then hard-refresh the browser. Purge only the affected URLs so the other application is not disturbed. See [Cloudflare's single-file purge guide](https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-single-file/).

## Recover the failed 8003 deployment and move to 8016

Use this section if you already loaded the release image and installed `/opt/aether/app.env`, as in the `Bind for 127.0.0.1:8003 failed: port is already allocated` error. It removes the old/failed Aether containers and deploys the uploaded release on **8016**. The port change does not require an image rebuild. Removing these containers preserves `/opt/aether/state`, the env file and loaded images, but discards the previous rollback container and interrupts any running Aether until deployment finishes.

In **Windows PowerShell**, upload the updated deployment helpers:

```powershell
Set-Location C:\Projects\DevDay-Community-Hackathon\aether-ai
```

```powershell
scp -i "$HOME\.ssh\LightsailDefaultKey-eu-west-2.pem" .\deploy\deploy.sh .\deploy\configure_caddy.py .\deploy\aether.routes "ubuntu@3.9.76.187:/home/ubuntu/aether-upload/"
```

In your **Lightsail SSH session (Bash)**, install the updated script and confirm the uploaded image exists before deleting the old containers:

```bash
sudo install -m 0755 -o root -g root /home/ubuntu/aether-upload/deploy.sh /opt/aether/deploy.sh
```

```bash
sudo install -m 0644 -o root -g root /home/ubuntu/aether-upload/configure_caddy.py /opt/aether/configure_caddy.py
```

```bash
AETHER_TAG=$(tr -d '\r\n' < /home/ubuntu/aether-upload/aether-release.txt); sudo docker image inspect "aether-ai:$AETHER_TAG" --format '{{.RepoTags}}'
```

Inspect the containers and port 8016. If the port checks show a listener or a container publishing 8016, resolve that conflict before continuing. Leave the service using 8003 alone.

```bash
sudo docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'
```

```bash
sudo ss -ltnp 'sport = :8016'
```

Remove only the named Aether containers, including any failed container left by the earlier script. Missing containers are skipped:

```bash
sudo bash -ec 'for container in aether-ai aether-ai-previous; do if docker container inspect "$container" >/dev/null 2>&1; then docker rm -f "$container"; fi; done'
```

```bash
sudo bash /opt/aether/deploy.sh "$AETHER_TAG"
```

```bash
curl --fail --show-error http://127.0.0.1:8016/api/health
```

**Repeat step 4 below**, including uploading/installing the new `aether.routes`, validation and Caddy reload, even if the import already exists: its proxy target must change from 8003 to 8016. Then run the public checks in step 5. Future releases use the normal deployment flow below and keep one previous container for rollback.

## 1. Build on Windows PowerShell

```powershell
Set-Location C:\Projects\DevDay-Community-Hackathon\aether-ai
```

Use the existing **.env in this directory**. Keep it private. Its AGENT_PROVIDER setting determines whether the workspace uses demo, OpenAI or Ollama; voice uses its own OpenAI settings. The server loads this same file with python-dotenv, so quoted values and Windows CRLF work without destructive sed conversions. The public .env.example contains placeholders only.

Create a unique release tag and a small upload manifest; keep this PowerShell session open through the upload steps.

```powershell
$AetherTag = Get-Date -Format 'yyyyMMdd-HHmmss'; New-Item -ItemType Directory -Force .\output\deploy | Out-Null; Set-Content -NoNewline -Encoding ascii -Path .\output\deploy\aether-release.txt -Value $AetherTag
```

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

```powershell
docker version
```

The base path is compiled into frontend URLs. Do not omit this build argument. The image contains the frontend, backend and public assets; it does not contain .env or local run data.

```powershell
docker build --platform linux/amd64 --build-arg APP_BASE_PATH=/aether/ --tag "aether-ai:$AetherTag" .
```

```powershell
docker save --output .\output\deploy\aether-image.tar "aether-ai:$AetherTag"
```

```powershell
Get-FileHash .\output\deploy\aether-image.tar -Algorithm SHA256
```

Keep that hash for the comparison below. Existing app images are not pruned.

## 2. Upload from the same Windows PowerShell session

The upload directory is private to ubuntu; the uploaded .env is not left readable in /tmp.

```powershell
ssh -i "$HOME\.ssh\LightsailDefaultKey-eu-west-2.pem" ubuntu@3.9.76.187 "install -d -m 0700 /home/ubuntu/aether-upload && df -h /"
```

Allow roughly twice the tar size in free server disk space for upload plus docker load.

```powershell
scp -i "$HOME\.ssh\LightsailDefaultKey-eu-west-2.pem" .\output\deploy\aether-image.tar .\output\deploy\aether-release.txt .\deploy\deploy.sh .\deploy\configure_caddy.py .\deploy\aether.routes "ubuntu@3.9.76.187:/home/ubuntu/aether-upload/"
```

This uploads the actual local .env, not .env.example.

```powershell
scp -i "$HOME\.ssh\LightsailDefaultKey-eu-west-2.pem" .\.env "ubuntu@3.9.76.187:/home/ubuntu/aether-upload/.env"
```

```powershell
ssh -i "$HOME\.ssh\LightsailDefaultKey-eu-west-2.pem" ubuntu@3.9.76.187
```

## 3. Install inside the Lightsail SSH session (Bash)

```bash
AETHER_TAG=$(tr -d '\r\n' < /home/ubuntu/aether-upload/aether-release.txt)
```

```bash
sha256sum /home/ubuntu/aether-upload/aether-image.tar
```

Confirm it matches the PowerShell hash before loading.

```bash
sudo install -d -m 0755 /opt/aether
```

The mounted env file is root-owned and readable by container group 10001; it is never baked into the image or printed. Aether's non-root UID/GID is 10001.

```bash
sudo install -m 0640 -o root -g 10001 /home/ubuntu/aether-upload/.env /opt/aether/app.env && rm /home/ubuntu/aether-upload/.env
```

```bash
sudo install -m 0755 -o root -g root /home/ubuntu/aether-upload/deploy.sh /opt/aether/deploy.sh
```

```bash
sudo install -m 0644 -o root -g root /home/ubuntu/aether-upload/configure_caddy.py /opt/aether/configure_caddy.py
```

```bash
sudo docker load --input /home/ubuntu/aether-upload/aether-image.tar
```

This script checks the new image and env permissions before stopping an existing Aether container. It keeps one previous Aether container for rollback, starts the new release, waits up to 30 seconds for health, and restores the previous Aether container if startup fails. Your other app is not stopped.

```bash
sudo bash /opt/aether/deploy.sh "$AETHER_TAG"
```

Expected: healthy JSON, followed by the successful release message. The app reads /opt/aether/app.env through a read-only mount at /app/.env; mission workspaces and flight logs persist in /opt/aether/state. The numerical Python harness works inside this container; nested Docker execution is intentionally not enabled and no Docker socket is mounted. Ollama requires a separately running/reachable Ollama service.

```bash
curl --fail --show-error http://127.0.0.1:8016/api/health
```

## 4. Add /aether/ to the existing Caddy site

Do this after the container is healthy. This uses **/etc/caddy/agent-framework.caddy**, matching your existing deployment notes. If your live site block was moved, pass its actual file path to the installer instead. Do not replace the whole Caddyfile or create a second site block for the same hostname.

```bash
sudo install -m 0644 -o root -g root /home/ubuntu/aether-upload/aether.routes /etc/caddy/aether.routes && sudo sed -i 's|handle_path /aether/\*|handle /aether/*|' /etc/caddy/aether.routes
```

The installer adds one import inside the existing agent.vedantpandya.com block, preserves its routes, saves a timestamped backup and validates the complete config. If validation fails it restores the previous site file; stop and inspect the error. It does not reload Caddy automatically.

```bash
sudo python3 /opt/aether/configure_caddy.py /etc/caddy/agent-framework.caddy
```

```bash
sudo systemctl reload caddy
```

Caddy redirects /aether to /aether/, preserves that prefix when forwarding to 8016, and flushes streaming responses immediately. FastAPI uses APP_ROOT_PATH=/aether and needs the prefix for mounted static assets. Requests outside /aether/ keep using your existing routes. The container uses APP_ROOT_PATH=/aether so API docs and generated runtime URLs also have the correct external prefix.

## 5. Verify publicly

```bash
curl --fail --show-error https://agent.vedantpandya.com/aether/api/health
```

```bash
curl --fail --show-error https://agent.vedantpandya.com/aether/api/voice/status
```

```bash
curl --fail --show-error --output /dev/null https://agent.vedantpandya.com/aether/
```

```bash
curl --fail --show-error https://agent.vedantpandya.com/health
```

The last command checks your original app. Open **https://agent.vedantpandya.com/aether/**, download/open a docking scene, then verify voice over HTTPS. Browser microphone permission is still required. Scene downloads, API requests, SSE, avatar sprites, model decoders and file downloads should all use /aether/; a request to the old root /api/ usually means a frontend was built without the base-path argument.

```bash
sudo docker logs --tail 100 aether-ai
```

## Env-only changes

In Windows PowerShell, edit the project's .env and upload it again:

```powershell
scp -i "$HOME\.ssh\LightsailDefaultKey-eu-west-2.pem" .\.env "ubuntu@3.9.76.187:/home/ubuntu/aether-upload/.env"
```

In the SSH session, install it and recreate Aether using its current image. A restart alone does not reliably remount a replaced env-file inode; use the deploy script.

```bash
sudo install -m 0640 -o root -g 10001 /home/ubuntu/aether-upload/.env /opt/aether/app.env && rm /home/ubuntu/aether-upload/.env
```

```bash
AETHER_TAG=$(sudo docker inspect --format '{{.Config.Image}}' aether-ai); AETHER_TAG=${AETHER_TAG#aether-ai:}; sudo bash /opt/aether/deploy.sh "$AETHER_TAG"
```

## Redeploy or roll back

For a new image, repeat steps 1-3 with a new tag. Caddy's import is already installed, so step 4 is unnecessary unless its routes changed. **Moving from 8003 to 8016 requires step 4 once** to update the proxy target. State remains in /opt/aether/state across container replacement. This rollback restores the previous image/container; it does not revert mission data or the installed env file.

```bash
sudo bash /opt/aether/deploy.sh --rollback
```

```bash
curl --fail --show-error http://127.0.0.1:8016/api/health
```

After successful public checks, remove only this upload's tar to reclaim disk space:

```bash
rm -f /home/ubuntu/aether-upload/aether-image.tar
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| JavaScript and CSS return 404 | Follow the /aether/assets/ fix above and purge any cached 404s for those URLs. |
| CSS loads but API or voice hits the old app | Rebuild with APP_BASE_PATH=/aether/ and deploy the new image; reload the page. |
| Scene missing or model decoder 404 | Check the request starts /aether/assets-3d/ or /aether/draco/ and download the scene again. |
| Container cannot read .env | Reinstall /opt/aether/app.env with owner root, group 10001, mode 0640. |
| Workspace writes fail | State directory must be owned by 10001:10001; the deploy script creates it. |
| Only Caddy returns 502 | Check local 8016 health and container logs before changing the proxy. |
| Caddy installer cannot find a site | Inspect the existing site's file; do not overwrite your other app's config. |
| Docker daemon unavailable locally | Start Docker Desktop in Linux-container mode, then rerun docker version. |
| Bind for 127.0.0.1:8003 failed: port is already allocated | Follow the recovery section above to remove the old Aether containers, install the updated deploy script and move Docker/Caddy to 8016. |
| Bind for 127.0.0.1:8016 failed: port is already allocated | Inspect docker ps and sudo ss -ltnp 'sport = :8016'; identify the owner before removing anything. |

References: [Vite base paths](https://vite.dev/guide/build#public-base-path), [Caddy handle_path](https://caddyserver.com/docs/caddyfile/directives/handle_path), [Caddy streaming proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming).
