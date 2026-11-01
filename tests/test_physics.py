import math
import pytest
from pydantic import ValidationError
from backend.physics import DEFAULTS, EARTH_RADIUS, MU, G0, MissionConfig, plan_mission

@pytest.mark.parametrize("mission", list(DEFAULTS))
def test_nominal_missions_reach_their_constraints(mission):
    p=plan_mission(MissionConfig(**DEFAULTS[mission]),include_samples=True)
    assert p["feasible"] and p["success"]
    assert all(s["fuel_kg"]>=0 for s in p["samples"])
    assert p["fuel_required_kg"]+p["fuel_remaining_kg"]==pytest.approx(p["config"]["fuel_kg"])
    assert all(b["t"]>=a["t"] for a,b in zip(p["samples"],p["samples"][1:]))
    assert p["samples"][-1]["t"]==pytest.approx(p["duration_s"])
    if mission=="orbit": assert p["final"]["altitude_km"]==pytest.approx(800,abs=0.001)
    elif mission=="lunar": assert math.hypot(p["final"]["x"],p["final"]["y"])==pytest.approx(384400,abs=0.02)
    elif mission=="docking":
        assert p["final"]["distance_m"]<0.25
        assert p["final"]["speed_m_s"]<0.05
    elif mission=="launch": assert p["final"]["altitude_km"]>=100
    elif mission=="ball_throw": assert p["final"]["phase"]=="Ground contact"
    else: assert p["metrics"]["arrival_miss_distance_km"]<=p["config"]["arrival_tolerance_km"]

@pytest.mark.parametrize("mission", [m for m in DEFAULTS if m!="ball_throw"])
def test_zero_fuel_cannot_execute(mission):
    data={**DEFAULTS[mission],"fuel_kg":0}
    assert not plan_mission(MissionConfig(**data))["feasible"]

def test_hohmann_reference_and_rocket_equation():
    p=plan_mission(MissionConfig())
    # Independent numerical reference: 300 km to 800 km, using 6371 km Earth radius.
    assert p["delta_v_m_s"]==pytest.approx(274.263999,abs=0.01)
    assert p["burns"][0]["delta_v_m_s"]==pytest.approx(138.37,abs=0.03)
    assert p["fuel_remaining_kg"]==pytest.approx(720*math.exp(-p["delta_v_m_s"]/(320*G0))-600)

def test_orbital_coast_conserves_specific_energy():
    p=plan_mission(MissionConfig(),include_samples=True)
    coast=[s for s in p["samples"] if s["phase"]=="Transfer coast"]
    def energy(s): return s["speed_m_s"]**2/2-MU/math.hypot(s["x"]*1000,s["y"]*1000)
    first=energy(coast[0])
    assert max(abs((energy(s)-first)/first) for s in coast)<1e-7

def test_downward_transfer_circularizes():
    p=plan_mission(MissionConfig(start_altitude_km=1200,target_altitude_km=300,fuel_kg=300))
    assert p["feasible"]
    assert p["final"]["altitude_km"]==pytest.approx(300,abs=0.002)
    assert p["burns"][0]["description"]=="Retrograde"

def test_payload_increases_required_propellant():
    a=plan_mission(MissionConfig(payload_kg=0))
    b=plan_mission(MissionConfig(payload_kg=1000))
    assert b["fuel_required_kg"]>a["fuel_required_kg"]

@pytest.mark.parametrize("kwargs",[{"fuel_kg":-1},{"fuel_kg":float('nan')},{"mission_type":"mars"},{"station_rpm":5},{"start_altitude_km":800,"target_altitude_km":800},{"unexpected":True}])
def test_invalid_configuration_rejected(kwargs):
    with pytest.raises(ValidationError): MissionConfig(**kwargs)
