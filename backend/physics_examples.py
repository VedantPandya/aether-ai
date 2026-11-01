"""Curated reproducible teaching/demo cases; all configurations go through validation."""
from .physics import DEFAULTS

def case(id,name,mission,description,expected=True,**overrides):
    return {"id":id,"name":name,"mission_type":mission,"description":description,"expected_feasible":expected,"config":{**DEFAULTS[mission],**overrides}}

EXAMPLES=[
 case("ball-vacuum","The perfect parabola","ball_throw","A drag-free 20 m/s, 45 degree throw. Compare range and flight time with the textbook solution.",atmosphere_enabled=False,ball_height_m=0),
 case("ball-drag","A throw through real air","ball_throw","The same throw with quadratic drag. Drag reduces range and removes mechanical energy.",ball_height_m=0),
 case("ball-backspin","Backspin and lift","ball_throw","Positive 120 rad/s spin adds upward Magnus lift. The lift law is a bounded approximation, not calibrated baseball aerodynamics.",ball_spin_rad_s=120,ball_height_m=0),
 case("ball-precision-miss","Precision matters","ball_throw","The landing range must be within 0.10 m of a 45 m target. This throw misses.",expected=False,ball_target_range_m=45,ball_target_tolerance_m=0.1),
 case("launch-space","First light: reach space","launch","Finite 30 kN thrust, changing mass, layered atmosphere, drag, burnout and apogee detection."),
 case("launch-low-thrust","Fuel cannot fix low thrust","launch","A full tank with only 10 kN thrust cannot lift the default rocket off the pad.",expected=False,thrust_n=10000),
 case("launch-vacuum","Measure drag losses","launch","Disable air to isolate gravity losses; compare with the atmosphere-enabled launch.",atmosphere_enabled=False),
 case("orbit-efficient","A two-burn orbital transfer","orbit","300 to 800 km circular orbit, with exact conic propagation and explicit prograde burns."),
 case("orbit-fuel-shortage","Propellant veto","orbit","12 kg of fuel cannot provide the required delta-v. Planning succeeds as a calculation; execution is blocked.",expected=False,fuel_kg=12),
 case("docking-nominal","Meet the rotating port","docking","Match translation, attitude and angular rate while charging shared propellant for force and torque."),
 case("docking-no-torque","Close is not docked","docking","Translation can reach the port but zero attitude torque cannot match the rotating docking orientation.",expected=False,max_torque_nm=0),
 case("docking-precision","Tighter capture tolerances","docking","Require 5 cm position, 1 cm/s relative velocity, 0.5 degrees attitude and 0.02 deg/s angular-rate error.",docking_position_tolerance_m=0.05,docking_velocity_tolerance_m_s=0.01,docking_angle_tolerance_deg=0.5,docking_rate_tolerance_deg_s=0.02),
 case("lunar-distance","Lunar pathfinder","lunar","An exact high-eccentricity Earth transfer to lunar distance. Lunar interception and capture are explicitly omitted."),
 case("mars-tourism","A one-way Mars itinerary","interplanetary","Ideal 259-day solar transfer with solved launch phase, LEO escape and Mars parking-orbit capture budgets."),
 case("mars-wrong-window","Enough fuel, wrong window","interplanetary","Depart when Mars is at 0 degrees rather than the required phase; the spacecraft misses the arrival tolerance.",expected=False,departure_phase_angle_deg=0),
 case("mars-flyby","A cheaper flyby","interplanetary","Skip the Mars capture budget. This is a flyby, not an orbital stay or landing.",capture_at_destination=False),
 case("venus-transfer","A trip inward to Venus","interplanetary","An ideal inward heliocentric transfer; higher arrival capture costs must still fit the fuel budget.",destination="venus",fuel_kg=20000),
]
