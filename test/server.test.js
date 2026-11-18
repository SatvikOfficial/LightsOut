'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { createGame, CLASSES } = require('../server.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function boot(config = {}, options = {}) {
  const game = createGame({ config, seed: 424242, ...options });
  const port = await game.listen(0);
  return { game, port, url: `ws://127.0.0.1:${port}`, http: `http://127.0.0.1:${port}` };
}

function track(ws) {
  const queue = [];
  const waiters = [];
  ws.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    const index = waiters.findIndex((waiter) => waiter.pred(message));
    if (index >= 0) {
      const waiter = waiters.splice(index, 1)[0];
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else queue.push(message);
  });
  return {
    next(pred, timeout = 3000) {
      const index = queue.findIndex(pred);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { pred, resolve };
        waiter.timer = setTimeout(() => {
          const at = waiters.indexOf(waiter);
          if (at >= 0) waiters.splice(at, 1);
          reject(new Error('timed out waiting for a server message'));
        }, timeout);
        waiters.push(waiter);
      });
    },
    drain() { queue.length = 0; },
  };
}

async function join(url, { name = 'Tester', cls = 'monk' } = {}) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const tracker = track(ws);
  ws.send(JSON.stringify({ t: 'join', name, cls }));
  const welcome = await tracker.next((m) => m.t === 'welcome');
  return { ws, tracker, welcome };
}

function closed(ws, timeout = 4000) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve({ code: null });
    const timer = setTimeout(() => reject(new Error('socket did not close')), timeout);
    ws.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

const own = (m, id) => (m.t === 'state' ? m.p.find((p) => p.i === id) : null);

test('a client survives at least three heartbeat intervals with the same player id', async () => {
  const { game, url } = await boot({ NET: { HEARTBEAT_INTERVAL_MS: 70 } });
  try {
    const { ws, tracker, welcome } = await join(url);
    await sleep(320);
    assert.equal(ws.readyState, WebSocket.OPEN);
    const state = await tracker.next((m) => own(m, welcome.id));
    assert.equal(own(state, welcome.id).i, welcome.id);
    assert.equal(own(state, welcome.id).al, 1);
    ws.close();
  } finally {
    await game.stop();
  }
});

test('flooding state messages cannot exceed class speed × elapsed time', async () => {
  const { game, url } = await boot({
    BOT_TARGET_HUMANS: 0,
    NET: { MESSAGE_RATE_LIMIT: 100000, RATE_VIOLATION_MULTIPLIER: 1000 },
  });
  try {
    const { ws, tracker, welcome } = await join(url, { cls: 'monk' });
    const first = await tracker.next((m) => own(m, welcome.id));
    const start = own(first, welcome.id);
    const startedAt = Date.now();
    let x = start.x;
    for (let i = 0; i < 500; i++) {
      x += 5;
      ws.send(JSON.stringify({ t: 'state', x, z: start.z, d: 0, r: false }));
      await sleep(1);
    }
    const correction = await tracker.next((m) => m.t === 'correct', 3000);
    assert.ok(Number.isFinite(correction.x) && Number.isFinite(correction.z));
    await sleep(120);
    tracker.drain();
    const last = await tracker.next((m) => own(m, welcome.id));
    const end = own(last, welcome.id);
    const elapsed = (Date.now() - startedAt) / 1000;
    const displacement = Math.hypot(end.x - start.x, end.z - start.z);
    const budget = 3.8 * elapsed * 1.35 + 3; // monk speed × run cap + tolerance
    assert.ok(displacement <= budget, `displacement ${displacement.toFixed(2)}m exceeded ${budget.toFixed(2)}m`);
    ws.close();
  } finally {
    await game.stop();
  }
});

test('sustained message flooding disconnects the socket with 1008', async () => {
  const { game, url } = await boot();
  try {
    const { ws } = await join(url);
    const close = closed(ws);
    for (let i = 0; i < 400; i++) ws.send(JSON.stringify({ t: 'state', x: 0, z: 0, d: 0, r: false }));
    const { code } = await close;
    assert.equal(code, 1008);
  } finally {
    await game.stop();
  }
});

