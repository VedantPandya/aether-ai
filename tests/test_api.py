import asyncio
import json
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.physics import DEFAULTS, MissionConfig
from backend import agent

client=TestClient(app)
@pytest.fixture(autouse=True)
def no_live_calls(monkeypatch): monkeypatch.setenv("AGENT_PROVIDER","demo")

def test_full_plan_execute_and_anomaly_journey():
    r=client.post('/api/chat',json={"message":"Transfer from 300 km to 800 km", "offline":True})
    assert r.status_code==200
    result=r.json(); assert result['plan']['feasible']
    assert {t['tier'] for t in result['trace']}=={1,2}
    config=result['plan']['config']
    preflight=client.post('/api/reflex',json={"config":config,"offline":True}).json()
    assert preflight['action']=='continue'
    simulation=client.post('/api/simulate',json=config)
    assert simulation.status_code==200
    assert simulation.json()['samples'][-1]['altitude_km']==pytest.approx(800,abs=.001)
    failed=client.post('/api/chat',json={"message":"A fuel leak occurred. Recalculate.","config":config,"offline":True}).json()
    assert not failed['plan']['feasible']
    assert client.post('/api/simulate',json=failed['plan']['config']).status_code==409

@pytest.mark.parametrize("kind",list(DEFAULTS))
def test_each_scenario_can_be_planned_and_executed(kind):
    p=client.post('/api/plan',json=DEFAULTS[kind]); assert p.status_code==200 and p.json()['feasible']
    s=client.post('/api/simulate',json=DEFAULTS[kind]); assert s.status_code==200 and len(s.json()['samples'])>10

def test_knowledge_graph_has_resolvable_edges_and_sources():
    nodes=client.get('/api/knowledge').json(); ids={n['id'] for n in nodes}
    assert len(ids)>=8
    for n in nodes:
        assert set(n['related'])<=ids
        assert n['sources'] and n['equation']
        assert '?' not in n['equation']

def test_secrets_are_not_exposed(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY','private-test-key')
    assert 'private-test-key' not in client.get('/api/health').text
    assert client.get('/.env').status_code!=200 or 'private-test-key' not in client.get('/.env').text

def test_invalid_inputs_and_unsupported_missions():
    assert client.post('/api/plan',json={'fuel_kg':-1}).status_code==422
    assert client.post('/api/chat',json={'message':'x'*2001}).status_code==422
    r=client.post('/api/chat',json={'message':'Take me to Mars','offline':True}).json()
    assert r['plan'] is None

@pytest.mark.parametrize('text,expected', [('Use 5 kg fuel',5),('Carry 900 kg payload',120),('Fuel leak detected',12)])
def test_offline_parser_changes_parameters(text,expected):
    r=client.post('/api/chat',json={'message':text,'offline':True}).json()
    assert r['plan']['config']['fuel_kg']==expected
    if 'payload' in text: assert r['plan']['config']['payload_kg']==900

def test_decisions_contract_and_deterministic_veto(monkeypatch):
    captured={}
    async def fake_decisions(text,questions):
        captured['questions']=questions
        return {'answers':[{'type':'choice','name':'reflex','choice':'continue','confidence':.99}]}
    monkeypatch.setenv('AGENT_PROVIDER','openai')
    monkeypatch.setattr(agent,'decisions',fake_decisions)
    r=asyncio.run(agent.reflex(MissionConfig(fuel_kg=0)))
    assert r['action']=='hold' # A classifier cannot override insufficient fuel.
    assert captured['questions'][0]['type']=='choice'

def test_decisions_refusal_fails_closed(monkeypatch):
    async def fake_decisions(*args): return {'answers':[{'type':'refusal','name':'reflex'}]}
    monkeypatch.setenv('AGENT_PROVIDER','openai'); monkeypatch.setattr(agent,'decisions',fake_decisions)
    assert asyncio.run(agent.reflex(MissionConfig()))['action']=='escalate'

def test_openai_tool_round_trip(monkeypatch):
    responses=[
        SimpleNamespace(model='test',usage=None,output=[SimpleNamespace(type='function_call',name='search_physics',arguments=json.dumps({'query':'hohmann'}),call_id='k1')],output_text=''),
        SimpleNamespace(model='test',usage=None,output=[SimpleNamespace(type='function_call',name='plan_mission',arguments=json.dumps(DEFAULTS['orbit']),call_id='p1')],output_text=''),
        SimpleNamespace(model='test',usage=None,output=[],output_text='Verified orbital transfer.'),
    ]
    requests=[]
    class FakeClient:
        def __init__(self,**kwargs): self.responses=self
        async def __aenter__(self): return self
        async def __aexit__(self,*args): pass
        async def create(self,**kwargs): requests.append(dict(kwargs)); return responses.pop(0)
    async def fake_route(*args): return 'reasoning'
    monkeypatch.setattr(agent,'AsyncOpenAI',FakeClient); monkeypatch.setattr(agent,'route_request',fake_route)
    r=asyncio.run(agent.live_openai(agent.ChatRequest(message='Plan an orbital transfer'),[]))
    assert r['plan']['feasible'] and r['reply']=='Verified orbital transfer.'
    assert any(isinstance(m,dict) and m.get('type')=='function_call_output' and m.get('call_id')=='p1' for m in requests[-1]['input'])
    assert all(not request['store'] for request in requests)
