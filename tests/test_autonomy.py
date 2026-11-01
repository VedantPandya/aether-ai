import asyncio
import json
import math
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.physics import DEFAULTS,MissionConfig
from backend.physics_models.docking_plant import DockingPlant
from backend.autonomy.types import AutonomyRequest,ControlProgram,ReflexDecision,Fault
from backend.autonomy.runtime import AutonomySession,create_session
from backend.autonomy.reflex import ReflexPolicy
from backend.autonomy.safety import enforce_reflex,preview_program
from backend.autonomy.flyby import assess_swingby
from backend.autonomy.strategy import StrategicPlanner
from backend.autonomy import reflex as reflex_module
from backend.autonomy import strategy as strategy_module

@pytest.mark.parametrize('faults,expected',[
 ([], 'docked'),
 ([{'type':'thrust_loss','at_s':25,'value':.5}], 'docked'),
 ([{'type':'obstacle','at_s':25,'value':2.5,'position_m':[11,18]}], 'docked'),
 ([{'type':'fuel_leak','at_s':25,'value':.99}], 'aborted'),
])
def test_full_three_layer_fault_journeys(faults,expected):
    async def scenario():
        s=create_session(AutonomyRequest(mode='demo',paced=False,faults=faults));await s.task;return s
    s=asyncio.run(scenario())
    assert s.status==expected,s.summary
    assert s.plant.fuel>=s.request.fuel_reserve_kg-1e-10
    assert s.plant.step_count>0
    if faults and expected=='docked':
        assert s.strategy_calls>=1
        assert any(e['type']=='reflex_decision' and e['data']['action']=='replan' for e in s.events)
        applied=[e for e in s.events if e['type']=='program_applied']
        assert applied and all(e['data']['forecast']['admissible'] for e in applied)
        assert all(e['data']['position_continuity_m']==0 and e['data']['fuel_continuity_kg']==0 for e in applied)
    if faults and faults[0]['type']=='obstacle':
        assert s.last_applied_program['phase_offset_deg']!=0
        assert any(e['type']=='strategic_preview' and not e['data']['evidence']['admissible'] for e in s.events)

def test_state_and_fuel_do_not_reset_on_program_change():
    p=DockingPlant(MissionConfig(**DEFAULTS['docking']));p.rollout(25);before=p.snapshot()
    p.set_program(ControlProgram(mode='hold',hold_distance_m=30).model_dump())
    after=p.snapshot()
    assert after['position_m']==before['position_m']
    assert after['velocity_m_s']==before['velocity_m_s']
    assert after['fuel_kg']==before['fuel_kg']
    assert after['heading_rad']==before['heading_rad']

def test_station_spin_change_is_phase_continuous():
    p=DockingPlant(MissionConfig(**DEFAULTS['docking']));p.rollout(25);before=p.snapshot()['station_angle']
    p.inject({'type':'station_spin_change','value':.4})
    assert p.snapshot()['station_angle']==pytest.approx(before)
    assert p.spin==pytest.approx(.4*2*math.pi/60)

def test_model_continue_cannot_override_a_fuel_veto():
    state=DockingPlant(MissionConfig(**DEFAULTS['docking'])).snapshot();state['fuel_kg']=.1
    decision=ReflexDecision(action='continue',confidence=.99,source='decisions_api',reason='mock')
    result=enforce_reflex(decision,state,.25)
    assert result.action=='abort' and result.vetoed

def test_reflex_low_confidence_and_fault_override():
    state=DockingPlant(MissionConfig(**DEFAULTS['docking'])).snapshot()
    decision=ReflexDecision(action='continue',confidence=.3,source='decisions_api',reason='mock')
    assert enforce_reflex(decision,state,.25).action=='hold'
    assert enforce_reflex(decision,state,.25,True).action=='replan'

def test_decisions_timeout_is_bounded_and_explicit(monkeypatch):
    async def slow(*args,**kwargs):await asyncio.sleep(.2)
    monkeypatch.setattr(reflex_module,'decisions',slow)
    state=DockingPlant(MissionConfig(**DEFAULTS['docking'])).snapshot()
    result=asyncio.run(ReflexPolicy(mode='openai',timeout_ms=10).decide(state,'Dock',.25))
    assert result.source=='fallback' and result.action=='hold' and result.escalate
    assert result.latency_ms<150

