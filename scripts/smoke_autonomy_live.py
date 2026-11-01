"""Small live API smoke check. Never prints keys or raw provider error bodies."""
import argparse
import asyncio
import json
from pathlib import Path
import sys
import time
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from dotenv import load_dotenv
load_dotenv(ROOT/'.env')
from backend.agent import decisions
from backend.physics import MissionConfig,DEFAULTS
from backend.physics_models.docking_plant import DockingPlant
from backend.autonomy.strategy import StrategicPlanner
from backend.autonomy.safety import preview_program

async def main(strategy=False):
    report={}
    started=time.perf_counter()
    try:
        response=await decisions('Nominal docking: fuel 30 kg, no faults, outside station exclusion boundary.',[{'type':'choice','name':'action','instructions':'Choose continue for nominal docking, hold for an anomaly.','choices':[{'value':'continue'},{'value':'hold'}]}])
        report['reflex']={'ok':True,'model':response.get('model'),'answers':response.get('answers'),'latency_ms':round((time.perf_counter()-started)*1000)}
    except Exception as exc:
        status=getattr(getattr(exc,'response',None),'status_code',None)
        report['reflex']={'ok':False,'error_type':type(exc).__name__,'http_status':status}
    if strategy:
        plant=DockingPlant(MissionConfig(**DEFAULTS['docking']));planner=StrategicPlanner(plant,.25,'openai')
        started=time.perf_counter()
        try:
            proposal=await planner.plan('Inspect state and preview/select a safe nominal docking approach. No detour is needed.',[])
            report['strategy']={'ok':True,'program':proposal['program'],'admissible':preview_program(plant,proposal['program'],.25)['admissible'],'model_calls':planner.model_calls,'tokens':planner.tokens,'latency_ms':round((time.perf_counter()-started)*1000)}
        except Exception as exc:
            status=getattr(getattr(exc,'response',None),'status_code',None)
            report['strategy']={'ok':False,'error_type':type(exc).__name__,'http_status':status,'model_calls':planner.model_calls}
    print(json.dumps(report,indent=2))
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--strategy',action='store_true');args=p.parse_args();asyncio.run(main(args.strategy))
