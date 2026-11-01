"""Planar unpowered hyperbolic flyby assessment, not encounter targeting."""
import math
from .types import SwingbyRequest
from ..physics_models.common import MU,EARTH_RADIUS,PLANETS

def assess_swingby(request):
    c=SwingbyRequest.model_validate(request)
    body={"mu":MU,"radius_m":EARTH_RADIUS} if c.body=="earth" else PLANETS[c.body]
    safe_altitude={"earth":160,"mars":120,"venus":250}[c.body]
    vinf=math.hypot(*c.incoming_vinf_m_s)
    if not 100<=vinf<=100000:raise ValueError("Hyperbolic excess speed must be in [100,100000] m/s")
    if math.hypot(*c.planet_velocity_m_s)>100000:raise ValueError("Planet velocity outside this Newtonian example domain")
    radius=body["radius_m"]+1000*c.periapsis_altitude_km
    eccentricity=1+radius*vinf**2/body["mu"]
    turning=2*math.asin(1/eccentricity)*c.turn_direction
    co,si=math.cos(turning),math.sin(turning);ix,iy=c.incoming_vinf_m_s
    ox,oy=ix*co-iy*si,ix*si+iy*co;px,py=c.planet_velocity_m_s
    before=(ix+px,iy+py);after=(ox+px,oy+py)
    energy_delta=(after[0]**2+after[1]**2-before[0]**2-before[1]**2)/2
    return {"body":c.body,"periapsis_altitude_km":c.periapsis_altitude_km,"above_conservative_altitude_floor":c.periapsis_altitude_km>=safe_altitude,"minimum_altitude_km":safe_altitude,"turn_angle_deg":math.degrees(turning),"hyperbola_eccentricity":eccentricity,"incoming_vinf_m_s":list(c.incoming_vinf_m_s),"outgoing_vinf_m_s":[ox,oy],"planet_frame_speed_error_m_s":math.hypot(ox,oy)-vinf,"heliocentric_incoming_velocity_m_s":list(before),"heliocentric_outgoing_velocity_m_s":list(after),"heliocentric_speed_change_m_s":math.hypot(*after)-math.hypot(*before),"specific_orbital_energy_change_j_kg":energy_delta,"periapsis_speed_m_s":math.sqrt(vinf**2+2*body["mu"]/radius),"ideal_propellant_kg":0,"encounter_targeting_verified":False,"eligible_for_execution":False,"assumptions":["Planar Newtonian patched-conic, unpowered flyby; constant planet velocity over the encounter.","Planet-relative asymptotic speed is conserved; heliocentric energy may change by exchanging momentum with the planet.","An altitude floor is a screening bound, not a full atmosphere, terrain, heating or radiation assessment.","Encounter date, B-plane targeting, reachable incoming/outgoing legs and mission timing are not solved by this assessment. A favorable energy change alone does not authorize a swingby."]}
