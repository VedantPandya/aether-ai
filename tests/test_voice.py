"""Voice contract tests; no microphone, credentials, or live API calls required."""

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.voice import service
from backend.voice.app import app

client = TestClient(app)
OFFER = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
ANSWER = {"session": {"id": "opaque_session-123"},
          "transport": {"type": "webrtc", "sdp": "v=0\r\nanswer"}}


@pytest.fixture(autouse=True)
def upstream(monkeypatch):
    for name in ("OPENAI_VOICE_MODEL", "OPENAI_VOICE", "OPENAI_VOICE_BACKEND_MODEL", "VOICE_HUMOR"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "private-test-key")
    state = {"requests": [], "status": 201, "body": ANSWER, "error": None}

    def handle(request):
        state["requests"].append(request)
        if state["error"]:
            raise state["error"]
        return httpx.Response(state["status"], json=state["body"])

    original = httpx.AsyncClient
    monkeypatch.setattr(service.httpx, "AsyncClient", lambda **kwargs: original(
        **kwargs, transport=httpx.MockTransport(handle)))
    return state


def test_live_session_contract_and_server_owned_configuration(upstream):
    result = client.post("/api/voice/sessions", json={"sdp": OFFER})
    assert result.status_code == 201
    assert result.json() == ANSWER
    assert result.headers["cache-control"] == "no-store"
    request, = upstream["requests"]
    assert str(request.url) == "https://api.openai.com/v1/live/sessions"
    assert request.headers["authorization"] == "Bearer private-test-key"
    payload = json.loads(request.content)
    assert payload["transport"] == {"type": "webrtc", "sdp": OFFER}
    session = payload["session"]
    assert session["model"] == "gpt-live-1"
    assert session["audio"] == {"output": {"voice": "meridian"}}
    assert session["store"] is False
    assert session["input"][0]["role"] == "developer"
    assert "TARS-inspired" in session["instructions"]
    assert "Honesty: 100 percent. Humor: 70 percent" in session["instructions"]
    assert session["delegation"]["type"] == "responses"
    backend = session["delegation"]["responses"]
    assert backend["model"] == "gpt-6-luna"
    assert backend["tools"] == [] and backend["tool_choice"] == "none"
    assert "no tools, live telemetry" in backend["instructions"]
    assert set(session["client"]["data_channel"]["allowed_client_events"]) == {
        "session.close", "session.input_audio.mute", "session.input_audio.unmute"}
    assert "private-test-key" not in result.text


def test_response_filters_unexpected_upstream_fields(upstream):
    upstream["body"] = {
        "session": {"id": "keep-prefix_123", "secret": "do-not-expose"},
        "transport": {"type": "webrtc", "sdp": "answer", "token": "do-not-expose"},
        "api_key": "do-not-expose",
    }
    result = client.post("/api/voice/sessions", json={"sdp": OFFER})
    assert result.status_code == 201
    assert result.json()["session"]["id"] == "keep-prefix_123"
    assert "do-not-expose" not in result.text


def test_status_and_environment_overrides(monkeypatch, upstream):
    monkeypatch.setenv("OPENAI_VOICE_MODEL", "gpt-live-1-custom")
    monkeypatch.setenv("OPENAI_VOICE", "vesper")
    monkeypatch.setenv("OPENAI_VOICE_BACKEND_MODEL", "gpt-6-sol")
    monkeypatch.setenv("VOICE_HUMOR", "0")
    monkeypatch.setenv("AGENT_PROVIDER", "demo")
    result = client.get("/api/voice/status")
    assert result.json() == {
        "key_configured": True, "model": "gpt-live-1-custom", "voice": "vesper",
        "backend_model": "gpt-6-sol", "humor": 0, "transport": "webrtc"}
    assert "private-test-key" not in result.text
    assert upstream["requests"] == []
    assert client.post("/api/voice/sessions", json={"sdp": OFFER}).status_code == 201
    config = json.loads(upstream["requests"][0].content)["session"]
    assert config["model"] == "gpt-live-1-custom"
    assert config["audio"]["output"]["voice"] == "vesper"
    assert config["delegation"]["responses"]["model"] == "gpt-6-sol"
    assert "Humor: 0 percent" in config["instructions"]


