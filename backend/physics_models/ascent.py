"""Finite-thrust vertical ascent, consistent mass flow, RK4 and located apogee."""
import math
from .common import MU,EARTH_RADIUS,G0,atmosphere,rk4_step,locate_event,sample,frame

def launch(c):
    inert=c.dry_mass_kg+c.payload_kg;initial_mass=inert+c.fuel_kg;ve=c.isp_s*G0
    flow=c.thrust_n/ve;initial_twr=c.thrust_n/(initial_mass*MU/EARTH_RADIUS**2)
    state=[0.0,0.0,c.fuel_kg,0.0,0.0,0.0];t=0.0;samples=[];events=[]
    peak_q=peak_accel=peak_speed=0.0;burnout=None;reason="";next_sample=0.0
    def derivative(powered):
        def f(t,s):
            h,v,fuel,_,_,_=s;mass=inert+max(0,fuel)
            rho=atmosphere(h)["density_kg_m3"] if c.atmosphere_enabled else 0.0
            drag=0.5*rho*c.drag_coefficient*c.reference_area_m2*v*abs(v)
            thrust=c.thrust_n if powered else 0.0
            g=MU/(EARTH_RADIUS+max(0,h))**2
            return [v,(thrust-drag)/mass-g,-flow if powered else 0.0,thrust/mass,g,drag/mass]
        return f
    def record(phase):
        h,v,fuel,dv,gloss,dloss=state;mass=inert+fuel
        rho=atmosphere(h)["density_kg_m3"] if c.atmosphere_enabled else 0.0
        powered=fuel>1e-8 and phase=="Powered ascent"
        proper=(c.thrust_n if powered else 0)-0.5*rho*c.drag_coefficient*c.reference_area_m2*v*abs(v)
        thrust=c.thrust_n if powered else 0.0
        drag=0.5*rho*c.drag_coefficient*c.reference_area_m2*v*abs(v)
        gravity=MU/(EARTH_RADIUS+max(0,h))**2
        samples.append(sample(t,0,EARTH_RADIUS+h,0,v,fuel,phase,legacy_scale=1000,altitude_m=h,thrust_n=thrust,mass_kg=mass,dynamic_pressure_pa=0.5*rho*v*v,proper_acceleration_m_s2=proper/mass,acceleration_m_s2=[0.0,(thrust-drag)/mass-gravity,0.0],force_vectors_n={"thrust":[0.0,thrust,0.0],"drag":[0.0,-drag,0.0],"gravity":[0.0,-mass*gravity,0.0]}))
    record("On pad")
    if c.fuel_kg<=0: reason="No propellant loaded"
    elif initial_twr<=1: reason="Liftoff thrust-to-weight ratio is not greater than one"
    else:
        events.append({"type":"liftoff","t":0.0})
        while t<3600:
            powered=state[2]>1e-9
            dt=min(c.integration_step_s,3600-t)
            if powered: dt=min(dt,state[2]/flow)
            f=derivative(powered);candidate=rk4_step(f,t,state,dt)
            if state[0]<c.launch_target_altitude_km*1000<=candidate[0] and not any(e["type"]=="target_altitude" for e in events):
                crossing,_=locate_event(f,t,state,dt,index=0,target=c.launch_target_altitude_km*1000)
                events.append({"type":"target_altitude","t":crossing,"altitude_m":c.launch_target_altitude_km*1000})
            if state[1]>0 and candidate[1]<=0:
                t,state=locate_event(f,t,state,dt,index=1)
                events.append({"type":"apogee","t":t,"altitude_m":state[0]})
                state[2]=max(0,state[2]);record("Apogee");break
            t+=dt;state=candidate;state[2]=max(0,state[2])
            h,v,fuel,_,_,_=state;mass=inert+fuel
            rho=atmosphere(h)["density_kg_m3"] if c.atmosphere_enabled else 0.0
            peak_q=max(peak_q,0.5*rho*v*v);peak_speed=max(peak_speed,v)
            drag=0.5*rho*c.drag_coefficient*c.reference_area_m2*v*abs(v)
            peak_accel=max(peak_accel,abs(((c.thrust_n if powered else 0)-drag)/mass))
            if powered and fuel<1e-8 and burnout is None:
                burnout=t;events.append({"type":"burnout","t":t,"altitude_m":h,"speed_m_s":v});record("Burnout")
            if t>=next_sample:
                record("Powered ascent" if fuel>1e-8 else "Ballistic coast");next_sample=t+1.0
            if h<0: reason="Vehicle returned to ground before attaining the target";break
        else: reason="Apogee was not reached within the 3600 s integration limit"
    if not samples or samples[-1]["t"]!=t: record("Stopped" if reason else "Apogee")
    success=not reason and state[0]>=c.launch_target_altitude_km*1000
    used=c.fuel_kg-state[2]
    if not success and not reason: reason="Apogee is below the requested altitude"
    return {"feasible":success,"success":success,"delta_v_m_s":state[3],"available_delta_v_m_s":ve*math.log(initial_mass/inert),"fuel_required_kg":used,"fuel_remaining_kg":state[2],"fuel_used_kg":used,"fuel_requirement_kind":"predicted_consumption_not_minimum_design_fuel","duration_s":t,"samples":samples,
        "burns":[{"name":"Liftoff","at_s":0,"delta_v_m_s":state[3],"description":f"{c.thrust_n/1000:g} kN finite thrust; variable mass"},{"name":"Apogee" if not reason or success else "Flight limit","at_s":t,"delta_v_m_s":0,"description":f"Predicted altitude {state[0]/1000:.2f} km"}],
        "summary":f"{c.launch_target_altitude_km:g} km space boundary crossed" if success else reason,
        "frame":frame("earth_vertical","Earth center","km"),"events":events,
        "metrics":{"apogee_altitude_m":state[0],"apogee_time_s":t,"burnout_time_s":burnout,"initial_thrust_to_weight":initial_twr,"peak_dynamic_pressure_pa":peak_q,"peak_proper_acceleration_g":peak_accel/G0,"peak_speed_m_s":peak_speed,"ideal_thrust_delta_v_m_s":state[3],"gravity_loss_m_s":state[4],"drag_loss_m_s":state[5],"velocity_budget_residual_m_s":state[1]-(state[3]-state[4]-state[5]),"propellant_mass_balance_error_kg":initial_mass-(inert+state[2]+used)},
        "integrator":{"name":"RK4 with exact burnout split and bisected apogee","step_s":c.integration_step_s,"event_time_tolerance_s":1e-9},
        "assumptions":["Vertical suborbital sounding rocket; no orbital insertion, staging, winds, rotation or landing.","Spherical-Earth inverse-square gravity; U.S. Standard Atmosphere 1976 layers to 86 km, vacuum above.","Constant thrust and Isp; fuel means total consumed propellant, including oxidizer.","Constant drag coefficient and reference area; no transonic aerodynamics or thermal model.","Initial thrust-to-weight must exceed one; no hold-down propellant burning is modelled."],"knowledge_ids":["gravity","rocket-equation","drag","atmosphere-models","numerical-integration"]}
