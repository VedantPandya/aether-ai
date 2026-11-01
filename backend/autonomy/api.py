import asyncio
import json
from fastapi import APIRouter,HTTPException
from fastapi.responses import StreamingResponse
from .types import AutonomyRequest,Fault,SwingbyRequest
from .runtime import create_session,SESSIONS,ACTIVE
from .flyby import assess_swingby
from ..physics import DEFAULTS,MODEL_VERSION

router=APIRouter(prefix="/api/autonomy",tags=["Hierarchical flight autonomy"])
def find(id):
    if id not in SESSIONS:raise HTTPException(404,"Autonomy session not found; runtime sessions are process-local and logs persist under .aether/autonomy")
    return SESSIONS[id]

@router.get("/capabilities")
def capabilities():
    return {"layers":[{"tier":1,"role":"Mechanics, simulated truth state and deterministic force/torque-limited PD","cadence":"Every integration step; no model calls"},{"tier":2,"role":"Typed reflex classification via Decisions API / gpt-6-luna","cadence":"Faults and periodic telemetry checkpoints; bounded deadline; cannot override local guards"},{"tier":3,"role":"Strategic reasoning with tools and candidate trajectory previews","cadence":"Escalations only; proposals revalidated against latest physical state"}],"runtime_missions":["docking"],"strategic_mission_models":list(DEFAULTS),"local_swingby_assessment":True,"complete_gravity_assist_mission_targeting":False,"model_version":MODEL_VERSION}
@router.get("/examples")
def examples():
    base={"mode":"demo","paced":False,"config":DEFAULTS["docking"]}
    return [
        {"id":"nominal-stack","name":"Three layers, nominal flight","request":{**base,"faults":[]}},
        {"id":"engine-fault-replan","name":"Thrust loss: reflex hold, strategic replan","request":{**base,"faults":[{"type":"thrust_loss","at_s":25,"value":0.5}]}},
        {"id":"obstacle-detour","name":"Obstacle: validate a detour","request":{**base,"faults":[{"type":"obstacle","at_s":25,"value":2.5,"position_m":[11,18]}]}},
        {"id":"fuel-leak-safing","name":"Fuel leak: preserve reserve or abort","request":{**base,"faults":[{"type":"fuel_leak","at_s":25,"value":0.99}]}}
    ]
@router.post("/sessions")
async def create(request:AutonomyRequest):
    try:return create_session(request).snapshot()
    except ValueError as exc:raise HTTPException(422,str(exc))
@router.get("/sessions")
def sessions():return [s.snapshot(after=len(s.events)) for s in SESSIONS.values()]
@router.get("/sessions/{id}")
def state(id:str,after:int=0):return find(id).snapshot(after)
@router.post("/sessions/{id}/inject")
async def inject(id:str,fault:Fault):
    session=find(id)
    if session.status not in ACTIVE or session.stopped:raise HTTPException(409,"Session is no longer active")
    session.inject(fault);return {"queued":True,"session_id":id,"fault":fault.model_dump()}
@router.post("/sessions/{id}/stop")
async def stop(id:str):
    session=find(id);await session.stop()
    return {"stop_requested":True,"id":id}
@router.get("/sessions/{id}/simulation")
def simulation(id:str):
    session=find(id);result=session.plant.result()
    return {**result,"id":id,"config":session.request.config.model_dump(),"model_version":MODEL_VERSION,"execution_status":session.status,"sample_count":len(result["samples"]),"final":result["samples"][-1]}
@router.get("/sessions/{id}/events")
async def events(id:str,after:int=0):
    session=find(id)
    async def stream():
        cursor=after
        while True:
            for event in [e for e in session.events if e["id"]>cursor]:
                cursor=event["id"];yield "id: "+str(cursor)+"\ndata: "+json.dumps(event)+"\n\n"
            if session.status not in ACTIVE:return
            yield ": heartbeat\n\n";await asyncio.sleep(.25)
    return StreamingResponse(stream(),media_type="text/event-stream",headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})
@router.post("/swingby")
def swingby(request:SwingbyRequest):
    try:return assess_swingby(request)
    except ValueError as exc:raise HTTPException(422,str(exc))
@router.post("/strategic-runs")
async def strategic_run(request:dict):
    # The existing workspace harness is the long-task strategic agent for all supported missions.
    from ..harness.service import RunRequest,create_run
    try:
        parsed=RunRequest(**request)
        return create_run(parsed).snapshot()
    except ValueError as exc:raise HTTPException(422,str(exc)[:400])
