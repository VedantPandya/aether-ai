"""Public physics API. Models use SI internally and report explicit rendering frames."""
from __future__ import annotations
import hashlib
import json
import math
from typing import Literal
from pydantic import BaseModel,ConfigDict,Field,model_validator
from .physics_models.common import MU,EARTH_RADIUS,G0,MOON_DISTANCE,AU,SUN_MU,atmosphere
from .physics_models.orbital import orbital,rk4
from .physics_models.ascent import launch
from .physics_models.docking import docking
from .physics_models.ballistics import ball_throw
from .physics_models.interplanetary import interplanetary

MODEL_VERSION="0.2.0"

class MissionConfig(BaseModel):
    model_config=ConfigDict(extra="forbid",allow_inf_nan=False)
    mission_type:Literal["orbit","lunar","docking","launch","ball_throw","interplanetary"]="orbit"
    start_altitude_km:float=Field(default=300,ge=160,le=2000)
    target_altitude_km:float=Field(default=800,ge=180,le=40000)
    dry_mass_kg:float=Field(default=500,ge=100,le=20000)
    payload_kg:float=Field(default=100,ge=0,le=10000)
    fuel_kg:float=Field(default=120,ge=0,le=200000)
    isp_s:float=Field(default=320,ge=100,le=500)
    thrust_n:float=Field(default=30000,ge=1,le=5000000)
    atmosphere_enabled:bool=True
    drag_coefficient:float=Field(default=0.35,ge=0,le=2)
    reference_area_m2:float=Field(default=1,gt=0,le=100)
    integration_step_s:float=Field(default=0.05,ge=0.01,le=0.2)
    launch_target_altitude_km:float=Field(default=100,ge=1,le=1000)
    station_rpm:float=Field(default=0.2,ge=0,le=2)
    station_orbit_altitude_km:float=Field(default=400,ge=180,le=2000)
    station_port_radius_m:float=Field(default=8,ge=2,le=30)
    docking_standoff_m:float=Field(default=80,ge=10,le=500)
    docking_thrust_n:float=Field(default=500,ge=0,le=10000)
    max_torque_nm:float=Field(default=20,ge=0,le=1000)
    moment_of_inertia_kg_m2:float=Field(default=250,ge=5,le=1000000)
    rcs_lever_arm_m:float=Field(default=2,ge=0.1,le=10)
    initial_attitude_deg:float=Field(default=30,ge=-180,le=180)
    initial_angular_velocity_deg_s:float=Field(default=0,ge=-10,le=10)
    controller_kp:float=Field(default=0.08,ge=0,le=2)
    controller_kd:float=Field(default=0.6,ge=0,le=5)
    docking_position_tolerance_m:float=Field(default=0.25,ge=0.01,le=2)
    docking_velocity_tolerance_m_s:float=Field(default=0.05,ge=0.001,le=0.2)
    docking_angle_tolerance_deg:float=Field(default=2,ge=0.1,le=10)
    docking_rate_tolerance_deg_s:float=Field(default=0.1,ge=0.01,le=1)
    docking_dwell_s:float=Field(default=1,ge=0,le=10)
    docking_timeout_s:float=Field(default=300,ge=30,le=600)
    ball_speed_m_s:float=Field(default=20,ge=0,le=150)
    ball_angle_deg:float=Field(default=45,ge=-90,le=90)
    ball_height_m:float=Field(default=1.8,ge=0,le=1000)
    ball_mass_kg:float=Field(default=0.145,ge=0.005,le=100)
    ball_radius_m:float=Field(default=0.0366,ge=0.005,le=0.5)
    ball_drag_coefficient:float=Field(default=0.47,ge=0,le=2)
    ball_spin_rad_s:float=Field(default=0,ge=-500,le=500)
    wind_m_s:float=Field(default=0,ge=-50,le=50)
    ball_target_range_m:float|None=Field(default=None,ge=-5000,le=5000)
    ball_target_tolerance_m:float=Field(default=0.5,ge=0.01,le=50)
    destination:Literal["mars","venus"]="mars"
    arrival_orbit_altitude_km:float=Field(default=300,ge=150,le=10000)
    capture_at_destination:bool=True
    departure_phase_angle_deg:float|None=Field(default=None,ge=-180,le=180)
    arrival_tolerance_km:float=Field(default=1000,ge=1,le=100000)
    @model_validator(mode="after")
    def distinct_orbits(self):
        if self.mission_type=="orbit" and abs(self.target_altitude_km-self.start_altitude_km)<10:
            raise ValueError("Choose a target at least 10 km from the starting orbit")
        return self

