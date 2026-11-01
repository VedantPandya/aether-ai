from typing import Literal
from fastapi import APIRouter
from pydantic import BaseModel,Field,ConfigDict
from .physics import MissionConfig,plan_mission,MODEL_VERSION
from .physics_examples import EXAMPLES

router=APIRouter(prefix="/api/physics",tags=["Physics models and teaching examples"])
@router.get("/examples")
def examples(): return {"model_version":MODEL_VERSION,"examples":EXAMPLES}
@router.get("/schema")
def schema(): return MissionConfig.model_json_schema()

class Comparison(BaseModel):
    model_config=ConfigDict(extra="forbid",allow_inf_nan=False)
    config:MissionConfig
    parameter:Literal["fuel_kg","payload_kg","isp_s","thrust_n","station_rpm","max_torque_nm","controller_kp","controller_kd","ball_angle_deg","ball_speed_m_s","ball_spin_rad_s","wind_m_s","target_altitude_km","departure_phase_angle_deg"]
    values:list[float]=Field(min_length=1,max_length=12)

@router.post("/compare")
def compare(request:Comparison):
    points=[]
    for value in request.values:
        try:
            cfg=MissionConfig(**{**request.config.model_dump(),request.parameter:value})
        except ValueError:
            points.append({"value":value,"error":"Parameter value violates the configuration schema"});continue
        result=plan_mission(cfg)
        points.append({"value":value,"feasible":result["feasible"],"summary":result["summary"],"delta_v_m_s":result["delta_v_m_s"],"fuel_remaining_kg":result["fuel_remaining_kg"],"duration_s":result["duration_s"],"metrics":result["metrics"]})
    return {"parameter":request.parameter,"points":points,"model_version":MODEL_VERSION}
