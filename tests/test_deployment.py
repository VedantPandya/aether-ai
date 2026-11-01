import importlib.util
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from starlette.applications import Starlette
from starlette.routing import Mount
from backend.main import app

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("aether_caddy_config",ROOT/"deploy/configure_caddy.py")
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def test_caddy_import_preserves_existing_site_and_is_idempotent():
    original="agent.vedantpandya.com {\n    encode zstd gzip\n    reverse_proxy 127.0.0.1:8002\n}\n"
    updated=module.add_import(original)
    assert "reverse_proxy 127.0.0.1:8002" in updated
    assert updated.count(module.IMPORT)==1
    assert module.add_import(updated)==updated
    with pytest.raises(ValueError):module.add_import("different.example.com {\n}\n")

def test_prefixed_proxy_can_serve_api_voice_and_scene_assets(monkeypatch):
    monkeypatch.setenv("AGENT_PROVIDER","demo")
    with TestClient(Starlette(routes=[Mount("/aether",app)])) as client:
        assert client.get("/aether/api/health").json()["status"]=="ok"
        assert client.get("/aether/api/voice/status").status_code==200
        assert client.get("/aether/api/autonomy/capabilities").status_code==200
        if (ROOT/"dist/index.html").exists():
            assert client.get("/aether/").status_code==200
            assert client.get("/aether/favicon.svg").headers["content-type"].startswith("image/svg+xml")
            assert client.get("/aether/assets-3d/docking/aether-relay-station.glb").status_code==200

def test_deployment_commands_are_single_lines_and_example_has_no_key():
    import re
    guide=(ROOT/"DEPLOY_LIGHTSAIL.md").read_text()
    commands=re.findall(r"```(?:powershell|bash)\n(.*?)\n```",guide,re.S)
    assert len(commands)>25 and all("\n" not in command for command in commands)
    from dotenv import dotenv_values
    assert not dotenv_values(ROOT/".env.example").get("OPENAI_API_KEY")
