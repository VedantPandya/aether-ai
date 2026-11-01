"""Nonblocking three-layer supervisor around the shared stateful physics plant."""
import asyncio
from datetime import datetime,timezone
import json
import math
import os
from pathlib import Path
import time
import uuid
import threading
from .types import AutonomyRequest,ControlProgram,Fault,ReflexDecision
from .reflex import ReflexPolicy
from .strategy import StrategicPlanner
from .safety import guard_state,preview_program,assess_current_program
from ..agent import configured_provider
from ..physics_models.docking_plant import DockingPlant

ROOT=Path(__file__).resolve().parents[2]/".aether"/"autonomy"
SESSIONS={}
ACTIVE={"created","running"}

class AutonomySession:
    def __init__(self,request):
        self.request=request;self.id=uuid.uuid4().hex;self.provider=configured_provider() if request.mode=="auto" else request.mode
        self.plant=DockingPlant(request.config);self.plant.minimum_fuel_kg=request.fuel_reserve_kg
        self.event_lock=threading.RLock()
        self.status="created";self.events=[];self.reflex_task=None;self.strategy_task=None;self.task=None
        self.reflex=ReflexPolicy("demo" if self.provider=="demo" or (self.provider=="ollama" and not os.getenv("OPENAI_API_KEY")) else "openai",request.reflex_timeout_ms)
        self.pending_faults=[];self.manual_faults=[];self.scheduled=sorted([f.model_dump() for f in request.faults],key=lambda f:f["at_s"])
        self.strategy_calls=0;self.strategic_model_calls=0;self.strategic_tokens=0;self.last_strategy_revision=None;self.last_applied_program=None
        self.next_reflex=0.0;self.next_telemetry=0.0;self.last_state_for_reflex=None;self.last_fault_revision=0
        self.created_at=datetime.now(timezone.utc).isoformat();self.wall_started=None;self.summary="";self.stopped=False
        self.folder=ROOT/self.id;self.folder.mkdir(parents=True,exist_ok=True)
    def emit(self,type,data,layer=None):
        with self.event_lock:
            data=json.loads(json.dumps(data,default=str))
            event={"id":len(self.events)+1,"type":type,"layer":layer,"t":self.plant.t,"at":datetime.now(timezone.utc).isoformat(),"data":data}
            self.events.append(event)
            with (self.folder/"events.jsonl").open("a",encoding="utf-8") as f:f.write(json.dumps(event,default=str)+"\n")
            return event
    def snapshot(self,after=0):
        return {"id":self.id,"status":self.status,"provider":self.provider,"objective":self.request.objective,"created_at":self.created_at,"summary":self.summary,"state":self.plant.snapshot(),"config":self.request.config.model_dump(),"layers":{"mechanics":{"name":"Stateful CW + torque/force-limited PD","step_s":self.request.config.integration_step_s,"ticks":self.plant.step_count},"reflex":{"name":"Decisions API / gpt-6-luna" if self.reflex.mode!="demo" else "Deterministic offline policy","calls":self.reflex.calls,"tokens":self.reflex.tokens,"pending":self.reflex_task is not None,"deadline_ms":self.request.reflex_timeout_ms},"strategic":{"name":"Responses API reasoning" if self.provider=="openai" else "Ollama reasoning" if self.provider=="ollama" else "Deterministic candidate search","requests":self.strategy_calls,"model_calls":self.strategic_model_calls,"tokens":self.strategic_tokens,"pending":self.strategy_task is not None}},"events":[e for e in self.events if e["id"]>after],"paced":self.request.paced,"realtime_factor":self.request.realtime_factor}
    def persist(self):
        data=self.snapshot(after=len(self.events))
        (self.folder/"state.json").write_text(json.dumps(data,default=str),encoding="utf-8")
    async def stop(self):
        already_requested=self.stopped;self.stopped=True
        if self.task and not self.task.done():
            if not already_requested:self.task.cancel()
            await asyncio.gather(self.task,return_exceptions=True)
        # A task cancelled before its first tick never enters run()'s finally block.
        if self.status in ACTIVE:
            self.status="stopped";self.summary="Stopped before the first physics tick"
            self.emit("status",{"status":self.status,"summary":self.summary},1);self.persist()
    def holding_program(self):
        distance=max(10,min(500,math.hypot(*self.plant.state[:2])-self.plant.radius))
        return ControlProgram(mode="hold",hold_distance_m=distance).model_dump()
    def local_hold(self,reason):
        if self.plant.program["mode"] not in {"hold","abort"}:
            self.plant.set_program(self.holding_program())
            self.emit("local_guard",{"action":"hold","reason":reason,"state_continuity":True},1)
    def inject(self,fault):
        self.manual_faults.append(Fault.model_validate(fault).model_dump())
    def process_faults(self):
        ready=[]
        while self.scheduled and self.scheduled[0]["at_s"]<=self.plant.t+1e-8:ready.append(self.scheduled.pop(0))
        ready+=self.manual_faults;self.manual_faults=[]
        for fault in ready:
            self.plant.inject(fault);self.pending_faults.append(fault);self.last_fault_revision=self.plant.revision
            self.emit("fault",{**fault,"applied_at_s":self.plant.t},1)
            self.local_hold("Plant parameters changed; hold locally while reflex classification is pending")
            self.next_reflex=self.plant.t
    def start_reflex(self):
        state=self.plant.snapshot();self.last_state_for_reflex=state
        self.emit("reflex_requested",{"state_t":state["t"],"revision":state["revision"]},2)
        physical_snapshot=self.plant.clone()
        fault_pending=bool(self.pending_faults)
        state["strategic_pending"]=self.strategy_task is not None
        state["phase"]="far_field_alignment" if state["distance_m"]>20 else "approach" if state["distance_m"]>2 else "capture"
        async def classify():
            if self.provider=="demo":state["local_assessment"]=assess_current_program(physical_snapshot,self.request.fuel_reserve_kg)
            else:state["local_assessment"]=await asyncio.to_thread(assess_current_program,physical_snapshot,self.request.fuel_reserve_kg)
            return await self.reflex.decide(state,self.request.objective,self.request.fuel_reserve_kg,fault_pending)
        self.reflex_task=asyncio.create_task(classify())
        self.next_reflex=self.plant.t+self.request.reflex_interval_s
    def start_strategy(self):
        if self.strategy_task or self.strategy_calls>=self.request.max_strategic_calls:return
        self.local_hold("Strategic reasoning in progress; physics and attitude control remain active")
        self.strategy_calls+=1;revision=self.plant.revision;self.last_strategy_revision=revision
        planner=StrategicPlanner(self.plant,self.request.fuel_reserve_kg,self.provider,lambda kind,data:self.emit(kind,data,3))
        self.emit("strategic_requested",{"revision":revision,"state_t":self.plant.t,"faults":self.pending_faults},3)
        async def operation():
            try:
                result=await asyncio.wait_for(planner.plan(self.request.objective,list(self.pending_faults)),timeout=45)
                return result,revision
            finally:
                self.strategic_model_calls+=planner.model_calls
                self.strategic_tokens+=planner.tokens
        self.strategy_task=asyncio.create_task(operation())
    async def collect_decisions(self):
        if self.reflex_task and self.reflex_task.done():
            task=self.reflex_task;self.reflex_task=None
            try:decision=task.result()
            except Exception:
                decision=ReflexDecision(action="hold",confidence=0,source="fallback",reason="Reflex task failed",escalate=True)
            # A response classified under an old control/hardware revision has no authority.
            if self.plant.revision!=self.last_state_for_reflex["revision"]:
                self.emit("reflex_discarded",{"reason":"Control or hardware revision changed during classification","classified_revision":self.last_state_for_reflex["revision"],"current_revision":self.plant.revision},2)
                self.next_reflex=self.plant.t
            else:
                # Re-evaluate deterministic authority against current, not classified, state.
                from .safety import enforce_reflex
                current_state=self.plant.snapshot()
                current_state["local_assessment"]=self.last_state_for_reflex.get("local_assessment",{})
                decision=enforce_reflex(decision,current_state,self.request.fuel_reserve_kg,bool(self.pending_faults))
                age=self.plant.t-self.last_state_for_reflex["t"]
                if age>max(20,self.request.reflex_timeout_ms/1000*self.request.realtime_factor+5) and decision.action in {"continue","slow_down"}:
                    decision=ReflexDecision(action="hold",confidence=0,source="fallback",reason="Reflex response is stale",escalate=True)
                self.emit("reflex_decision",{**decision.model_dump(),"state_age_s":age},2)
                action=decision.action
                if action=="abort":self.plant.set_program(ControlProgram(mode="abort").model_dump())
                elif action in {"hold","replan"}:self.local_hold(decision.reason)
                elif action=="retreat":
                    distance=max(20,min(500,math.hypot(*self.plant.state[:2])-self.plant.radius+10))
                    retreat=ControlProgram(mode="retreat",hold_distance_m=distance,approach_time_constant_s=40)
                    evidence=preview_program(self.plant,retreat,self.request.fuel_reserve_kg)
                    if evidence["admissible"]:
                        self.plant.set_program(retreat.model_dump())
                        self.emit("reflex_program_applied",{"program":retreat.model_dump(),"forecast":evidence},1)
                    else:self.local_hold("Reflex retreat failed physics preview")
                elif action=="slow_down" and self.plant.program["mode"]=="approach":
                    p=ControlProgram(**{**self.plant.program,"approach_time_constant_s":max(40,self.plant.program["approach_time_constant_s"])})
                    evidence=preview_program(self.plant,p,self.request.fuel_reserve_kg)
                    if evidence["admissible"]:self.plant.set_program(p.model_dump())
                    else:self.local_hold("Slow-down command failed deterministic preview");decision.escalate=True
                if action!="abort" and (decision.escalate or action in {"replan","retreat"} or self.pending_faults):self.start_strategy()
        if self.strategy_task and self.strategy_task.done():
            task=self.strategy_task;self.strategy_task=None
            try:
                proposal,revision=task.result()
                if revision!=self.plant.revision:
                    self.emit("proposal_vetoed",{"reason":"Plant authority/program changed while planning","proposal_revision":revision,"current_revision":self.plant.revision},1)
                    self.start_strategy();return
                program=ControlProgram.model_validate(proposal["program"])
                evidence=preview_program(self.plant,program,self.request.fuel_reserve_kg)
                if not evidence["admissible"]:
                    self.emit("proposal_vetoed",{"reason":"Latest-state rollout rejected the proposal","evidence":evidence},1)
                    self.local_hold("Strategic proposal failed latest-state physics validation");self.start_strategy();return
                before=self.plant.snapshot()
                self.plant.set_program(program.model_dump());self.last_applied_program=program.model_dump();self.pending_faults=[]
                self.emit("program_applied",{"program":program.model_dump(),"source":proposal["source"],"rationale":proposal["rationale"],"forecast":evidence,"position_continuity_m":math.dist(before["position_m"],self.plant.snapshot()["position_m"]),"fuel_continuity_kg":self.plant.fuel-before["fuel_kg"]},1)
            except Exception as exc:
                self.emit("strategic_error",{"reason":type(exc).__name__,"message":"No validated strategic proposal was applied; the local holding program remains active"},3)
                self.local_hold("Strategic planning unavailable")
    async def run(self):
        self.status="running";self.wall_started=time.monotonic();self.emit("status",{"status":self.status},1)
        if self.provider=="demo":self.emit("notice",{"message":"Explicit offline stack: deterministic reflex policy and candidate search; no LLM calls. Physics, faults and plan validation are real."})
        try:
            while not self.plant.done and not self.stopped:
                self.process_faults();mandatory,reason=guard_state(self.plant.snapshot(),self.request.fuel_reserve_kg)
                if mandatory=="abort":self.plant.set_program(ControlProgram(mode="abort").model_dump());self.emit("local_guard",{"action":"abort","reason":reason},1);break
                if mandatory=="replan":self.local_hold(reason);self.start_strategy()
                await self.collect_decisions()
                if self.plant.done:break
                if self.plant.t>=self.next_reflex and self.reflex_task is None and self.reflex.calls<self.request.max_reflex_calls:self.start_reflex()
                if self.reflex.calls>=self.request.max_reflex_calls and self.pending_faults and not self.strategy_task:self.start_strategy()
                if self.request.paced:target=(time.monotonic()-self.wall_started)*self.request.realtime_factor
                else:target=self.plant.t+0.5
                target=min(target,self.request.config.docking_timeout_s)
                while self.plant.t<target-1e-9 and not self.plant.done:
                    self.process_faults();mandatory,reason=guard_state(self.plant.snapshot(),self.request.fuel_reserve_kg)
                    if mandatory=="abort":self.plant.set_program(ControlProgram(mode="abort").model_dump());self.emit("local_guard",{"action":"abort","reason":reason},1);break
                    self.plant.step(min(self.request.config.integration_step_s,target-self.plant.t))
                if self.plant.t>=self.next_telemetry:
                    self.emit("telemetry",self.plant.snapshot(),1);self.next_telemetry=self.plant.t+0.5;self.persist()
                if self.plant.t>=self.request.config.docking_timeout_s-1e-9 and not self.plant.done:self.plant.step()
                await asyncio.sleep(.05 if self.request.paced else 0)
            self.status="stopped" if self.stopped else "docked" if self.plant.success else "aborted" if "abort" in self.plant.reason.lower() or self.plant.fuel<=self.request.fuel_reserve_kg else "timeout" if self.plant.t>=self.request.config.docking_timeout_s-1e-6 else "failed"
            self.summary="Capture completed within all physical tolerances" if self.plant.success else self.plant.reason or "Autonomy session stopped without capture"
        except asyncio.CancelledError:self.status="stopped";self.summary="Stopped; last physical state and event log preserved"
        except Exception as exc:self.status="failed";self.summary=type(exc).__name__+": "+str(exc)[:300]
        finally:
            pending=[task for task in [self.reflex_task,self.strategy_task] if task is not None]
            for task in pending:
                if not task.done():task.cancel()
            if pending:await asyncio.gather(*pending,return_exceptions=True)
            await self.reflex.close()
            self.reflex_task=None;self.strategy_task=None
            self.plant.record("Docked" if self.plant.success else "Session stopped")
            self.emit("status",{"status":self.status,"summary":self.summary},1);self.persist()
            (self.folder/"trajectory.json").write_text(json.dumps(self.plant.samples),encoding="utf-8")


def create_session(request):
    provider=configured_provider() if request.mode=="auto" else request.mode
    if provider=="openai" and not os.getenv("OPENAI_API_KEY"):raise ValueError("OpenAI mode needs OPENAI_API_KEY on the server. Choose explicit demo mode until configured.")
    if provider!="demo" and not request.paced:raise ValueError("Live model mode requires paced simulation so physical time cannot outrun pending network decisions")
    if sum(s.status in ACTIVE for s in SESSIONS.values())>=4:raise ValueError("Four autonomy sessions are already active; stop one before starting another")
    session=AutonomySession(request);SESSIONS[session.id]=session
    session.task=asyncio.create_task(session.run());return session
