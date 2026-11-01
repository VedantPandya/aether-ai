"""Shared SI constants, numerical primitives, atmosphere and propellant budgets."""
import math

MU=3.986004418e14
EARTH_RADIUS=6_371_000.0
G0=9.80665
MOON_DISTANCE=384_400_000.0
AU=149_597_870_700.0
SUN_MU=1.32712440018e20
PLANETS={
    "mars":{"name":"Mars","orbit_radius_m":1.523679*AU,"mu":4.282837e13,"radius_m":3_389_500.0,"color":"#d88662"},
    "venus":{"name":"Venus","orbit_radius_m":0.723332*AU,"mu":3.24858592e14,"radius_m":6_051_800.0,"color":"#deb97a"},
}

def rk4_step(derivative,t,state,dt):
    a=derivative(t,state)
    b=derivative(t+dt/2,[v+dt*k/2 for v,k in zip(state,a)])
    c=derivative(t+dt/2,[v+dt*k/2 for v,k in zip(state,b)])
    d=derivative(t+dt,[v+dt*k for v,k in zip(state,c)])
    return [v+dt*(i+2*j+2*k+l)/6 for v,i,j,k,l in zip(state,a,b,c,d)]

def locate_event(derivative,t,state,dt,index,target=0.0,tolerance=1e-9):
    """Locate a bracketed scalar crossing by bisecting RK4 substeps."""
    lo=0.0;hi=dt;initial=state[index]-target
    for _ in range(45):
        mid=(lo+hi)/2;candidate=rk4_step(derivative,t,state,mid)
        if (candidate[index]-target)*initial>0: lo=mid
        else: hi=mid
        if hi-lo<tolerance: break
    event_dt=(lo+hi)/2
    return t+event_dt,rk4_step(derivative,t,state,event_dt)

def wrap_angle(value): return (value+math.pi)%(2*math.pi)-math.pi

def propellant_budget(c,delta_v):
    inert=c.dry_mass_kg+c.payload_kg;wet=inert+c.fuel_kg;ve=c.isp_s*G0
    remaining_mass=wet*math.exp(-delta_v/ve)
    required=wet-remaining_mass
    available=ve*math.log1p(c.fuel_kg/inert)
    return {"feasible":available+1e-8>=delta_v,"available_delta_v_m_s":available,"fuel_required_kg":required,"fuel_remaining_kg":max(0,c.fuel_kg-required),"mass_ratio":wet/remaining_mass,"required_initial_fuel_kg":inert*math.expm1(delta_v/ve),"fuel_margin_kg":c.fuel_kg-inert*math.expm1(delta_v/ve)}

# U.S. Standard Atmosphere 1976 lower-atmosphere layers (geopotential altitude).
HEIGHTS=[0,11000,20000,32000,47000,51000,71000,84852]
LAPSES=[-0.0065,0,0.001,0.0028,0,-0.0028,-0.002]
R_AIR=287.05287
BASES=[(288.15,101325.0)]
for i,lapse in enumerate(LAPSES):
    temp,pressure=BASES[-1];height=HEIGHTS[i+1]-HEIGHTS[i]
    next_temp=temp+lapse*height
    next_pressure=pressure*math.exp(-G0*height/(R_AIR*temp)) if lapse==0 else pressure*(temp/next_temp)**(G0/(R_AIR*lapse))
    BASES.append((next_temp,next_pressure))

def atmosphere(altitude_m):
    geometric=max(0,float(altitude_m));geopotential=6_356_766.0*geometric/(6_356_766.0+geometric)
    if geopotential>=HEIGHTS[-1]: return {"density_kg_m3":0.0,"pressure_pa":0.0,"temperature_k":BASES[-1][0]}
    index=next(i for i in range(7) if geopotential<HEIGHTS[i+1])
    tb,pb=BASES[index];lapse=LAPSES[index];height=geopotential-HEIGHTS[index]
    temp=tb+lapse*height
    pressure=pb*math.exp(-G0*height/(R_AIR*tb)) if lapse==0 else pb*(tb/temp)**(G0/(R_AIR*lapse))
    return {"density_kg_m3":pressure/(R_AIR*temp),"pressure_pa":pressure,"temperature_k":temp}

def sample(t,x_m,y_m,vx,vy,fuel,phase,*,legacy_scale=1.0,altitude_m=0,**extra):
    return {"t":t,"x":x_m/legacy_scale,"y":y_m/legacy_scale,"z":0.0,"position_m":[x_m,y_m,0.0],"velocity_m_s":[vx,vy,0.0],"vx_m_s":vx,"vy_m_s":vy,"altitude_km":altitude_m/1000,"speed_m_s":math.hypot(vx,vy),"fuel_kg":max(0,fuel),"phase":phase,**extra}

def frame(name,origin,position_unit="m",speed_kind="frame_velocity"):
    return {"name":name,"origin":origin,"axes":"right-handed XY plane; Z normal to plane","legacy_position_unit":position_unit,"position_m_unit":"m","velocity_m_s_unit":"m/s","time_unit":"s","angle_unit":"rad","speed_kind":speed_kind}
