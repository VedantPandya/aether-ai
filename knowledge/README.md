# Physics knowledge library

`topics.json` contains more than 120 connected topics across classical mechanics,
spaceflight engineering and relativity. It is a broad,
mission-focused reference from classical mechanics through relativity, not an
exhaustive replacement for the physics literature or an executable equation engine.
The Physics library UI and `search_physics` agent tool read this same file.

Open `/physics` on the running app (for example
<http://127.0.0.1:8000/physics>). The active agent workspace links to that page;
it supports text/alias search, category filtering, connected concepts and model
validity/implementation labels. The displayed topic count comes from the API.

## Coverage

| Area | Included concepts |
| --- | --- |
| Foundations | SI units/constants, dimensional analysis, inertial/body/rotating frames, render conversions |
| Classical mechanics | Newton laws, impulse, work/energy, angular momentum, Lagrangian and Hamiltonian mechanics |
| Spacecraft dynamics | Centre of mass, inertia tensors, 6-DoF rigid bodies, quaternions, gyroscopes, habitat spin, slosh, release dynamics |
| Orbital mechanics | Kepler conics and timing, elements, vis-viva, escape, J2, N-body/three-body models, Lagrange points, Hill/SOI scales, perturbations |
| Trajectory planning | Hohmann/Lambert transfers, plane changes, patched conics, gravity assists, B-plane targeting, hyperbolic flybys, Oberth effect |
| Propulsion | Rocket equation, thrust/Isp, variable mass, staging, finite burns, power-limited electric engines |
| Docking/control | Rotating ports, Hill-Clohessy-Wiltshire, relative elements, PD/LQR/MPC, attitude tracking, RCS allocation, contact and keep-out geometry |
| Navigation | Sensors/observability, Kalman filtering, covariance/Monte Carlo, ephemerides, UTC/TT/TDB, communication latency, constrained planning |
| Launch/entry/landing | Atmosphere models, drag, Mach effects, ballistic coefficient, entry corridor, heating, powered descent |
| Surface exploration | Terrain-relative navigation, hazards, wheel-soil traction, slip and rollover |
| Resources/environment | Radiative thermal balance, electrical energy, eclipses, radiation and life-support inventory |
| Electromagnetism/thermal physics | Maxwell equations, Lorentz force, thermodynamic energy and entropy |
| Numerical methods | RK4/step refinement, adaptive and symplectic methods, event detection, invariants, model/error budgets |
| Special relativity | Lorentz transforms/factor, simultaneity, proper time/acceleration, velocity addition, Doppler effects, four-momentum, relativistic rocket |
| General relativity | Equivalence principle, metrics/tetrads, field equations, geodesics/deviation, redshift, clock rates, lensing, post-Newtonian corrections, gravitational waves |
| Black-hole encounters | Schwarzschild/Kerr geometry, spin/frame dragging, horizon/ergosphere, photon sphere/shadow, ISCO, effective-potential capture, Penrose conditions, tides, disk emission, relativistic navigation/flybys |

## Entry schema and conventions

The root remains an array, preserving the existing `/api/knowledge` contract.
Original topic IDs are stable so mission reports and links continue to resolve.

| Field | Meaning |
| --- | --- |
| `id`, `title`, `category` | Stable identifier and human-facing organization |
| `equation` | Human-readable equation or algorithmic relation, not code to execute |
| `summary`, `details` | Explanation plus definitions, units, frame/observer conventions and conditions |
| `regime` | Physical domain where the displayed relation applies |
| `assumptions`, `limitations` | Explicit conditions and common misuse or missing physics |
| `simulation_status` | `implemented`, `simplified`, or `reference_only` |
| `simulation_notes` | What the current project actually supports |
| `keywords` | Curated aliases for search, without source-URL noise |
| `related` | One to three connected topic IDs, all resolvable |
| `sources` | Public primary-source titles and HTTPS links |

Equations state local conventions in their details: SI unless explicitly noted,
angles in radians, invariant rest mass in relativity, and metric signature
`(-,+,+,+)`. Geometric-unit equations explicitly state `G=c=1`. Never mix them
with SI masses or metres without conversion. `r_s=2GM/c²` differs by a factor of
two from `r_g=GM/c²`.

Regime restrictions matter: the square-root Schwarzschild clock factor is for a
static observer, not a universal clock law for any moving spacecraft. The 3 `r_s`
ISCO applies to circular timelike Schwarzschild geodesics, not all capture cases.
Unpowered flybys conserve asymptotic speed in a stationary body's rest frame;
stage release is not automatically a propulsive or Penrose energy gain.

## Scenario reading paths

- **Rotating docking:** `reference-frames` → `rotating-frames` →
  `hill-clohessy-wiltshire` → `quaternions` → `attitude-control` →
  `rcs-allocation` → `docking-contact` → `collision-avoidance`.
- **Drop-stage flyby:** `hyperbolic-flyby` → `b-plane-targeting` →
  `gravity-assist` → `momentum-conservation` → `separation-dynamics` →
  `mass-properties` → `staging` → `oberth-effect` → `finite-burns`.
- **Strong-field encounter:** `model-fidelity` → `lorentz-factor` →
  `spacetime-metric` → `geodesics` → `schwarzschild-metric` / `kerr-black-hole` →
  `black-hole-capture` → `relativistic-flyby` → `proper-time` → `tidal-forces`.
- **Interstellar visuals:** `event-horizon` → `photon-sphere` →
  `black-hole-shadow` → `gravitational-lensing` → `relativistic-doppler` →
  `accretion-disks`. A visual shader is separate from physical ray tracing.
- **Landing and rover:** `atmosphere-models` → `aerodynamic-heating` →
  `powered-descent` → `terrain-navigation` → `rover-traction` → `rover-stability`.
- **Validation:** `units-dimensional-analysis` → `coordinate-transforms` →
  `event-detection` → `conservation-checks` → `uncertainty-propagation` →
  `constrained-planning`.

## Agent retrieval and execution boundary

Retrieval uses a small local weighted lexical index with inverse-document-frequency
ranking. Titles, IDs, keywords and summaries carry more weight than body text.
Common request words, source URLs, graph edges and repeated implementation notes
do not dominate ranking. Query aliases cover black-hole spelling, swingby,
jettison, GR/SR, HCW, RCS, MPC, EKF and TVC. A call returns at most four complete
topics. Empty or unrelated queries return no matches rather than arbitrary facts.

Examples:

```python
from backend.knowledge import search_physics

search_physics('blackhole swingby')
search_physics('stage separation')
search_physics('rotating docking')
search_physics('Schwarzschild time dilation')
```

Both the copilot and autonomous workspace agent are instructed to read validity
and implementation metadata and preserve deterministic feasibility gates.
Knowledge additions do not install dynamics. Executable scenarios and parameters
are defined by the current `MissionConfig`, `DEFAULTS` and model dispatch; read
each plan's frame, integrator, constraints and assumptions. Current scenario
families include orbital/lunar-distance transfer, planar rotating docking,
vertical ascent, projectiles and ideal interplanetary transfers. Partial
implementations are labelled accordingly; full 6-DoF contact and relativistic
geodesics remain reference material. The independent swingby asset preview is
still an approximate Newtonian demonstration.

Further solver work can use these entries as a requirements map: full 6-DoF
mass/attitude dynamics, sensor estimates, individual-thruster allocation, contact
mechanics and a separately verified metric-based geodesic solver for relativistic
encounters. Each needs implementation and numerical validation before any status
is changed from `reference_only`; existing planar subsets do not imply the full
theory has been implemented.

## Sources, maintenance and checks

Sources include NASA/JPL/NAIF, NIST/BIPM, MIT course materials and author-written
relativity research/lecture notes. Content is newly written concise exposition of
standard physics with attributed primary references; no textbook passages or
external images are copied. A public source link is attribution, not endorsement
or a claim that the app implements everything in that source.

Tests in `tests/test_knowledge.py` check topic coverage, field/schema integrity,
stable/resolvable graph edges, source URL structure, retrieval of scenario concepts
and aliases, unrelated queries, existing mission references, and reference-only
boundaries. They do not prove every scientific statement by executing an equation
string. Browser checks exercise expanded search, metadata, links, graph navigation
and mobile layout. Live source availability is separate from offline tests.

Run from `aether-ai`:

```sh
python -m pytest -q
npm run build
```

Restart the Python server after editing `topics.json`, because it is loaded and
indexed at process startup. Rebuild the frontend for UI changes when serving the
production build.
