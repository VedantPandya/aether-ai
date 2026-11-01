# Physics verification snapshot

Model version: 0.2.0. All examples are reproducible; no API key is required.

| Check | Observed | Acceptance | Pass |
| --- | --- | --- | --- |
| ball-vacuum outcome | True | True | yes |
| ball-drag outcome | True | True | yes |
| ball-backspin outcome | True | True | yes |
| ball-precision-miss outcome | False | False | yes |
| launch-space outcome | True | True | yes |
| launch-low-thrust outcome | False | False | yes |
| launch-vacuum outcome | True | True | yes |
| orbit-efficient outcome | True | True | yes |
| orbit-fuel-shortage outcome | False | False | yes |
| docking-nominal outcome | True | True | yes |
| docking-no-torque outcome | False | False | yes |
| docking-precision outcome | True | True | yes |
| lunar-distance outcome | True | True | yes |
| mars-tourism outcome | True | True | yes |
| mars-wrong-window outcome | False | False | yes |
| mars-flyby outcome | True | True | yes |
| venus-transfer outcome | True | True | yes |
| Vacuum projectile range error (m) | 1.00847e-10 | < 2e-7 m | yes |
| Ball aerodynamic energy residual (J) | 4.103e-09 | < 1e-6 J | yes |
| Launch step-halving apogee difference (m) | 0.00361374 | < 0.01 m | yes |
| orbit-efficient relative energy error | 7.76198e-16 | < 1e-10 | yes |
| lunar-distance relative energy error | 3.02216e-13 | < 1e-10 | yes |
| Docking position alone is insufficient | False | False with zero attitude torque | yes |

Precision is measured within the stated model. Ideal interplanetary trajectories omit date-specific ephemerides and local arrival arcs. Ball lift is approximate; docking is planar, not full 6-DOF.

Primary references: [NASA trajectories](https://science.nasa.gov/learn/basics-of-space-flight/chapter4-1/), [NASA standard atmosphere](https://ntrs.nasa.gov/citations/19770009539), [NASA rendezvous equations](https://ntrs.nasa.gov/citations/19930020463), [NASA ballistic flight](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/ballistic-flight-equations/).
