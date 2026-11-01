"""Analytic references, conservation, event consistency and convergence checks."""
import math
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.physics import MissionConfig,DEFAULTS,plan_mission,G0,MU,EARTH_RADIUS,AU,SUN_MU,atmosphere
from backend.physics_examples import EXAMPLES
from backend.physics_models.common import propellant_budget

@pytest.mark.parametrize("example",EXAMPLES,ids=lambda e:e["id"])
def test_curated_example_outcomes(example):
    p=plan_mission(MissionConfig(**example["config"]),include_samples=True)
    assert p["feasible"] is example["expected_feasible"]
    assert all(s["fuel_kg"]>=0 for s in p["samples"])
    assert p["final"]["t"]==pytest.approx(p["duration_s"])
    assert all(a["t"]<=b["t"] for a,b in zip(p["samples"],p["samples"][1:]))
    assert p["frame"]["position_m_unit"]=="m"

@pytest.mark.parametrize("angle,height",[(20,0),(45,0),(70,1.8),(90,5),(-30,10)])
def test_ball_vacuum_matches_textbook_solution(angle,height):
    v=20;theta=math.radians(angle);vy=v*math.sin(theta);vx=v*math.cos(theta)
    expected_time=(vy+math.sqrt(vy*vy+2*G0*height))/G0
    expected_range=vx*expected_time
    p=plan_mission(MissionConfig(mission_type="ball_throw",ball_angle_deg=angle,ball_height_m=height,atmosphere_enabled=False))
    assert p["duration_s"]==pytest.approx(expected_time,abs=2e-8)
    assert p["metrics"]["range_m"]==pytest.approx(expected_range,abs=2e-7)
    assert abs(p["metrics"]["energy_balance_residual_j"])<1e-7
    assert p["fuel_used_kg"]==0

def test_air_shortens_ball_range_and_accounts_for_energy():
    a=plan_mission(MissionConfig(mission_type="ball_throw",atmosphere_enabled=False))
    b=plan_mission(MissionConfig(mission_type="ball_throw"))
    assert b["metrics"]["range_m"]<a["metrics"]["range_m"]
    assert b["metrics"]["aerodynamic_work_j"]<0
    assert abs(b["metrics"]["energy_balance_residual_j"])<1e-6

def test_backspin_changes_trajectory_without_free_mechanical_energy_in_still_air():
    a=plan_mission(MissionConfig(mission_type="ball_throw"))
    b=plan_mission(MissionConfig(mission_type="ball_throw",ball_spin_rad_s=120))
    assert b["metrics"]["max_height_m"]>a["metrics"]["max_height_m"]
    assert abs(b["metrics"]["energy_balance_residual_j"])<1e-6

@pytest.mark.parametrize("height,expected",[(0,1.225),(11000,0.3648),(20000,0.08891),(32000,0.01355)])
def test_standard_atmosphere_reference_densities(height,expected):
    # Geometric-altitude reference table values (kg/m^3), not geopotential heights.
    assert atmosphere(height)["density_kg_m3"]==pytest.approx(expected,rel=0.006)

def test_launch_has_consistent_apogee_mass_flow_and_velocity_budget():
    c=MissionConfig(**DEFAULTS["launch"]);p=plan_mission(c,include_samples=True);m=p["metrics"]
    assert m["burnout_time_s"]==pytest.approx(c.fuel_kg*c.isp_s*G0/c.thrust_n,abs=1e-7)
    expected_dv=c.isp_s*G0*math.log((c.dry_mass_kg+c.payload_kg+c.fuel_kg)/(c.dry_mass_kg+c.payload_kg))
    assert m["ideal_thrust_delta_v_m_s"]==pytest.approx(expected_dv,abs=1e-6)
    assert abs(m["velocity_budget_residual_m_s"])<1e-7
    assert p["final"]["speed_m_s"]<1e-7
    assert p["final"]["altitude_km"]*1000==pytest.approx(m["apogee_altitude_m"])
    assert m["peak_dynamic_pressure_pa"]>0 and m["drag_loss_m_s"]>0

