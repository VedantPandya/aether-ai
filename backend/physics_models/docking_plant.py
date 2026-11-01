"""Stateful docking plant shared by offline physics and the live autonomy stack."""
import copy
import math
from .common import MU,EARTH_RADIUS,G0,rk4_step,wrap_angle,sample,frame

class DockingPlant:
    def __init__(self,config):
        self.config=config;c=config
        self.spin=c.station_rpm*2*math.pi/60;self.station_phase=0.0
        self.n=math.sqrt(MU/(EARTH_RADIUS+c.station_orbit_altitude_km*1000)**3)
        self.radius=c.station_port_radius_m
        self.state=[self.radius+c.docking_standoff_m,0.0,0.0,0.0,math.radians(c.initial_attitude_deg),math.radians(c.initial_angular_velocity_deg_s)]
        self.fuel=c.fuel_kg;self.inert=c.dry_mass_kg+c.payload_kg;self.wet=self.inert+self.fuel;self.ve=c.isp_s*G0
        self.step_count=0
        self.t=0.0;self.samples=[];self.events=[];self.dv_equiv=self.translation_dv=self.angular_impulse=self.signed_angular_impulse=0.0
        self.initial_omega=self.state[5];self.translation_fuel=self.attitude_fuel=0.0
        self.peak_thrust=self.peak_torque=self.dwell=0.0;self.success=False;self.reason="";self.done=False
        self.next_sample=0.0;self.last_force=(0.0,0.0);self.last_torque=0.0
        self.minimum_fuel_kg=0.0
        self.thrust_effectiveness=1.0;self.torque_effectiveness=1.0;self.leaked_fuel=0.0
        self.obstacles=[];self.revision=0
        self.program={"mode":"approach","approach_time_constant_s":27.0,"phase_offset_deg":0.0,"thrust_fraction":1.0,"hold_distance_m":20.0}
        self.reference_epoch=0.0;self.reference_start_radius=self.radius+c.docking_standoff_m
        self.record("Rendezvous start")
    def clone(self): return copy.deepcopy(self)
    def target(self,t=None):
        t=self.t if t is None else t
        angle=self.station_phase+self.spin*t;co,si=math.cos(angle),math.sin(angle)
        return self.radius*co,self.radius*si,-self.radius*self.spin*si,self.radius*self.spin*co,angle+math.pi
    def errors(self):
        px,py,pvx,pvy,heading=self.target();x,y,vx,vy,theta,omega=self.state
        return math.hypot(x-px,y-py),math.hypot(vx-pvx,vy-pvy),wrap_angle(heading-theta),self.spin-omega
    def set_program(self,program):
        if program["mode"] not in {"approach","hold","retreat","abort"}: raise ValueError("Invalid control mode")
        self.program=dict(program);self.reference_epoch=self.t;self.reference_start_radius=math.hypot(*self.state[:2]);self.dwell=0.0
        self.revision+=1
        if program["mode"]=="abort": self.done=True;self.reason="Mission aborted by supervisory control"
    def reference(self):
        c=self.config;u=max(0,self.t-self.reference_epoch);tau=self.program["approach_time_constant_s"]
        decay=math.exp(-u/tau);start=self.reference_start_radius
        mode=self.program["mode"]
        goal=self.radius if mode=="approach" else self.radius+self.program["hold_distance_m"]
        if mode=="retreat":goal=max(goal,start+10)
        if mode=="hold":r=goal;rd=rdd=0.0
        else:r=goal+(start-goal)*decay;rd=-(start-goal)*decay/tau;rdd=(start-goal)*decay/tau**2
        offset=math.radians(self.program["phase_offset_deg"])*decay
        angle=self.station_phase+self.spin*self.t+offset;rate=self.spin-offset/tau;rate_dot=offset/tau**2
        co,si=math.cos(angle),math.sin(angle)
        return (r*co,r*si,rd*co-r*rate*si,rd*si+r*rate*co,
                (rdd-r*rate**2)*co-(2*rd*rate+r*rate_dot)*si,
                (rdd-r*rate**2)*si+(2*rd*rate+r*rate_dot)*co)
    def control(self):
        c=self.config;x,y,vx,vy,theta,omega=self.state
        rx,ry,rvx,rvy,rax,ray=self.reference();_,_,heading_error,rate_error=self.errors()
        natural_x=3*self.n*self.n*x+2*self.n*vy;natural_y=-2*self.n*vx
        mass=self.inert+self.fuel
        fx=mass*(c.controller_kp*(rx-x)+c.controller_kd*(rvx-vx)+rax-natural_x)
        fy=mass*(c.controller_kp*(ry-y)+c.controller_kd*(rvy-vy)+ray-natural_y)
        force=math.hypot(fx,fy);limit=c.docking_thrust_n*self.thrust_effectiveness*self.program["thrust_fraction"]
        if force>limit and force>0:fx*=limit/force;fy*=limit/force
        torque=c.moment_of_inertia_kg_m2*(0.35*heading_error+1.1*rate_error)
        max_torque=c.max_torque_nm*self.torque_effectiveness
        torque=max(-max_torque,min(max_torque,torque))
        if self.fuel<=self.minimum_fuel_kg+1e-12:return 0.0,0.0,0.0
        return fx,fy,torque
    def step(self,dt=None):
        if self.done:return self.snapshot()
        c=self.config;gap,relative_speed,heading_error,rate_error=self.errors()
        within=gap<c.docking_position_tolerance_m and relative_speed<c.docking_velocity_tolerance_m_s and abs(heading_error)<math.radians(c.docking_angle_tolerance_deg) and abs(rate_error)<math.radians(c.docking_rate_tolerance_deg_s)
        if self.program["mode"]=="approach" and within and self.dwell>=c.docking_dwell_s:
            self.success=True;self.done=True;self.events.append({"type":"soft_capture","t":self.t,"position_error_m":gap,"relative_speed_m_s":relative_speed,"attitude_error_rad":heading_error,"angular_rate_error_rad_s":rate_error});self.record("Docked");return self.snapshot()
        if math.hypot(*self.state[:2])<self.radius-0.5 and gap>c.docking_position_tolerance_m:
            self.reason="Station hull exclusion boundary crossed";self.done=True;self.record("Aborted");return self.snapshot()
        for obstacle in self.obstacles:
            distance=math.hypot(self.state[0]-obstacle["position_m"][0],self.state[1]-obstacle["position_m"][1])
            if distance<obstacle["radius_m"]+0.5:
                self.reason="Obstacle exclusion boundary crossed";self.done=True;self.record("Aborted");return self.snapshot()
        remaining=c.docking_timeout_s-self.t
        if remaining<=1e-9:self.done=True;self.reason="Docking tolerances were not attained before the time limit";self.record("Hold");return self.snapshot()
        dt=min(dt or c.integration_step_s,c.integration_step_s,remaining)
        self.dwell=self.dwell+dt if within and self.program["mode"]=="approach" else 0.0
        fx,fy,torque=self.control();force=math.hypot(fx,fy);attitude_force=abs(torque)/c.rcs_lever_arm_m
        total=force+attitude_force;flow=total/self.ve;burn_dt=min(dt,max(0,self.fuel-self.minimum_fuel_kg)/flow) if flow>0 else 0.0
        start_fuel=self.fuel
        def derivative(ax_force,ay_force,applied_torque,mdot,origin_time,origin_fuel):
            def f(t_sub,s):
                x,y,vx,vy,theta,omega=s;mass=self.inert+max(0,origin_fuel-mdot*(t_sub-origin_time))
                return [vx,vy,3*self.n*self.n*x+2*self.n*vy+ax_force/mass,-2*self.n*vx+ay_force/mass,omega,applied_torque/c.moment_of_inertia_kg_m2]
            return f
        if burn_dt>0:
            self.state=rk4_step(derivative(fx,fy,torque,flow,self.t,self.fuel),self.t,self.state,burn_dt)
            used=min(self.fuel,flow*burn_dt);self.fuel=max(self.minimum_fuel_kg,self.fuel-used)
            dv=self.ve*math.log((self.inert+start_fuel)/(self.inert+self.fuel))
            self.dv_equiv+=dv;self.translation_dv+=dv*force/total
            self.translation_fuel+=used*force/total;self.attitude_fuel+=used*attitude_force/total
            self.angular_impulse+=abs(torque)*burn_dt;self.signed_angular_impulse+=torque*burn_dt
        if burn_dt<dt:
            self.state=rk4_step(derivative(0,0,0,0,self.t+burn_dt,self.fuel),self.t+burn_dt,self.state,dt-burn_dt)
            if start_fuel>0 and self.fuel<=1e-12:self.events.append({"type":"propellant_depleted","t":self.t+burn_dt})
        self.step_count+=1
        self.t+=dt;self.last_force=(fx,fy);self.last_torque=torque
        self.peak_thrust=max(self.peak_thrust,force);self.peak_torque=max(self.peak_torque,abs(torque))
        if self.t>=self.next_sample:self.record("PD + attitude approach" if self.program["mode"]=="approach" and self.fuel>0 else self.program["mode"].capitalize());self.next_sample=self.t+0.5
        return self.snapshot()
    def rollout(self,horizon_s=None):
        end=self.config.docking_timeout_s if horizon_s is None else min(self.config.docking_timeout_s,self.t+horizon_s)
        while not self.done and self.t<end-1e-9:self.step(min(self.config.integration_step_s,end-self.t))
        if self.t>=self.config.docking_timeout_s-1e-9 and not self.done:self.step()
        return self.snapshot()
    def inject(self,event):
        kind=event["type"];value=event["value"]
        if kind=="fuel_leak":
            lost=self.fuel*value;self.fuel-=lost;self.leaked_fuel+=lost
        elif kind=="thrust_loss":self.thrust_effectiveness*=1-value
        elif kind=="torque_loss":self.torque_effectiveness*=1-value
        elif kind=="station_spin_change":
            previous=self.station_phase+self.spin*self.t;self.spin=value*2*math.pi/60;self.station_phase=previous-self.spin*self.t
        elif kind=="obstacle":self.obstacles.append({"position_m":event["position_m"],"radius_m":value})
        else:raise ValueError("Unknown plant event")
        self.revision+=1;self.events.append({"type":kind,"t":self.t,"value":value})
    def snapshot(self):
        gap,speed,angle,rate=self.errors();x,y,vx,vy,theta,omega=self.state
        margin=min([math.hypot(x-o["position_m"][0],y-o["position_m"][1])-o["radius_m"]-0.5 for o in self.obstacles],default=1000000.0)
        return {"t":self.t,"position_m":[x,y,0.0],"velocity_m_s":[vx,vy,0.0],"heading_rad":theta,"angular_velocity_rad_s":omega,"fuel_kg":self.fuel,"leaked_fuel_kg":self.leaked_fuel,"distance_m":gap,"relative_speed_m_s":speed,"attitude_error_rad":angle,"angular_rate_error_rad_s":rate,"station_angle":self.station_phase+self.spin*self.t,"station_angular_velocity_rad_s":self.spin,"obstacle_margin_m":margin,"thrust_effectiveness":self.thrust_effectiveness,"torque_effectiveness":self.torque_effectiveness,"program":dict(self.program),"revision":self.revision,"success":self.success,"done":self.done,"reason":self.reason}
    def record(self,phase):
        c=self.config;x,y,vx,vy,theta,omega=self.state;gap,speed,angle,rate=self.errors();px,py,_,_,_=self.target()
        s=sample(self.t,x,y,vx,vy,self.fuel,phase,altitude_m=c.station_orbit_altitude_km*1000,distance_m=gap,relative_speed_m_s=speed,station_angle=self.station_phase+self.spin*self.t,heading_rad=theta,attitude_error_rad=angle,angular_velocity_rad_s=omega,angular_rate_error_rad_s=rate,station_angular_velocity_rad_s=self.spin,thrust_n=math.hypot(*self.last_force),torque_nm=self.last_torque,port_position_m=[px,py,0.0]);s["speed_m_s"]=speed;self.samples.append(s)
    def result(self):
        if self.samples[-1]["t"]!=self.t:self.record("Docked" if self.success else "Hold")
        c=self.config;spin=self.spin;n=self.n;fuel=self.fuel;inert=self.inert;wet=self.wet;ve=self.ve;t=self.t;samples=self.samples;events=self.events;success=self.success;reason=self.reason
        dv_equiv=self.dv_equiv;translation_dv=self.translation_dv;translation_fuel=self.translation_fuel;attitude_fuel=self.attitude_fuel;angular_impulse=self.angular_impulse;signed_angular_impulse=self.signed_angular_impulse;peak_thrust=self.peak_thrust;peak_torque=self.peak_torque;dwell=self.dwell;state=self.state;initial_omega=self.initial_omega
        gap,rel,angle_error,rate_error=self.errors();used=c.fuel_kg-fuel-self.leaked_fuel
        return {"fuel_leaked_kg":self.leaked_fuel,"feasible":success,"success":success,"delta_v_m_s":dv_equiv,"available_delta_v_m_s":ve*math.log(wet/inert),"fuel_required_kg":used,"fuel_used_kg":used,"fuel_remaining_kg":fuel,"fuel_requirement_kind":"predicted_consumption_not_minimum_design_fuel","duration_s":t,"samples":samples,
            "burns":[{"name":"Relative approach","at_s":0,"delta_v_m_s":translation_dv,"description":f"CW-aware PD; {c.docking_thrust_n:g} N translation limit"},{"name":"Attitude match and capture","at_s":t,"delta_v_m_s":dv_equiv-translation_dv,"description":"Position, relative velocity, orientation and angular rate all checked"}],
            "summary":"Soft docking confirmed" if success else reason,
            "frame":{**frame("station_lvlh","Station center","m","port_relative"),"axes":"X radial outward; Y along orbital motion; Z orbit normal"},"events":events,
            "metrics":{"position_error_m":gap,"relative_speed_m_s":rel,"attitude_error_deg":math.degrees(angle_error),"angular_rate_error_deg_s":math.degrees(rate_error),"station_angular_velocity_rad_s":spin,"orbital_mean_motion_rad_s":n,"translation_delta_v_m_s":translation_dv,"translation_fuel_kg":translation_fuel,"attitude_fuel_kg":attitude_fuel,"angular_impulse_nm_s":angular_impulse,"signed_angular_impulse_nm_s":signed_angular_impulse,"angular_momentum_balance_residual_nm_s":c.moment_of_inertia_kg_m2*(state[5]-initial_omega)-signed_angular_impulse,"peak_thrust_n":peak_thrust,"peak_torque_nm":peak_torque,"propellant_mass_balance_error_kg":used-translation_fuel-attitude_fuel,"capture_dwell_s":dwell},
            "constraints":{"position_tolerance_m":c.docking_position_tolerance_m,"relative_speed_tolerance_m_s":c.docking_velocity_tolerance_m_s,"attitude_tolerance_deg":c.docking_angle_tolerance_deg,"angular_rate_tolerance_deg_s":c.docking_rate_tolerance_deg_s,"dwell_s":c.docking_dwell_s},
            "integrator":{"name":"RK4, sample-and-hold force/torque, exact fuel depletion split","step_s":c.integration_step_s},
            "assumptions":["Planar Clohessy-Wiltshire relative motion about a circular Earth reference orbit; small separation approximation.","Planar body attitude with constant moment of inertia and torque-limited RCS; translation is fully actuated.","Translation and attitude thrusters share propellant and Isp; torque couple propellant uses lever arm.","Constant station spin relative to LVLH; exponential radial approach reference; fixed PD gains.","Capture requires all four tolerances for a dwell interval. Hull exclusion is geometric; no rigid-body contact dynamics or full 6-DOF model."],"knowledge_ids":["pd-control","rotating-frames","hill-clohessy-wiltshire","attitude-control","rocket-equation"]}
