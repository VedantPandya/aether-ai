# Three-layer flight verification

Recorded 1 November 2026. This is an actual API-backed flight, not an LLM narration of a precomputed recovery. The reference plant remains an educational planar model; passing these checks does not validate real spacecraft hardware.

## Live run

Command: `python scripts/run_autonomy.py --mode openai --scenario engine-fault --factor 5`

- Translation authority drops by 50% at t=25 s.
- The local force/torque-limited controller maintains a rotating stand-off while models run.
- All 17 reflex results came from the Decisions API (`gpt-6-luna`); observed transport-inclusive latency was 230-1178 ms, median 420.77 ms.
- The Responses reasoning model (`gpt-6.1-sol`) selected a screened slower approach in one request / one model call.
- The latest-state preview accepted that program. Applying it introduced zero position and fuel discontinuity.
- The spacecraft docked at t=241.85 s, satisfying position, relative velocity, attitude and angular-rate thresholds for the capture dwell period.

The sanitized [machine-readable observation](live-engine-fault.json) contains the final state, exact constraints and proposal evidence. It contains no API keys, personal data, local paths or private run identifiers. Timings describe this one run and are not performance guarantees.

An earlier live run timed out after overly cautious classifications repeatedly interrupted a valid approach. The final implementation supplies phase-aware physics forecasts, preserves a verified current controller under classification uncertainty, and presents screened candidates to the strategic model. The result above is the subsequent successful retest.

## Offline repeatable cases

The deterministic `demo` policy uses the same mechanics, faults, screening and supervisor, with explicitly labelled local replacements for model inference:

- Nominal approach captures without strategic calls.
- A 50% engine loss triggers escalation and recovers.
- An obstacle invalidates the direct approach; a screened angular detour captures.
- A 99% fuel leak causes an honest abort with protected propellant remaining.

Tests additionally verify that physics advances during delayed model calls, stale decisions/programs cannot gain authority, fuel/actuator guards veto unsafe choices, and the workspace agent can execute the same runtime and export bounded artifacts. Run `python -m pytest -q`.

For the full interface and scope, see [AUTONOMY.md](../AUTONOMY.md).
