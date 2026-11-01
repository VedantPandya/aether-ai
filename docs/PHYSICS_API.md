# Physics API / frontend handoff

The renderer should consume the computed state, frame and units. Do not infer a coordinate system from a mission name or treat every x/y pair as Earth-centered kilometres.

## Stable endpoints

- `GET /api/missions`: six missions and full validated defaults: `ball_throw`, `launch`, `orbit`, `docking`, `lunar`, `interplanetary`.
- `GET /api/physics/examples`: curated configurations with a description and expected feasible/blocked outcome. Use these for example cards, including deliberate failures.
- `GET /api/physics/schema`: configuration fields, types, defaults and bounds.
- `POST /api/plan`: accepts MissionConfig; returns calculated outcome without samples.
- `POST /api/simulate`: same request; returns full state samples. Infeasible missions return HTTP 409. Use `/api/plan` for explaining a failed objective.
- `POST /api/physics/compare`: `{ "config": <config>, "parameter": "station_rpm", "values": [0.1, 0.2, 0.4] }`; up to 12 sweep points, with metrics and per-value failures.

Existing four mission IDs and old required result fields remain. New configuration fields have defaults; old saved configurations remain accepted.

## Coordinates and time

`sample.position_m = [x,y,z]` is the authoritative position in **metres** in the declared `result.frame`. `sample.velocity_m_s` uses the same frame. `sample.t` is simulation time in seconds; use it for interpolation and playback rather than moving a craft by sample index. `sample.heading_rad` and `angular_velocity_rad_s` are radians / radians per second. `frame.speed_kind` explains the legacy scalar speed.

Legacy `sample.x`, `sample.y`, `sample.z` remain for compatibility, but their units vary:

| Mission | Frame | Legacy x/y unit | Renderer guidance |
| --- | --- | --- | --- |
| ball_throw | Local ground: X horizontal, Y up | m | Ground plane, ball radius from config; velocity/force arrows; fit the trajectory bounds |
| launch | Earth vertical: Y from Earth center | km | Display height using `altitude_km`; do not mistake geocentric Y for height above ground |
| orbit / lunar | Earth-centered inertial XY | km | Earth radius 6,371 km; trajectories and orbital rings in the same scale |
| docking | Station LVLH: X radial outward, Y along orbital motion | m | Port radius and station spin from config; use `station_angle`, `heading_rad`, `port_position_m` |
| interplanetary | Sun-centered ecliptic XY | km | Sun at origin; fit AU-scale path, not Earth-scale path; use supplied body ephemerides |

`rendering.bounds_m` gives trajectory bounds for camera fitting. `physical_body_radius_m` is a true radius, not a magnified display size. `acceleration_m_s2` is available for orbit, lunar, solar, ball and launch states. Ball and launch also provide named `force_vectors_n` for gravity, drag/aerodynamics and thrust arrows.

`position_m` avoids all legacy scaling ambiguity. No model implements full 3D attitude; spacecraft motion is planar and Z is zero. For visual clarity body sizes may be exaggerated, but label that choice. Physics positions should remain consistent.

## Precision, fuel and angular motion

- **Ball:** `metrics.range_m`, `flight_time_s`, `max_height_m`, `impact_speed_m_s`, target error, energy-balance residual. A throw uses initial energy and consumes no rocket propellant. Optional spin lift is approximate.
- **Launch:** finite thrust and mass flow; exact burnout split and located apogee. Plot fuel, altitude, speed and dynamic pressure; metrics include thrust-to-weight, peak proper acceleration in g, gravity/drag losses and velocity-budget residual.
- **Orbit:** exact Kepler conic sampling, impulses and fuel consumed per burn; angular rate varies along the transfer. Energy/angular-momentum errors are reported. Duplicate timestamps at circularization represent an instantaneous velocity/fuel change; interpolate position without smearing the burn into a long continuous acceleration.
- **Docking:** success requires position, relative speed, attitude angle and angular-rate errors all within `result.constraints` for the dwell interval. Show all four errors, not distance alone. `sample.speed_m_s` is port-relative for legacy compatibility; `velocity_m_s` is the full LVLH velocity. Thruster force, torque and fuel are limited. Attitude consumes propellant too.
- **Interplanetary:** show travel days, required launch phase, departure C3/v-infinity, injection and capture delta-v, and arrival miss distance. `body_ephemerides` supplies 101 snapshots at a subset of trajectory timestamps. For exact body animation at any time, use `bodies`: angle = initial_phase_rad + mean_motion_rad_s * t, position = orbit_radius_m * [cos(angle), sin(angle), 0]. The capture burn is an energy budget; local hyperbolic and parking-orbit arrival arcs are not propagated.

All `fuel_kg` values mean **propellant including oxidizer**. `fuel_required_kg` is retained for compatibility. For impulsive transfers it is the ideal burn consumption with the configured initial mass; `required_initial_fuel_kg` separately solves how much initial fuel is needed with fixed inert mass. For launch/docking it is predicted consumption of the simulated design, not an optimized minimum. `fuel_requirement_kind` distinguishes these meanings.

`trajectory_validity` marks valid computed trajectories versus blocked reference/failed attempts. A smooth line or an LLM statement does not override `feasible=false`. Show `summary`, constraints and assumptions when a mission is blocked.

## Suggested complete examples

Start with `ball-vacuum`, add drag, then show `launch-space`, `orbit-efficient`, `docking-nominal`, `docking-no-torque`, and `mars-tourism` / `mars-wrong-window`. This progression demonstrates the same laws across local motion, propulsion, orbital geometry and precision control.

This is deterministic educational mission analysis. Interplanetary results use ideal circular/coplanar planet orbits with solved phase; they are not date-specific launch predictions or a crewed travel safety assessment.

## Hierarchical runtime control

The shared docking model now has a stateful three-layer supervisor with live telemetry, fault injection, Decisions reflexes and validated strategic detours. See [AUTONOMY.md](AUTONOMY.md) for endpoints and control authority. The frontend can consume these independently of the ordinary batch `/api/simulate` endpoint.
