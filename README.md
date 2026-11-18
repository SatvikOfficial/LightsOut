# LIGHTS OUT 🔥

A LAN multiplayer torch-survival game for the browser. Your flame is your **eyes** and your **confession**:
it shows you the street, and it shows *you* to everyone else. When your torch dies you have 12 seconds
to find fuel — or the dark takes you. Kills only land in the dark. Amber makes you a bigger lighthouse:
more fuel, wider light, heavier drain, fatter kill-target.

The world is procedurally generated and streamed in chunks around the players. Each server session
shares one seed across all clients, with broad biome regions including Ashen Forest, Forgotten
Graveyard, Witchlight Mire, Frostfall, Cinder Wastes, and the Forgotten Hamlet. Terrain, foliage,
rocks, and landmarks are generated locally from that seed; amber is provisioned as players explore.
Restart the server to roll a new world.

**No build step. No internet needed at play time.** Everything (three.js, loaders, every model)
is vendored locally.

## Run
```
npm install      # once (ws only)
npm start        # node server.js
```
Open the printed URL (LAN links print for friends on the same network). Mobile supported.

## The Twelve — pick your sin
| class | icon | play |
|---|---|---|
| **Viktor, the Emberborn** | 🪓 | fast orc barbarian, wide axe arc |
| **Fenna, the Ash-Eye** | 🏹 | long arrow, slow tempo |
| **Mordai, the Candle-Sage** | 🔮 | short fast flame-darts |
| **Whisper, the Veil-Witch** | 🕯️ | slow heavy curse, long reach |
| **Bram, the Gravedigger** | ⚰️ | kills drop rich amber (2.2×) |
| **Lumen, the Lamp-Monk** | 🕉️ | steals 1.5× fuel on kills |
| **Korr, the Chain-Fist** | ⛓️ | long-reach chain |
| **Vessa, the Knife-Singer** | 🗡️ | fast, quick tempo, close |
| **Torvold, the Lantern-Keeper** | 🏮 | +15% torch radius |
| **Nyx, the Moth-Dancer** | 🦋 | +20% torch radius, fastest |
| **Grim, the Scythe-Warden** | 🌒 | widest arc, slowest swing |
| **Petra, the Ember-Drum** | 🥁 | kills stun nearby players 0.8s |

Full lore is in the lobby. Class stats live **only** in `server.js → CONFIG/CLASSES` and are
served to the client from `/classes.json` (single source of truth — no duplicated balance numbers).

## The Three Cages
Three sides of the street hold three cages. Linger at a cage for 3 seconds and what's inside
gets loose. Boss strength **scales with lobby skill** (70%–130%: amber, kills, streaks, deaths)
so a fresh lobby is never spawn-killed and a veteran lobby is never bored.

- **DRACULA, THE UNBURNED** — he *hates* light: standing near him drains your torch (watch the
  red arcs leaving your flame). Full lighthouses make him flinch. Touch in the dark is final.
- **VARGULF, THE HOLLOW HOUND** — hunts your light. Prowls, crouches (run!), and LOOSES in a dash
  that kills through any flame. Big bright lighthouses make it circle first.
- **THE LAMPLIGHTER** — a ghost collecting snuffed lights. Floats to the richest flame, *holds* you
  (be bright to delay it, be brief to escape). Fights with a lantern that was never yours.

Slay a boss: +2 kills, +2 amber (rank surge), a 6-amber hoard bursts from the cage, Bloodlit 15s.
It returns to its cage after a minute.

## Mechanics
- **Fuel** drains 1.5/s (×2.1 running, +4% per rank — the *lighthouse tax*). Dark = 12s grace.
- **Siphoning**: dark players lean on lit neighbours within 6m and drink their flame (green arcs).
- **Bait** (Q / BAIT): spend 10 fuel to lay a glowing amber lure at your feet — it can't be grabbed
  for 2s (no self-pickup exploit). Drag the greedy into your dark.
- **Amber** = Ember Ranks: 5 amber → +1 rank (max 10, *FULL LIT*). Ranks: +5 max fuel, +0.7 light
  radius, +4% drain, +8% kill-target radius. 3-kill streak → **BLOODLIT** (30% slower drain).
