# Decisions

Defaults chosen for the human-decision items in the production brief. Status records what this
working tree actually does; items marked outstanding are not implemented yet.

| # | Decision | Default | Status |
|---|---|---|---|
| 1 | Ranged classes must be dark to kill | Yes | Implemented. `resolveAttack` stores the attacker's `canKill()` result on the projectile; lit shots still damage bosses at the 0.5 lit penalty. Melee, ranged, and bot paths share the predicate. |
| 2 | Session shape | 12-minute Nights with a 60 s warning, Dawn results, 20 s intermission, new seed, retained humans | Outstanding. There is no Night cycle yet; the README still says a restart rolls a new world. |
| 3 | Death penalty | Drop 50% of amber as rich pickups at the death position, decaying after 45 s | Outstanding. Deaths currently cost the respawn timer and a fuel reset; amber and rank persist. |
| 4 | Paid packs / commissioned boss art | Procedural animation layer and per-boss shader treatment | Outstanding. The current stand-in boss sprites remain. |
| 5 | Miregrave AI art for release | Keep with disclosure and credits | Kept. The Miregrave AI disclosure stays with the pack, licenses are mirrored under `public/assets/licenses/`, and the README does not describe the art as non-AI. |
| 6 | `ftmb.txt` provenance / history purge | Remove from the working tree; purge is a human decision | Removed from the working tree without being read. This checkout has no `.git`, so no history purge was possible or attempted. |
| 7 | Hosting target and domain | Not chosen | Outstanding. `ORIGINS` is the allowlist hook; no TLS/reverse-proxy deployment was configured. |
| 8 | Frostfall and Cinder art | Source or budget dedicated art | Outstanding. Those biomes still use generated/procedural obstacles. |

## Additional defaults implemented

- **Debug backdoor:** disabled unless `LIGHTS_OUT_DEBUG=1`.
- **Movement rate:** clients send `state` at the served `config.stateHz` (20 Hz).
- **Movement authority:** a time-based distance budget using class speed and `CONFIG.RUN_MULT`; violations are clamped and answered with `correct`.
- **AFK:** humans idle without movement or actions for `AFK_MS` (60 s default) receive `afk` and are disconnected.
- **Boss leash:** 30 m / 60 s, then the boss returns to its cage and resets HP. HP is also scaled at wake.
- **Memories:** collected per player for the session, not consumed globally.