def test_decisions_contract_and_refusal(monkeypatch):
    captured={}
    async def valid(text,questions,**kwargs):
        captured['input']=json.loads(text);captured['questions']=questions
        return {'answers':[{'name':'action','type':'choice','choice':'continue','confidence':.95},{'name':'strategic_required','type':'predicate','probability':.01}]}
    monkeypatch.setattr(reflex_module,'decisions',valid)
    state=DockingPlant(MissionConfig(**DEFAULTS['docking'])).snapshot()
    result=asyncio.run(ReflexPolicy('openai').decide(state,'Dock',.25))
    assert result.action=='continue' and result.source=='decisions_api'
    assert captured['questions'][0]['type']=='choice'
    async def refusal(*args,**kwargs):return {'answers':[{'name':'action','type':'refusal'}]}
    monkeypatch.setattr(reflex_module,'decisions',refusal)
    assert asyncio.run(ReflexPolicy('openai').decide(state,'Dock',.25)).action=='hold'

def test_physics_advances_while_reflex_is_waiting(monkeypatch):
    async def scenario():
        started=asyncio.Event();release=asyncio.Event()
        async def delayed(*args,**kwargs):
            started.set();await release.wait()
            return ReflexDecision(action='replan',confidence=1,source='deterministic_rules',reason='test',escalate=True)
        s=AutonomySession(AutonomyRequest(mode='demo',paced=True,realtime_factor=30,faults=[{'type':'thrust_loss','at_s':0,'value':.5}]))
        s.reflex.decide=delayed;s.task=asyncio.create_task(s.run())
        await asyncio.wait_for(started.wait(),1);t0=s.plant.t
        await asyncio.sleep(.13)
        assert s.plant.t>t0+1
        assert s.plant.program['mode']=='hold'
        assert s.plant.thrust_effectiveness==.5
        release.set();s.stopped=True;await s.task
    asyncio.run(scenario())

def test_stale_reflex_revision_is_discarded():
    async def scenario():
        s=AutonomySession(AutonomyRequest(mode='demo',paced=False));s.last_state_for_reflex=s.plant.snapshot()
        async def decision():return ReflexDecision(action='abort',confidence=1,source='decisions_api',reason='old')
        s.reflex_task=asyncio.create_task(decision());await asyncio.sleep(0)
        s.plant.set_program(ControlProgram(mode='hold').model_dump())
        await s.collect_decisions()
        assert not s.plant.done
        assert any(e['type']=='reflex_discarded' for e in s.events)
    asyncio.run(scenario())

def test_bad_and_old_strategic_proposals_are_vetoed():
    async def scenario():
        s=AutonomySession(AutonomyRequest(mode='demo',paced=False,max_strategic_calls=1));s.strategy_calls=1
        s.plant.rollout(25);s.plant.inject({'type':'obstacle','value':2.5,'position_m':[11,18]});s.local_hold('test')
        async def proposal():return {'program':ControlProgram().model_dump(),'source':'test','rationale':'unsafe'},s.plant.revision
        s.strategy_task=asyncio.create_task(proposal());await asyncio.sleep(0)
        await s.collect_decisions()
        assert any(e['type']=='proposal_vetoed' for e in s.events)
        assert s.plant.program['mode']=='hold'
        s.events=[]
        async def stale():return {'program':ControlProgram().model_dump(),'source':'test','rationale':'stale'},s.plant.revision-1
        s.strategy_task=asyncio.create_task(stale());await asyncio.sleep(0);await s.collect_decisions()
        assert any(e['type']=='proposal_vetoed' and 'changed' in e['data']['reason'] for e in s.events)
    asyncio.run(scenario())

def test_select_plan_requires_a_validated_candidate():
    p=DockingPlant(MissionConfig(**DEFAULTS['docking']));planner=StrategicPlanner(p,.25,'demo')
    assert 'error' in planner.tool('select_plan',{'candidate_id':'invented','rationale':'trust me'})
    candidate=planner.preview(ControlProgram())
    assert candidate['admissible']
    selected=planner.tool('select_plan',{'candidate_id':candidate['candidate_id'],'rationale':'computed capture'})
    assert selected['proposal_selected']
    assert p.t==0 and p.fuel==30