- **Focus** (F / FOC): channel 1 amber straight into +40 fuel (capped). The Hollow-Knight trick —
  your rank is your own emergency flame. Chime included.
- **Memories**: 10 quiet lore fragments drift over the street (pale-blue motes, 🕮 counter top-left).
  Stand in one to collect it; a slow bell plays and the memory opens. Memories are collected
  **per player**: the fragment stays in the street for everyone else, and the server tracks each
  walker's own set for the session. Bots can't carry them. All ten texts live only in
  `server.js → LORE`, served via `/classes.json`.
- **Atmosphere**: fireflies brighten when *you* go dark, a sparse ambient score (drone pad + far
  bells), biome-specific fog and ground cover, and the mask cracks when you die. Separate effects,
  music, and ambience sliders are available in the audio menu.
- **Exploration**: streamed, seeded terrain has no arena boundary. The minimap follows you, the
  biome name changes as you travel, and newly explored regions receive amber caches.
- **Stuns**: Petra's drum pulse stuns everything within 7m for 0.8s.
- **Lobby**: server keeps 8 players; bots fill in and get *real* classes. Bots seek amber, flee the
dark **and the bosses**, ambush confident humans, lay bait, and bold bots (high skill) trade arrows
with awakened bosses.

## Controls
Desktop defaults: WASD move · mouse aim · **SPACE** attack (targets the nearest opponent in the
aimed direction — melee only lands in the dark) · **Q** bait · **F** focus · **LEFT SHIFT** run.
The match uses an orthographic, follow-camera view for top-down play. Open **Settings** to remap
each action, adjust camera zoom and render scale, enable reduced motion, or tune separate effects,
music, and ambience levels. Settings persist in this browser. Mobile: left virtual joystick ·
right-side drag aim · ATK / RUN / BAIT / FOC buttons.

## Server protocol (20 Hz authoritative)
`join {name,cls}` → `welcome {id, classes, seed}` · `state {x,z,d,r}` sent at the served CONFIG rate
(20 Hz) · `attack {tgt:'p'|'b', id}` · `bait` · `focus` (1 amber → +40 fuel) · `state` broadcasts:
players, ambers, arrows, **bosses {st,hp,h,tg,lt}**, **cages {st}**, **memories {i,x,z}**, feed,
`hi.tf` (lobby threat %). `welcome` includes the shared world seed. Collectors get a direct
`memory {i}` message; texts come from `/classes.json → lore`.

Movement is authoritative by **time budget**, not per message: the server accrues
`CLASSES[cls].speed × elapsed × (running ? CONFIG.RUN_MULT : 1)` and clamps any message that spends
more than that, replying with `correct {x,z}` so the client snaps back. `state` from a dead player is
ignored. Kill cooldowns are epoch-ms (`attackReadyAt`) for humans and bots alike.

Names are normalized server-side (format/control characters and `<>&"'` stripped, whitespace
collapsed, 1–14 characters, fallback `Wanderer`, duplicates suffixed). All server-derived text is
rendered with `textContent`; no server value is interpolated into `innerHTML`. The old `dbg` backdoor
is gone from normal play: `debug` messages are ignored unless the process runs with
`LIGHTS_OUT_DEBUG=1`, and `dbg`-prefixed names are ordinary, visible names.

## Tests
Run `npm test` for the checked-in Node test suite. It covers deterministic biome and decoration
generation, biome diversity, procedural-obstacle collision, name sanitizing and duplicate suffixes,
the dark-only kill predicate, melee/ranged/bot kill paths, per-class movement speed and the run
multiplier, death-streak reset, per-player memories, boss leashing, and server integration for
heartbeat/pong survival, movement flooding, rate limiting, oversize payloads, malformed JSON, the
origin allowlist, join timeout, the per-IP cap, AFK removal, debug gating, security headers, MIME
types, and `/classes.json` ETag caching.

## Operations
Environment: `PORT` (default 8787), `ORIGINS` (comma-separated WebSocket origin allowlist; unset
allows same-host development), `LIGHTS_OUT_DEBUG=1` (enables debug messages), `MAX_HUMANS` (12),
`HEARTBEAT_MS` (15000), `AFK_MS` (60000), `MAX_CONNECTIONS_PER_IP` (3).