def test_launch_step_halving_converges_to_less_than_one_centimetre():
    a=plan_mission(MissionConfig(**{**DEFAULTS["launch"],"integration_step_s":.05}))
    b=plan_mission(MissionConfig(**{**DEFAULTS["launch"],"integration_step_s":.025}))
    assert abs(a["metrics"]["apogee_altitude_m"]-b["metrics"]["apogee_altitude_m"])<0.01
    assert abs(a["duration_s"]-b["duration_s"])<1e-4

def test_docking_checks_attitude_and_spends_fuel_on_torque():
    c=MissionConfig(**DEFAULTS["docking"]);p=plan_mission(c,include_samples=True);m=p["metrics"]
    assert p["success"]
    assert m["position_error_m"]<c.docking_position_tolerance_m
    assert m["relative_speed_m_s"]<c.docking_velocity_tolerance_m_s
    assert abs(m["attitude_error_deg"])<c.docking_angle_tolerance_deg
    assert abs(m["angular_rate_error_deg_s"])<c.docking_rate_tolerance_deg_s
    assert m["attitude_fuel_kg"]>0
    assert m["capture_dwell_s"]>=c.docking_dwell_s
    assert m["peak_torque_nm"]<=c.max_torque_nm+1e-9
    assert m["peak_thrust_n"]<=c.docking_thrust_n+1e-9
    assert m["translation_fuel_kg"]+m["attitude_fuel_kg"]==pytest.approx(p["fuel_used_kg"],abs=1e-9)
    assert p["final"]["station_angle"]==pytest.approx(c.station_rpm*2*math.pi/60*p["duration_s"])

def test_position_match_without_torque_is_not_docking():
    c=MissionConfig(**{**DEFAULTS["docking"],"max_torque_nm":0})
    p=plan_mission(c)
    assert p["metrics"]["position_error_m"]<c.docking_position_tolerance_m
    assert not p["success"]
    assert abs(p["metrics"]["attitude_error_deg"])>c.docking_angle_tolerance_deg

def test_docking_step_halving_is_stable():
    a=plan_mission(MissionConfig(**{**DEFAULTS["docking"],"integration_step_s":.05}))
    b=plan_mission(MissionConfig(**{**DEFAULTS["docking"],"integration_step_s":.025}))
    assert a["success"] and b["success"]
    assert abs(a["duration_s"]-b["duration_s"])<0.2
    assert abs(a["fuel_used_kg"]-b["fuel_used_kg"])<0.005

@pytest.mark.parametrize("kind",["orbit","lunar"])
def test_transfer_energy_and_angular_momentum_conservation(kind):
    p=plan_mission(MissionConfig(**DEFAULTS[kind]),include_samples=True)
    states=[s for s in p["samples"] if s["phase"]=="Transfer coast"]
    def energy(s):
        x,y,_=s["position_m"];vx,vy,_=s["velocity_m_s"]
        return (vx*vx+vy*vy)/2-MU/math.hypot(x,y)
    def angular(s):
        x,y,_=s["position_m"];vx,vy,_=s["velocity_m_s"]
        return x*vy-y*vx
    e,h=energy(states[0]),angular(states[0])
    assert max(abs((energy(s)-e)/e) for s in states)<1e-10
    assert max(abs((angular(s)-h)/h) for s in states)<1e-12

def test_fuel_budget_threshold_is_solved_for_fixed_inert_mass():
    first=plan_mission(MissionConfig());needed=first["required_initial_fuel_kg"]
    assert plan_mission(MissionConfig(fuel_kg=needed*(1+1e-6)))["feasible"]
    assert not plan_mission(MissionConfig(fuel_kg=needed*(1-1e-6)))["feasible"]

def test_mars_reference_travel_phase_and_parking_burns():
    p=plan_mission(MissionConfig(**DEFAULTS["interplanetary"]));m=p["metrics"]
    assert 258<m["travel_days"]<260
    assert 44<m["required_departure_phase_angle_deg"]<45
    assert 3500<m["injection_delta_v_m_s"]<3700
    assert 2000<m["capture_delta_v_m_s"]<2200
    assert m["arrival_miss_distance_km"]<0.001
    assert p["delta_v_m_s"]==pytest.approx(m["injection_delta_v_m_s"]+m["capture_delta_v_m_s"])

def test_wrong_launch_phase_fails_even_with_enough_fuel():
    p=plan_mission(MissionConfig(**{**DEFAULTS["interplanetary"],"departure_phase_angle_deg":0}))
    assert p["fuel_margin_kg"]>0
    assert p["metrics"]["arrival_miss_distance_km"]>p["config"]["arrival_tolerance_km"]
    assert not p["feasible"]