def test_strategic_responses_tool_round_trip(monkeypatch):
    class FakeClient:
        def __init__(self,**kwargs):self.responses=self;self.turn=0
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def create(self,**kwargs):
            self.turn+=1
            if self.turn==1:
                call=SimpleNamespace(type='function_call',name='preview_control_program',arguments=ControlProgram().model_dump_json(),call_id='preview')
            else:
                output=next(m['output'] for m in reversed(kwargs['input']) if isinstance(m,dict) and m.get('type')=='function_call_output')
                token=json.loads(output)['candidate_id']
                call=SimpleNamespace(type='function_call',name='select_plan',arguments=json.dumps({'candidate_id':token,'rationale':'Numerical preview meets capture constraints'}),call_id='select')
            return SimpleNamespace(output=[call],output_text='',usage=None)
    monkeypatch.setattr(strategy_module,'AsyncOpenAI',FakeClient)
    p=DockingPlant(MissionConfig(**DEFAULTS['docking']));planner=StrategicPlanner(p,.25,'openai')
    selected=asyncio.run(planner.plan('Dock',[]))
    assert selected['evidence']['admissible'] and selected['source']=='reasoning_model'
    assert planner.model_calls==2

@pytest.mark.parametrize('body',['earth','mars','venus'])
def test_swingby_conserves_planet_frame_speed_and_reports_scope(body):
    result=assess_swingby({'body':body,'incoming_vinf_m_s':[3000,0],'planet_velocity_m_s':[0,30000],'periapsis_altitude_km':500,'turn_direction':1})
    assert abs(result['planet_frame_speed_error_m_s'])<1e-9
    assert result['specific_orbital_energy_change_j_kg']>0
    assert 0<result['turn_angle_deg']<180
    assert not result['eligible_for_execution'] and not result['encounter_targeting_verified']
    assert result['ideal_propellant_kg']==0

def test_swingby_direction_changes_energy_and_atmosphere_is_screened():
    args={'incoming_vinf_m_s':[3000,0],'planet_velocity_m_s':[0,30000],'periapsis_altitude_km':500,'turn_direction':-1}
    assert assess_swingby(args)['specific_orbital_energy_change_j_kg']<0
    args['periapsis_altitude_km']=0
    assert not assess_swingby(args)['above_conservative_altitude_floor']

def test_autonomy_api_and_input_boundaries():
    with TestClient(app) as client:
        assert client.get('/api/autonomy/capabilities').json()['runtime_missions']==['docking']
        assert len(client.get('/api/autonomy/examples').json())==4
        r=client.post('/api/autonomy/sessions',json={'mode':'demo','paced':False,'config':DEFAULTS['docking']})
        assert r.status_code==200
        id=r.json()['id']
        import time
        for _ in range(100):
            state=client.get('/api/autonomy/sessions/'+id).json()
            if state['status'] not in {'created','running'}:break
            time.sleep(.02)
        assert state['status']=='docked'
        assert client.get('/api/autonomy/sessions/'+id+'/simulation').json()['execution_status']=='docked'
        assert client.post('/api/autonomy/sessions/'+id+'/inject',json={'type':'fuel_leak','value':.5}).status_code==409
        assert client.post('/api/autonomy/sessions',json={'config':DEFAULTS['launch']}).status_code==422
        assert client.post('/api/autonomy/sessions',json={'faults':[{'type':'fuel_leak','value':2}]}).status_code==422
        assert client.post('/api/autonomy/sessions',json={'mode':'openai','paced':False}).status_code==422

def test_physics_advances_while_strategic_reasoning_waits(monkeypatch):
    async def scenario():
        started=asyncio.Event();release=asyncio.Event()
        original=StrategicPlanner.plan
        async def delayed(self,objective,faults):
            started.set();await release.wait();return await original(self,objective,faults)
        monkeypatch.setattr(StrategicPlanner,'plan',delayed)
        s=create_session(AutonomyRequest(mode='demo',paced=True,realtime_factor=30,faults=[{'type':'thrust_loss','at_s':0,'value':.5}]))
        await asyncio.wait_for(started.wait(),2);t=s.plant.t;fuel=s.plant.fuel
        await asyncio.sleep(.13)
        assert s.plant.t>t+1 and s.plant.program['mode']=='hold'
        assert s.plant.fuel<=fuel
        release.set();s.stopped=True;await s.task
    asyncio.run(scenario())

