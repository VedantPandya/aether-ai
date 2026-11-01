from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from backend.main import app
from backend.harness import service
service.RUNS_ROOT=ROOT/'.aether/demo-video/runs'
import uvicorn
if __name__=='__main__':uvicorn.run(app,host='127.0.0.1',port=8386,log_level='warning')
