"""Tier 3 proposes programs; deterministic rollouts validate every proposal."""
import asyncio
import hashlib
import json
import os
from openai import AsyncOpenAI
import httpx
from .types import ControlProgram
from .safety import preview_program
from .flyby import assess_swingby
from ..knowledge import search_physics


def strict_schema(model):
    schema=model.model_json_schema();schema.pop("title",None);schema["required"]=list(schema["properties"])
    for prop in schema["properties"].values():prop.pop("title",None);prop.pop("default",None)
    return schema

PROGRAM_SCHEMA=strict_schema(ControlProgram)
TOOLS=[
 {"type":"function","name":"inspect_state","description":"Inspect the latest physical state and remaining control authority. No state changes.","strict":True,"parameters":{"type":"object","properties":{},"required":[],"additionalProperties":False}},
 {"type":"function","name":"search_physics","description":"Retrieve sourced physics knowledge; implemented and reference-only boundaries remain explicit.","strict":True,"parameters":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"],"additionalProperties":False}},
 {"type":"function","name":"preview_control_program","description":"Numerically roll out a candidate from the current state with the actual remaining fuel, thrust/torque authority and obstacles. approach must meet all capture tolerances; hold/retreat are screened over 20 s. Returns a candidate ID and deterministic admissibility.","strict":True,"parameters":PROGRAM_SCHEMA},
 {"type":"function","name":"select_plan","description":"Select a previously previewed admissible candidate by its ID and explain the choice. This is a proposal; the supervisor independently revalidates it against the latest physical state before applying.","strict":True,"parameters":{"type":"object","properties":{"candidate_id":{"type":"string"},"rationale":{"type":"string"}},"required":["candidate_id","rationale"],"additionalProperties":False}}
]

SYSTEM="""You are Aether's strategic flight director, tier 3 of a hierarchical control system.
The deterministic controller is actively integrating mechanics while you plan. A fast reflex layer has placed the vehicle in a holding pattern after a fault. You may propose a new approach, detour, retreat, hold or abort, but never set position, velocity, fuel, mass or hardware authority. Stay within the provided tool contracts.
The input includes physics_screened_candidates already numerically previewed from the live plant. Select one directly if it meets the objective; avoid redundant state reads and previews. Use inspect/search/preview tools when a new candidate or missing evidence is needed. Every selected candidate must have a tool-generated numerical preview. If an approach cannot capture with the remaining fuel/authority and obstacles, try a slower or angular-detour approach. phase_offset_deg makes the approach reference arc around the station before decaying to the actual port. Avoid unnecessary detours and fuel consumption. If no capture is feasible, preview retreat or hold, or select a previewed abort.
Select only an admissible preview. A favorable endpoint alone is insufficient: respect obstacle boundaries, propellant reserve, attitude and rate limits, and the simulation deadline. Do not fabricate readiness or replenish fuel. A holding pattern is not a completed docking. The supervisor revalidates current state after your response; old forecasts are not execution authority.
Use short factual progress summaries, not private chain-of-thought. You must call select_plan to return an actionable proposal; free text does not command the plant.
"""

class StrategicPlanner:
    def __init__(self,plant,reserve,mode,emit=lambda *args:None):
        self.plant=plant;self.reserve=reserve;self.mode=mode;self.emit=emit;self.candidates={};self.selected=None;self.model_calls=0;self.tokens=0
    def preview(self,program,physical_snapshot=None):
        program=ControlProgram.model_validate(program)
        plant=physical_snapshot or self.plant
        evidence=preview_program(plant,program,self.reserve)
        token=hashlib.sha256(json.dumps({"t":plant.t,"revision":plant.revision,"program":program.model_dump()},sort_keys=True).encode()).hexdigest()[:12]
        self.candidates[token]={"program":program.model_dump(),"evidence":evidence,"state_t":plant.t,"revision":plant.revision}
        self.emit("strategic_preview",{"candidate_id":token,"program":program.model_dump(),"evidence":evidence})
        return {"candidate_id":token,**evidence}
    def tool(self,name,args):
        if name=="inspect_state":return self.plant.snapshot()
        if name=="search_physics":return search_physics(args["query"])
        if name=="preview_control_program":return self.preview(args)
        if name=="select_plan":
            candidate=self.candidates.get(args["candidate_id"])
            if not candidate or not candidate["evidence"]["admissible"]:return {"error":"Candidate is missing or failed deterministic preview"}
            self.selected={**candidate,"candidate_id":args["candidate_id"],"rationale":str(args["rationale"])[:1000],"source":"reasoning_model"}
            return {"proposal_selected":True,"candidate_id":args["candidate_id"]}
        return {"error":"Unsupported strategic tool"}
    async def tool_async(self,name,args):
        if name=="preview_control_program":
            snapshot=self.plant.clone()
            return await asyncio.to_thread(self.preview,args,snapshot)
        return self.tool(name,args)
    async def shortlist(self):
        candidates=[]
        for tau,phase in [(27,0),(40,0),(36,40),(36,-40)]:
            program=ControlProgram(approach_time_constant_s=tau,phase_offset_deg=phase)
            result=await self.tool_async("preview_control_program",program.model_dump())
            candidates.append({"candidate_id":result["candidate_id"],"program":program.model_dump(),**{k:result[k] for k in ["admissible","captures","duration_s","fuel_remaining_kg","reason"]}})
        return candidates
    async def plan(self,objective,faults):
        if self.mode=="demo":return self.rules()
        if self.mode=="ollama":return await self.ollama(objective,faults)
        candidates=await self.shortlist()
        messages=[{"role":"user","content":json.dumps({"objective":objective,"faults":faults,"state":self.plant.snapshot(),"protected_reserve_kg":self.reserve,"physics_screened_candidates":candidates})}]
        client=await asyncio.to_thread(AsyncOpenAI,timeout=25,max_retries=0)
        async with client:
            for _ in range(6):
                self.model_calls+=1
                self.emit("strategic_model",{"model":os.getenv("OPENAI_MODEL","gpt-6-luna"),"turn":self.model_calls})
                response=await client.responses.create(model=os.getenv("OPENAI_MODEL","gpt-6-luna"),instructions=SYSTEM,input=messages,tools=TOOLS,parallel_tool_calls=True,max_output_tokens=2200,store=False)
                if response.usage:self.tokens+=response.usage.total_tokens
                messages.extend(response.output)
                if response.output_text:self.emit("strategic_message",{"text":response.output_text})
                calls=[o for o in response.output if o.type=="function_call"]
                if not calls:break
                for call in calls:
                    try:result=await self.tool_async(call.name,json.loads(call.arguments))
                    except (ValueError,TypeError,KeyError) as exc:result={"error":str(exc)[:400]}
                    messages.append({"type":"function_call_output","call_id":call.call_id,"output":json.dumps(result,default=str)[:18000]})
                if self.selected:return self.selected
                if self.tokens>20000:raise RuntimeError("Strategic token budget reached")
        raise RuntimeError("Strategic model did not select a validated candidate")
    async def ollama(self,objective,faults):
        messages=[{"role":"system","content":SYSTEM},{"role":"user","content":json.dumps({"objective":objective,"faults":faults,"state":self.plant.snapshot(),"protected_reserve_kg":self.reserve})}]
        tools=[{"type":"function","function":{k:v for k,v in t.items() if k not in {"type","strict"}}} for t in TOOLS]
        client=await asyncio.to_thread(httpx.AsyncClient,timeout=25)
        async with client:
            for _ in range(6):
                self.model_calls+=1
                response=await client.post(os.getenv("OLLAMA_BASE_URL","http://localhost:11434").rstrip("/")+"/api/chat",json={"model":os.getenv("OLLAMA_MODEL","qwen3:8b"),"messages":messages,"tools":tools,"stream":False})
                response.raise_for_status();data=response.json();message=data["message"];messages.append(message)
                self.tokens+=data.get("prompt_eval_count",0)+data.get("eval_count",0)
                for call in message.get("tool_calls",[]):
                    name=call["function"]["name"]
                    try:result=await self.tool_async(name,call["function"]["arguments"])
                    except (ValueError,TypeError,KeyError) as exc:result={"error":str(exc)[:400]}
                    messages.append({"role":"tool","tool_name":name,"content":json.dumps(result,default=str)[:18000]})
                if self.selected:return self.selected
                if not message.get("tool_calls") or self.tokens>20000:break
        raise RuntimeError("Local strategic model did not select an admissible candidate")
    def rules(self):
        # Explicit offline physics search, not a fabricated reasoning-model response.
        candidates=[]
        for tau,phase in [(27,0),(40,0),(36,40),(36,-40)]:
            program=ControlProgram(approach_time_constant_s=tau,phase_offset_deg=phase)
            result=self.preview(program)
            if result["admissible"]:candidates.append((result["duration_s"]+result["fuel_used_kg"]*5,result))
        if candidates:
            result=min(candidates,key=lambda p:p[0])[1]
        else:
            stand_off=max(20,math_radius(self.plant)-self.plant.radius+10)
            result=self.preview(ControlProgram(mode="retreat",hold_distance_m=min(500,stand_off),approach_time_constant_s=40))
            if not result["admissible"]:result=self.preview(ControlProgram(mode="abort"))
        candidate=self.candidates[result["candidate_id"]]
        return {**candidate,"candidate_id":result["candidate_id"],"rationale":"Offline deterministic candidate search selected a physically screened program","source":"deterministic_search"}

def math_radius(plant):
    import math
    return math.hypot(*plant.state[:2])
