"""Analytic elliptic Kepler propagation and impulsive circular-orbit transfers."""
import math
from .common import MU,EARTH_RADIUS,MOON_DISTANCE,G0,propellant_budget,sample,frame

def rk4(state,dt):
    from .common import rk4_step
    def derivative(t,s):
        x,y,vx,vy=s;r=math.hypot(x,y)
        return [vx,vy,-MU*x/r**3,-MU*y/r**3]
    return rk4_step(derivative,0,state,dt)

def ellipse_state(mu,a,e,eccentric_anomaly,rotation=0):
    E=eccentric_anomaly;root=math.sqrt(1-e*e);r=a*(1-e*math.cos(E))
    x=a*(math.cos(E)-e);y=a*root*math.sin(E)
    factor=math.sqrt(mu*a)/r;vx=-factor*math.sin(E);vy=factor*root*math.cos(E)
    co,si=math.cos(rotation),math.sin(rotation)
    return x*co-y*si,x*si+y*co,vx*co-vy*si,vx*si+vy*co

def transfer_states(mu,r1,r2,count=401):
    a=(r1+r2)/2;e=abs(r2-r1)/(r1+r2);n=math.sqrt(mu/a**3)
    initial_E=0 if r2>=r1 else math.pi
    rotation=0 if r2>=r1 else math.pi
    initial_mean=initial_E-e*math.sin(initial_E)
    for i in range(count):
        E=initial_E+math.pi*i/(count-1)
        t=(E-e*math.sin(E)-initial_mean)/n
        yield t,ellipse_state(mu,a,e,E,rotation)

def orbital(c):
    r1=EARTH_RADIUS+c.start_altitude_km*1000
    r2=MOON_DISTANCE if c.mission_type=="lunar" else EARTH_RADIUS+c.target_altitude_km*1000
    a=(r1+r2)/2
    first=math.sqrt(MU/r1)*(math.sqrt(2*r2/(r1+r2))-1)
    second=0 if c.mission_type=="lunar" else math.sqrt(MU/r2)*(1-math.sqrt(2*r1/(r1+r2)))
    dv=abs(first)+abs(second);budget=propellant_budget(c,dv)
    wet=c.dry_mass_kg+c.payload_kg+c.fuel_kg;ve=c.isp_s*G0
    after_first=wet*math.exp(-abs(first)/ve);inert=c.dry_mass_kg+c.payload_kg
    coast=math.pi*math.sqrt(a**3/MU);samples=[]
    h0=None;energy0=-MU/(2*a);max_energy_error=0;max_h_error=0
    for t,(x,y,vx,vy) in transfer_states(MU,r1,r2):
        r=math.hypot(x,y);h=x*vy-y*vx
        h0=h if h0 is None else h0
        max_energy_error=max(max_energy_error,abs((0.5*(vx*vx+vy*vy)-MU/r-energy0)/energy0))
        max_h_error=max(max_h_error,abs((h-h0)/h0))
        samples.append(sample(t,x,y,vx,vy,after_first-inert,"Transfer coast",legacy_scale=1000,altitude_m=r-EARTH_RADIUS,angular_velocity_rad_s=h/r**2,specific_energy_j_kg=energy0,specific_angular_momentum_m2_s=h))
    burn1_fuel=wet-after_first;burn2_fuel=after_first-(wet-budget["fuel_required_kg"])
    burns=[{"name":"Departure burn","at_s":0,"delta_v_m_s":abs(first),"signed_delta_v_m_s":first,"fuel_kg":burn1_fuel,"equivalent_burn_duration_s":burn1_fuel*ve/c.thrust_n,"description":"Prograde" if first>0 else "Retrograde"},
           {"name":"Reach lunar distance" if c.mission_type=="lunar" else "Circularization burn","at_s":coast,"delta_v_m_s":abs(second),"signed_delta_v_m_s":second,"fuel_kg":burn2_fuel,"equivalent_burn_duration_s":burn2_fuel*ve/c.thrust_n,"description":"Transfer endpoint; no lunar capture" if c.mission_type=="lunar" else ("Prograde" if second>0 else "Retrograde")}]
    if c.mission_type=="orbit":
        circular_speed=math.sqrt(MU/r2);omega=math.sqrt(MU/r2**3);duration=0.2*2*math.pi/omega
        # Exact second impulse at the computed endpoint, followed by a circular coast.
        for i in range(101):
            t_after=duration*i/100;theta=math.pi+omega*t_after
            x,y=r2*math.cos(theta),r2*math.sin(theta)
            vx,vy=-circular_speed*math.sin(theta),circular_speed*math.cos(theta)
            samples.append(sample(coast+t_after,x,y,vx,vy,budget["fuel_remaining_kg"],"Target orbit",legacy_scale=1000,altitude_m=r2-EARTH_RADIUS,angular_velocity_rad_s=omega,specific_energy_j_kg=-MU/(2*r2),specific_angular_momentum_m2_s=math.sqrt(MU*r2)))
    return {**budget,"delta_v_m_s":dv,"duration_s":samples[-1]["t"],"burns":burns,"samples":samples,"success":budget["feasible"],
        "summary":("Lunar distance reached" if c.mission_type=="lunar" else "Target orbit acquired") if budget["feasible"] else "Insufficient propellant for the requested transfer",
        "frame":frame("earth_inertial","Earth center","km"),
        "metrics":{"transfer_time_s":coast,"semi_major_axis_m":a,"eccentricity":abs(r2-r1)/(r2+r1),"max_relative_energy_error":max_energy_error,"max_relative_angular_momentum_error":max_h_error},
        "events":[{"type":"burn","t":0,"delta_v_m_s":first},{"type":"transfer_endpoint","t":coast},{"type":"burn","t":coast,"delta_v_m_s":second}] if second else [{"type":"burn","t":0,"delta_v_m_s":first},{"type":"lunar_distance","t":coast}],
        "integrator":{"name":"Analytic Kepler ellipse and circular coast","error_control":"No time-integration drift in the two-body model"},
        "assumptions":["Spherical Earth; coplanar circular initial and final orbits; exact Newtonian two-body conics.","Instantaneous impulses; finite-burn gravity losses, J2, atmospheric drag and third-body perturbations omitted.","Equivalent burn durations are diagnostics only, not a finite-thrust propagation."]+(["Lunar-distance transfer only: no moving-Moon interception, lunar gravity, capture or landing."] if c.mission_type=="lunar" else []),
        "knowledge_ids":["gravity","hohmann","rocket-equation","numerical-integration"]}
