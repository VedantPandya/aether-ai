"""Expose the hierarchical runtime as an executable mission-engineering tool."""
import asyncio
import json
import os
from ..autonomy.runtime import create_session
from ..autonomy.types import AutonomyRequest
from ..physics import MissionConfig,MODEL_VERSION
from .artifacts import save_trajectory

FAULTS={"nominal":[],"thrust_loss":[{"type":"thrust_loss","at_s":25,"value":.5}],"obstacle":[{"type":"obstacle","at_s":25,"value":2.5,"position_m":[11,18]}],"fuel_leak":[{"type":"fuel_leak","at_s":25,"value":.99}]}

def run_autonomous_mission(run,config_path,scenario):
    if scenario not in FAULTS:raise ValueError("Unknown autonomy scenario")
    config=MissionConfig(**json.loads(run.workspace.path(config_path).read_text(encoding="utf-8")))
    if config.mission_type!="docking":raise ValueError("Closed-loop runtime currently supports docking; use simulate_mission for other reference models")
    provider=getattr(run,"provider","demo")
    async def drive():
        session=create_session(AutonomyRequest(config=config,mode=provider,paced=provider!="demo",faults=FAULTS[scenario]))
        prefix=os.getenv("APP_ROOT_PATH", "").rstrip("/")
        run.emit("autonomy_started",{"session_id":session.id,"state_url":prefix+"/api/autonomy/sessions/"+session.id,"events_url":prefix+"/api/autonomy/sessions/"+session.id+"/events"})
        run.emit("notice",{"message":"Running the three-layer docking stack: local mechanics, reflex classification and strategic replanning. Session "+session.id[:8]+"."})
        while not session.task.done():
            if getattr(run,"cancel_requested",False):
                await session.stop();break
            await asyncio.sleep(.05)
        await asyncio.gather(session.task,return_exceptions=True)
        return session
    session=asyncio.run(drive())
    result=session.plant.result()
    result.update(id=session.id,config=config.model_dump(),model_version=MODEL_VERSION,execution_status=session.status,summary=session.summary,sample_count=len(result["samples"]),final=result["samples"][-1])
    run.simulation=result
    exported=save_trajectory(run.workspace,result["samples"])
    compact=session.snapshot(after=len(session.events));compact["trajectory_export"]=exported;compact["scenario"]=scenario;compact["applied_faults"]=[e["data"] for e in session.events if e["type"]=="fault"];compact["unapplied_faults"]=session.scheduled
    run.workspace.write("artifacts/autonomy-summary.json",json.dumps(compact,indent=2))
    run.workspace.write("artifacts/plan.json",json.dumps({k:v for k,v in result.items() if k!="samples"},indent=2))
    run.emit("simulation",{"summary":result["summary"],"mission_type":"docking","sample_count":len(result["samples"]),"autonomy_session_id":session.id,"execution_status":session.status})
    return {"autonomy_session_id":session.id,"status":session.status,"summary":session.summary,"final_state":session.plant.snapshot(),"layers":compact["layers"],"applied_faults":compact["applied_faults"],"unapplied_faults":compact["unapplied_faults"],"artifacts":["artifacts/autonomy-summary.json","artifacts/trajectory.json","artifacts/plan.json"],"model_version":MODEL_VERSION}