def test_capture_cost_changes_tourism_propellant_budget():
    a=plan_mission(MissionConfig(**DEFAULTS["interplanetary"]))
    b=plan_mission(MissionConfig(**{**DEFAULTS["interplanetary"],"capture_at_destination":False}))
    assert b["fuel_required_kg"]<a["fuel_required_kg"]
    assert b["metrics"]["capture_delta_v_m_s"]==0

def test_new_physics_endpoints_and_sweep():
    client=TestClient(app)
    data=client.get('/api/physics/examples').json()
    assert len(data['examples'])>=15
    assert client.get('/api/physics/schema').status_code==200
    result=client.post('/api/physics/compare',json={'config':DEFAULTS['docking'],'parameter':'max_torque_nm','values':[0,20]}).json()
    assert [p['feasible'] for p in result['points']]==[False,True]
    bad=client.post('/api/simulate',json={**DEFAULTS['interplanetary'],'departure_phase_angle_deg':0})
    assert bad.status_code==409

@pytest.mark.parametrize("kind",list(DEFAULTS))
def test_physics_artifacts_fit_workspace_quotas(tmp_path,kind):
    from types import SimpleNamespace
    import json
    from backend.harness.workspace import Workspace
    from backend.harness.tools import execute_tool
    ws=Workspace(tmp_path/kind);ws.write('mission.json',json.dumps(DEFAULTS[kind]))
    run=SimpleNamespace(workspace=ws,simulation=None,emit=lambda *args:None)
    result=execute_tool(run,'simulate_mission',{'config_path':'mission.json'})
    assert result['feasible']
    assert run.simulation is not None
    assert len(json.loads(ws.path('artifacts/trajectory.json').read_text()))>10
    assert ws.path('artifacts/trajectory.json').stat().st_size<=120000

def test_ball_released_on_ground_without_upward_velocity_is_already_landed():
    p=plan_mission(MissionConfig(mission_type='ball_throw',ball_height_m=0,ball_angle_deg=0))
    assert p['feasible'] and p['duration_s']==0
    assert p['final']['phase']=='Ground contact'

def test_unpowered_cw_motion_matches_closed_form_solution():
    c=MissionConfig(**{**DEFAULTS['docking'],'fuel_kg':0})
    p=plan_mission(c);t=p['duration_s'];n=math.sqrt(MU/(EARTH_RADIUS+c.station_orbit_altitude_km*1000)**3)
    x0=c.station_port_radius_m+c.docking_standoff_m
    expected_x=(4-3*math.cos(n*t))*x0
    expected_y=6*(math.sin(n*t)-n*t)*x0
    expected_vx=3*n*math.sin(n*t)*x0
    expected_vy=6*n*(math.cos(n*t)-1)*x0
    assert p['final']['position_m'][:2]==pytest.approx([expected_x,expected_y],abs=1e-7)
    assert p['final']['velocity_m_s'][:2]==pytest.approx([expected_vx,expected_vy],abs=1e-9)

def test_torque_integral_reconciles_angular_momentum():
    p=plan_mission(MissionConfig(**DEFAULTS['docking']))
    assert abs(p['metrics']['angular_momentum_balance_residual_nm_s'])<1e-9
    assert p['metrics']['signed_angular_impulse_nm_s']!=0

@pytest.mark.parametrize('kind',['ball_throw','launch'])
def test_renderer_force_vectors_reconcile_with_acceleration(kind):
    c=MissionConfig(**DEFAULTS[kind]);p=plan_mission(c,include_samples=True)
    for s in p['samples']:
        mass=c.ball_mass_kg if kind=='ball_throw' else s['mass_kg']
        force=[sum(v[i] for v in s['force_vectors_n'].values()) for i in range(3)]
        assert [v/mass for v in force]==pytest.approx(s['acceleration_m_s2'],abs=1e-10)

def test_interplanetary_impulsive_fidelity_warns_about_a_long_burn():
    p=plan_mission(MissionConfig(**{**DEFAULTS['interplanetary'],'thrust_n':1000}))
    assert p['fidelity_warnings']
    assert p['metrics']['departure_burn_to_parking_period_ratio']>0.05
