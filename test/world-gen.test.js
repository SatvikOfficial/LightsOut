const assert = require('node:assert/strict');
const test = require('node:test');
const world = require('../public/world-gen.js');

test('biomes and decorations are repeatable for the same seed', () => {
  const seed = 913728;
  assert.equal(world.biomeAt(seed, 140, -920).id, world.biomeAt(seed, 140, -920).id);
  assert.deepEqual(world.decorations(seed, -3, 7), world.decorations(seed, -3, 7));
  assert.notEqual(world.hash(seed, 2, 5), world.hash(seed + 1, 2, 5));
});

test('the streamed world contains several distinct biomes', () => {
  const biomes = new Set();
  for (let z = -2048; z <= 2048; z += 128) {
    for (let x = -2048; x <= 2048; x += 128) biomes.add(world.biomeAt(271828, x, z).id);
  }
  assert.ok(biomes.size >= 5, `expected at least five biomes, got ${biomes.size}`);
});

test('procedural obstacles block movement while allowing collision sliding', () => {
  const seed = 8675309;
  let obstacle = null, chunkX = 0, chunkZ = 0;
  for (let cz = -4; cz <= 4 && !obstacle; cz++) {
    for (let cx = -4; cx <= 4 && !obstacle; cx++) {
      obstacle = world.decorations(seed, cx, cz).find((item) => item.type === 'tree' || item.type === 'rock');
      if (obstacle) { chunkX = cx; chunkZ = cz; }
    }
  }
  assert.ok(obstacle, 'expected generated tree or rock');
  const x = chunkX * world.CHUNK_SIZE + obstacle.x;
  const z = chunkZ * world.CHUNK_SIZE + obstacle.z;
  assert.equal(world.isBlocked(seed, x, z, 0.2), true);
  const fromX = x - obstacle.radius - 2;
  const moved = world.resolveMove(seed, fromX, z - 2, x, z + 2, 0.2);
  assert.equal(world.isBlocked(seed, moved.x, moved.z, 0.2), false);
  assert.ok(moved.z > z - 2, 'movement should slide along an obstacle');
});

test('hamlet buildings are deterministic and block player movement', () => {
  const seed = 424242;
  let building = null, chunkX = 0, chunkZ = 0;
  for (let cz = -20; cz <= 20 && !building; cz++) {
    for (let cx = -20; cx <= 20 && !building; cx++) {
      if (world.biomeAt(seed, cx * world.CHUNK_SIZE + 32, cz * world.CHUNK_SIZE + 32).id !== 'hamlet') continue;
      const found = world.decorations(seed, cx, cz).find((item) => item.type === 'building');
      if (found) { building = found; chunkX = cx; chunkZ = cz; }
    }
  }
  assert.ok(building, 'expected a generated hamlet building');
  assert.deepEqual(world.decorations(seed, chunkX, chunkZ).find((item) => item.type === 'building'), building);
  assert.equal(world.isBlocked(
    seed,
    chunkX * world.CHUNK_SIZE + building.x,
    chunkZ * world.CHUNK_SIZE + building.z,
    0.2,
  ), true);
});
