"""Reproduce reference checks and export standalone plots, without live AI calls.

Run: .venv/Scripts/python.exe scripts/verify_physics.py --plot
Optional plot dependency: pip install -r requirements-analysis.txt
"""
import argparse
from datetime import datetime,timezone
import json
import math
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from backend.physics import MissionConfig,DEFAULTS,MODEL_VERSION,plan_mission,G0,AU
from backend.physics_examples import EXAMPLES


def collect():
    results={e["id"]:plan_mission(MissionConfig(**e["config"]),include_samples=True) for e in EXAMPLES}
    checks=[]
    def check(name,observed,tolerance,passed): checks.append({"name":name,"observed":observed,"acceptance":tolerance,"passed":bool(passed)})
    for example in EXAMPLES:
        p=results[example["id"]]
        check(example["id"]+" outcome",p["feasible"],str(example["expected_feasible"]),p["feasible"]==example["expected_feasible"])
    vacuum=results['ball-vacuum'];expected_range=20**2/G0;error=abs(vacuum['metrics']['range_m']-expected_range)
    check('Vacuum projectile range error (m)',error,'< 2e-7 m',error<2e-7)
    check('Ball aerodynamic energy residual (J)',abs(results['ball-drag']['metrics']['energy_balance_residual_j']),'< 1e-6 J',abs(results['ball-drag']['metrics']['energy_balance_residual_j'])<1e-6)
    coarse=results['launch-space'];fine=plan_mission(MissionConfig(**{**DEFAULTS['launch'],'integration_step_s':.025}))
    error=abs(coarse['metrics']['apogee_altitude_m']-fine['metrics']['apogee_altitude_m'])
    check('Launch step-halving apogee difference (m)',error,'< 0.01 m',error<.01)
    for name in ['orbit-efficient','lunar-distance']:
        error=results[name]['metrics']['max_relative_energy_error']
        check(name+' relative energy error',error,'< 1e-10',error<1e-10)
    checks.append({'name':'Docking position alone is insufficient','observed':results['docking-no-torque']['feasible'],'acceptance':'False with zero attitude torque','passed':not results['docking-no-torque']['feasible']})
    return results,checks


