/* Shared deterministic world helpers. Keep this file free of browser APIs so
 * the client and server can derive the same biome layout from one seed. */
(function (root) {
  'use strict';

  const BIOMES = [
    { id: 'forest', name: 'Ashen Forest', ground: 0x33443a, accent: 0x526b4b, canopy: 0x455b3c, fog: 0x17231e },
    { id: 'graveyard', name: 'Forgotten Graveyard', ground: 0x46464a, accent: 0x66636a, canopy: 0x41463e, fog: 0x20202a },
    { id: 'marsh', name: 'Witchlight Mire', ground: 0x344342, accent: 0x536b61, canopy: 0x45584a, fog: 0x16292d },
    { id: 'frost', name: 'Frostfall', ground: 0x53616a, accent: 0x7d9098, canopy: 0x58646e, fog: 0x263444 },
    { id: 'cinder', name: 'Cinder Wastes', ground: 0x514039, accent: 0x785542, canopy: 0x614637, fog: 0x30211c },
    { id: 'hamlet', name: 'The Forgotten Hamlet', ground: 0x48443a, accent: 0x71654b, canopy: 0x596047, fog: 0x28251e },
  ];
  const REGION_SIZE = 256;
  const CHUNK_SIZE = 64;
  const CAGE_DISTANCE = 58;
  const decorationCache = new Map();

  function hash(seed, x, z, salt = 0) {
    let h = (seed ^ Math.imul(x | 0, 0x45d9f3b) ^ Math.imul(z | 0, 0x119de1f3) ^ Math.imul(salt | 0, 0x3449)) | 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return (h ^ (h >>> 16)) >>> 0;
  }

  function random(seed, x, z, salt = 0) {
    return hash(seed, x, z, salt) / 4294967296;
  }

  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  function valueNoise(seed, x, z, scale, salt) {
    const gx = Math.floor(x / scale), gz = Math.floor(z / scale);
    const tx = smooth((x / scale) - gx), tz = smooth((z / scale) - gz);
    const a = random(seed, gx, gz, salt), b = random(seed, gx + 1, gz, salt);
    const c = random(seed, gx, gz + 1, salt), d = random(seed, gx + 1, gz + 1, salt);
    const top = a + (b - a) * tx, bottom = c + (d - c) * tx;
    return top + (bottom - top) * tz;
  }

  function biomeAt(seed, x, z) {
    const cx = Math.floor(x / REGION_SIZE), cz = Math.floor(z / REGION_SIZE);
    let nearest = null, nearestD = Infinity;
    for (let rz = cz - 1; rz <= cz + 1; rz++) {
      for (let rx = cx - 1; rx <= cx + 1; rx++) {
        const px = (rx + 0.18 + random(seed, rx, rz, 11) * 0.64) * REGION_SIZE;
        const pz = (rz + 0.18 + random(seed, rx, rz, 12) * 0.64) * REGION_SIZE;
        const d = (x - px) ** 2 + (z - pz) ** 2;
        if (d < nearestD) {
          nearestD = d;
          nearest = BIOMES[hash(seed, rx, rz, 13) % BIOMES.length];
        }
      }
    }
    return nearest;
  }

  function heightAt(seed, x, z) {
    const broad = valueNoise(seed, x, z, 110, 21) - 0.5;
    const detail = valueNoise(seed, x, z, 28, 22) - 0.5;
    return broad * 1.4 + detail * 0.45;
  }

  function protectedSpot(x, z) {
    if (Math.hypot(x, z) < 16) return true;
    for (const angle of [90, 210, 330]) {
      const a = angle * Math.PI / 180;
      if (Math.hypot(x - Math.cos(a) * CAGE_DISTANCE, z - Math.sin(a) * CAGE_DISTANCE) < 12) return true;
    }
    return false;
  }

  function decorations(seed, cx, cz) {
    const key = seed + ':' + cx + ',' + cz;
    if (decorationCache.has(key)) return decorationCache.get(key);
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
    const biome = biomeAt(seed, x0 + CHUNK_SIZE / 2, z0 + CHUNK_SIZE / 2);
    const treeBiome = ['forest', 'marsh', 'frost', 'cinder', 'hamlet'].includes(biome.id);
    const markerBiome = biome.id === 'graveyard';
    const entries = [];
    for (let i = 0; i < 30; i++) {
      const x = 3 + random(seed, cx, cz, 100 + i) * (CHUNK_SIZE - 6);
      const z = 3 + random(seed, cx, cz, 140 + i) * (CHUNK_SIZE - 6);
      if (protectedSpot(x0 + x, z0 + z)) continue;
      const rot = random(seed, cx, cz, 320 + i) * Math.PI * 2;
      if (biome.id === 'hamlet' && i < 2 && random(seed, cx, cz, 430 + i) > 0.56) {
        const scale = 0.9 + random(seed, cx, cz, 440 + i) * 0.22;
        entries.push({ type: 'building', x, z, scale, rot, radius: 4.25 * scale });
      } else if (i < 14 && treeBiome && random(seed, cx, cz, 180 + i) > (biome.id === 'cinder' ? 0.52 : 0.18)) {
        const scale = 0.75 + random(seed, cx, cz, 220 + i) * 0.75;
        entries.push({ type: 'tree', x, z, scale, rot, radius: 1.15 * scale });
      } else if (markerBiome && i < 19) {
        const scale = 0.8 + random(seed, cx, cz, 280 + i) * 0.3;
        entries.push({ type: 'marker', x, z, scale, rot: random(seed, cx, cz, 320 + i) * 0.7 - 0.35, radius: 0.65 });
      } else if (biome.id === 'hamlet' && i < 10) {
        const scale = 1.6 + random(seed, cx, cz, 340 + i);
        entries.push({ type: 'wall', x, z, scale, rot, radius: scale * 0.55 });
      } else if (i % 2 === 0) {
        const scale = 0.35 + random(seed, cx, cz, 380 + i) * 0.8;
        entries.push({ type: 'rock', x, z, scale, rot: random(seed, cx, cz, 400 + i) * Math.PI, radius: scale * 0.8 });
      }
    }
    decorationCache.set(key, entries);
    if (decorationCache.size > 512) decorationCache.delete(decorationCache.keys().next().value);
    return entries;
  }

  function isBlocked(seed, x, z, radius = 0.55) {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const item of decorations(seed, cx + dx, cz + dz)) {
          if (Math.hypot(x - (cx + dx) * CHUNK_SIZE - item.x, z - (cz + dz) * CHUNK_SIZE - item.z) < item.radius + radius) return true;
        }
      }
    }
    return false;
  }

  function resolveMove(seed, x, z, nextX, nextZ, radius = 0.55) {
    let resultX = x, resultZ = z;
    if (!isBlocked(seed, nextX, z, radius)) resultX = nextX;
    if (!isBlocked(seed, resultX, nextZ, radius)) resultZ = nextZ;
    return { x: resultX, z: resultZ };
  }

  const api = { BIOMES, REGION_SIZE, CHUNK_SIZE, hash, random, biomeAt, heightAt, decorations, isBlocked, resolveMove };
  root.LightsOutWorld = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
