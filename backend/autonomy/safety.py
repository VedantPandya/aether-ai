"""Deterministic authority: model recommendations cannot bypass these gates."""
import math
from .types import ControlProgram,ReflexDecision

def guard_state(state,reserve):
    if state["done"] and not state["success"]:return "abort",state["reason"] or "Plant stopped"
    if state["obstacle_margin_m"]<=0:return "abort","Obstacle exclusion boundary crossed"
    if state["fuel_kg"]<=max(1e-9,reserve):return "abort","Propellant is at or below the protected reserve"
    if state["thrust_effectiveness"]<=0:return "replan","Translation thrust authority lost"
    return None,None

def enforce_reflex(decision,state,reserve,unhandled_fault=False):
    mandatory,reason=guard_state(state,reserve)
    if mandatory and decision.action!=mandatory:
        return ReflexDecision(action=mandatory,confidence=1,source=decision.source,reason=reason,latency_ms=decision.latency_ms,escalate=mandatory=="replan",vetoed=True)
    if unhandled_fault and decision.action in {"continue","slow_down"}:
        return ReflexDecision(action="replan",confidence=1,source=decision.source,reason="Unresolved plant fault requires a validated new control plan",latency_ms=decision.latency_ms,escalate=True,vetoed=True)
    assessment=state.get("local_assessment",{})
    if decision.confidence<0.8 and not unhandled_fault and state["program"]["mode"]=="approach" and assessment.get("captures") and assessment.get("admissible") and decision.action!="abort":
        return ReflexDecision(action="continue",confidence=decision.confidence,source="fallback",reason="Classifier uncertainty does not invalidate the current numerically verified approach",latency_ms=decision.latency_ms,escalate=False,vetoed=True)
    if decision.confidence<0.8 and decision.action in {"continue","slow_down"}:
        return ReflexDecision(action="hold",confidence=decision.confidence,source=decision.source,reason="Reflex confidence below the engineering acceptance threshold",latency_ms=decision.latency_ms,escalate=True,vetoed=True)
    return decision

def preview_program(plant,program,reserve,horizon_s=None):
    program=ControlProgram.model_validate(program)
    test=plant.clone();test.samples=[];test.events=[];test.record("Candidate start");test.set_program(program.model_dump())
    if program.mode=="abort":return {"admissible":True,"captures":False,"reason":"Explicit mission abort; no state reset or future capture claim","duration_s":0,"fuel_remaining_kg":test.fuel,"final":test.snapshot()}
    horizon=plant.config.docking_timeout_s-plant.t if program.mode=="approach" else (horizon_s or 20)
    test.rollout(horizon)
    final=test.snapshot();reason=test.reason
    collision="boundary" in reason.lower()
    admissible=not collision and test.fuel>=reserve
    if program.mode=="approach":admissible=admissible and test.success
    elif test.done and not test.success:admissible=False
    return {"admissible":admissible,"captures":test.success,"reason":reason or ("Capture constraints met" if test.success else "Stand-off forecast remains within the model envelope"),"duration_s":test.t-plant.t,"fuel_remaining_kg":test.fuel,"fuel_used_kg":max(0,plant.fuel-test.fuel),"final":final}


def assess_current_program(plant,reserve):
    """Forecast the active program without resetting its reference epoch or detour phase."""
    test=plant.clone();test.samples=[];test.events=[];test.record("Current-program forecast")
    test.rollout(None if test.program["mode"]=="approach" else 20)
    admissible=(not test.reason and test.fuel>=reserve)
    if test.program["mode"]=="approach":admissible=admissible and test.success
    return {"admissible":admissible,"captures":test.success,"fuel_remaining_kg":test.fuel,"reason":test.reason or "Current reference remains feasible","forecast_from_t":plant.t}
