import time
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.harness.workspace import Workspace


def wait_for(client, run_id, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        state = client.get(f"/api/harness/runs/{run_id}").json()
        if state["status"] not in ("running", "queued", "created"):
            return state
        time.sleep(0.2)
    raise AssertionError("Harness run did not finish")


def test_demo_run_edits_code_and_passes_checks():
    with TestClient(app) as client:
        created = client.post("/api/harness/runs", json={"task": "Repair the controller", "mode": "demo"})
        assert created.status_code == 200
        state = wait_for(client, created.json()["id"])
        assert state["status"] == "completed", state["summary"]
        ends = [e["data"] for e in state["events"] if e["type"] == "tool_end"]
        tests = [e for e in ends if e["name"] == "run_tests"]
        # The scripted session reproduces a failure before repairing it.
        assert not tests[0]["ok"] and tests[-1]["ok"]
        assert any(e["name"] == "edit_file" and e["ok"] for e in ends)
        paths = {f["path"] for f in state["files"]}
        assert {"artifacts/report.md", "artifacts/trajectory.json", "controller.py"} <= paths
        assert any(p.startswith("references/physics/") for p in paths)


def test_workspace_find_delete_and_confinement(tmp_path):
    ws = Workspace(tmp_path)
    ws.write("a.py", "x = 1\n")
    ws.write("notes/b.md", "hello\n")
    assert [f["path"] for f in ws.find("*.py")["files"]] == ["a.py"]
    assert "-x = 1" in ws.delete("a.py")["diff"]
    assert ws.find("*.py")["files"] == []
    for bad in ["../escape.py", "/etc/passwd", "C:/x.py", ".env"]:
        with pytest.raises(ValueError):
            ws.path(bad)