def plot(results,destination):
    import os
    os.environ.setdefault("MPLCONFIGDIR",str(ROOT/".aether"/"mplconfig"))
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.ticker import MaxNLocator
    ink='#1f303a';muted='#697c85';green='#2f8d7a';orange='#d88245';blue='#537fba'
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.labelcolor':muted,'text.color':ink,'axes.edgecolor':'#d2dadd','xtick.color':muted,'ytick.color':muted,'axes.titleweight':'bold','axes.spines.top':False,'axes.spines.right':False,'figure.facecolor':'#f5f8f7','axes.facecolor':'#ffffff','grid.color':'#e5ebeb','grid.linewidth':.7})
    fig,axes=plt.subplots(2,2,figsize=(14,10),layout='constrained')
    fig.suptitle('Aether / physics from a ball throw to Mars',fontsize=22,fontweight='bold',x=.03,ha='left')
    ax=axes[0,0]
    for key,label,color in [('ball-vacuum','Vacuum reference',muted),('ball-drag','Air + drag',green),('ball-backspin','Air + backspin',orange)]:
        s=results[key]['samples'];ax.plot([q['position_m'][0] for q in s],[q['position_m'][1] for q in s],label=label,color=color,lw=2)
    ax.set(title='01 / A throw, with forces accounted for',xlabel='Horizontal range (m)',ylabel='Height above ground (m)');ax.grid();ax.legend(frameon=False,loc='upper right');ax.set_ylim(bottom=0)
    ax.text(.02,.98,'20 m/s / 45 degrees / 0.145 kg',transform=ax.transAxes,va='top',color=muted,fontsize=9)
    ax=axes[0,1];p=results['launch-space'];s=p['samples']
    ax.plot([q['t'] for q in s],[q['altitude_km'] for q in s],color=green,lw=2.4,label='Altitude')
    ax.axhline(100,color=muted,ls=':',lw=1,label='100 km target');ax.axvline(p['metrics']['burnout_time_s'],color=orange,ls='--',lw=1.3,label='Burnout')
    ax.set(title='02 / Finite thrust, burnout, then apogee',xlabel='Mission time (s)',ylabel='Altitude (km)');ax.grid();ax.legend(frameon=False,loc='upper left')
    ax.text(.98,.06,f"Apogee: {p['metrics']['apogee_altitude_m']/1000:.2f} km\nPeak dynamic pressure: {p['metrics']['peak_dynamic_pressure_pa']/1000:.1f} kPa",transform=ax.transAxes,ha='right',color=muted,fontsize=9)
    ax=axes[1,0];p=results['docking-nominal'];s=p['samples'];c=p['config']
    series=[('distance_m',c['docking_position_tolerance_m'],'Position',green),('relative_speed_m_s',c['docking_velocity_tolerance_m_s'],'Relative speed',blue),('attitude_error_rad',math.radians(c['docking_angle_tolerance_deg']),'Attitude',orange),('angular_rate_error_rad_s',math.radians(c['docking_rate_tolerance_deg_s']),'Angular rate','#9875a9')]
    for field,tolerance,label,color in series: ax.semilogy([q['t'] for q in s],[max(.001,abs(q[field])/tolerance) for q in s],label=label,color=color,lw=1.6)
    ax.axhline(1,color=ink,ls='--',lw=1,label='Capture threshold');ax.set(title='03 / Docking requires four precision gates',xlabel='Approach time (s)',ylabel='Error / allowed tolerance');ax.set_ylim(.001,2000);ax.grid();ax.legend(frameon=False,fontsize=8,ncol=2)
    ax=axes[1,1];p=results['mars-tourism'];s=p['samples'];body=p['bodies'][-1];radius=body['orbit_radius_m']/AU
    angles=[2*math.pi*i/300 for i in range(301)]
    for r,color,label in [(1,blue,'Earth orbit'),(radius,orange,'Mars orbit')]:ax.plot([r*math.cos(a) for a in angles],[r*math.sin(a) for a in angles],color=color,alpha=.45,lw=1,label=label)
    ax.plot([q['position_m'][0]/AU for q in s],[q['position_m'][1]/AU for q in s],color=green,lw=2.5,label='Transfer ellipse')
    ax.scatter([0],[0],color='#e6ad39',s=110,marker='*',zorder=4);ax.scatter([1,-radius],[0,0],color=[blue,orange],s=40,zorder=5)
    phase=body['initial_phase_rad'];ax.scatter([radius*math.cos(phase)],[radius*math.sin(phase)],color=orange,s=40,marker='o',facecolors='none',zorder=5)
    ax.set(title='04 / A phased, fuel-budgeted Mars itinerary',xlabel='Heliocentric X (AU)',ylabel='Heliocentric Y (AU)',aspect='equal');ax.grid();ax.legend(frameon=False,fontsize=8,loc='lower left')
    ax.text(.98,.05,f"{p['metrics']['travel_days']:.1f} days / phase {p['metrics']['required_departure_phase_angle_deg']:.2f} deg\nInjection + capture: {p['delta_v_m_s']/1000:.2f} km/s",transform=ax.transAxes,ha='right',color=muted,fontsize=9)
    fig.get_layout_engine().set(h_pad=.12,w_pad=.12)
    fig.savefig(destination/'physics-examples.png',dpi=180)
    fig.savefig(destination/'physics-examples.svg')
    plt.close(fig)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--plot',action='store_true');parser.add_argument('--output',type=Path,default=ROOT/'docs'/'physics')
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    results,checks=collect()
    report={'model_version':MODEL_VERSION,'generated_at':datetime.now(timezone.utc).isoformat(),'checks':checks,'examples':{key:{k:v for k,v in p.items() if k not in {'samples','body_ephemerides'}} for key,p in results.items()},'notice':'Model verification is distinct from validation against real flight data. All assumptions remain explicit.'}
    (args.output/'validation.json').write_text(json.dumps(report,indent=2,allow_nan=False),encoding='utf-8')
    lines=['# Physics verification snapshot','',f'Model version: {MODEL_VERSION}. All examples are reproducible; no API key is required.','','| Check | Observed | Acceptance | Pass |','| --- | --- | --- | --- |']
    for c in checks:
        observed=f"{c['observed']:.6g}" if isinstance(c['observed'],float) else str(c['observed'])
        lines.append(f"| {c['name']} | {observed} | {c['acceptance']} | {'yes' if c['passed'] else 'NO'} |")
    lines+=['','Precision is measured within the stated model. Ideal interplanetary trajectories omit date-specific ephemerides and local arrival arcs. Ball lift is approximate; docking is planar, not full 6-DOF.','', 'Primary references: [NASA trajectories](https://science.nasa.gov/learn/basics-of-space-flight/chapter4-1/), [NASA standard atmosphere](https://ntrs.nasa.gov/citations/19770009539), [NASA rendezvous equations](https://ntrs.nasa.gov/citations/19930020463), [NASA ballistic flight](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/ballistic-flight-equations/).']
    (args.output/'VALIDATION.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    if args.plot:plot(results,args.output)
    failed=[c for c in checks if not c['passed']]
    print(f"{len(checks)-len(failed)}/{len(checks)} reference checks passed. Artifacts: {args.output}")
    if failed:raise SystemExit(1)

if __name__=='__main__':main()