@pytest.mark.parametrize("key", [None, "", "  "])
def test_missing_key_fails_without_network(monkeypatch, upstream, key):
    if key is None:
        monkeypatch.delenv("OPENAI_API_KEY")
    else:
        monkeypatch.setenv("OPENAI_API_KEY", key)
    assert client.get("/api/voice/status").json()["key_configured"] is False
    result = client.post("/api/voice/sessions", json={"sdp": OFFER})
    assert result.status_code == 503
    assert upstream["requests"] == []


@pytest.mark.parametrize("body", [
    {}, {"sdp": ""}, {"sdp": "   "}, {"sdp": 42}, {"sdp": "x" * 65537},
    {"sdp": "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 111\r\n"},
    {"sdp": OFFER, "session": {"model": "override"}},
])
def test_invalid_offers_never_contact_provider(upstream, body):
    assert client.post("/api/voice/sessions", json=body).status_code == 422
    assert upstream["requests"] == []


@pytest.mark.parametrize("name,value", [
    ("VOICE_HUMOR", "-1"), ("VOICE_HUMOR", "101"), ("VOICE_HUMOR", "invalid"),
    ("OPENAI_VOICE_MODEL", " "), ("OPENAI_VOICE_BACKEND_MODEL", ""), ("OPENAI_VOICE", ""),
])
def test_invalid_server_configuration(monkeypatch, upstream, name, value):
    monkeypatch.setenv(name, value)
    assert client.post("/api/voice/sessions", json={"sdp": OFFER}).status_code == 503
    assert upstream["requests"] == []


def test_browser_origin(upstream):
    assert client.post("/api/voice/sessions", json={"sdp": OFFER},
                       headers={"Origin": "https://unexpected.example"}).status_code == 403
    assert upstream["requests"] == []
    assert client.post("/api/voice/sessions", json={"sdp": OFFER},
                       headers={"Origin": "http://testserver"}).status_code == 201


@pytest.mark.parametrize("provider_status,expected", [(400, 502), (401, 502), (403, 502), (429, 429), (500, 502)])
def test_provider_errors_are_sanitized_and_not_retried(upstream, provider_status, expected):
    upstream["status"] = provider_status
    upstream["body"] = {"error": {"message": "private-test-key internal-details"}}
    result = client.post("/api/voice/sessions", json={"sdp": OFFER})
    assert result.status_code == expected
    assert "private-test-key" not in result.text and "internal-details" not in result.text
    assert len(upstream["requests"]) == 1


@pytest.mark.parametrize("error,expected", [
    (httpx.ReadTimeout("private-test-key"), 504),
    (httpx.ConnectError("private-test-key"), 502),
])
def test_network_failures(upstream, error, expected):
    upstream["error"] = error
    result = client.post("/api/voice/sessions", json={"sdp": OFFER})
    assert result.status_code == expected
    assert "private-test-key" not in result.text
    assert len(upstream["requests"]) == 1


@pytest.mark.parametrize("body", [None, {}, {"session": {"id": 123}, "transport": ANSWER["transport"]}])
def test_malformed_provider_response(upstream, body):
    upstream["body"] = body
    assert client.post("/api/voice/sessions", json={"sdp": OFFER}).status_code == 502


def test_main_app_mounts_voice_before_frontend_fallback():
    from backend.main import app as main_app
    paths = [route.path for route in main_app.routes]
    assert {"/api/voice/status", "/api/voice/sessions"} <= set(paths)
    # The SPA catch-all must not shadow the voice API.
    if "/{path:path}" in paths:
        assert paths.index("/api/voice/sessions") < paths.index("/{path:path}")
