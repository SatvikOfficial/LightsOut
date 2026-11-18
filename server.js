// LIGHTS OUT — authoritative server.
// All gameplay numbers live in CONFIG/CLASSES/BOSSES below and reach the
// client through /classes.json. The module exports createGame() so the
// integration tests can boot an isolated server on an ephemeral port.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { WebSocketServer } = require('ws');
const WORLD = require('./public/world-gen.js');

// =====================================================================
// CONFIG — every balance number in the game lives here.
// =====================================================================
const CONFIG = {
  TICK_MS: 50,
  WORLD_RADIUS: 70,
  MAX_PLAYERS: Number(process.env.MAX_HUMANS) || 12,
  START_FUEL: 100,
  FUEL_DRAIN: 1.5,
  FUEL_DRAIN_PER_RANK: 0.04,
  RUN_MULT: 1.35,               // run speed multiplier (client movement)
  RUN_DRAIN_MULT: 2.1,
  DARK_GRACE_MS: 12000,
  AMBER_FUEL: 34,
  AMBER_COUNT: 28,
  AMBER_PICKUP_R: 2.3,
  AMBER_RESPAWN_MS: 8000,
  BAIT_COST: 10,
  BAIT_LIFE_MS: 15000,
  BAIT_NO_PICKUP_MS: 2000,
  KILL_DROP_AMBER_CHANCE: 0.22,
  KILL_DROP_AMBER_FUEL: 18,
  KILL_FUEL_GAIN: 10,
  SIPHON_RANGE: 6,
  SIPHON_PER_SEC: 4,
  RANK_AMBER_PER: 5,
  RANK_MAX: 10,
  RANK_FUEL_BONUS: 5,
  RANK_RADIUS_BONUS: 0.7,
  RESPAWN_MS: 6000,
  STUN_PULSE_MS: 800,
  STUN_PULSE_R: 7,
  BOT_TARGET_HUMANS: 8,
  BOT_SPAWN_EVERY_MS: 250,
  BOT_MAX: 11,
  BOT_DECIDE_MS: 350,
  BOT_BAITS: true,
  BOT_FUEL_SEEK: 42,
  BOT_SPAWN_RADIUS: 10,
  BOT_RUN_MULT: 1.35,
  BOT_BAIT_CHANCE: 0.03,
  BOT_BAIT_COOLDOWN_MS: 20000,
  BOT_KITE_R: 6,
  BOT_BOLD_SKILL: 12,
  BOT_TARGET_SLACK: 1.2,
  BOSS_MELEE_SLACK: 2.5,
  BOSS_RANGED_SLACK: 4,
  PLAYER_RANGED_SLACK: 2,
  LIGHT_WHIFF_CD_MULT: 0.4,
  ARROW_LIFE_S: 2,
  ARROW_PLAYER_R: 0.9,
  ARROW_PLAYER_R_PER_RANK: 0.08,
  ARROW_BOSS_R: 2.2,
  FOCUS: { AMBER: 1, FUEL: 40 },
  MEMORIES: { COUNT: 10, PICKUP_R: 1.8 },
  SKILL_WEIGHT: { AMBER: 1, KILL: 4, STREAK: 2, DEATH: -2 },
  THREAT_REF: 25,
  BOSSES: {
    RESPAWN_MS: 60000,
    AWAKE_NEAR_R: 7,
    AWAKE_HOLD_MS: 3000,
    CAGE_DIST: 58,
    CAGE_SIZE: 13,
    FRESH_PROTECT_MS: 15000,
    BOSS_DAMAGE_BONUS: 2,
    BOSS_AMBER_BONUS: 2,
    LEASH_RADIUS: 30,
    LEASH_MS: 60000,
  },
  NET: {
    HEARTBEAT_INTERVAL_MS: Number(process.env.HEARTBEAT_MS) || 15000,
    MAX_PAYLOAD_BYTES: 1024,
    STATE_HZ: 20,
    MESSAGE_RATE_LIMIT: 45,
    RATE_WINDOW_MS: 1000,
    RATE_VIOLATION_MULTIPLIER: 3,
    JOIN_TIMEOUT_MS: 5000,
    AFK_TIMEOUT_MS: Number(process.env.AFK_MS) || 60000,
    RESUME_TTL_MS: Number(process.env.RESUME_TTL_MS) || 120000,
    MAX_CONNECTIONS_PER_IP: Number(process.env.MAX_CONNECTIONS_PER_IP) || 3,
    ORIGINS: (process.env.ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    MOVE_SLACK: 0.5,
    MOVE_BUDGET_MAX_MS: 250,
    STATIC_CACHE_BYTES: 32 * 1024 * 1024,
    TICK_SAMPLE_SIZE: 400,
  },
};

// =====================================================================
// THE TWELVE — pick your sin.
// =====================================================================
const CLASSES = {
  barb:   { id:'barb',   name: 'Viktor',  title: 'the Emberborn',     icon: '🪓', model: 'character-orc.glb',      tint: 0xc96b3f, weapon: 'axe',     kind: 'melee',  speed: 5.6, range: 4.6, cd: 1.20, dmg: 100,
            lore: 'Clanfather of the Ashfields, beyond the salt flats. He says he was struck by the last honest lightning the sky ever sent, and it never left. His axe remembers every torch it has ever snuffed.' },
  arch:   { id:'arch',   name: 'Fenna',   title: 'the Ash-Eye',       icon: '🏹', model: 'character-archer.glb',   tint: 0xb08d57, weapon: 'bow',     kind: 'ranged', speed: 4.8, range: 18, cd: 2.20, dmg: 100, proj: 26,
            lore: 'She counts the lights from the ridge like a witch counts teeth. One eye is gone — traded, she claims, to the thing in the well. The other never blinks, and her arrows do not come back empty.' },
  mage:   { id:'mage',   name: 'Mordai',  title: 'the Candle-Sage',   icon: '🔮', model: 'character-c.glb',        tint: 0x8f7fe8, weapon: 'staff',   kind: 'ranged', speed: 4.6, range: 13, cd: 1.40, dmg: 70, proj: 22,
            lore: 'Keeper of the Nine Candle Rites. His flame-darts are short-lived but unending, like the small prayers he says when he is afraid — and he is always a little afraid.' },
  witch:  { id:'witch',  name: 'Whisper', title: 'the Veil-Witch',    icon: '🕯️', model: 'character-a.glb',        tint: 0x6f5fb8, weapon: 'curse',   kind: 'ranged', speed: 4.6, range: 20, cd: 2.80, dmg: 130, proj: 13,
            lore: 'Her curse travels slow as debt and hits like collection. The veil between here and the other side is thin where she walks, and things on the other side are patient.' },
  dig:    { id:'dig',    name: 'Bram',    title: 'the Gravedigger',   icon: '⚰️', model: 'character-keeper.glb',   tint: 0x8a8f7a, weapon: 'shovel',  kind: 'melee',  speed: 4.4, range: 4.2, cd: 1.10, dmg: 100,
            lore: 'Pays for his meals in what he unearths. The rich amber he leaves behind after a kill is not generosity — it is hush money, so the dead keep their mouths shut.' },
  monk:   { id:'monk',   name: 'Lumen',   title: 'the Lamp-Monk',     icon: '🕉️', model: 'character-e.glb',        tint: 0xd8c27a, weapon: 'mace',    kind: 'melee',  speed: 3.8, range: 3.8, cd: 1.00, dmg: 100,
            lore: 'Sister of the Long Wick. She believes every stolen flame is a soul she is escorting. Her mace is slow; her arithmetic is not. The ledger says she keeps more than she takes.' },
  chain:  { id:'chain',  name: 'Korr',    title: 'the Chain-Fist',    icon: '⛓️', model: 'character-g.glb',        tint: 0x9a9aa5, weapon: 'chain',   kind: 'melee',  speed: 4.2, range: 5.6, cd: 1.30, dmg: 90,
            lore: 'The chain is three fathoms and older than him. He grew into it, or it grew into him — the smith who forged it is no longer accounted for in any registry.' },
  knife:  { id:'knife',  name: 'Vessa',   title: 'the Knife-Singer',  icon: '🗡️', model: 'character-female-b.glb', tint: 0x6f8f8f, weapon: 'knife',   kind: 'melee',  speed: 5.8, range: 3.2, cd: 0.80, dmg: 80,
            lore: 'She hums to keep time. When the humming stops, you have perhaps a second. The song is older than her; her teachers are not.' },
  lante:  { id:'lante',  name: 'Torvold', title: 'the Lantern-Keeper',icon: '🏮', model: 'character-i.glb',        tint: 0xc9a04f, weapon: 'lantern', kind: 'melee',  speed: 4.4, range: 5.0, cd: 1.50, dmg: 100, radiusBonus: 0.15,
            lore: 'Last keeper of the streetlights after the city forgot the sun. His lamp swings wide and bright — a mercy to friends, a confession for enemies. The dark hates him personally.' },
  moth:   { id:'moth',   name: 'Nyx',     title: 'the Moth-Dancer',   icon: '🦋', model: 'character-female-d.glb', tint: 0xc9b3e6, weapon: 'dagger',  kind: 'melee',  speed: 6.0, range: 3.4, cd: 0.90, dmg: 75, radiusBonus: 0.20,
            lore: 'Drawn to every flame, loyal to none. She dances at the edge of your light in patterns almost like words. Nobody has read them. Nobody who tried is around to argue.' },
  scythe: { id:'scythe', name: 'Grim',    title: 'the Scythe-Warden', icon: '🌒', model: 'character-k.glb',        tint: 0x7f8f6f, weapon: 'scythe',  kind: 'melee',  speed: 4.0, range: 5.8, cd: 1.60, dmg: 110,
            lore: 'Not death itself — something more tired. He was sent to hold the line while death was away. His swing is unhurried, because he has never once needed to be quick.' },
  drum:   { id:'drum',   name: 'Petra',   title: 'the Ember-Drum',    icon: '🥁', model: 'character-m.glb',        tint: 0xb3574f, weapon: 'drum',    kind: 'melee',  speed: 4.6, range: 4.4, cd: 1.20, dmg: 100,
            lore: 'Her drum speaks in a language the dark half-understands. When it thuds after a kill, the whole street stumbles — even the ones who know better. The dark does not.' },
};
const CLASS_IDS = Object.keys(CLASSES);
const BOT_CLASS_WEIGHTS = { barb: 3, arch: 3, mage: 2, witch: 2, dig: 3, monk: 2, chain: 2, knife: 3, lante: 2, moth: 2, scythe: 2, drum: 2 };

// =====================================================================
// THE THREE
// =====================================================================
const BOSSES = {
  dracula:   { id:'dracula',   name: 'DRACULA, THE UNBURNED',    model: 'character-vampire.glb', scale: 2.6, hp: 260, speed: 4.2, cageAng: 90, drain: 2.2, drainR: 9,
               touchR: 2.4, touchCdMs: 1800, flinchR: 12, flinchFuel: 50, flinchRank: 4, slowMult: 0.55,
               tell: 'His reach drains your flame — break away and come back dark.',
               lore: 'A count who died the night the first match was struck. He did not go out. Patient, elegant — and he HATES your light: standing near one feeds him. His touch in the dark is final.' },
  vargulf:   { id:'vargulf',   name: 'VARGULF, THE HOLLOW HOUND',model: 'character-zombie.glb',  scale: 2.3, hp: 220, speed: 6.5, cageAng: 210,
               windupMs: 700, dashMs: 500, dashSpeed: 17, dashCdMs: 5200, dashRange: 15, dashMin: 6, hitR: 2.4,
               fearFuel: 60, fearRank: 5,
               tell: 'When he crouches, run. The dash kills through any light.',
               lore: 'Bred from the howl that came up out of the sea. It does not hunt the dark — it hunts the LIGHT. Your torch is its dinner bell. When it crouches, run.' },
  lamplight: { id:'lamplight', name: 'THE LAMPLIGHTER',          model: 'character-ghost.glb',   scale: 2.4, hp: 180, speed: 5.0, cageAng: 330,
               holdR: 2.6, holdBreakR: 4, holdBrightFuel: 40, holdBrightMs: 3000, holdDimMs: 1600, holdDelayMs: 600, holdCdMs: 2500,
               tell: 'Bright flames make it flinch. Break the hold before it finishes.',
               lore: 'It walks the streets collecting every light that was ever snuffed, and it is not full yet. When it holds you, it remembers you. Bright flames make it flinch — be bright, be brief, be gone.' },
};

// =====================================================================
// MEMORIES
// =====================================================================
const LORE = [
  { title: 'The Old Street',    text: 'They say the street was lit once, before the match was struck. Now the flame walks, and the street watches it pass the way a town watches a funeral.' },
  { title: 'The First Keeper',  text: 'The first keeper of the lamps did not die. He was carried into his own light, one candle at a time. The street says thank you when it rains.' },
  { title: 'The Counter',       text: 'Beneath the third cage, something counts. It has been counting lights for a very long time, and it has never once been wrong.' },
  { title: 'The Hound\u2019s Ear', text: 'The hound does not howl at the moon. It howls at whatever carries a flame \u2014 and it has been waiting, a long time, to hear yours.' },
  { title: 'The Veil',          text: 'Whisper keeps her veil drawn. She says the other side is not dark. It is only unlit. She knows the difference, and which one is worse.' },
  { title: 'The Last Lightning', text: 'Viktor\u2019s axe was forged in the last honest lightning the sky ever sent. It has never asked to be put down. It remembers.' },
  { title: 'Hush Money',        text: 'The gravedigger pays hush money to the dead. The amber he leaves behind is not a gift. It is a receipt.' },
  { title: 'The Snuffed Light', text: 'They say the Lamplighter\u2019s lantern was once a streetlight. If you find the street where it went out, do not stand still.' },
  { title: 'The Drum',          text: 'Petra\u2019s drum speaks a language the dark half-understands. When the drum sounds, the street stumbles. The dark does not. That is why they are afraid.' },
  { title: 'Guttering',         text: 'When your flame gutters, do not be ashamed. Every walker has been dark. The street does not count how long you stayed.' },
];
const FINAL_TRUTH = 'The street was never dark. It was waiting for someone to carry the last flame far enough to remember why it was lit. You did. The lamps go out one by one — and for the first time, the dark is only dark.';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.txt', '.md']);
const BINARY_ASSETS = new Set(['.glb', '.wasm', '.png']);
const IMPORTMAP = '{"imports":{"three":"/vendor/three.module.js"}}';
const IMPORTMAP_HASH = crypto.createHash('sha256').update(IMPORTMAP).digest('base64');
const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    `script-src 'self' 'sha256-${IMPORTMAP_HASH}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' ws: wss:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

// =====================================================================
// Name handling — every server-derived name passes through here.
// =====================================================================
const NAME_MAX = 14;
const NAME_FALLBACK = 'Wanderer';
function sanitizeName(raw) {
  let value = String(raw == null ? '' : raw);
  value = value.replace(/\p{Cf}/gu, '');                       // format characters
  value = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' '); // controls
  value = value.replace(/[<>&"']/g, ' ');                      // markup metacharacters
  value = value.replace(/\s+/g, ' ').trim();
  if (!value) value = NAME_FALLBACK;
  value = Array.from(value).slice(0, NAME_MAX).join('').trim();
  return value || NAME_FALLBACK;
}
function uniqueName(base, taken) {
  const clean = sanitizeName(base);
  if (!taken.has(clean)) return clean;
  for (let n = 2; n < 100; n++) {
    const suffix = '-' + n;
    const candidate = Array.from(clean).slice(0, NAME_MAX - suffix.length).join('') + suffix;
    if (!taken.has(candidate)) return candidate;
  }
  return Array.from(clean).slice(0, NAME_MAX - 4).join('') + '-999';
}

// One predicate for every kill path. Light is safety, dark is danger.
function canKill(attacker) {
  return !!attacker && attacker.alive && attacker.fuel <= 0;
}

function p95(samples) {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(2);
}

function mergeConfig(base, extra) {
  for (const [key, value] of Object.entries(extra || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)
      && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      mergeConfig(base[key], value);
    } else {
      base[key] = value;
    }
  }
  return base;
}

function acceptEncodings(header = '') {
  return new Map(header.split(',').map((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    const quality = params.find((param) => param.trim().startsWith('q='));
    return [name, quality ? Number(quality.trim().slice(2)) : 1];
  }));
}

// =====================================================================
function createGame(options = {}) {
  const config = mergeConfig(structuredClone(CONFIG), options.config);
  const DEBUG_ENABLED = options.debug === true || process.env.LIGHTS_OUT_DEBUG === '1';
  const WORLD_SEED = Number.isSafeInteger(options.seed) ? options.seed : crypto.randomBytes(4).readUInt32LE(0);

  // ---- world state ----
  const players = new Set();
  const ambers = [];
  const arrows = [];
  const feed = [];
  const resourceZones = new Map();
  const RESOURCE_ZONE_SIZE = 96;
  const MAX_RESOURCE_ZONES = 160;
  const stats = {
    errors: 0, ticks: 0, tickSamples: [], sessions: 0, humanDeaths: 0,
    deathsByCause: {}, humanKills: 0, firstKills: 0, bossKills: 0, memories: 0,
    playMs: 0, playSessions: 0,
  };
  const ipCounts = new Map();
  const resumeTokens = new Map();
  let idSeq = 1;
  let botSeq = 0;
  let nextAmberId = 0;
  let lastBotAt = Date.now();

  for (let i = 0; i < config.AMBER_COUNT; i++) {
    const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * (config.WORLD_RADIUS - 12);
    ambers.push({ i: nextAmberId++, x: Math.cos(a) * r, z: Math.sin(a) * r, on: true, respawnAt: 0, pickupAt: 0 });
  }

  const memories = [];
  {
    const cagePoints = Object.values(BOSSES).map((def) => {
      const a = def.cageAng * Math.PI / 180;
      return { x: Math.cos(a) * config.BOSSES.CAGE_DIST, z: Math.sin(a) * config.BOSSES.CAGE_DIST };
    });
    for (let i = 0; i < config.MEMORIES.COUNT; i++) {
      let x = 0, z = 0, tries = 0;
      do {
        const a = Math.random() * Math.PI * 2, r = 15 + Math.random() * 45;
        x = Math.cos(a) * r; z = Math.sin(a) * r; tries++;
      } while (tries < 40 && (cagePoints.some((c) => Math.hypot(x - c.x, z - c.z) < 16) || Math.hypot(x, z) < 12));
      memories.push({ i, x, z, on: true });
    }
  }

  // ---- cages & bosses ----
  const cages = [];
  const bosses = [];
  for (const [id, def] of Object.entries(BOSSES)) {
    const a = def.cageAng * Math.PI / 180;
    const cx = Math.cos(a) * config.BOSSES.CAGE_DIST, cz = Math.sin(a) * config.BOSSES.CAGE_DIST;
    cages.push({ i: bosses.length, id, x: cx, z: cz, st: 0, awakeT: 0 });
    bosses.push({
      id, cage: cages.length - 1, st: 'dormant', x: cx, z: cz, ang: 0,
      hp: def.hp, hpMax: def.hp, target: null, cd: 0, state: 'move', stateT: 0,
      dashDir: null, holdTarget: null, holdT: 0,
      respawnAt: 0, lastHitBy: null, awakeT: 0, leashSince: 0,
    });
  }

  function nextId() { return idSeq++; }
  function send(ws, message) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(message));
  }
  function pushFeed(message) {
    feed.push(message);
    if (feed.length > 8) feed.shift();
  }
  function rankOf(p) { return Math.min(config.RANK_MAX, Math.floor(p.amber / config.RANK_AMBER_PER)); }
  function maxFuel(p) { return config.START_FUEL + rankOf(p) * config.RANK_FUEL_BONUS; }
  function fuelRadius(p) {
    if (p.fuel <= 0) return 0;
    const c = CLASSES[p.cls];
    return 7 + 8 * Math.min(1, p.fuel / config.START_FUEL) + rankOf(p) * config.RANK_RADIUS_BONUS
      + (c.radiusBonus ? 8 * c.radiusBonus * Math.min(1, p.fuel / 40) : 0);
  }
  function skill(p) {
    const w = config.SKILL_WEIGHT;
    return Math.max(0, p.amber * w.AMBER + p.kills * w.KILL + p.streak * w.STREAK + p.deaths * w.DEATH);
  }
  function lobbyThreat() {
    let t = 0, n = 0;
    for (const p of players) { if (p.alive) { t += skill(p); n++; } }
    return n ? t / n : 0;
  }
  function threatMult() { return 0.7 + 0.6 * Math.min(1, lobbyThreat() / config.THREAT_REF); }

  function resetBoss(b) {
    const c = cages[b.cage];
    b.st = 'dormant'; b.x = c.x; b.z = c.z;
    b.hp = b.hpMax = Math.round(BOSSES[b.id].hp * threatMult());
    b.state = 'move'; b.stateT = 0; b.target = null; b.cd = 0; b.awakeT = 0;
    b.holdTarget = null; b.lastHitBy = null; b.leashSince = 0;
    c.st = 0; c.awakeT = 0;
  }
  bosses.forEach(resetBoss);

  function dropBait(p, atX, atZ) {
    let best = null, bd = 1e9;
    for (const a of ambers) {
      if (a.on) continue;
      const d = Math.hypot(atX - a.x, atZ - a.z);
      if (d < bd) { bd = d; best = a; }
    }
    if (!best) best = { i: nextAmberId++, x: 0, z: 0, on: false, respawnAt: 0, pickupAt: 0 };
    p.fuel -= config.BAIT_COST;
    best.x = atX; best.z = atZ;
    best.on = true;
    best.pickupAt = Date.now() + config.BAIT_NO_PICKUP_MS;
    best.respawnAt = Date.now() + config.BAIT_LIFE_MS;
    if (!ambers.includes(best)) ambers.push(best);
  }
  function dropKillAmber(killer, victim) {
    const c = CLASSES[killer.cls];
    const chance = config.KILL_DROP_AMBER_CHANCE * (c.id === 'dig' ? 2.2 : 1);
    if (Math.random() < chance) {
      ambers.push({
        i: nextAmberId++, x: victim.x + (Math.random() - 0.5) * 2, z: victim.z + (Math.random() - 0.5) * 2,
        on: true, respawnAt: Date.now() + 30000, pickupAt: 0, rich: config.KILL_DROP_AMBER_FUEL,
      });
    }
  }
  function dropBounty(b) {
    const c = cages[b.cage];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ambers.push({
        i: nextAmberId++, x: c.x + Math.cos(a) * 4, z: c.z + Math.sin(a) * 4,
        on: true, respawnAt: Date.now() + 45000, pickupAt: Date.now() + 2500, rich: 20,
      });
    }
  }

  function ensureExplorationResources(now) {
    const activeZones = [];
    for (const p of players) {
      if (!p.alive) continue;
      const zx = Math.floor(p.x / RESOURCE_ZONE_SIZE), zz = Math.floor(p.z / RESOURCE_ZONE_SIZE);
      const key = zx + ',' + zz;
      activeZones.push({ zx, zz });
      let zone = resourceZones.get(key);
      if (zone) {
        zone.last = now;
        resourceZones.delete(key);
        resourceZones.set(key, zone);
        continue;
      }
      const ids = new Set();
      for (let i = 0; i < 4; i++) {
        const x = zx * RESOURCE_ZONE_SIZE + 12 + WORLD.random(WORLD_SEED, zx, zz, 200 + i) * (RESOURCE_ZONE_SIZE - 24);
        const z = zz * RESOURCE_ZONE_SIZE + 12 + WORLD.random(WORLD_SEED, zx, zz, 210 + i) * (RESOURCE_ZONE_SIZE - 24);
        const id = nextAmberId++;
        ids.add(id);
        ambers.push({ i: id, x, z, on: true, respawnAt: 0, pickupAt: 0 });
      }
      resourceZones.set(key, { ids, last: now });
    }

    while (resourceZones.size > MAX_RESOURCE_ZONES) {
      let removed = false;
      for (const [key, zone] of resourceZones) {
        const [zx, zz] = key.split(',').map(Number);
        const nearby = activeZones.some((a) => Math.abs(a.zx - zx) <= 2 && Math.abs(a.zz - zz) <= 2);
        if (nearby) continue;
        resourceZones.delete(key);
        for (let i = ambers.length - 1; i >= 0; i--) if (zone.ids.has(ambers[i].i)) ambers.splice(i, 1);
        removed = true;
        break;
      }
      if (!removed) break;
    }
  }

  function makePlayer(name, cls, socket, isBot) {
    const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * config.BOT_SPAWN_RADIUS;
    return {
      id: nextId(), socket: socket || null, isBot: !!isBot, name, cls: CLASSES[cls] ? cls : 'barb', bot: !!isBot,
      x: Math.cos(a) * r, z: Math.sin(a) * r, lx: 0, lz: 0, d: Math.random() * Math.PI * 2,
      fuel: config.START_FUEL, lastFuel: config.START_FUEL, amber: 0, kills: 0, deaths: 0, streak: 0,
      alive: true, darkSince: 0, respawnAt: 0, spawnAt: Date.now(),
      bloodlit: 0, stunUntil: 0, run: false, memories: new Set(),
      lastKiller: null, lastKillCause: '', lastPos: { x: 0, z: 0 },
      attackReadyAt: 0, moveBudget: 1, moveAt: Date.now(), lastActiveAt: Date.now(),
      joinedAt: Date.now(), firstKillAt: 0, resumeToken: null, resumeTimer: null,
      botState: 'roam', botTarget: null, botPrey: null, botNext: 0, botMove: { x: 0, z: 0 },
    };
  }
  const BOT_NAMES = ['Bjorn', 'Kess', 'Mora', 'Ulfe', 'Ragnhild', 'Torvald', 'Skade', 'Eira', 'Sten', 'Wren', 'Halja', 'Osk', 'Yrsa', 'Baldur'];
  function detachHuman(p) {
    if (!p || p.isBot) return;
    p.socket = null;
    players.delete(p);
    const token = p.resumeToken;
    if (!token || !resumeTokens.has(token)) {
      players.delete(p);
      stats.playMs += Date.now() - p.joinedAt;
      stats.playSessions++;
      return;
    }
    clearTimeout(p.resumeTimer);
    p.resumeTimer = setTimeout(() => {
      if (p.socket) return;
      resumeTokens.delete(token);
      players.delete(p);
      stats.playMs += Date.now() - p.joinedAt;
      stats.playSessions++;
    }, config.NET.RESUME_TTL_MS);
    p.resumeTimer.unref?.();
  }
  function spawnBot() {
    let taken = new Set(); for (const p of players) taken.add(p.name);
    let name;
    do {
      name = BOT_NAMES[botSeq % BOT_NAMES.length] + '-' + (Math.floor(botSeq / BOT_NAMES.length) + 1);
      botSeq++;
    } while (taken.has(name) && botSeq < 10000);
    let total = 0; for (const k of CLASS_IDS) total += BOT_CLASS_WEIGHTS[k] || 1;
    let r = Math.random() * total, cls = CLASS_IDS[0];
    for (const k of CLASS_IDS) { r -= BOT_CLASS_WEIGHTS[k] || 1; if (r <= 0) { cls = k; break; } }
    const p = makePlayer(name, cls, null, true);
    p.lx = p.x; p.lz = p.z;
    players.add(p);
  }
  function killPlayer(victim, killerName, cause, killer) {
    victim.lastFuel = victim.fuel;
    victim.alive = false;
    victim.deaths++;
    victim.fuel = 0;
    victim.lastKiller = killerName;
    victim.lastKillCause = cause;
    victim.respawnAt = Date.now() + config.RESPAWN_MS;
    victim.lastPos = { x: victim.x, z: victim.z };
    if (!victim.isBot) {
      stats.humanDeaths++;
      const key = cause || 'unknown';
      stats.deathsByCause[key] = (stats.deathsByCause[key] || 0) + 1;
    }
    // A death always breaks the streak, whoever caused it.
    victim.streak = 0;
    victim.bloodlit = 0;
    if (killer) {
      killer.streak++; killer.kills++;
      killer.bloodlit = Math.max(killer.bloodlit, Date.now() + 12000);
      if (!killer.isBot) {
        stats.humanKills++;
        if (!killer.firstKillAt) { killer.firstKillAt = Date.now(); stats.firstKills++; }
      }
    }
    if (killer && killer.cls === 'drum') {
      const now = Date.now();
      for (const q of players) {
        if (q.alive && q !== victim && q !== killer && Math.hypot(q.x - victim.x, q.z - victim.z) < config.STUN_PULSE_R) {
          q.stunUntil = now + config.STUN_PULSE_MS;
        }
      }
      pushFeed({ t: now, m: '🥁 Petra’s drum thuds — the street stumbles' });
    }
    if (killer) dropKillAmber(killer, victim);
    const verb = cause === 'dracula' ? 'drains' : cause === 'vargulf' ? 'tears' : cause === 'lamplight' ? 'collects' : 'takes';
    pushFeed({ t: Date.now(), m: (killerName || 'THE DARK') + ' ' + verb + ' ' + victim.name });
  }
  function slayBoss(b, killer) {
    b.st = 'dead';
    b.respawnAt = Date.now() + config.BOSSES.RESPAWN_MS;
    const c = cages[b.cage];
    c.st = 0; c.awakeT = 0;
    dropBounty(b);
    if (killer) {
      if (!killer.isBot) stats.bossKills++;
      killer.kills += config.BOSSES.BOSS_DAMAGE_BONUS;
      killer.amber += config.BOSSES.BOSS_AMBER_BONUS;
      killer.streak++;
      killer.bloodlit = Math.max(killer.bloodlit, Date.now() + 15000);
    }
    pushFeed({ t: Date.now(), m: '💀 ' + (killer ? killer.name : 'THE DARK') + ' slays ' + BOSSES[b.id].name + ' — the hoard is loose' });
  }

  // ---- boss AI ----
  function bossCollide(b, nx, nz) {
    return WORLD.resolveMove(WORLD_SEED, b.x, b.z, nx, nz, 1.2);
  }
  function bossUpdate(b, dt, now) {
    const def = BOSSES[b.id];
    if (b.st === 'dead') return;
    if (b.st === 'dormant') {
      let near = false;
      for (const p of players) if (p.alive && Math.hypot(p.x - b.x, p.z - b.z) < config.BOSSES.AWAKE_NEAR_R) near = true;
      if (near) {
        b.awakeT += dt * 1000;
        if (b.awakeT >= config.BOSSES.AWAKE_HOLD_MS) {
          b.st = 'awake';
          // Strength is locked in at wake, not only at reset.
          b.hp = b.hpMax = Math.round(def.hp * threatMult());
          b.leashSince = 0;
          cages[b.cage].st = 1;
          pushFeed({ t: now, m: '⚰ the cage shudders — ' + def.name + ' is loose' });
        }
      } else b.awakeT = Math.max(0, b.awakeT - dt * 2000);
      return;
    }

    // Leash: no living player within range for long enough → back to the cage.
    let nearest = Infinity;
    for (const p of players) {
      if (!p.alive) continue;
      nearest = Math.min(nearest, Math.hypot(p.x - b.x, p.z - b.z));
    }
    if (nearest > config.BOSSES.LEASH_RADIUS) {
      if (!b.leashSince) b.leashSince = now;
      else if (now - b.leashSince >= config.BOSSES.LEASH_MS) {
        resetBoss(b);
        pushFeed({ t: now, m: '⛓ ' + def.name + ' returns to its cage' });
        return;
      }
    } else b.leashSince = 0;

    let best = null, bs = -1;
    for (const p of players) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      const fresh = now - p.spawnAt < config.BOSSES.FRESH_PROTECT_MS;
      let score = -d + (fresh ? -30 : 0);
      if (b.id === 'lamplight') score += p.fuel * 0.15;
      if (b.id === 'dracula' && p.fuel > 40) score += 8;
      if (score > bs) { bs = score; best = p; }
    }
    if (!best) { b.target = null; return; }
    b.target = best;

    const dist = Math.hypot(best.x - b.x, best.z - b.z) || 0.001;
    let dx = (best.x - b.x) / dist, dz = (best.z - b.z) / dist;
    b.ang = Math.atan2(dx, dz);
    b.cd = Math.max(0, b.cd - dt * 1000);
    const speed = def.speed * (0.85 + 0.3 * Math.min(1, lobbyThreat() / config.THREAT_REF));

    if (b.id === 'dracula') {
      let slow = 1;
      for (const p of players) {
        if (!p.alive) continue;
        const d = Math.hypot(p.x - b.x, p.z - b.z);
        if (d < def.drainR && p.fuel > 0) p.fuel = Math.max(0, p.fuel - def.drain * dt * threatMult());
        if (d < def.flinchR && p.fuel > def.flinchFuel && rankOf(p) >= def.flinchRank) slow = def.slowMult;
      }
      b.x = bossCollide(b, b.x + dx * speed * slow * dt, b.z).x;
      b.z = bossCollide(b, b.x, b.z + dz * speed * slow * dt).z;
      if (dist < def.touchR && best.fuel <= 0 && b.cd <= 0) { killPlayer(best, def.name, 'dracula'); b.cd = def.touchCdMs; }
    } else if (b.id === 'vargulf') {
      if (b.state === 'move') {
        const fear = best.fuel > def.fearFuel && rankOf(best) >= def.fearRank;
        if (fear) { const t = b.ang + 0.9 * dt; b.ang = t; dx = Math.sin(t); dz = Math.cos(t); }
        b.x = bossCollide(b, b.x + dx * speed * dt, b.z).x;
        b.z = bossCollide(b, b.x, b.z + dz * speed * dt).z;
        if (dist < def.dashRange && dist > def.dashMin && b.cd <= 0) {
          b.state = 'windup'; b.stateT = def.windupMs; b.cd = def.dashCdMs;
        }
      } else if (b.state === 'windup') {
        b.stateT -= dt * 1000;
        b.ang = Math.atan2((best.x - b.x) / dist, (best.z - b.z) / dist);
        if (b.stateT <= 0) {
          b.state = 'dash'; b.stateT = def.dashMs;
          b.dashDir = { x: (best.x - b.x) / dist, z: (best.z - b.z) / dist };
          pushFeed({ t: now, m: '🐺 VARGULF howls and LOOSES' });
        }
      } else if (b.state === 'dash') {
        b.stateT -= dt * 1000;
        const ds = def.dashSpeed * dt;
        b.x = bossCollide(b, b.x + b.dashDir.x * ds, b.z).x;
        b.z = bossCollide(b, b.x, b.z + b.dashDir.z * ds).z;
        for (const p of players) {
          if (!p.alive) continue;
          if (Math.hypot(p.x - b.x, p.z - b.z) < def.hitR) { killPlayer(p, def.name, 'vargulf'); if (p === best) break; }
        }
        if (b.stateT <= 0) { b.state = 'move'; b.cd = 1200; }
      }
    } else if (b.id === 'lamplight') {
      b.x = bossCollide(b, b.x + dx * speed * dt, b.z).x;
      b.z = bossCollide(b, b.x, b.z + dz * speed * dt).z;
      if (b.state === 'hold') {
        b.holdT -= dt * 1000;
        if (best.fuel > def.holdBrightFuel) b.holdT += dt * 600;
        if (!best.alive || dist > def.holdBreakR) { b.state = 'move'; b.holdTarget = null; }
        else if (b.holdT <= 0) { killPlayer(best, def.name, 'lamplight'); b.state = 'move'; b.holdTarget = null; b.cd = def.holdCdMs; }
      } else if (dist < def.holdR && b.cd <= 0 && best.id !== b.holdTarget) {
        b.holdTarget = best.id;
        b.holdT = best.fuel > def.holdBrightFuel ? def.holdBrightMs : def.holdDimMs;
        b.state = 'hold';
        pushFeed({ t: now, m: '👁 the Lamplighter is holding ' + best.name + '…' });
      }
    }
  }

  // ---- shared attack resolution (humans and bots use this) ----
  function fireArrow(attacker, tx, tz, opts = {}) {
    const c = CLASSES[attacker.cls];
    const dx = tx - attacker.x, dz = tz - attacker.z;
    const dist = Math.hypot(dx, dz) || 1;
    const speed = c.proj || 24;
    arrows.push({
      from: attacker, x: attacker.x, z: attacker.z,
      vx: dx / dist * speed, vz: dz / dist * speed, t: 0,
      boss: !!opts.boss,
      lethalPlayer: !!opts.lethalPlayer,
      bossMult: Number.isFinite(opts.bossMult) ? opts.bossMult : 1,
    });
  }
  function nearestPlayer(attacker, range) {
    let best = null, bestD = range;
    for (const q of players) {
      if (q === attacker || !q.alive) continue;
      const d = Math.hypot(q.x - attacker.x, q.z - attacker.z);
      if (d < bestD) { bestD = d; best = q; }
    }
    return best;
  }
  function damageBoss(b, attacker, amount) {
    b.hp -= amount;
    b.lastHitBy = attacker;
    if (b.hp <= 0) slayBoss(b, attacker);
  }
  // Returns true when the attack consumed its cooldown.
  function resolveAttack(attacker, request, now) {
    if (!attacker || !attacker.alive) return false;
    if (now < attacker.attackReadyAt || attacker.stunUntil > now) return false;
    const c = CLASSES[attacker.cls];
    if (!c) return false;

    if (request.tgt === 'b') {
      const b = bosses[request.id];
      if (!b || b.st !== 'awake') return false;
      const dist = Math.hypot(b.x - attacker.x, b.z - attacker.z);
      if (c.kind === 'melee') {
        if (dist > c.range + config.BOSS_MELEE_SLACK) return false;
        attacker.attackReadyAt = now + c.cd * 1000;
        damageBoss(b, attacker, c.dmg * (canKill(attacker) ? 1 : 0.5));
        return true;
      }
      if (dist > c.range + config.BOSS_RANGED_SLACK) return false;
      attacker.attackReadyAt = now + c.cd * 1000;
      fireArrow(attacker, b.x, b.z, { boss: true, bossMult: canKill(attacker) ? 1 : 0.5 });
      return true;
    }

    if (c.kind === 'melee') {
      const victim = nearestPlayer(attacker, c.range);
      if (!victim) return false;
      if (!canKill(attacker)) {
        // Immediate local feedback for the attacker; the swing still costs tempo.
        attacker.attackReadyAt = now + c.cd * 1000 * config.LIGHT_WHIFF_CD_MULT;
        send(attacker.socket, { t: 'whiff', reason: 'light' });
        pushFeed({ t: now, m: attacker.name + ' swings at ' + victim.name + ' — but in the LIGHT' });
        return false;
      }
      attacker.attackReadyAt = now + c.cd * 1000;
      killPlayer(victim, attacker.name, 'kill', attacker);
      attacker.fuel = Math.min(maxFuel(attacker), attacker.fuel + config.KILL_FUEL_GAIN * (c.id === 'monk' ? 1.5 : 1));
      return true;
    }

    let victim = null;
    if (request.id != null) {
      for (const q of players) {
        if (q.id === request.id && q !== attacker && q.alive) { victim = q; break; }
      }
    }
    if (!victim) victim = nearestPlayer(attacker, Infinity);
    if (!victim) return false;
    const dist = Math.hypot(victim.x - attacker.x, victim.z - attacker.z);
    if (dist > c.range + config.PLAYER_RANGED_SLACK) return false;
    attacker.attackReadyAt = now + c.cd * 1000;
    // A lit ranged attacker fires, but the shot cannot claim a player.
    fireArrow(attacker, victim.x, victim.z, { lethalPlayer: canKill(attacker) });
    return true;
  }

  // ---- movement authority ----
  function applyState(p, message, now) {
    if (!p.alive) return; // dead players cannot author positions
    const nx = Number(message.x), nz = Number(message.z);
    if (!Number.isFinite(nx) || !Number.isFinite(nz)) return;
    if (Math.abs(nx) > 10000000 || Math.abs(nz) > 10000000) return;

    const elapsed = Math.max(0, Math.min(config.NET.MOVE_BUDGET_MAX_MS, now - p.moveAt)) / 1000;
    p.moveAt = now;
    const speed = CLASSES[p.cls].speed * (message.r ? config.RUN_MULT : 1);
    const cap = speed * (config.NET.MOVE_BUDGET_MAX_MS / 1000) + config.NET.MOVE_SLACK;
    p.moveBudget = Math.min(cap, p.moveBudget + speed * elapsed);

    const step = Math.hypot(nx - p.x, nz - p.z);
    let tx = nx, tz = nz;
    let corrected = false;
    if (step > p.moveBudget) {
      const scale = step > 0 ? p.moveBudget / step : 0;
      tx = p.x + (nx - p.x) * scale;
      tz = p.z + (nz - p.z) * scale;
      corrected = true;
    }
    const next = WORLD.resolveMove(WORLD_SEED, p.x, p.z, tx, tz);
    p.moveBudget = Math.max(0, p.moveBudget - Math.hypot(next.x - p.x, next.z - p.z));
    p.x = next.x; p.z = next.z;
    if (Number.isFinite(message.d)) p.d = message.d;
    p.run = !!message.r;
    if (corrected) send(p.socket, { t: 'correct', x: +p.x.toFixed(2), z: +p.z.toFixed(2) });
  }

  // ---- tick ----
  function tick() {
    const dt = config.TICK_MS / 1000;
    const now = Date.now();

    for (const p of players) {
      if (!p.alive) {
        if (now >= p.respawnAt && !p.isBot) {
          p.alive = true; p.fuel = config.START_FUEL; p.spawnAt = now;
          const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * config.BOT_SPAWN_RADIUS;
          p.x = Math.cos(a) * r; p.z = Math.sin(a) * r; p.lx = p.x; p.lz = p.z;
          p.darkSince = 0; p.lastPos = { x: p.x, z: p.z };
          p.moveAt = now; p.moveBudget = 1;
        }
        continue;
      }
      if (!p.isBot && p.socket && now - p.lastActiveAt > config.NET.AFK_TIMEOUT_MS) {
        send(p.socket, { t: 'afk' });
        resumeTokens.delete(p.resumeToken);
        p.resumeToken = null;
        if (p.socket) p.socket.close(4001, 'afk');
        continue;
      }
      p.lastFuel = p.fuel;
      const drain = config.FUEL_DRAIN * (p.run ? config.RUN_DRAIN_MULT : 1)
        * (1 + rankOf(p) * config.FUEL_DRAIN_PER_RANK) * (p.bloodlit > now ? 0.7 : 1);
      p.fuel = Math.max(0, p.fuel - drain * dt);
      if (p.fuel <= 0) {
        if (!p.darkSince) {
          p.darkSince = now;
          if (!p.isBot) pushFeed({ t: now, m: p.name + ' stepped into the dark' });
        } else if (now - p.darkSince > config.DARK_GRACE_MS) {
          killPlayer(p, 'THE DARK', 'dark');
          continue;
        }
      } else if (p.darkSince) p.darkSince = 0;
    }

    ensureExplorationResources(now);

    // siphoning
    for (const p of players) {
      if (!p.alive || p.fuel > 0) continue;
      for (const q of players) {
        if (q === p || !q.alive || q.fuel <= 2) continue;
        if (Math.hypot(q.x - p.x, q.z - p.z) < config.SIPHON_RANGE) {
          const amount = Math.min(q.fuel - 1, config.SIPHON_PER_SEC * dt * (q.fuel > 60 ? 2 : 1));
          q.fuel -= amount; p.fuel += amount * 0.8;
        }
      }
    }

    // amber respawn + pickup
    for (let ai = ambers.length - 1; ai >= 0; ai--) {
      const a = ambers[ai];
      if (!a.on && now >= a.respawnAt) a.on = true;
      if (!a.on || now < (a.pickupAt || 0)) continue;
      let best = null, bestD = config.AMBER_PICKUP_R;
      for (const p of players) {
        if (!p.alive) continue;
        const d = Math.hypot(p.x - a.x, p.z - a.z);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best) {
        const before = rankOf(best);
        best.fuel = Math.min(maxFuel(best), best.fuel + (a.rich || config.AMBER_FUEL));
        const wasRich = !!a.rich; a.rich = 0;
        best.amber++;
        const after = rankOf(best);
        if (after > before) pushFeed({ t: now, m: '✨ ' + best.name + ' ascends to EMBER RANK ' + after });
        else if (wasRich) pushFeed({ t: now, m: '💰 ' + best.name + ' pockets a rich amber' });
        a.on = false;
        a.respawnAt = now + config.AMBER_RESPAWN_MS;
      }
      if (!a.on && !a.rich && a.i >= config.AMBER_COUNT && now - a.respawnAt > 60000) ambers.splice(ai, 1);
    }

    // memories — per-player collections, never consumed for the whole street
    for (const m of memories) {
      if (!m.on) continue;
      let best = null, bestD = config.MEMORIES.PICKUP_R;
      for (const p of players) {
        if (!p.alive || p.isBot || p.memories.has(m.i)) continue;
        const d = Math.hypot(p.x - m.x, p.z - m.z);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best) {
        stats.memories++;
        best.memories.add(m.i);
        send(best.socket, { t: 'memory', i: m.i });
        pushFeed({ t: now, m: '🕮 ' + best.name + ' finds a memory (' + best.memories.size + '/' + config.MEMORIES.COUNT + ')' });
      }
    }

    // arrows / darts / curses
    for (let i = arrows.length - 1; i >= 0; i--) {
      const a = arrows[i];
      a.x += a.vx * dt; a.z += a.vz * dt; a.t += dt;
      let hit = false;
      if (a.lethalPlayer) {
        for (const p of players) {
          if (!p.alive || p === a.from) continue;
          const r = config.ARROW_PLAYER_R + rankOf(p) * config.ARROW_PLAYER_R_PER_RANK;
          if (Math.hypot(p.x - a.x, p.z - a.z) < r) {
            killPlayer(p, a.from.name, 'arrow', a.from);
            hit = true; break;
          }
        }
      }
      if (!hit) {
        for (const b of bosses) {
          if (b.st !== 'awake') continue;
          if (Math.hypot(b.x - a.x, b.z - a.z) < config.ARROW_BOSS_R) {
            damageBoss(b, a.from, CLASSES[a.from.cls].dmg * a.bossMult);
            hit = true; break;
          }
        }
      }
      if (hit || a.t > config.ARROW_LIFE_S) arrows.splice(i, 1);
    }

    for (const b of bosses) bossUpdate(b, dt, now);
    for (const p of players) if (p.isBot) botUpdate(p, dt, now);

    let humans = 0, bots = 0;
    for (const p of players) { if (p.isBot) bots++; else humans++; }
    if (humans + bots < config.BOT_TARGET_HUMANS && bots < config.BOT_MAX && now - lastBotAt > config.BOT_SPAWN_EVERY_MS) {
      lastBotAt = now; spawnBot();
    }
    if (humans + bots > config.BOT_TARGET_HUMANS) {
      for (const p of players) { if (p.isBot && !p.alive) { players.delete(p); break; } }
      if (humans === 0) for (const p of players) { if (p.isBot) { players.delete(p); break; } }
    }

    broadcast(now);
  }

  function broadcast(now) {
    const playerList = [...players];
    const base = {
      t: 'state', now,
      p: playerList.map((p) => ({
        i: p.id, x: +p.x.toFixed(1), z: +p.z.toFixed(1), d: +p.d.toFixed(2),
        f: Math.round(p.fuel), r: rankOf(p), s: p.kills, a: p.amber, st: p.streak,
        al: p.alive ? 1 : 0, n: p.name, c: p.cls, bk: p.bloodlit > now ? 1 : 0,
        sp: p.alive ? 0 : Math.max(0, p.respawnAt - now),
        dn: p.darkSince ? Math.max(0, config.DARK_GRACE_MS - (now - p.darkSince)) : 0,
        lu: p.run ? 1 : 0, su: p.stunUntil > now ? 1 : 0, mc: p.memories.size, mi: [...p.memories],
      })),
      a: ambers.map((x) => ({ i: x.i, x: +x.x.toFixed(1), z: +x.z.toFixed(1), on: x.on ? 1 : 0 })),
      r: arrows.map((x) => ({ x: +x.x.toFixed(1), z: +x.z.toFixed(1) })),
      b: bosses.map((b) => ({
        i: b.cage, x: +b.x.toFixed(1), z: +b.z.toFixed(1), ang: +b.ang.toFixed(2),
        st: b.st, hp: Math.max(0, Math.round(b.hp)), hm: b.hpMax, h: b.state,
        tg: b.target ? b.target.id : 0, lt: b.holdTarget || 0,
      })),
      c: cages.map((c) => ({ i: c.i, x: +c.x.toFixed(1), z: +c.z.toFixed(1), st: c.st })),
      m: memories.map((x) => ({ i: x.i, x: +x.x.toFixed(1), z: +x.z.toFixed(1), on: 1 })),
      f: feed.slice(-6).map((x) => ({ t: x.t, m: x.m })),
      hi: { wr: config.WORLD_RADIUS, dr: config.DARK_GRACE_MS, tf: Math.round(threatMult() * 100) },
    };
    const payload = JSON.stringify(base);
    for (const p of playerList) {
      if (p.socket && p.socket.readyState === 1) p.socket.send(payload);
    }
  }

  // ---- bot AI (same attack/cooldown rules as humans) ----
  function botUpdate(p, dt, now) {
    if (now < p.botNext) { botStep(p, dt); return; }
    p.botNext = now + config.BOT_DECIDE_MS;

    // A bot with amber but no flame spends its rank to survive instead of dying in place.
    if (p.fuel <= 0 && p.amber >= config.FOCUS.AMBER) {
      let nearbyLit = false;
      for (const q of players) {
        if (q !== p && q.alive && q.fuel > 0 && Math.hypot(q.x - p.x, q.z - p.z) < 8) { nearbyLit = true; break; }
      }
      if (!nearbyLit) {
        p.amber -= config.FOCUS.AMBER;
        p.fuel = Math.min(maxFuel(p), config.FOCUS.FUEL);
      }
    }

    let fear = null, fd = 1e9;
    for (const b of bosses) {
      if (b.st !== 'awake') continue;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d < fd) { fd = d; fear = b; }
    }
    const bold = skill(p) > config.BOT_BOLD_SKILL;
    const ranged = CLASSES[p.cls].kind === 'ranged';
    if (fear && fd < 16 && !(bold && ranged && fd > 6)) {
      p.botState = 'flee';
      const a = Math.atan2(p.x - fear.x, p.z - fear.z) + (Math.random() - 0.5) * 0.5;
      p.botMove = { x: p.x + Math.cos(a) * 14, z: p.z + Math.sin(a) * 14 };
      p.botTarget = null;
    } else if (fear && bold && ranged && fd < 16 && fd > 5 && now >= p.attackReadyAt) {
      resolveAttack(p, { tgt: 'b', id: fear.cage }, now);
    }

    if (p.botState !== 'flee') {
      if (p.fuel <= 0) {
        // Dark bots hunt the lit: the same predicate that governs human kills.
        let prey = null, pd = 1e9;
        for (const q of players) {
          if (q === p || !q.alive || q.fuel <= 0) continue;
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          if (d < pd) { pd = d; prey = q; }
        }
        if (prey) {
          p.botState = 'stalk';
          p.botTarget = { x: prey.x, z: prey.z };
          p.botPrey = prey;
        } else p.botState = 'seek';
      } else if (p.fuel < config.BOT_FUEL_SEEK) {
        let best = null, bd = 1e9;
        for (const a of ambers) {
          if (!a.on || now < (a.pickupAt || 0)) continue;
          const d = Math.hypot(a.x - p.x, a.z - p.z);
          if (d < bd) { bd = d; best = a; }
        }
        if (best) { p.botState = 'seek'; p.botTarget = { x: best.x, z: best.z }; }
      }
      if (canKill(p) && p.botState !== 'seek' && p.botState !== 'flee' && now >= p.attackReadyAt) {
        let prey = null, pd = 1e9;
        for (const q of players) {
          if (q === p || !q.alive) continue;
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          if (d < pd) { pd = d; prey = q; }
        }
        if (prey) {
          const c = CLASSES[p.cls];
          const reach = c.range + (c.kind === 'melee' ? config.BOT_TARGET_SLACK : 0);
          if (pd <= reach) {
            p.botState = 'hunt'; p.botTarget = { x: prey.x, z: prey.z }; p.botPrey = prey;
          }
        }
      }
      if (config.BOT_BAITS && p.botState === 'hunt' && p.fuel > 40
        && Math.random() < config.BOT_BAIT_CHANCE && now - (p.botBait || 0) > config.BOT_BAIT_COOLDOWN_MS) {
        p.botBait = now;
        dropBait(p, p.x, p.z);
      }
      if (p.botState === 'roam' || (!p.botTarget && p.botState === 'seek')) {
        const a = Math.random() * Math.PI * 2;
        p.botMove = { x: p.x + Math.cos(a) * 10, z: p.z + Math.sin(a) * 10 };
        p.botState = 'roam';
      }
      const t = p.botTarget;
      if (t) for (const cg of cages) {
        const d = Math.hypot(t.x - cg.x, t.z - cg.z);
        if (d < config.BOSSES.CAGE_SIZE) {
          const a = Math.atan2(t.z - cg.z, t.x - cg.x);
          t.x = cg.x + Math.cos(a) * config.BOSSES.CAGE_SIZE;
          t.z = cg.z + Math.sin(a) * config.BOSSES.CAGE_SIZE;
        }
      }
    }
    botStep(p, dt);
  }
  function botStep(p, dt) {
    const c = CLASSES[p.cls];
    const now = Date.now();
    let tx = p.botMove.x, tz = p.botMove.z;
    if (p.botTarget) { tx = p.botTarget.x; tz = p.botTarget.z; }
    if (p.botState === 'hunt' && p.botPrey && CLASSES[p.cls].kind === 'ranged') {
      const preyD = Math.hypot(p.botPrey.x - p.x, p.botPrey.z - p.z);
      if (preyD < config.BOT_KITE_R) {
        tx = p.x + (p.x - p.botPrey.x) * 2;
        tz = p.z + (p.z - p.botPrey.z) * 2;
      }
    }
    const d = Math.hypot(tx - p.x, tz - p.z);
    if (d > 0.6) {
      const sp = c.speed * (p.botState === 'flee' ? config.BOT_RUN_MULT : 1);
      const next = WORLD.resolveMove(WORLD_SEED, p.x, p.z,
        p.x + (tx - p.x) / d * sp * dt, p.z + (tz - p.z) / d * sp * dt);
      p.x = next.x; p.z = next.z;
      p.d = Math.atan2(tx - p.x, tz - p.z);
    }
    if (p.botState === 'hunt' && p.botPrey && p.botPrey.alive && canKill(p) && now >= p.attackReadyAt) {
      if (resolveAttack(p, { tgt: 'p', id: p.botPrey.id }, now)) {
        p.botState = 'roam'; p.botPrey = null;
      }
    }
    p.lx = p.x; p.lz = p.z;
  }

  // ---- static file serving (byte-bounded cache) ----
  const staticFiles = new Map();
  let staticBytes = 0;
  function cacheEntry(fp, entry) {
    const existing = staticFiles.get(fp);
    if (existing) { staticFiles.delete(fp); staticBytes -= existing.data.length; }
    staticFiles.set(fp, entry);
    staticBytes += entry.data.length;
    while (staticBytes > config.NET.STATIC_CACHE_BYTES && staticFiles.size > 1) {
      const [key, value] = staticFiles.entries().next().value;
      staticFiles.delete(key);
      staticBytes -= value.data.length;
    }
  }
  function compressFile(entry, encoding) {
    if (!entry.compressed.has(encoding)) {
      entry.compressed.set(encoding, new Promise((resolve, reject) => {
        const compress = encoding === 'br' ? zlib.brotliCompress : zlib.gzip;
        compress(entry.data, (error, result) => (error ? reject(error) : resolve(result)));
      }));
    }
    return entry.compressed.get(encoding);
  }
  function sendStatic(req, res, fp, versioned) {
    const ext = path.extname(fp);
    const serve = (entry) => {
      const etag = entry.etag;
      const cacheControl = versioned && BINARY_ASSETS.has(ext)
        ? 'public, max-age=31536000, immutable'
        : BINARY_ASSETS.has(ext) ? 'public, max-age=0, must-revalidate'
          : ['.js', '.mjs', '.css'].includes(ext) ? 'public, max-age=300' : 'no-cache';
      const headers = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': cacheControl,
        ETag: etag,
        'Last-Modified': entry.mtime.toUTCString(),
      };
      if (COMPRESSIBLE.has(ext)) headers.Vary = 'Accept-Encoding';
      if (req.headers['if-none-match']?.split(',').map((tag) => tag.trim()).includes(etag)) {
        res.writeHead(304, headers);
        return res.end();
      }
      const accepted = acceptEncodings(req.headers['accept-encoding']);
      const encoding = COMPRESSIBLE.has(ext) && accepted.get('br') > 0
        ? 'br'
        : COMPRESSIBLE.has(ext) && accepted.get('gzip') > 0 ? 'gzip' : null;
      const write = (data) => {
        if (encoding) {
          headers['Content-Encoding'] = encoding;
          headers['Content-Length'] = data.length;
        } else headers['Content-Length'] = entry.data.length;
        res.writeHead(200, headers);
        res.end(req.method === 'HEAD' ? undefined : data);
      };
      if (!encoding) return write(entry.data);
      compressFile(entry, encoding).then(write).catch((error) => {
        console.error(`Unable to compress static asset: ${fp}`, error);
        if (!res.headersSent) res.writeHead(500);
        res.end('asset compression failed');
      });
    };

    fs.stat(fp, (statError, currentStat) => {
      if (statError || !currentStat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('not found');
      }
      let entry = staticFiles.get(fp);
      if (entry && entry.mtimeMs === currentStat.mtimeMs && entry.size === currentStat.size) {
        staticFiles.delete(fp); staticFiles.set(fp, entry);
        return serve(entry);
      }
      fs.readFile(fp, (readError, data) => {
        if (readError) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('not found');
        }
        entry = {
          mtimeMs: currentStat.mtimeMs,
          mtime: currentStat.mtime,
          size: currentStat.size,
          data,
          etag: `W/"${crypto.createHash('sha1').update(data).digest('hex')}"`,
          compressed: new Map(),
        };
        cacheEntry(fp, entry);
        serve(entry);
      });
    });
  }

  function publicConfig() {
    const pub = (o, keys) => Object.fromEntries(
      Object.entries(o).map(([k, v]) => [k, Object.fromEntries(keys.map((kk) => [kk, v[kk]]))]),
    );
    return {
      classes: CLASSES,
      classIds: CLASS_IDS,
      bosses: pub(BOSSES, ['id', 'name', 'model', 'scale', 'lore', 'tell', 'cageAng']),
      lore: LORE,
      finalTruth: FINAL_TRUTH,
      focus: config.FOCUS,
      worldSeed: WORLD_SEED,
      config: {
        wr: config.WORLD_RADIUS, dr: config.DARK_GRACE_MS, tf: config.THREAT_REF,
        cageDist: config.BOSSES.CAGE_DIST, drain: config.FUEL_DRAIN,
        rankDrain: config.FUEL_DRAIN_PER_RANK, runDrain: config.RUN_DRAIN_MULT,
        run: config.RUN_MULT, stateHz: config.NET.STATE_HZ,
        fallbackSpeed: CLASSES.barb.speed, moveSlack: config.NET.MOVE_SLACK,
      },
    };
  }

  const httpServer = http.createServer((req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Invalid request path'); }

    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, uptime: Math.round(process.uptime()) }));
    }
    if (url.pathname === '/status') {
      let humans = 0;
      for (const p of players) if (!p.isBot) humans++;
      const body = JSON.stringify({
        ok: true,
        players: humans,
        totalActors: players.size,
        bossesAwake: bosses.filter((b) => b.st === 'awake').length,
        tickP95: p95(stats.tickSamples),
        tickSamples: stats.tickSamples.length,
        errors: stats.errors,
        telemetry: {
          sessions: stats.sessions, humanDeaths: stats.humanDeaths, deathsByCause: stats.deathsByCause,
          humanKills: stats.humanKills, firstKills: stats.firstKills, bossKills: stats.bossKills,
          memories: stats.memories,
          avgSessionSeconds: stats.playSessions ? Math.round(stats.playMs / stats.playSessions / 1000) : 0,
        },
        uptime: Math.round(process.uptime()),
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(body);
    }
    if (url.pathname === '/classes.json') {
      const body = JSON.stringify(publicConfig());
      const etag = `W/"${crypto.createHash('sha1').update(body).digest('hex')}"`;
      const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
        ETag: etag,
        Vary: 'Accept-Encoding',
      };
      if (req.headers['if-none-match']?.split(',').map((tag) => tag.trim()).includes(etag)) {
        res.writeHead(304, headers);
        return res.end();
      }
      res.writeHead(200, headers);
      return res.end(req.method === 'HEAD' ? undefined : body);
    }

    let pathname;
    try { pathname = decodeURIComponent(url.pathname); }
    catch { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Invalid request path'); }
    let p = pathname === '/' ? '/index.html' : pathname;
    p = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
    const fp = path.join(__dirname, 'public', p);
    if (!fp.startsWith(path.join(__dirname, 'public'))) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('forbidden');
    }
    sendStatic(req, res, fp, url.searchParams.has('v'));
  });

  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: config.NET.MAX_PAYLOAD_BYTES,
    verifyClient: (info, callback) => {
      const allowed = config.NET.ORIGINS;
      if (allowed.length && (!info.origin || !allowed.includes(info.origin))) {
        return callback(false, 403, 'origin not allowed');
      }
      callback(true);
    },
  });

  const intervals = [];
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* socket already closing */ }
    }
  }, config.NET.HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();
  intervals.push(heartbeat);

  const bossRespawn = setInterval(() => {
    try {
      for (const b of bosses) if (b.st === 'dead' && Date.now() >= b.respawnAt) resetBoss(b);
    } catch (error) { stats.errors++; console.error('boss respawn failed', error); }
  }, 1000);
  bossRespawn.unref?.();
  intervals.push(bossRespawn);

  const tickTimer = setInterval(() => {
    const t0 = performance.now();
    try { tick(); } catch (error) { stats.errors++; console.error('tick failed', error); }
    stats.ticks++;
    stats.tickSamples.push(performance.now() - t0);
    if (stats.tickSamples.length > config.NET.TICK_SAMPLE_SIZE) stats.tickSamples.shift();
  }, config.TICK_MS);
  tickTimer.unref?.();
  intervals.push(tickTimer);

  // ---- connection handling ----
  function connectionCount() { return wss.clients.size; }

  function rateLimited(ws) {
    const now = Date.now();
    if (now - ws.rateWindowAt > config.NET.RATE_WINDOW_MS) {
      ws.rateWindowAt = now;
      ws.rateCount = 0;
    }
    ws.rateCount++;
    if (ws.rateCount > config.NET.MESSAGE_RATE_LIMIT * config.NET.RATE_VIOLATION_MULTIPLIER) {
      ws.close(1008, 'rate limit');
      return true;
    }
    return false;
  }

  function handleJoin(ws, message) {
    if (ws.player) return;
    if (connectionCount() > config.MAX_PLAYERS + config.BOT_MAX) {
      send(ws, { t: 'full' });
      return;
    }
    const token = typeof message.token === 'string' && message.token.length <= 128 ? message.token : '';
    const returning = token ? resumeTokens.get(token) : null;
    if (returning && !returning.isBot && !returning.socket) {
      clearTimeout(returning.resumeTimer);
      returning.socket = ws;
      returning.lastActiveAt = Date.now();
      players.add(returning);
      ws.player = returning;
      clearTimeout(ws.joinTimer);
      send(ws, { t: 'welcome', id: returning.id, c: CLASS_IDS, cls: returning.cls, classes: CLASSES, seed: WORLD_SEED, token, resumed: true });
      pushFeed({ t: Date.now(), m: returning.name + ' returns to the street' });
      return;
    }
    if (token) resumeTokens.delete(token);

    let humans = 0;
    for (const p of players) if (!p.isBot) humans++;
    if (humans >= config.MAX_PLAYERS) { send(ws, { t: 'full' }); return; }

    const taken = new Set();
    for (const p of players) taken.add(p.name);
    const name = uniqueName(sanitizeName(message.name), taken);
    const cls = CLASSES[message.cls] ? message.cls : 'barb';
    const p = makePlayer(name, cls, ws, false);
    p.lx = p.x; p.lz = p.z;
    p.resumeToken = crypto.randomBytes(24).toString('base64url');
    resumeTokens.set(p.resumeToken, p);
    stats.sessions++;
    players.add(p);
    ws.player = p;
    clearTimeout(ws.joinTimer);
    send(ws, { t: 'welcome', id: p.id, c: CLASS_IDS, cls, classes: CLASSES, seed: WORLD_SEED, token: p.resumeToken });
    pushFeed({ t: Date.now(), m: name + ' lights a torch' });
  }

  function handleMessage(ws, buffer) {
    ws.isAlive = true;
    if (rateLimited(ws)) return;
    let message;
    try { message = JSON.parse(buffer); } catch { return; }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;

    switch (message.t) {
      case 'join':
        handleJoin(ws, message);
        return;
      case 'state': {
        if (typeof message.x !== 'number' || typeof message.z !== 'number') return;
        if (typeof message.d !== 'number' || !Number.isFinite(message.d)) return;
        if (message.r !== undefined && typeof message.r !== 'boolean' && typeof message.r !== 'number') return;
        const p = ws.player;
        if (!p) return;
        if (p.alive && Math.hypot(message.x - p.x, message.z - p.z) > 0.05) p.lastActiveAt = Date.now();
        applyState(p, message, Date.now());
        return;
      }
      case 'attack':
      case 'kill': {
        const p = ws.player;
        if (!p) return;
        if (message.tgt !== undefined && message.tgt !== 'p' && message.tgt !== 'b') return;
        if (message.id !== undefined && message.id !== null && !Number.isInteger(message.id)) return;
        p.lastActiveAt = Date.now();
        resolveAttack(p, { tgt: message.tgt || 'p', id: message.id }, Date.now());
        return;
      }
      case 'bait': {
        const p = ws.player;
        if (!p) return;
        p.lastActiveAt = Date.now();
        if (p.alive && p.fuel >= config.BAIT_COST + 1) dropBait(p, p.x, p.z);
        return;
      }
      case 'focus': {
        const p = ws.player;
        if (!p) return;
        p.lastActiveAt = Date.now();
        if (p.alive && p.amber >= config.FOCUS.AMBER && p.fuel < maxFuel(p)) {
          p.amber -= config.FOCUS.AMBER;
          p.fuel = Math.min(maxFuel(p), p.fuel + config.FOCUS.FUEL);
        }
        return;
      }
      case 'debug': {
        if (!DEBUG_ENABLED) return;
        const p = ws.player;
        if (!p) return;
        if (message.op === 'fuel' && Number.isFinite(Number(message.v))) p.fuel = Number(message.v);
        if (message.op === 'amber' && Number.isFinite(Number(message.v))) p.amber = Number(message.v);
        return;
      }
      default:
        return; // unknown message types are dropped
    }
  }

  wss.on('connection', (ws, req) => {
    const ip = (req && req.socket && req.socket.remoteAddress) || 'unknown';
    const count = ipCounts.get(ip) || 0;
    if (count >= config.NET.MAX_CONNECTIONS_PER_IP) {
      ws.close(1008, 'too many connections');
      return;
    }
    ipCounts.set(ip, count + 1);
    ws.isAlive = true;
    ws.rateWindowAt = Date.now();
    ws.rateCount = 0;
    ws.joinTimer = setTimeout(() => {
      if (!ws.player) { try { ws.close(1008, 'join timeout'); } catch { /* already closed */ } }
    }, config.NET.JOIN_TIMEOUT_MS);
    ws.joinTimer.unref?.();

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (buffer) => {
      try { handleMessage(ws, buffer); }
      catch (error) { stats.errors++; console.error('message handler failed', error); }
    });
    ws.on('error', (error) => {
      stats.errors++;
      console.error(JSON.stringify({ level: 'error', event: 'ws_error', message: error.message }));
    });
    ws.on('close', (code, reason) => {
      clearTimeout(ws.joinTimer);
      const remaining = (ipCounts.get(ip) || 1) - 1;
      if (remaining > 0) ipCounts.set(ip, remaining); else ipCounts.delete(ip);
      if (ws.player) {
        const p = ws.player;
        ws.player = null;
        if (p.socket === ws) detachHuman(p);
      }
    });
  });

  function listen(port = 0) {
    return new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      httpServer.once('error', onError);
      httpServer.listen(port, () => {
        httpServer.removeListener('error', onError);
        resolve(httpServer.address().port);
      });
    });
  }
  function stop() {
    for (const timer of intervals) clearInterval(timer);
    for (const p of players) clearTimeout(p.resumeTimer);
    for (const ws of wss.clients) { try { ws.terminate(); } catch { /* noop */ } }
    return new Promise((resolve) => {
      wss.close(() => httpServer.close(() => resolve()));
    });
  }

  return {
    httpServer, wss, config, listen, stop, players, bosses,
    _internals: { makePlayer, applyState, resolveAttack, killPlayer, tick, send, memories, arrows, ambers, canKill, fuelRadius },
  };
}

module.exports = { createGame, CONFIG, CLASSES, BOSSES, LORE, sanitizeName, uniqueName, canKill, p95 };

if (require.main === module) {
  const game = createGame();
  const port = Number(process.env.PORT) || 8787;
  game.listen(port).then(() => {
    console.log('LIGHTS OUT running on http://localhost:' + port);
    try {
      const os = require('os');
      const nets = os.networkInterfaces();
      for (const key of Object.keys(nets)) {
        for (const n of nets[key] || []) {
          if (n.family === 'IPv4' && !n.internal) console.log('LAN:  http://' + n.address + ':' + port);
        }
      }
    } catch { /* LAN listing is best-effort */ }
  }).catch((error) => {
    console.error('Unable to start the server.', error);
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    console.error(JSON.stringify({ level: 'fatal', event: 'uncaughtException', message: error.message, stack: error.stack }));
    process.exit(1);
  });
  process.on('unhandledRejection', (error) => {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(JSON.stringify({ level: 'fatal', event: 'unhandledRejection', message, stack }));
    process.exit(1);
  });
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ level: 'info', event: 'shutdown', signal: 'SIGTERM' }));
    game.stop().then(() => process.exit(0)).catch(() => process.exit(1));
    setTimeout(() => process.exit(1), 5000).unref?.();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
