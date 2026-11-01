# Demo script - 80 to 90 seconds

Use synthetic prompts. Keep .env, terminals, account pages and personal data out of the recording. At the time of recording, choose either live OpenAI mode or clearly identify offline mode. Do not claim offline planning is a live LLM.

| Time | On-screen action | Narration |
| --- | --- | --- |
| 0-8 s | Mission control, Aether avatar | "Aether is an autonomous mission-control playground. Tell it the mission; it computes and verifies the flight plan." |
| 8-20 s | Ask for a 300-to-800 km transfer; show plan | "The reasoning agent calls a physics knowledge tool and the deterministic planner. The result is a two-burn transfer with a real delta-v and fuel budget." |
| 20-34 s | Select 10 s demo, execute, watch completion | "These trajectories are propagated under Newtonian gravity. Fuel, velocity, altitude and mission time come from the simulation." |
| 34-43 s | Download report, inject fuel leak | "Cut the fuel, and it recalculates. This mission is blocked: model confidence cannot override insufficient propellant." |
| 43-58 s | Choose Rotating rendezvous, plan, execute at 10 s demo | "A separate PD controller tracks the rotating station's port. Success requires both position and relative speed to match." |
| 58-68 s | Choose lunar mission, then launch | "The same interface also supports a lunar-distance transfer and a suborbital launch with atmospheric drag. These are deliberately bounded educational models." |
| 68-80 s | Physics library, linked topics, flight log | "The three tiers are deterministic control, Decisions API reflex classification, and Responses API reasoning. Every tool result is inspectable." |
| 80-88 s | Repo / Codex contribution slide | "Codex built the integration and wrote tests for orbital energy conservation and a false AI continue decision being vetoed by physics. The public repo has setup instructions and credits." |

For a safe fallback demo, select offline planning before recording. The UI will show DEMO MODE / RULE-BASED PLANNING. Explain that the same physics/controller journey is active while live LLM integrations require the server key.
