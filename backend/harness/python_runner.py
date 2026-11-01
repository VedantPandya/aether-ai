"""Restricted numerical Python process. No host file/network/process capabilities.

This is a validated Python subset, not an unrestricted operating-system sandbox.
Docker execution is the separate full-Python isolation mode.
"""
import ast
import builtins
import io
import json
import math
import statistics
import sys
import time
from pathlib import Path
from types import SimpleNamespace

ROOT=Path(sys.argv[2]).resolve() if len(sys.argv)>2 else Path.cwd()
MAX_BYTES=128_000
MODULES={"math":math,"statistics":statistics,"json":SimpleNamespace(loads=json.loads,dumps=json.dumps)}
METHODS={"append","extend","pop","get","items","keys","values","copy","index","count","sort","reverse","update","setdefault","join","split","strip","lower","upper","startswith","endswith","replace","isdigit"}
FORBIDDEN=(ast.ClassDef,ast.AsyncFunctionDef,ast.AsyncFor,ast.AsyncWith,ast.With,ast.Delete,ast.Global,ast.Nonlocal,ast.Yield,ast.YieldFrom,ast.Await)
CALLS={"print","range","len","min","max","abs","sum","round","sorted","enumerate","zip","list","dict","tuple","set","float","int","str","bool","all","any","isinstance","reversed","map","filter","read_json","write_json","read_text","write_text","AssertionError","ValueError","RuntimeError","Exception"}
output=io.StringIO()
started=time.monotonic()
operations=0

def safe_path(name):
    if not isinstance(name,str) or name.startswith(("/","\\")) or ":" in name or "\\" in name: raise ValueError("Use a workspace-relative path")
    if any(p.startswith(".") for p in Path(name).parts): raise ValueError("Hidden paths and traversal are denied")
    p=(ROOT/name).resolve()
    if not p.is_relative_to(ROOT) or p==ROOT or p.is_symlink(): raise ValueError("Path outside workspace")
    return p

def read_text(name):
    p=safe_path(name)
    if p.stat().st_size>MAX_BYTES: raise ValueError("File too large")
    return p.read_text(encoding="utf-8")
def write_text(name,text):
    p=safe_path(name)
    if p.suffix not in {".json",".csv",".md",".txt"}: raise ValueError("Numerical scripts write JSON, CSV, Markdown or text artifacts")
    text=str(text)
    if len(text.encode())>MAX_BYTES: raise ValueError("Artifact too large")
    files=list(ROOT.rglob("*"))
    if len(files)>120 or sum(q.stat().st_size for q in files if q.is_file())+len(text.encode())>3_000_000: raise ValueError("Workspace quota exceeded")
    p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text,encoding="utf-8")
    return name

def write_json(name,value): return write_text(name,json.dumps(value,indent=2,allow_nan=False))
def safe_print(*args,sep=" ",end="\n"):
    if output.tell()<16000: output.write((sep.join(str(a) for a in args)+end)[:max(0,16000-output.tell())])
def safe_range(*args):
    r=range(*args)
    if len(r)>100_000: raise ValueError("range is limited to 100,000 steps")
    return r

