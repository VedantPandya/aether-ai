"""Knowledge integrity, retrieval relevance, and model-support boundaries."""
from urllib.parse import urlparse
import pytest
from backend.knowledge import TOPICS, search_physics
from backend.physics import DEFAULTS, MissionConfig, plan_mission

REQUIRED_CONCEPTS = {
    'newtons-laws', 'lagrangian-mechanics', 'hamiltonian-mechanics', 'rigid-body-dynamics',
    'staging', 'separation-dynamics', 'hill-clohessy-wiltshire', 'docking-contact',
    'gravity-assist', 'oberth-effect', 'b-plane-targeting', 'rover-traction',
    'maxwell-equations', 'thermodynamics', 'lorentz-transformations', 'relativistic-rocket',
    'proper-time', 'schwarzschild-metric', 'kerr-black-hole', 'penrose-process',
    'gravitational-lensing', 'relativistic-flyby', 'geodesic-deviation', 'model-fidelity',
}

def test_library_schema_coverage_and_graph_integrity():
    ids = {t['id'] for t in TOPICS}
    assert len(ids) == len(TOPICS) >= 120
    assert REQUIRED_CONCEPTS <= ids
    for topic in TOPICS:
        for key in ('title', 'category', 'equation', 'summary', 'details', 'regime', 'simulation_notes'):
            assert isinstance(topic[key], str) and topic[key].strip(), (topic['id'], key)
        assert topic['simulation_status'] in {'implemented', 'simplified', 'reference_only'}
        assert topic['assumptions'] and topic['limitations']
        assert 1 <= len(topic['related']) <= 3
        assert len(topic['related']) == len(set(topic['related']))
        assert set(topic['related']) <= ids and topic['id'] not in topic['related']
        assert topic['sources'] and all(urlparse(s['url']).scheme == 'https' for s in topic['sources'])
        assert '?' not in topic['equation'] and '\ufffd' not in str(topic)

@pytest.mark.parametrize('query,expected', [
    ('blackhole swingby', 'relativistic-flyby'),
    ('stage separation', 'separation-dynamics'),
    ('frame-dragging', 'frame-dragging'),
    ('rotating docking', 'rotating-frames'),
    ('Schwarzschild time dilation', 'gravitational-time-dilation'),
    ('HCW', 'hill-clohessy-wiltshire'),
    ('MPC', 'model-predictive-control'),
    ('EKF', 'kalman-filter'),
    ('rover traction', 'rover-traction'),
    ('relativistic rocket', 'relativistic-rocket'),
    ('Newtonian gravity', 'gravity'),
])
def test_retrieval_relevance_and_bounded_context(query, expected):
    result = search_physics(query)
    assert 1 <= len(result['topics']) <= 4
    assert expected in {t['id'] for t in result['topics']}
    assert 'reference-only' in result['coverage_notice']

@pytest.mark.parametrize('query', ['', 'the and of', 'zzqxnotphysics', 'https www org'])
def test_empty_unknown_and_source_tokens_do_not_return_arbitrary_knowledge(query):
    result = search_physics(query)
    assert result['topics'] == [] and result['notice']

def test_reference_topics_never_claim_to_be_backend_solvers():
    by_id = {t['id']: t for t in TOPICS}
    for id in {'kerr-black-hole', 'penrose-process', 'relativistic-flyby', 'docking-contact', 'rigid-body-dynamics'}:
        assert by_id[id]['simulation_status'] == 'reference_only'
    result = search_physics('Kerr black hole')
    assert all(t['simulation_status'] == 'reference_only' for t in result['topics'])
    with pytest.raises(ValueError):
        MissionConfig(mission_type='blackhole')

def test_existing_mission_knowledge_ids_still_resolve():
    ids = {t['id'] for t in TOPICS}
    for config in DEFAULTS.values():
        plan = plan_mission(MissionConfig(**config))
        assert set(plan['knowledge_ids']) <= ids