DEFAULTS={
    "orbit":MissionConfig().model_dump(),
    "lunar":MissionConfig(mission_type="lunar",fuel_kg=1500).model_dump(),
    "docking":MissionConfig(mission_type="docking",fuel_kg=30,isp_s=220).model_dump(),
    "launch":MissionConfig(mission_type="launch",fuel_kg=1200).model_dump(),
    "ball_throw":MissionConfig(mission_type="ball_throw",fuel_kg=0).model_dump(),
    "interplanetary":MissionConfig(mission_type="interplanetary",dry_mass_kg=4000,payload_kg=1000,fuel_kg=18000,isp_s=450,thrust_n=250000).model_dump(),
}
CATALOG=[
 {"id":"ball_throw","name":"Ball throw lab","subtitle":"Start with a throw. Discover the physics.","objective":"Throw a ball at 20 m/s and 45 degrees. Compare drag and vacuum trajectories, energy and range.","model":"RK4 projectile, air-relative drag, wind and optional spin lift","defaults":DEFAULTS["ball_throw"]},
 {"id":"launch","name":"First light","subtitle":"From launchpad to the edge of space.","objective":"Launch a sounding rocket above 100 km. Check thrust-to-weight, fuel, drag and peak acceleration.","model":"Finite-thrust vertical ascent, standard atmosphere, RK4 event detection","defaults":DEFAULTS["launch"]},
 {"id":"orbit","name":"Orbital transfer","subtitle":"Two burns. A verified circular orbit.","objective":"Move a spacecraft from a 300 km orbit to an 800 km Earth orbit and verify the fuel budget.","model":"Exact Kepler conics, Hohmann burns and rocket-equation propellant","defaults":DEFAULTS["orbit"]},
 {"id":"docking","name":"Rotating rendezvous","subtitle":"Match position, velocity, attitude and spin.","objective":"Dock with a rotating station while meeting position, velocity, attitude and angular-rate tolerances.","model":"CW orbital relative motion, thrust/torque-limited PD and shared RCS propellant","defaults":DEFAULTS["docking"]},
 {"id":"lunar","name":"Lunar pathfinder","subtitle":"A precise path to lunar distance.","objective":"Send a cargo spacecraft from Earth orbit to lunar distance and verify the departure fuel budget.","model":"Exact Earth-centered transfer ellipse; no lunar interception or capture","defaults":DEFAULTS["lunar"]},
 {"id":"interplanetary","name":"Interplanetary tourism","subtitle":"Choose the window. Budget the arrival.","objective":"Plan an ideal Earth-to-Mars transfer including departure and arrival fuel, phase angle and travel time.","model":"Solar Hohmann conic, analytic planet phasing and patched-conic injection/capture budgets","defaults":DEFAULTS["interplanetary"]},
]

MODELS={"orbit":orbital,"lunar":orbital,"docking":docking,"launch":launch,"ball_throw":ball_throw,"interplanetary":interplanetary}

def plan_mission(config:MissionConfig,include_samples=False):
    result=MODELS[config.mission_type](config)
    result["config"]=config.model_dump()
    result["id"]=hashlib.sha256((MODEL_VERSION+json.dumps(result["config"],sort_keys=True)).encode()).hexdigest()[:10]
    result["model_version"]=MODEL_VERSION
    result["status"]="ready" if result["feasible"] else "blocked"
    result["sample_count"]=len(result["samples"])
    if config.mission_type in {"orbit","lunar","interplanetary"}:
        mu=SUN_MU if config.mission_type=="interplanetary" else MU
        for state in result["samples"]:
            x,y,z=state["position_m"];radius=math.hypot(x,y)
            state["acceleration_m_s2"]=[-mu*x/radius**3,-mu*y/radius**3,0.0]
    positions=[s["position_m"] for s in result["samples"]]
    result["rendering"]={"bounds_m":{"min":[min(p[i] for p in positions) for i in range(3)],"max":[max(p[i] for p in positions) for i in range(3)]},"physical_body_radius_m":(696340000.0 if config.mission_type=="interplanetary" else EARTH_RADIUS if config.mission_type in {"orbit","lunar","launch"} else config.station_port_radius_m if config.mission_type=="docking" else config.ball_radius_m),"trajectory_plane":"XY","magnify_small_bodies_only_with_visible_scale_label":True}
    result["final"]=result["samples"][-1]
    result["trajectory_validity"]="model_validated" if result["feasible"] else "reference_or_failed_attempt_only"
    if "fuel_used_kg" not in result: result["fuel_used_kg"]=min(config.fuel_kg,result["fuel_required_kg"])
    result.setdefault("fuel_requirement_kind","ideal_impulsive_transfer_budget")
    result["units"]={"position_m":"m","velocity_m_s":"m/s","t":"s","fuel_kg":"kg","heading_rad":"rad","angular_velocity_rad_s":"rad/s","torque_nm":"N*m"}
    if not include_samples:
        result.pop("samples")
        result.pop("body_ephemerides",None)
    return result