class Validator(ast.NodeVisitor):
    def __init__(self,tree):
        self.aliases={}
        self.local_functions={n.name for n in ast.walk(tree) if isinstance(n,ast.FunctionDef)}
        self.modules={}
        for n in ast.walk(tree):
            if isinstance(n,ast.Import):
                for a in n.names: self.aliases[a.asname or a.name]=a.name
            elif isinstance(n,ast.ImportFrom):
                for a in n.names: self.aliases[a.asname or a.name]=n.module
    def generic_visit(self,node):
        if isinstance(node,FORBIDDEN): raise ValueError(f"{type(node).__name__} is outside numerical Python mode")
        super().generic_visit(node)
    def visit_Name(self,node):
        if node.id.startswith("_") or node.id in {"open","exec","eval","compile","globals","locals","getattr","setattr","delattr","vars","dir","help","input","breakpoint","memoryview","super","object","type"}:
            raise ValueError(f"Name '{node.id}' is unavailable in numerical mode")
    def visit_Attribute(self,node):
        if node.attr.startswith("_"): raise ValueError("Private and introspection attributes are denied")
        root=node.value.id if isinstance(node.value,ast.Name) else None
        module=self.aliases.get(root)
        if module in MODULES:
            if not hasattr(MODULES[module],node.attr) or (module=="json" and node.attr not in {"loads","dumps"}): raise ValueError("Module member unavailable")
        elif module:
            # Workspace modules only expose validated public Python functions/constants.
            if node.attr not in self.modules.get(module,set()): raise ValueError("Unknown workspace module member")
        elif node.attr not in METHODS: raise ValueError(f"Attribute '{node.attr}' is outside numerical mode")
        self.visit(node.value)
    def visit_Import(self,node):
        for alias in node.names:
            if alias.name.startswith("_") or "." in alias.name or (alias.asname and alias.asname.startswith("_")): raise ValueError("Import unavailable")
            if alias.name not in MODULES:
                p=safe_path(alias.name+".py")
                if not p.is_file(): raise ValueError("Only math, statistics, json and validated workspace modules are importable")
                tree=ast.parse(read_text(alias.name+".py")); self.modules[alias.name]={n.name for n in tree.body if isinstance(n,ast.FunctionDef)}|{t.id for n in tree.body if isinstance(n,ast.Assign) for t in n.targets if isinstance(t,ast.Name)}
    def visit_ImportFrom(self,node):
        if node.level or node.module not in MODULES or any(a.name.startswith("_") or a.name=="*" or (a.asname and a.asname.startswith("_")) for a in node.names): raise ValueError("Only explicit imports from math, statistics and json are allowed")
        for alias in node.names:
            if not hasattr(MODULES[node.module],alias.name): raise ValueError("Unknown import")
    def visit_Constant(self,node):
        if isinstance(node.value,(str,bytes)) and len(node.value)>MAX_BYTES: raise ValueError("Literal too large")
        if isinstance(node.value,int) and node.value.bit_length()>128: raise ValueError("Integer literal too large")
    def visit_BinOp(self,node):
        if isinstance(node.op,ast.Pow) and isinstance(node.right,ast.Constant) and isinstance(node.right.value,(int,float)) and abs(node.right.value)>100: raise ValueError("Exponent too large")
        self.generic_visit(node)

module_cache={}
loading=set()
def namespace():
    permitted={k:getattr(builtins,k) for k in CALLS if hasattr(builtins,k)}
    permitted.update({"print":safe_print,"range":safe_range,"__import__":safe_import})
    return {"__builtins__":permitted,"read_json":lambda p:json.loads(read_text(p)),"write_json":write_json,"read_text":read_text,"write_text":write_text}
def safe_import(name,globals=None,locals=None,fromlist=(),level=0):
    if level: raise ValueError("Relative imports unavailable")
    if name in MODULES: return MODULES[name]
    if name in loading: raise ValueError("Circular imports unavailable")
    if name not in module_cache:
        loading.add(name)
        source=read_text(name+".py"); scope=namespace(); execute(source,scope)
        module_cache[name]=SimpleNamespace(**{k:v for k,v in scope.items() if not k.startswith("_")})
        loading.remove(name)
    return module_cache[name]
def execute(source,scope):
    tree=ast.parse(source)
    if sum(1 for _ in ast.walk(tree))>15000: raise ValueError("Script AST too large")
    Validator(tree).visit(tree)
    exec(compile(tree,"<mission-script>","exec"),scope)

def budget(frame,event,arg):
    global operations
    operations+=1
    if operations>1_000_000 or time.monotonic()-started>3: raise TimeoutError("Numerical execution budget exceeded")
    return budget

# Resource limits are also enforced externally by a timeout; Linux gets address-space limits.
if sys.platform!="win32":
    import resource
    resource.setrlimit(resource.RLIMIT_AS,(256*1024*1024,256*1024*1024))
    resource.setrlimit(resource.RLIMIT_CPU,(4,4))

if __name__=="__main__":
    try:
        source=read_text(sys.argv[1]); scope=namespace()
        sys.settrace(budget)
        execute(source,scope)
        tests=[]
        if len(sys.argv)>3 and sys.argv[3]=="tests":
            for name,value in sorted(scope.items()):
                if name.startswith("test_") and callable(value):
                    try: value(); tests.append({"name":name,"passed":True})
                    except Exception as exc: tests.append({"name":name,"passed":False,"error":type(exc).__name__+": "+str(exc)[:500]})
        sys.settrace(None)
        print(json.dumps({"stdout":output.getvalue(),"tests":tests,"exit_code":1 if any(not t["passed"] for t in tests) else 0,"duration_ms":round((time.monotonic()-started)*1000)}))
    except BaseException as exc:
        sys.settrace(None)
        print(json.dumps({"stdout":output.getvalue(),"error":type(exc).__name__+": "+str(exc)[:1000],"exit_code":1}))
