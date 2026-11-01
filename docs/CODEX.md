# How Codex helped

The repository started with a vision README and no application code. During the hackathon, Codex turned that vision into a bounded full-stack simulation and helped validate the physics instead of trusting generated explanations.

## Concrete example: an unsafe reflex answer

The control hierarchy allows a small Decisions API classifier to recommend an action, but the physics engine retains veto power. Codex implemented `test_decisions_contract_and_deterministic_veto` in `tests/test_api.py`: a mocked classifier returns **continue** for a spacecraft with **zero fuel**, and the backend must return **hold**. This verifies an important architectural boundary with an executable regression test.

## Concrete example: conservation of energy

Codex implemented RK4 two-body propagation, then added `test_orbital_coast_conserves_specific_energy` in `tests/test_physics.py`. It independently computes specific orbital energy from position and speed along the coast and requires relative drift below `1e-7`. The default 300-to-800 km transfer also has an independently stated delta-v reference and a final altitude tolerance.

## Additional contributions

- Checked current OpenAI function-calling and Decisions schemas before implementing the integration.
- Built the React/Vite mission control and procedural Three.js scenes, including actual sample-based telemetry.
- Created the local physics graph with source references and connected concepts.
- Wrote the Python backend, four simulation models and optional Ollama tool adapter.
- Added browser journeys and Docker packaging; generated an original Aether avatar.
- Used browser screenshots to catch an ascent visualization scale problem and corrected it without changing the physical simulation.

The offline planner is rule-based and visibly labelled. Live model responses are not fabricated as test evidence. Test commands and current limitations are documented in the README and submission checklist.