def test_reserved_propellant_is_not_spent_by_controller():
    p=DockingPlant(MissionConfig(**{**DEFAULTS['docking'],'fuel_kg':.3}))
    p.minimum_fuel_kg=.25;p.rollout(20)
    assert p.fuel>=.25-1e-12
    assert p.translation_fuel+p.attitude_fuel<=.05+1e-10

def test_harness_exposes_swingby_assessment_with_no_execution_authority(tmp_path):
    from backend.harness.tools import execute_tool
    from backend.harness.workspace import Workspace
    r=SimpleNamespace(workspace=Workspace(tmp_path))
    result=execute_tool(r,'assess_swingby',{'body':'earth','incoming_vx_m_s':3000,'incoming_vy_m_s':0,'planet_vx_m_s':0,'planet_vy_m_s':30000,'periapsis_altitude_km':500,'turn_direction':1})
    assert not result['eligible_for_execution']
    assert result['specific_orbital_energy_change_j_kg']>0

def test_classifier_uncertainty_keeps_an_already_verified_program():
    state=DockingPlant(MissionConfig(**DEFAULTS['docking'])).snapshot()
    state['local_assessment']={'admissible':True,'captures':True}
    decision=ReflexDecision(action='hold',confidence=.2,source='decisions_api',reason='uncertain',escalate=True)
    result=enforce_reflex(decision,state,.25)
    assert result.action=='continue' and result.source=='fallback' and not result.escalate
    assert enforce_reflex(decision,state,.25,True).action!='continue'

def test_current_program_forecast_does_not_restart_a_detour():
    from backend.autonomy.safety import assess_current_program
    p=DockingPlant(MissionConfig(**DEFAULTS['docking']))
    p.set_program(ControlProgram(phase_offset_deg=40,approach_time_constant_s=36).model_dump())
    p.rollout(50);before=p.snapshot();epoch=p.reference_epoch
    assessment=assess_current_program(p,.25)
    assert assessment['captures'] and assessment['admissible']
    assert p.snapshot()==before and p.reference_epoch==epoch

def test_harness_can_execute_the_three_layer_runtime(tmp_path):
    from backend.harness.workspace import Workspace
    from backend.harness.tools import execute_tool
    ws=Workspace(tmp_path);ws.write('mission.json',json.dumps(DEFAULTS['docking']))
    recorded=[]
    run=SimpleNamespace(workspace=ws,provider='demo',cancel_requested=False,simulation=None,emit=lambda kind,data:recorded.append((kind,data)))
    result=execute_tool(run,'run_autonomous_mission',{'config_path':'mission.json','scenario':'obstacle'})
    assert result['status']=='docked'
    assert result['layers']['strategic']['requests']>=1
    assert run.simulation['success']
    assert ws.path('artifacts/autonomy-summary.json').is_file()
    assert any(kind=='autonomy_started' for kind,_ in recorded)
    assert ws.path('artifacts/trajectory.json').stat().st_size<=120000

def test_stop_before_first_tick_releases_active_slot_and_persists_state():
    async def scenario():
        s=create_session(AutonomyRequest(mode='demo',paced=False))
        await s.stop()
        assert s.status=='stopped' and s.task.done()
        assert s.plant.step_count==0 and s.reflex.calls==0
        assert json.loads((s.folder/'state.json').read_text())['status']=='stopped'
    asyncio.run(scenario())

def test_cancelled_harness_parent_does_not_start_inference(tmp_path):
    from backend.harness.workspace import Workspace
    from backend.harness.tools import execute_tool
    ws=Workspace(tmp_path);ws.write('mission.json',json.dumps(DEFAULTS['docking']))
    run=SimpleNamespace(workspace=ws,provider='demo',cancel_requested=True,simulation=None,emit=lambda *_:None)
    result=execute_tool(run,'run_autonomous_mission',{'config_path':'mission.json','scenario':'thrust_loss'})
    assert result['status']=='stopped'
    assert result['layers']['reflex']['calls']==0 and result['layers']['strategic']['model_calls']==0
    assert not result['applied_faults'] and len(result['unapplied_faults'])==1
