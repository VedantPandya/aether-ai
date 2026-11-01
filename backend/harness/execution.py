import asyncio
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

RUNNER=Path(__file__).with_name("python_runner.py").resolve()

def windows_memory_job(process):
    """Bound a numerical worker to 256 MB without granting its code OS APIs."""
    if os.name!="nt": return None
    import ctypes
    from ctypes import wintypes
    class IO(ctypes.Structure):
        _fields_=[(n,ctypes.c_ulonglong) for n in ["ReadOperationCount","WriteOperationCount","OtherOperationCount","ReadTransferCount","WriteTransferCount","OtherTransferCount"]]
    class BASIC(ctypes.Structure):
        _fields_=[("PerProcessUserTimeLimit",ctypes.c_longlong),("PerJobUserTimeLimit",ctypes.c_longlong),("LimitFlags",wintypes.DWORD),("MinimumWorkingSetSize",ctypes.c_size_t),("MaximumWorkingSetSize",ctypes.c_size_t),("ActiveProcessLimit",wintypes.DWORD),("Affinity",ctypes.c_size_t),("PriorityClass",wintypes.DWORD),("SchedulingClass",wintypes.DWORD)]
    class EXTENDED(ctypes.Structure):
        _fields_=[("BasicLimitInformation",BASIC),("IoInfo",IO),("ProcessMemoryLimit",ctypes.c_size_t),("JobMemoryLimit",ctypes.c_size_t),("PeakProcessMemoryUsed",ctypes.c_size_t),("PeakJobMemoryUsed",ctypes.c_size_t)]
    kernel=ctypes.WinDLL("kernel32",use_last_error=True)
    kernel.CreateJobObjectW.argtypes=[ctypes.c_void_p,wintypes.LPCWSTR]; kernel.CreateJobObjectW.restype=wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes=[wintypes.HANDLE,ctypes.c_int,ctypes.c_void_p,wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes=[wintypes.HANDLE,wintypes.HANDLE]
    job=kernel.CreateJobObjectW(None,None)
    if not job: raise RuntimeError("Cannot create numerical worker memory limit")
    info=EXTENDED();info.BasicLimitInformation.LimitFlags=0x100|0x2000;info.ProcessMemoryLimit=256*1024*1024
    if not kernel.SetInformationJobObject(job,9,ctypes.byref(info),ctypes.sizeof(info)) or not kernel.AssignProcessToJobObject(job,wintypes.HANDLE(int(process._handle))):
        kernel.CloseHandle(job);raise RuntimeError("Cannot apply numerical worker memory limit")
    return (kernel,job)

def execute_python(workspace,path,tests=False):
    source=workspace.path(path)
    if source.suffix!=".py" or not source.is_file(): raise ValueError("Choose a Python file in the run workspace")
    mode=os.getenv("HARNESS_EXECUTION_MODE","numerical").lower()
    started=time.perf_counter()
    if mode=="docker":
        docker=shutil.which("docker")
        if not docker: raise ValueError("Docker is unavailable. Use numerical mode or install/start Docker.")
        command=[docker,"run","--rm","--network","none","--memory","256m","--cpus","1","--pids-limit","32","--cap-drop","ALL","--security-opt","no-new-privileges","--read-only","--tmpfs","/tmp:rw,noexec,nosuid,size=32m","--mount",f"type=bind,src={workspace.root},dst=/workspace","--workdir","/workspace",os.getenv("HARNESS_PYTHON_IMAGE","python:3.13-slim"),"python","-I"]
        command+= ["-m","unittest","discover","-s",".","-p",path] if tests else [path]
        p=subprocess.run(command,capture_output=True,text=True,timeout=20)
        return {"mode":"docker","exit_code":p.returncode,"stdout":p.stdout[:16000],"stderr":p.stderr[:4000],"duration_ms":round((time.perf_counter()-started)*1000)}
    if mode!="numerical": raise ValueError("HARNESS_EXECUTION_MODE must be numerical or docker")
    # No inherited API keys, user secrets, Python paths, network configuration or shell invocation.
    env={k:os.environ[k] for k in ["SYSTEMROOT","WINDIR","TEMP","TMP","LANG"] if k in os.environ}
    command=[sys.executable,"-I",str(RUNNER),path,str(workspace.root)]
    if tests: command.append("tests")
    process=subprocess.Popen(command,cwd=workspace.root,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,creationflags=subprocess.CREATE_NO_WINDOW if os.name=="nt" else 0)
    job=None
    try:
        job=windows_memory_job(process)
        stdout,stderr=process.communicate(timeout=6)
    except subprocess.TimeoutExpired:
        process.kill();process.communicate()
        return {"mode":"numerical","exit_code":124,"error":"Numerical execution timed out; simplify the script or reduce iterations"}
    except Exception:
        process.kill();process.communicate();raise
    finally:
        if job: job[0].CloseHandle(job[1])
    try: result=json.loads(stdout)
    except ValueError: result={"exit_code":process.returncode or 1,"error":"Numerical worker stopped without a result","stderr":stderr[:2000]}
    return {**result,"mode":"numerical","duration_ms":round((time.perf_counter()-started)*1000)}
