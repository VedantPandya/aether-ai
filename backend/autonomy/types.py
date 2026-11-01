from typing import Literal
from pydantic import BaseModel,ConfigDict,Field,model_validator
from ..physics import MissionConfig

class ControlProgram(BaseModel):
    model_config=ConfigDict(extra="forbid",allow_inf_nan=False)
    mode:Literal["approach","hold","retreat","abort"]="approach"
    approach_time_constant_s:float=Field(default=27,ge=15,le=120)
    phase_offset_deg:float=Field(default=0,ge=-90,le=90)
    thrust_fraction:float=Field(default=1,ge=0,le=1)
    hold_distance_m:float=Field(default=20,ge=10,le=500)

class Fault(BaseModel):
    model_config=ConfigDict(extra="forbid",allow_inf_nan=False)
    type:Literal["fuel_leak","thrust_loss","torque_loss","station_spin_change","obstacle"]
    at_s:float=Field(default=0,ge=0,le=600)
    value:float=Field(ge=0,le=100)
    position_m:tuple[float,float]= (0.0,0.0)
    @model_validator(mode="after")
    def limits(self):
        if self.type in {"fuel_leak","thrust_loss","torque_loss"} and self.value>1:raise ValueError("Loss is a fraction from 0 to 1")
        if self.type=="station_spin_change" and self.value>2:raise ValueError("Station rpm must be in [0,2]")
        if self.type=="obstacle" and (self.value<0.1 or max(map(abs,self.position_m))>1000):raise ValueError("Obstacle radius/position outside local docking domain")
        return self

class AutonomyRequest(BaseModel):
    model_config=ConfigDict(extra="forbid",allow_inf_nan=False)
    objective:str=Field(default="Dock safely, preserving fuel and all capture tolerances.",min_length=3,max_length=2000)
    config:MissionConfig=Field(default_factory=lambda:MissionConfig(mission_type="docking",fuel_kg=30,isp_s=220))
    mode:Literal["auto","demo","openai","ollama"]="auto"
    paced:bool=True
    realtime_factor:float=Field(default=5,ge=1,le=30)
    reflex_interval_s:float=Field(default=15,ge=5,le=30)
    reflex_timeout_ms:int=Field(default=5000,ge=100,le=5000)
    max_reflex_calls:int=Field(default=30,ge=1,le=60)
    max_strategic_calls:int=Field(default=3,ge=1,le=6)
    fuel_reserve_kg:float=Field(default=0.25,ge=0,le=100)
    faults:list[Fault]=Field(default_factory=list,max_length=8)
    @model_validator(mode="after")
    def scope(self):
        if self.config.mission_type!="docking":raise ValueError("Runtime autonomy currently uses the stateful docking plant; use strategic mission planning for other mission types")
        if self.fuel_reserve_kg>self.config.fuel_kg:raise ValueError("Reserve exceeds loaded propellant")
        return self

class ReflexDecision(BaseModel):
    action:Literal["continue","slow_down","hold","retreat","replan","abort"]
    confidence:float=Field(ge=0,le=1)
    source:Literal["decisions_api","deterministic_rules","fallback"]
    reason:str
    latency_ms:float=0
    escalate:bool=False
    vetoed:bool=False

class SwingbyRequest(BaseModel):
    model_config=ConfigDict(extra="forbid",allow_inf_nan=False)
    body:Literal["earth","mars","venus"]="earth"
    incoming_vinf_m_s:tuple[float,float]
    planet_velocity_m_s:tuple[float,float]
    periapsis_altitude_km:float=Field(ge=0,le=1000000)
    turn_direction:Literal[-1,1]=1