test('a socket that never joins is closed after the join timeout', async () => {
  const { game, url } = await boot({ NET: { JOIN_TIMEOUT_MS: 120 } });
  try {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const { code } = await closed(ws);
    assert.equal(code, 1008);
  } finally {
    await game.stop();
  }
});

test('per-IP connection cap rejects the extra socket', async () => {
  const { game, url } = await boot({ NET: { MAX_CONNECTIONS_PER_IP: 1 } });
  try {
    const first = new WebSocket(url);
    await new Promise((resolve, reject) => { first.once('open', resolve); first.once('error', reject); });
    const second = new WebSocket(url);
    const { code } = await closed(second);
    assert.equal(code, 1008);
    first.close();
  } finally {
    await game.stop();
  }
});

test('an oversize payload closes the socket with 1009', async () => {
  const { game, url } = await boot();
  try {
    const { ws } = await join(url);
    const close = closed(ws);
    ws.send('x'.repeat(4096));
    const { code } = await close;
    assert.equal(code, 1009);
  } finally {
    await game.stop();
  }
});

test('malformed JSON is dropped without harming the session', async () => {
  const { game, url } = await boot();
  try {
    const { ws, tracker, welcome } = await join(url);
    ws.send('{not json');
    await sleep(100);
    assert.equal(ws.readyState, WebSocket.OPEN);
    ws.send(JSON.stringify({ t: 'state', x: 0, z: 0, d: 0, r: false }));
    const state = await tracker.next((m) => own(m, welcome.id));
    assert.equal(own(state, welcome.id).al, 1);
    ws.close();
  } finally {
    await game.stop();
  }
});

test('the origin allowlist rejects a hostile origin', async () => {
  const { game, url } = await boot({ NET: { ORIGINS: ['https://good.example'] } });
  try {
    const bad = new WebSocket(url, { origin: 'https://evil.example' });
    const result = await new Promise((resolve) => {
      bad.on('unexpected-response', (req, res) => { res.resume(); resolve({ status: res.statusCode }); });
      bad.on('error', (error) => resolve({ error: error.message }));
      setTimeout(() => resolve({ timeout: true }), 2000);
    });
    assert.ok(result.status === 403 || result.error, `unexpected origin result: ${JSON.stringify(result)}`);
    const good = new WebSocket(url, { origin: 'https://good.example' });
    await new Promise((resolve, reject) => { good.once('open', resolve); good.once('error', reject); });
    good.close();
  } finally {
    await game.stop();
  }
});

test('an AFK human is told and removed after the configured idle window', async () => {
  const { game, url } = await boot({ BOT_TARGET_HUMANS: 0, BOT_MAX: 0, NET: { AFK_TIMEOUT_MS: 150 } });
  try {
    const { ws, tracker } = await join(url, { name: 'Stillness' });
    const afk = await tracker.next((m) => m.t === 'afk', 3000);
    assert.equal(afk.t, 'afk');
    await closed(ws);
    await sleep(50); // the server removes the player from its own close callback
    assert.equal([...game.players].filter((p) => !p.isBot).length, 0);
  } finally {
    await game.stop();
  }
});

test('names are sanitized and duplicates are suffixed', async () => {
  const { game, url } = await boot();
  try {
    const first = await join(url, { name: '<svg onload=1>' });
    const second = await join(url, { name: '<svg onload=1>' });
    await sleep(120);
    const state = await first.tracker.next((m) => m.t === 'state' && m.p.length >= 2);
    const names = state.p.map((p) => p.n);
    assert.ok(names.includes('svg onload=1'));
    assert.ok(names.includes('svg onload=1-2'), `duplicate suffix missing: ${names.join(', ')}`);
    first.ws.close(); second.ws.close();
  } finally {
    await game.stop();
  }
});

