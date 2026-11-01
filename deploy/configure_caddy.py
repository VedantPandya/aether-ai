"""Add Aether inside the existing domain; preserve its other routes."""
from pathlib import Path
import re
import shutil
import subprocess
import sys
from datetime import datetime

IMPORT = "import /etc/caddy/aether.routes"

def add_import(config):
    matches=list(re.finditer(r"(?m)^[ \t]*(?:https://)?agent\.vedantpandya\.com[ \t]*\{[ \t]*$",config))
    if len(matches)!=1:raise ValueError("Expected exactly one agent.vedantpandya.com site block; inspect the existing Caddyfile instead of replacing it")
    if IMPORT in [line.strip() for line in config.splitlines()]:return config
    match=matches[0]
    return config[:match.end()]+"\n    "+IMPORT+config[match.end():]

def main():
    target=Path(sys.argv[1] if len(sys.argv)>1 else "/etc/caddy/agent-framework.caddy")
    original=target.read_text(encoding="utf-8")
    updated=add_import(original)
    backup=target.with_name(target.name+".pre-aether-"+datetime.now().strftime("%Y%m%d-%H%M%S"))
    shutil.copy2(target,backup)
    try:
        target.write_text(updated,encoding="utf-8")
        subprocess.run(["caddy","fmt","--overwrite",str(target)],check=True)
        subprocess.run(["caddy","validate","--config","/etc/caddy/Caddyfile"],check=True)
    except BaseException:
        shutil.copy2(backup,target)
        print("Validation failed; restored the previous config. Do not reload Caddy.",file=sys.stderr)
        raise
    print("Validated config; existing routes preserved. Backup: "+str(backup))
    print("Run sudo systemctl reload caddy to activate /aether/.")

if __name__=="__main__":main()
