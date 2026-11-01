import json
from pathlib import Path
from .execution import execute_python
from ..physics import MissionConfig, plan_mission
from ..knowledge import search_physics


def schema(name,description,properties):
    return {"type":"function","name":name,"description":description,"strict":True,"parameters":{"type":"object","properties":properties,"required":list(properties),"additionalProperties":False}}
STR={"type":"string"}
TOOLS=[
 schema("list_files","List files in this run workspace. The application repository and host secrets are outside scope.",{}),
 schema("read_file","Read a workspace file with line numbers. Use this before editing.",{"path":STR,"start_line":{"type":"integer"},"end_line":{"type":"integer"}}),
 schema("grep","Search workspace file contents using ripgrep regex, or a literal fallback. glob examples: *.py or references/*.md.",{"pattern":STR,"glob":STR,"case_sensitive":{"type":"boolean"}}),
 schema("find_files","Find workspace files by glob pattern, e.g. *.py, artifacts/*, references/*.md.",{"glob":STR}),
 schema("delete_file","Delete one workspace file and return its removal diff. AGENTS.md and mission.json are protected.",{"path":STR}),
 schema("write_file","Create a new Python, JSON, Markdown, CSV or text file. Existing files require edit_file.",{"path":STR,"content":STR}),
 schema("edit_file","Replace exactly one occurrence of old_text in a workspace file; returns a unified diff. Read the file first.",{"path":STR,"old_text":STR,"new_text":STR}),
 schema("run_python","Execute an existing Python script. Numerical mode supports math, statistics, json, local modules, functions, loops, assertions, read_json/write_json/read_text/write_text. No shell, network, arbitrary imports, classes or introspection. Docker mode enables full Python in an isolated container. Output includes real stdout and exit status.",{"path":STR}),
 schema("run_tests","Run test_ functions in one test Python file in numerical mode. Tests may import a validated workspace module. In Docker mode use unittest classes. A zero-test result is not proof of correctness.",{"path":STR}),
 schema("assess_swingby","Assess a planar unpowered hyperbolic flyby: turning angle, planet-relative speed conservation and heliocentric energy change. This does NOT solve encounter targeting or authorize a gravity-assist mission.",{"body":{"type":"string","enum":["earth","mars","venus"]},"incoming_vx_m_s":{"type":"number"},"incoming_vy_m_s":{"type":"number"},"planet_vx_m_s":{"type":"number"},"planet_vy_m_s":{"type":"number"},"periapsis_altitude_km":{"type":"number"},"turn_direction":{"type":"integer","enum":[-1,1]}}),
 schema("search_physics","Search the sourced local physics knowledge graph.",{"query":STR}),
 schema("plan_mission","Read a mission configuration JSON file and compute a deterministic feasibility plan. Writes artifacts/plan.json. Does not run custom Python controllers.",{"config_path":STR}),
 schema("run_autonomous_mission","Execute the real three-layer docking runtime: local force/torque-limited control, Decisions API reflexes and validated strategic replanning. Optional fault scenario. Runs a paced flight in live mode; explicit demo uses offline model replacements. Saves trajectory and layer report. Other mission types use simulate_mission.",{"config_path":STR,"scenario":{"type":"string","enum":["nominal","thrust_loss","obstacle","fuel_leak"]}}),
 schema("simulate_mission","Run a validated built-in physics model using a configuration file. Uses the built-in reference controller for docking. Writes computed trajectory and report artifacts for the 3D viewer; infeasible missions are blocked.",{"config_path":STR}),
 schema("update_plan","Maintain a short visible task plan. Update steps as work progresses.",{"steps":{"type":"array","items":{"type":"object","properties":{"title":STR,"status":{"type":"string","enum":["pending","in_progress","completed"]}},"required":["title","status"],"additionalProperties":False}}}),
]

def execute_tool(run,name,args):
    ws=run.workspace
    if name=="list_files": return {"files":ws.files()}
    if name=="read_file": return ws.read(**args)
    if name=="grep": return ws.grep(**args)
    if name=="find_files": return ws.find(args["glob"])
    if name=="delete_file": return ws.delete(args["path"])
    if name=="write_file": return ws.write(args["path"],args["content"],create_only=True)
    if name=="edit_file": return ws.edit(**args)
    if name=="run_python": return execute_python(ws,args["path"])
    if name=="run_tests":
        result=execute_python(ws,args["path"],tests=True)
        if result.get("mode")=="numerical" and not result.get("tests") and result.get("exit_code")==0:
            result.update(exit_code=1,error="No test_ functions were discovered")
        return result
    if name=="assess_swingby":
        from ..autonomy.flyby import assess_swingby
        return assess_swingby({"body":args["body"],"incoming_vinf_m_s":[args["incoming_vx_m_s"],args["incoming_vy_m_s"]],"planet_velocity_m_s":[args["planet_vx_m_s"],args["planet_vy_m_s"]],"periapsis_altitude_km":args["periapsis_altitude_km"],"turn_direction":args["turn_direction"]})
    if name=="search_physics": return search_physics(args["query"])
    if name=="run_autonomous_mission":
        from .autonomy_bridge import run_autonomous_mission
        return run_autonomous_mission(run,args["config_path"],args["scenario"])
    if name in {"plan_mission","simulate_mission"}:
        cfg=MissionConfig(**json.loads(ws.path(args["config_path"]).read_text(encoding="utf-8")))
        result=plan_mission(cfg,include_samples=name=="simulate_mission")
        ws.write("artifacts/plan.json",json.dumps({k:v for k,v in result.items() if k not in {"samples","body_ephemerides"}},indent=2))
        if name=="simulate_mission":
            if not result["feasible"]: return {"error":"Simulation blocked by deterministic physics feasibility gate","status":"blocked","plan":{k:v for k,v in result.items() if k not in {"samples","body_ephemerides"}}}
            run.simulation=result
            from .artifacts import save_trajectory
            save_trajectory(ws,result["samples"])
            run.emit("simulation",{"summary":result["summary"],"mission_type":cfg.mission_type,"sample_count":len(result["samples"])})
        return {k:v for k,v in result.items() if k not in {"samples","body_ephemerides"}}
    if name=="update_plan":
        if not 1<=len(args["steps"])<=8: raise ValueError("Use one to eight plan steps")
        run.plan=args["steps"];run.emit("plan",{"steps":run.plan}); return {"steps":run.plan}
    raise ValueError("Tool is not registered")
