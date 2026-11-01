from pathlib import Path
import asyncio
import os
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import httpx
from openai import OpenAIError
from .physics import MissionConfig, CATALOG, plan_mission
from .knowledge import TOPICS
from .agent import ChatRequest, chat, reflex, configured_provider

app=FastAPI(title="Aether Mission Control",version="0.1.0",root_path=os.getenv("APP_ROOT_PATH", "").rstrip("/"))
# Bound expensive chat calls in this single-process hackathon server.
agent_slots=asyncio.Semaphore(3)

@app.middleware("http")
async def limit_body(request: Request, call_next):
    if request.headers.get("content-length", "").isdigit() and int(request.headers["content-length"])>100_000:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=413,content={"detail":"Request too large"})
    return await call_next(request)

@app.get("/api/health")
def health():
    return {"status":"ok","provider":configured_provider(),"key_configured":bool(os.getenv("OPENAI_API_KEY")),"reasoning_model":os.getenv("OPENAI_MODEL","gpt-6-luna"),"decisions_model":"gpt-6-luna","physics":"deterministic","version":"0.1.0"}
@app.get("/api/missions")
def missions(): return CATALOG
@app.get("/api/knowledge")
def knowledge(): return TOPICS
@app.post("/api/plan")
def plan(config: MissionConfig): return plan_mission(config)
@app.post("/api/simulate")
def simulate(config: MissionConfig):
    result=plan_mission(config,include_samples=True)
    if not result["feasible"]: raise HTTPException(409,"Physics feasibility check failed. Replan before executing.")
    return result

async def guarded(operation):
    try:
        async with agent_slots:
            return await asyncio.wait_for(operation,timeout=150)
    except (OpenAIError,httpx.HTTPError,KeyError):
        raise HTTPException(502,"The configured AI provider could not complete this request. Check the server's .env key, model access, network, and quota. You can explicitly switch to offline mode.")
    except asyncio.TimeoutError:
        raise HTTPException(504,"The planning deadline was reached. Retry a simpler request or choose offline mode.")
    except (ValueError,RuntimeError) as exc:
        raise HTTPException(422,str(exc)[:400])

@app.post("/api/chat")
async def converse(req: ChatRequest): return await guarded(chat(req))
class ReflexRequest(BaseModel):
    config: MissionConfig
    offline: bool=False
@app.post("/api/reflex")
async def preflight(req: ReflexRequest): return await guarded(reflex(req.config,req.offline))

from .autonomy.api import router as autonomy_router
app.include_router(autonomy_router)

from .physics_api import router as physics_router
app.include_router(physics_router)

from .harness.api import router as harness_router
app.include_router(harness_router)

from .voice.api import router as voice_router
app.include_router(voice_router)

DIST=Path(os.getenv("AETHER_STATIC_DIR", str(Path(__file__).resolve().parent.parent/"dist"))).resolve()
if DIST.exists():
    app.mount("/assets",StaticFiles(directory=DIST/"assets"),name="assets")
    @app.get("/{path:path}")
    def frontend(path: str):
        if path.startswith("api/"): raise HTTPException(404,"Unknown API route")
        candidate=(DIST/path).resolve()
        if candidate.is_relative_to(DIST.resolve()) and candidate.is_file(): return FileResponse(candidate)
        return FileResponse(DIST/"index.html")
