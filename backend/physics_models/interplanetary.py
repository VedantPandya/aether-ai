"""Ideal heliocentric transfers, launch phasing and patched-conic burn budgets."""
import math
from .common import MU,EARTH_RADIUS,SUN_MU,AU,PLANETS,G0,propellant_budget,sample,frame
from .orbital import transfer_states

def interplanetary(c):
    body=PLANETS[c.destination];r1=AU;r2=body["orbit_radius_m"];a=(r1+r2)/2
    transfer_time=math.pi*math.sqrt(a**3/SUN_MU)
    v1=math.sqrt(SUN_MU/r1);v2=math.sqrt(SUN_MU/r2)
    transfer1=math.sqrt(SUN_MU*(2/r1-1/a));transfer2=math.sqrt(SUN_MU*(2/r2-1/a))
    vinf1=abs(transfer1-v1);vinf2=abs(v2-transfer2)
    departure_r=EARTH_RADIUS+c.start_altitude_km*1000;arrival_r=body["radius_m"]+c.arrival_orbit_altitude_km*1000
    injection=math.sqrt(vinf1**2+2*MU/departure_r)-math.sqrt(MU/departure_r)
    capture=math.sqrt(vinf2**2+2*body["mu"]/arrival_r)-math.sqrt(body["mu"]/arrival_r) if c.capture_at_destination else 0.0
    dv=injection+capture;budget=propellant_budget(c,dv)
    ve=c.isp_s*G0;initial_mass=c.dry_mass_kg+c.payload_kg+c.fuel_kg
    departure_propellant=initial_mass*(1-math.exp(-injection/ve))
    departure_burn_duration=departure_propellant*ve/c.thrust_n
    departure_parking_period=2*math.pi*math.sqrt(departure_r**3/MU)
    fidelity_warnings=[]
    if departure_burn_duration/departure_parking_period>0.05:
        fidelity_warnings.append("Equivalent departure burn exceeds 5% of the parking-orbit period; an impulsive escape budget is a weak finite-thrust approximation for this engine.")
    earth_n=math.sqrt(SUN_MU/r1**3);target_n=math.sqrt(SUN_MU/r2**3)
    required_phase=(math.pi-target_n*transfer_time+math.pi)%(2*math.pi)-math.pi
    phase=required_phase if c.departure_phase_angle_deg is None else math.radians(c.departure_phase_angle_deg)
    final_target_angle=phase+target_n*transfer_time
    miss=math.hypot(-r2-r2*math.cos(final_target_angle),-r2*math.sin(final_target_angle))
    phase_ok=miss<=c.arrival_tolerance_km*1000
    success=budget["feasible"] and phase_ok
    wet=c.dry_mass_kg+c.payload_kg+c.fuel_kg;inert=c.dry_mass_kg+c.payload_kg;ve=c.isp_s*G0
    coast_fuel=wet*math.exp(-injection/ve)-inert;samples=[];bodies=[]
    for t,(x,y,vx,vy) in transfer_states(SUN_MU,r1,r2,501):
        h=x*vy-y*vx;r=math.hypot(x,y)
        samples.append(sample(t,x,y,vx,vy,coast_fuel,"Heliocentric transfer",legacy_scale=1000,altitude_m=0,heliocentric_radius_m=r,angular_velocity_rad_s=h/r**2))
        bodies.append({"t":t,"earth_position_m":[r1*math.cos(earth_n*t),r1*math.sin(earth_n*t),0.0],"destination_position_m":[r2*math.cos(phase+target_n*t),r2*math.sin(phase+target_n*t),0.0]})
    # The patched-conic capture is a budget/event, not a falsely propagated planet-centered landing.
    samples[-1]["fuel_kg"]=budget["fuel_remaining_kg"]
    samples[-1]["phase"]="Arrival; capture budget applied" if c.capture_at_destination else "Arrival flyby"
    return {**budget,"feasible":success,"success":success,"delta_v_m_s":dv,"duration_s":transfer_time,"samples":samples,"fidelity_warnings":fidelity_warnings,
        "burns":[{"name":"Earth departure injection","at_s":0,"delta_v_m_s":injection,"description":"Parking-orbit escape with computed hyperbolic excess speed"},{"name":body["name"]+" orbit capture budget" if c.capture_at_destination else body["name"]+" flyby","at_s":transfer_time,"delta_v_m_s":capture,"description":"Patched-conic parking-orbit insertion budget; local arrival arc not propagated"}],
        "summary":body["name"]+" transfer arrival and fuel budget verified" if success else "Departure phase misses the destination tolerance" if not phase_ok else "Insufficient propellant for departure and arrival burns",
        "frame":frame("heliocentric_ecliptic","Sun center","km"),"body_ephemerides":bodies[::5],
        "bodies":[{"id":"sun","radius_m":696_340_000,"position_m":[0,0,0],"color":"#ffd77a"},{"id":"earth","radius_m":EARTH_RADIUS,"orbit_radius_m":r1,"mean_motion_rad_s":earth_n,"initial_phase_rad":0,"color":"#73aee8"},{"id":c.destination,"radius_m":body["radius_m"],"orbit_radius_m":r2,"mean_motion_rad_s":target_n,"initial_phase_rad":phase,"color":body["color"]}],
        "metrics":{"travel_days":transfer_time/86400,"equivalent_departure_burn_duration_s":departure_burn_duration,"departure_burn_to_parking_period_ratio":departure_burn_duration/departure_parking_period,"departure_vinf_m_s":vinf1,"arrival_vinf_m_s":vinf2,"departure_c3_km2_s2":vinf1**2/1e6,"injection_delta_v_m_s":injection,"capture_delta_v_m_s":capture,"heliocentric_delta_v_m_s":abs(transfer1-v1)+abs(v2-transfer2),"required_departure_phase_angle_deg":math.degrees(required_phase),"actual_departure_phase_angle_deg":math.degrees(phase),"arrival_miss_distance_km":miss/1000,"arrival_tolerance_km":c.arrival_tolerance_km,"synodic_period_days":2*math.pi/abs(earth_n-target_n)/86400,"transfer_semi_major_axis_m":a,"transfer_eccentricity":abs(r2-r1)/(r1+r2)},
        "events":[{"type":"injection","t":0,"delta_v_m_s":injection},{"type":"ideal_arrival","t":transfer_time,"miss_distance_m":miss,"capture_delta_v_m_s":capture}],
        "integrator":{"name":"Analytic solar two-body Hohmann conic; circular analytic planet motion"},
        "assumptions":["Ideal coplanar circular Earth/destination orbits around the Sun; not date-specific JPL ephemerides.","Launch phase is solved analytically unless explicitly supplied; a wrong phase fails the arrival tolerance.","Departure and optional capture use patched-conic parking-orbit energy budgets. Sphere-of-influence and local hyperbolic arcs are not propagated.","One-way transfer only; no round-trip, life support, radiation, planetary atmosphere, aerobraking or landing model.","The destination point is the ideal planet-center orbital location; it is not a physical surface collision or a rendered parking orbit."],"knowledge_ids":["interplanetary-transfers","hohmann","rocket-equation","gravity"]}