`GET /healthz` returns liveness, `GET /status` returns connected humans, awake bosses, and rolling
tick p95, and `GET /classes.json` carries an ETag and `no-cache`. The WebSocket server enforces a
1 KiB payload cap, per-type schema validation, a per-socket message budget, a 5 s join timeout, and
an origin allowlist. Responses carry CSP (`script-src 'self'`), `X-Content-Type-Options: nosniff`,
and `Referrer-Policy: no-referrer`. Static files use a byte-bounded cache; binary assets are
`immutable` only when requested with a `?v=` version query, otherwise they revalidate by ETag.
`uncaughtException`/`unhandledRejection` log and exit for a supervisor, and SIGTERM shuts down
gracefully.

## Performance diagnostics
Open `/?perf=1` to show rolling FPS, average draw calls and triangles per rendered frame, shader
count, pixel ratio, and a gameplay scene breakdown. The breakdown estimates visible meshes by
instanced/skinned/mesh/sprite/points kind and lists the six most expensive top-level scene groups.
The same sample is logged to the browser console every two seconds; measure in a match near the
Crossing, a cage, and active pickups for representative results. The lobby is capped at 30 FPS and
uses the same WebGL renderer for the animated roster, without drawing the full world behind it.
Amber pickups and cage bars use instancing, static prop materials are shared, the four nearest
remote torches use a fixed shared light budget, and streamed terrain chunks are built one per frame
to avoid boundary-crossing bursts. Remote walkers and bosses interpolate buffered 20 Hz snapshots
at an 80 ms render delay. Bolt/zap effects use emissive visuals instead of creating and removing
point lights. Static text assets support Brotli/gzip with ETags; large models and textures have
long-lived browser cache headers.

## Art and asset credits
Character art is now rendered as locally bundled top-down directional sprites in the lobby and
match. Viktor uses the animated HD knight sheet; Vessa uses the animated eight-direction assassin.
The other class portraits use the included eight-direction hero/undead poses or four-direction
vampire sheet. Those pose-only packs do not contain walk, attack, or death animations, so they
change facing and use lightweight movement feedback rather than pretending to have authored
animation. Dracula uses the vampire art, Vargulf the bone-crusher, and the Lamplighter the
doll-like undead; these are visual stand-ins, not dedicated canon boss illustrations.

Hamlet, Mire, forest, and Cinder tree placements use the local Miregrave vegetation/building
art. Hamlet buildings are part of the deterministic world decoration data and use matching
server collision radii. Frostfall and Graveyard keep their existing generated/CC0 environment
art until dedicated sprites are available. The downloaded packs and detailed license/source notes
are listed in [`public/assets/ASSET_SOURCES.md`](./public/assets/ASSET_SOURCES.md); retain the
included license files and credits when distributing the game.

Required credit: **elie automata** for the Heroes and Dread Realms demos. The OpenGameArt credits
and CC-BY terms for Vampires Rework and Dark Forest Combat are recorded in the source notes. The
Miregrave pack includes generative-AI-created graphics; its disclosure is retained with the pack.
Do not describe those images as non-AI art.

Other retained art and code:
- Cage props: **Kenney CC0 Graveyard** and other Kenney packs
- Torch: **Lantern.glb** — Khronos Sample Models (CC-BY)
- three.js (MIT), SkeletonUtils, GLTF/DRACO loaders + DRACO decoders — vendored under `public/vendor`

Unreferenced legacy models (including `LittlestTokyo.glb`, `MosquitoInAmber.glb`, `Soldier.glb`,
and the unused damaged/urn cage props) were removed from the working tree. Pack licenses are
mirrored under [`public/assets/licenses/`](./public/assets/licenses/). The raw downloadable packs
are still served from `public/assets/itch/` and `public/assets/opengameart/`; moving them out of
`public/` depends on the derived-atlas pipeline and remains outstanding.

Inspired by: Light No Fire (light = vision = beacon) · Dead by Daylight (kill only in the dark,
hold-to-claim) · Phasmophobia (light as drag and risk) · slither.io / balls.io (always-populated
lobby, growth = power = visibility, constant reward loops).
