"""File capabilities scoped to one mission run, with exact edits and visible diffs."""
from pathlib import Path, PurePosixPath
import difflib
import hashlib
import json
import re
import shutil
import subprocess

MAX_FILE=128_000
MAX_WORKSPACE=3_000_000
EXTENSIONS={".py", ".json", ".md", ".txt", ".csv", ".yaml", ".yml"}

class Workspace:
    def __init__(self,root):
        self.root=Path(root).resolve(); self.root.mkdir(parents=True,exist_ok=True)
    def path(self,name,allow_root=False):
        if not isinstance(name,str) or len(name)>240 or "\\" in name or ":" in name or name.startswith("/"):
            raise ValueError("Use a relative workspace path with forward slashes")
        parts=PurePosixPath(name).parts
        if any(p.startswith(".") or p in ("..",) for p in parts): raise ValueError("Hidden paths and parent traversal are not allowed")
        target=self.root.joinpath(*parts)
        if any(p.is_symlink() for p in [target,*target.parents] if p!=self.root.parent):
            raise ValueError("Symbolic links are not allowed")
        target=target.resolve()
        if not target.is_relative_to(self.root) or (target==self.root and not allow_root): raise ValueError("Path is outside the run workspace")
        return target
    def files(self):
        result=[]
        for p in sorted(self.root.rglob("*")):
            if p.is_file() and not p.is_symlink() and not any(part.startswith(".") for part in p.relative_to(self.root).parts):
                result.append({"path":p.relative_to(self.root).as_posix(),"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()[:12]})
        return result
    def read(self,path,start_line=1,end_line=200):
        p=self.path(path)
        if not p.is_file(): raise ValueError("File does not exist in this workspace")
        if p.stat().st_size>MAX_FILE: raise ValueError("File exceeds the text read limit")
        lines=p.read_text(encoding="utf-8").splitlines()
        start=max(1,int(start_line)); end=min(len(lines),int(end_line),start+399)
        return {"path":path,"total_lines":len(lines),"content":"\n".join(f"{i+1:4} | {lines[i]}" for i in range(start-1,end)),"text":"\n".join(lines[start-1:end])}
    def write(self,path,content,create_only=False):
        p=self.path(path)
        if p.suffix not in EXTENSIONS: raise ValueError("Supported files: Python, JSON, Markdown, text, CSV, YAML")
        if len(content.encode("utf-8"))>MAX_FILE: raise ValueError("File exceeds 128 KB")
        if create_only and p.exists(): raise ValueError("File already exists; use edit_file for an exact replacement")
        old=p.read_text(encoding="utf-8") if p.exists() else ""
        total=sum(f["bytes"] for f in self.files())-len(old.encode("utf-8"))+len(content.encode("utf-8"))
        if total>MAX_WORKSPACE or (not p.exists() and len(self.files())>=100): raise ValueError("Workspace quota exceeded")
        p.parent.mkdir(parents=True,exist_ok=True)
        p.write_text(content,encoding="utf-8")
        diff="".join(difflib.unified_diff(old.splitlines(True),content.splitlines(True),fromfile="a/"+path,tofile="b/"+path))
        return {"path":path,"bytes":len(content.encode("utf-8")),"diff":diff[:16000],"created":not bool(old)}
    def edit(self,path,old_text,new_text):
        p=self.path(path)
        if not p.is_file(): raise ValueError("File does not exist")
        text=p.read_text(encoding="utf-8")
        if not old_text or text.count(old_text)!=1: raise ValueError("old_text must match exactly once; read or grep the file first")
        return self.write(path,text.replace(old_text,new_text,1))
    def find(self,glob):
        if not glob or len(glob)>120: raise ValueError("Provide a glob such as *.py or artifacts/*")
        matches=[f for f in self.files() if PurePosixPath(f["path"]).match(glob)]
        return {"glob":glob,"files":matches[:200],"truncated":len(matches)>200}
    def delete(self,path):
        p=self.path(path)
        if not p.is_file(): raise ValueError("File does not exist")
        if path in {"AGENTS.md","mission.json"}: raise ValueError("Core workspace files cannot be deleted; edit them instead")
        old=p.read_text(encoding="utf-8") if p.stat().st_size<=MAX_FILE else ""
        p.unlink()
        diff="".join(difflib.unified_diff(old.splitlines(True),[],fromfile="a/"+path,tofile="/dev/null"))
        return {"path":path,"deleted":True,"diff":diff[:16000]}
    def grep(self,pattern,glob="*",case_sensitive=False):
        if len(pattern)>300 or len(glob)>120: raise ValueError("Search pattern too long")
        candidates=[f["path"] for f in self.files() if Path(f["path"]).match(glob)]
        rg=shutil.which("rg")
        if rg and candidates:
            args=[rg,"--line-number","--no-heading","--color","never","--max-count","20","--max-columns","400"]
            if not case_sensitive: args.append("--ignore-case")
            args += ["--regexp",pattern,"--",*candidates]
            p=subprocess.run(args,cwd=self.root,capture_output=True,text=True,timeout=3)
            if p.returncode not in (0,1): raise ValueError("Invalid search expression")
            return {"matches":p.stdout[:18000].splitlines()[:100],"engine":"ripgrep","truncated":len(p.stdout)>18000}
        # Literal fallback is intentionally not a potentially unbounded regex engine.
        matches=[]
        for name in candidates:
            for i,line in enumerate(self.path(name).read_text(encoding="utf-8").splitlines(),1):
                if (pattern if case_sensitive else pattern.lower()) in (line if case_sensitive else line.lower()): matches.append(f"{name}:{i}: {line[:400]}")
        return {"matches":matches[:100],"engine":"literal fallback","truncated":len(matches)>100}
