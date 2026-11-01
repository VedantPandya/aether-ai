"""Keep exported trajectory previews inside the per-file capability quota."""
import json

def save_trajectory(workspace,samples):
    if not samples:raise ValueError("No computed trajectory samples")
    stride=max(1,len(samples)//200)
    while True:
        trajectory=samples[::stride]
        if trajectory[-1]!=samples[-1]:trajectory.append(samples[-1])
        encoded=json.dumps(trajectory,separators=(",",":"))
        if len(encoded.encode("utf-8"))<=120000:break
        stride+=1
    workspace.write("artifacts/trajectory.json",encoded)
    return {"full_sample_count":len(samples),"exported_sample_count":len(trajectory)}
