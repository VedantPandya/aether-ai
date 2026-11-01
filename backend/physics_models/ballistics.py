"""Two-dimensional ball throw with wind, drag, optional spin lift and ground events."""
import math
from .common import G0,rk4_step,locate_event,sample,frame,atmosphere

def ball_throw(c):
    angle=math.radians(c.ball_angle_deg);m=c.ball_mass_kg;area=math.pi*c.ball_radius_m**2
    state=[0.0,c.ball_height_m,c.ball_speed_m_s*math.cos(angle),c.ball_speed_m_s*math.sin(angle),0.0,0.0]
    initial_energy=0.5*m*c.ball_speed_m_s**2+m*G0*c.ball_height_m
    samples=[];events=[];t=0.0;max_height=c.ball_height_m;apogee=None;landed=False;next_sample=0.0
    def f(t,s):
        x,y,vx,vy,_,_=s;ux=vx-c.wind_m_s;uy=vy;speed=math.hypot(ux,uy)
        rho=atmosphere(max(0,y))["density_kg_m3"] if c.atmosphere_enabled else 0.0
        drag_factor=0.5*rho*c.ball_drag_coefficient*area*speed
        dx,dy=-drag_factor*ux,-drag_factor*uy
        # Bounded phenomenological lift law, not a calibrated sports-ball aerodynamic model.
        spin_ratio=c.ball_radius_m*c.ball_spin_rad_s/max(speed,0.01)
        cl=max(-0.6,min(0.6,1.5*spin_ratio))
        lift_factor=0.5*rho*cl*area*speed
        lx,ly=-lift_factor*uy,lift_factor*ux
        return [vx,vy,(dx+lx)/m,-G0+(dy+ly)/m,dx*vx+dy*vy,lx*vx+ly*vy]
    def record(phase):
        x,y,vx,vy,wd,wl=state
        acceleration=f(t,state)
        samples.append(sample(t,x,max(0,y),vx,vy,0,phase,altitude_m=max(0,y),heading_rad=c.ball_spin_rad_s*t,angular_velocity_rad_s=c.ball_spin_rad_s,kinetic_energy_j=0.5*m*(vx*vx+vy*vy),potential_energy_j=m*G0*y,acceleration_m_s2=[acceleration[2],acceleration[3],0.0],force_vectors_n={"gravity":[0.0,-m*G0,0.0],"aerodynamic":[m*acceleration[2],m*(acceleration[3]+G0),0.0]}))
    record("Released")
    if state[1]==0 and state[3]<=0:
        landed=True;samples[-1]["phase"]="Ground contact";events.append({"type":"ground_contact","t":0.0,"range_m":0.0})
    while not landed and t<120:
        dt=min(c.integration_step_s,0.02,120-t);candidate=rk4_step(f,t,state,dt)
        if apogee is None and state[3]>0 and candidate[3]<=0:
            ta,sa=locate_event(f,t,state,dt,3);apogee={"type":"apogee","t":ta,"position_m":[sa[0],sa[1],0]};max_height=max(max_height,sa[1]);events.append(apogee)
        if candidate[1]<=0 and (state[1]>0 or state[3]<0):
            t,state=locate_event(f,t,state,dt,1);state[1]=0.0;landed=True;events.append({"type":"ground_contact","t":t,"range_m":state[0]});record("Ground contact");break
        t+=dt;state=candidate;max_height=max(max_height,state[1])
        if t>=next_sample: record("Ballistic flight");next_sample=t+0.04
    if not samples or samples[-1]["t"]!=t: record("Ground contact" if landed else "Time limit")
    target_error=None if c.ball_target_range_m is None else abs(state[0]-c.ball_target_range_m)
    success=landed and (target_error is None or target_error<=c.ball_target_tolerance_m)
    final_energy=0.5*m*(state[2]**2+state[3]**2)+m*G0*state[1]
    return {"feasible":success,"success":success,"delta_v_m_s":0.0,"available_delta_v_m_s":0.0,"fuel_required_kg":0.0,"fuel_remaining_kg":c.fuel_kg,"fuel_used_kg":0.0,"duration_s":t,"samples":samples,"burns":[],
        "summary":"Ball reached the landing target" if success and target_error is not None else "Ball throw completed" if success else "Ball missed the target tolerance" if landed else "Ball did not land within the time limit",
        "frame":frame("local_ground","Release ground point","m"),"events":events,
        "metrics":{"range_m":state[0],"flight_time_s":t,"max_height_m":max_height,"impact_speed_m_s":math.hypot(state[2],state[3]),"target_error_m":target_error,"target_tolerance_m":c.ball_target_tolerance_m,"initial_energy_j":initial_energy,"aerodynamic_work_j":state[4]+state[5],"energy_balance_residual_j":final_energy-initial_energy-state[4]-state[5],"initial_angular_momentum_kg_m2_s":0.4*m*c.ball_radius_m**2*c.ball_spin_rad_s},
        "integrator":{"name":"RK4 with bisected apogee/ground contact","step_s":min(c.integration_step_s,0.02),"event_time_tolerance_s":1e-9},
        "assumptions":["Flat local ground, constant standard gravity and 2D motion; no bounce or terrain.","Quadratic drag using air-relative velocity, constant horizontal wind and spherical frontal area.","Optional Magnus lift uses a bounded approximate lift coefficient; spin decay is omitted.","The throw supplies initial kinetic energy; no rocket propellant is consumed."],"knowledge_ids":["projectile-motion","drag","rotating-frames","numerical-integration"]}