test('debug messages are ignored unless the server enables the flag', async () => {
  const off = await boot({ BOT_TARGET_HUMANS: 0, AMBER_PICKUP_R: -1 });
  try {
    const { ws, tracker, welcome } = await join(off.url, { name: 'dbgHax' });
    ws.send(JSON.stringify({ t: 'debug', op: 'amber', v: 999 }));
    await sleep(120);
    const state = await tracker.next((m) => own(m, welcome.id));
    assert.equal(own(state, welcome.id).a, 0);
    assert.ok(state.f.some((line) => line.m.includes('dbgHax')), 'dbg names must not be feed-muted');
    ws.close();
  } finally {
    await off.game.stop();
  }

  const on = await boot({ BOT_TARGET_HUMANS: 0, AMBER_PICKUP_R: -1 }, { debug: true });
  try {
    const { ws, tracker, welcome } = await join(on.url, { name: 'dbgHax' });
    ws.send(JSON.stringify({ t: 'debug', op: 'amber', v: 7 }));
    await sleep(120);
    const state = await tracker.next((m) => own(m, welcome.id));
    assert.equal(own(state, welcome.id).a, 7);
    ws.close();
  } finally {
    await on.game.stop();
  }
});

test('health, status, security headers, MIME, and /classes.json caching are present', async () => {
  const { game, http } = await boot();
  try {
    const health = await fetch(http + '/healthz');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
    assert.match(health.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(health.headers.get('referrer-policy'), 'no-referrer');

    const status = await fetch(http + '/status');
    const body = await status.json();
    assert.equal(typeof body.players, 'number');
    assert.equal(typeof body.bossesAwake, 'number');
    assert.equal(typeof body.tickP95, 'number');

    const config = await fetch(http + '/classes.json');
    assert.equal(config.status, 200);
    assert.equal(config.headers.get('cache-control'), 'no-cache');
    const etag = config.headers.get('etag');
    assert.ok(etag);
    const cached = await fetch(http + '/classes.json', { headers: { 'If-None-Match': etag } });
    assert.equal(cached.status, 304);

    const markdown = await fetch(http + '/assets/ASSET_SOURCES.md');
    assert.equal(markdown.status, 200);
    assert.match(markdown.headers.get('content-type'), /text\/markdown/);
  } finally {
    await game.stop();
  }
});

// ---------------------------------------------------------------------
// Combat rules exercised against the real closure, no sockets required.
// ---------------------------------------------------------------------
function headlessGame() {
  const game = createGame({
    seed: 99,
    config: { TICK_MS: 600000, BOT_TARGET_HUMANS: 0, MEMORIES: { COUNT: 1 } },
  });
  game.config.TICK_MS = 50;
  return game;
}
function addPlayer(game, name, cls, x, z, extra = {}) {
  const player = game._internals.makePlayer(name, cls, null, extra.isBot === true);
  player.x = x; player.z = z; player.lx = x; player.lz = z;
  Object.assign(player, extra);
  game.players.add(player);
  return player;
}

test('melee kills only when the attacker is dark', async () => {
  const game = headlessGame();
  try {
    const attacker = addPlayer(game, 'Lit', 'barb', 0, 0, { fuel: 100 });
    const victim = addPlayer(game, 'Victim', 'barb', 1, 0, { fuel: 100 });
    assert.equal(game._internals.resolveAttack(attacker, { tgt: 'p', id: victim.id }, Date.now()), false);
    assert.equal(victim.alive, true);

    attacker.fuel = 0;
    attacker.attackReadyAt = 0;
    const now = Date.now();
    assert.equal(game._internals.resolveAttack(attacker, { tgt: 'p', id: victim.id }, now), true);
    assert.equal(victim.alive, false);
    assert.ok(attacker.attackReadyAt >= now + 1000, 'cooldowns are epochs in milliseconds');
  } finally {
    await game.stop();
  }
});

test('lit ranged shots deal no player damage; dark shots kill', async () => {
  const game = headlessGame();
  try {
    const archer = addPlayer(game, 'Fenna', 'arch', 0, 0, { fuel: 100 });
    const litVictim = addPlayer(game, 'LitTarget', 'barb', 10, 0, { fuel: 100 });
    assert.equal(game._internals.resolveAttack(archer, { tgt: 'p', id: litVictim.id }, Date.now()), true);
    for (let i = 0; i < 12; i++) game._internals.tick();
    assert.equal(litVictim.alive, true, 'a lit shot must not kill a player');

    const darkVictim = addPlayer(game, 'DarkTarget', 'barb', 0, 10, { fuel: 100 });
    archer.fuel = 0;
    archer.attackReadyAt = 0;
    assert.equal(game._internals.resolveAttack(archer, { tgt: 'p', id: darkVictim.id }, Date.now()), true);
    for (let i = 0; i < 12; i++) game._internals.tick();
    assert.equal(darkVictim.alive, false, 'a dark shot must kill');
  } finally {
    await game.stop();
  }
});

test('movement authority matches every CLASSES speed and the run multiplier within 5%', async () => {
  const game = headlessGame();
  try {
    for (const [id, def] of Object.entries(CLASSES)) {
      for (const running of [false, true]) {
        const player = addPlayer(game, `Speed-${id}-${running}`, id, 0, 0, { fuel: 100 });
        const base = Date.now();
        player.moveAt = base;
        const step = def.speed * (running ? game.config.RUN_MULT : 1) * 0.05;
        for (let i = 0; i <= 20; i++) {
          game._internals.applyState(player, { x: step * i, z: 0, d: 0, r: running }, base + i * 50);
        }
        const measured = Math.hypot(player.x, player.z);
        const expected = def.speed * (running ? game.config.RUN_MULT : 1);
        const error = Math.abs(measured - expected) / expected;
        assert.ok(error < 0.05, `${id}${running ? '+run' : ''}: measured ${measured.toFixed(2)}m/s vs ${expected.toFixed(2)} (${(error * 100).toFixed(1)}%)`);
      }
    }
  } finally {
    await game.stop();
  }
});

test('bots resolve kills through the same dark-only attack path', async () => {
  const game = headlessGame();
  try {
    const bot = addPlayer(game, 'Bot', 'knife', 0, 0, { fuel: 100, isBot: true });
    const victim = addPlayer(game, 'Prey', 'barb', 1, 0, { fuel: 100 });
    assert.equal(game._internals.resolveAttack(bot, { tgt: 'p', id: victim.id }, Date.now()), false);
    assert.equal(victim.alive, true);
    bot.fuel = 0;
    bot.attackReadyAt = 0;
    const now = Date.now();
    assert.equal(game._internals.resolveAttack(bot, { tgt: 'p', id: victim.id }, now), true);
    assert.equal(victim.alive, false);
    assert.ok(bot.attackReadyAt >= now + 700);
  } finally {
    await game.stop();
  }
});

test('state messages from dead players are ignored', async () => {
  const game = headlessGame();
  try {
    const player = addPlayer(game, 'Ghost', 'barb', 0, 0, { fuel: 100 });
    player.alive = false;
    game._internals.applyState(player, { x: 50, z: 50, d: 0, r: false }, Date.now());
    assert.equal(player.x, 0);
    assert.equal(player.z, 0);
  } finally {
    await game.stop();
  }
});

test('death always resets the victim streak, with or without a killer', async () => {
  const game = headlessGame();
  try {
    const killer = addPlayer(game, 'Killer', 'barb', 0, 0, { fuel: 0 });
    const victim = addPlayer(game, 'Victim', 'barb', 1, 0, { streak: 9, fuel: 100 });
    game._internals.killPlayer(victim, 'Killer', 'kill', killer);
    assert.equal(victim.streak, 0);
  } finally {
    await game.stop();
  }
});

test('memories are collected per player, not consumed globally', async () => {
  const game = headlessGame();
  try {
    const first = addPlayer(game, 'First', 'barb', 0, 0, { fuel: 100 });
    const second = addPlayer(game, 'Second', 'barb', 0.5, 0, { fuel: 100 });
    game._internals.memories[0].x = 0;
    game._internals.memories[0].z = 0;
    game._internals.tick();
    game._internals.tick();
    assert.equal(first.memories.size, 1);
    assert.equal(second.memories.size, 1);
    assert.equal(game._internals.memories[0].on, true);
  } finally {
    await game.stop();
  }
});

test('an awake boss with no player nearby leashes home and resets', async () => {
  const game = headlessGame();
  try {
    const boss = game.bosses[0];
    boss.st = 'awake';
    boss.hp = 1;
    boss.leashSince = Date.now() - game.config.BOSSES.LEASH_MS - 1;
    game._internals.tick();
    assert.equal(boss.st, 'dormant');
    assert.ok(boss.hp > 1, 'HP should be restored on leash reset');
    assert.ok(Math.hypot(boss.x, boss.z) > 40, 'boss should be back at its cage');
  } finally {
    await game.stop();
  }
});
