import asyncio
import json
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from .service import RunRequest, ContinueRequest, FileEdit, create_run, get_run, list_runs, continue_run, cancel_run
from .tools import TOOLS

router=APIRouter(prefix="/api/harness",tags=["Mission engineering harness"])
def find(id):
    try: return get_run(id)
    except ValueError: raise HTTPException(404,"Run not found")

@router.get("/tools")
def tools(): return TOOLS
@router.get("/runs")
def runs(): return list_runs()
@router.post("/runs")
async def create(request:RunRequest): return create_run(request).snapshot()
@router.get("/runs/{id}")
def state(id:str,after:int=0):
    run=find(id);result=run.snapshot();result["events"]=[e for e in run.events if e["id"]>after];return result
@router.post("/runs/{id}/continue")
async def resume(id:str,request:ContinueRequest):
    try: return continue_run(find(id),request.task).snapshot()
    except ValueError as exc: raise HTTPException(409,str(exc))
@router.post("/runs/{id}/cancel")
async def cancel(id:str): return cancel_run(find(id)).snapshot()
@router.get("/runs/{id}/file")
def read(id:str,path:str):
    try: return find(id).workspace.read(path,1,400)
    except (ValueError,OSError) as exc: raise HTTPException(400,str(exc))
@router.put("/runs/{id}/file")
def edit(id:str,request:FileEdit):
    run=find(id)
    if run.status in {"running","queued","created"}: raise HTTPException(409,"Stop the agent before editing its workspace")
    try:
        result=run.workspace.write(request.path,request.content)
        run.emit("file_edit",result);return result
    except (ValueError,OSError) as exc: raise HTTPException(400,str(exc))
@router.get("/runs/{id}/download")
def download(id:str,path:str):
    try:
        file=find(id).workspace.path(path)
        if not file.is_file(): raise ValueError("File not found")
        return FileResponse(file,filename=file.name,media_type="application/octet-stream")
    except ValueError as exc: raise HTTPException(400,str(exc))
@router.get("/runs/{id}/simulation")
def simulation(id:str):
    run=find(id)
    if run.simulation is None:
        # Recompute the reference model after a server restart, rather than trusting a file's feasibility flag.
        from ..physics import MissionConfig,plan_mission
        try: result=plan_mission(MissionConfig(**json.loads(run.workspace.path("mission.json").read_text(encoding="utf-8"))),include_samples=True)
        except Exception: raise HTTPException(404,"No validated simulation available")
        if not result["feasible"] or not run.workspace.path("artifacts/trajectory.json").is_file(): raise HTTPException(404,"No validated simulation available")
        run.simulation=result
    return run.simulation
@router.get("/runs/{id}/events")
async def events(id:str,after:int=0):
    run=find(id)
    async def stream():
        cursor=after
        while True:
            pending=[e for e in run.events if e["id"]>cursor]
            for event in pending:
                cursor=event["id"]
                yield "id: "+str(cursor)+"\ndata: "+json.dumps(event)+"\n\n"
            if run.status not in {"running","queued","created"}: return
            yield ": heartbeat\n\n"
            await asyncio.sleep(0.5)
    return StreamingResponse(stream(),media_type="text/event-stream",headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})
