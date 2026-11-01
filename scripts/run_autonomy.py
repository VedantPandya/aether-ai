"""Run and export a complete hierarchical-control example without the frontend."""
import argparse
import asyncio
import json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from dotenv import load_dotenv
load_dotenv(ROOT/'.env')
from backend.autonomy.types import AutonomyRequest
from backend.autonomy.runtime import create_session

FAULTS={
 'nominal':[],
 'engine-fault':[{'type':'thrust_loss','at_s':25,'value':.5}],
 'obstacle':[{'type':'obstacle','at_s':25,'value':2.5,'position_m':[11,18]}],
 'fuel-leak':[{'type':'fuel_leak','at_s':25,'value':.99}],
}
async def run(args):
    request=AutonomyRequest(mode=args.mode,paced=args.mode!='demo' or args.paced,realtime_factor=args.factor,faults=FAULTS[args.scenario])
    session=create_session(request);await session.task
    result={'id':session.id,'status':session.status,'summary':session.summary,'simulated_time_s':session.plant.t,'final_state':session.plant.snapshot(),'layers':session.snapshot()['layers'],'reflex_results':[{'action':e['data']['action'],'source':e['data']['source'],'latency_ms':e['data']['latency_ms'],'vetoed':e['data']['vetoed']} for e in session.events if e['type']=='reflex_decision'],'applied_programs':[e['data'] for e in session.events if e['type']=='program_applied'],'log_directory':str(session.folder)}
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k not in {'applied_programs','final_state'}},indent=2))
    return session
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--mode',choices=['demo','openai','ollama'],default='demo');parser.add_argument('--scenario',choices=list(FAULTS),default='engine-fault');parser.add_argument('--factor',type=float,default=5);parser.add_argument('--paced',action='store_true');parser.add_argument('--output',type=Path)
    asyncio.run(run(parser.parse_args()))
