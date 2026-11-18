// LIGHTS OUT — client v2: 12 classes, 3 bosses, light-stealing VFX, atmosphere
import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from './vendor/jsm/loaders/DRACOLoader.js';
import { clone as cloneSkeleton } from './vendor/jsm/utils/SkeletonUtils.js';

const DEFAULT_BINDINGS = {
  up: 'KeyW',
  down: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  attack: 'Space',
  run: 'ShiftLeft',
  bait: 'KeyQ',
  focus: 'KeyF',
};
const SETTINGS_KEY = 'lights-out-settings-v1';
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const bindings = { ...DEFAULT_BINDINGS };
    const audio = { effects: 0.85, music: 0.45, ambience: 0.6 };
    if (saved.bindings && typeof saved.bindings === 'object') {
      for (const action of Object.keys(bindings)) {
        if (typeof saved.bindings[action] === 'string' && saved.bindings[action]) {
          bindings[action] = saved.bindings[action];
        }
      }
    }
    if (saved.audio && typeof saved.audio === 'object') {
      for (const name of Object.keys(audio)) {
        if (Number.isFinite(saved.audio[name])) audio[name] = Math.max(0, Math.min(1, saved.audio[name]));
      }
    }
    return {
      bindings,
      audio,
      cameraZoom: Number.isFinite(saved.cameraZoom) ? Math.max(0.75, Math.min(1.5, saved.cameraZoom)) : 1,
      renderScale: ['low', 'balanced', 'high'].includes(saved.renderScale) ? saved.renderScale : 'balanced',
      reducedMotion: saved.reducedMotion === true,
    };
  } catch (error) {
    console.warn('Unable to read saved game settings; using defaults.', error);
    return {
      bindings: { ...DEFAULT_BINDINGS },
      audio: { effects: 0.85, music: 0.45, ambience: 0.6 },
      cameraZoom: 1,
      renderScale: 'balanced',
      reducedMotion: false,
    };
  }
}
const userSettings = loadSettings();
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(userSettings));
  } catch (error) {
    console.warn('Unable to save game settings.', error);
    const status = document.getElementById('settings-status');
    if (status) status.textContent = 'SETTINGS COULD NOT BE SAVED IN THIS BROWSER';
  }
}

// ============================================================= visual config
const V = {
  PLAYER_H: 1.75, BOSS_H: 4.6,
  EMBER_COLOR: 0xffb040, BOLT: 0xffd080,
  BOSS_COLORS: { dracula: 0xff2244, vargulf: 0xffa020, lamplight: 0x60a0ff },
  FOG_DENSITY: 0.028, MOON: 0x8090c0,
  ZAP_LIFE: 0.38, ZAP_SEGS: 14,
  FOG_PATCHES: 34, EMBERS: 90,
  SHARK: null,
};
const EMBER_RANKS = ['Wick', 'Spark', 'Kindling', 'Cinder', 'Ember', 'Flame', 'Brand', 'Beacon', 'Lighthouse', 'Pyre', 'Noon'];
const WARD_NAMES = {
  forest: 'Ward of Pines',
  graveyard: 'Gravemarch',
  marsh: 'Marrowmere',
  frost: 'the Pale Ward',
  cinder: 'Ember-hold',
  hamlet: 'Lowe',
};
const WARD_RUMORS = {
  forest: 'The pines keep old light.',
  graveyard: 'The dead are waiting to be named.',
  marsh: 'The old lamps still drift.',
  frost: 'One lamp remains uncounted.',
  cinder: 'The glass remembers the fire.',
  hamlet: 'The Street forgot this place.',
};

// ============================================================= audio (all synthesized)
const A = (() => {
  let ctx = null, master = null, buses = null;
  const ensure = () => {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.6; master.connect(ctx.destination);
      buses = {};
      for (const [name, value] of Object.entries(userSettings.audio)) {
        buses[name] = ctx.createGain(); buses[name].gain.value = value; buses[name].connect(master);
      }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  const setMix = (name, value) => {
    if (!Object.hasOwn(userSettings.audio, name) || !Number.isFinite(value)) return;
    const level = Math.max(0, Math.min(1, value));
    userSettings.audio[name] = level;
    if (buses && ctx) buses[name].gain.setTargetAtTime(level, ctx.currentTime, 0.04);
    saveSettings();
  };
  function env(g, t, a, d, v = 1) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.001, t + a + d); }
  function tone(f0, f1, dur, type = 'sine', vol = 0.3, delay = 0) {
    const c = ensure(); const t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = c.createGain(); env(g, t, 0.008, dur, vol);
    o.connect(g); g.connect(buses.effects); o.start(t); o.stop(t + dur + 0.1);
  }
  function noise(dur, vol = 0.3, freq = 800, q = 1, delay = 0, type = 'bandpass') {
    const c = ensure(); const t = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); env(g, t, 0.005, dur, vol);
    s.connect(f); f.connect(g); g.connect(buses.effects); s.start(t); s.stop(t + dur + 0.1);
  }
  return {
    ensure, setMix,
    musicBus() { ensure(); return buses.music; },
    ambienceBus() { ensure(); return buses.ambience; },
    blip() { tone(1200, 500, 0.07, 'sine', 0.15); },
    pickup() { tone(520, 1040, 0.12, 'sine', 0.25); tone(780, 1560, 0.12, 'sine', 0.15, 0.05); },
    rankup() { [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.22, 'triangle', 0.3, i * 0.09)); },
    kill() { tone(200, 60, 0.4, 'sawtooth', 0.35); noise(0.3, 0.4, 300, 1, 0, 'lowpass'); },
    die() { tone(300, 40, 0.9, 'sawtooth', 0.4); noise(0.7, 0.3, 200, 1, 0.1, 'lowpass'); },
    shot() { noise(0.08, 0.35, 1800, 2); tone(600, 200, 0.1, 'square', 0.12); },
    swing() { noise(0.12, 0.3, 900, 1); },
    zap() { noise(0.18, 0.5, 3000, 3); tone(2400, 300, 0.22, 'sawtooth', 0.3); tone(1200, 100, 0.18, 'square', 0.15, 0.02); },
    siphon() { tone(300, 500, 0.3, 'sine', 0.06); },
    heartbeat() { tone(55, 40, 0.12, 'sine', 0.5); tone(50, 35, 0.1, 'sine', 0.35, 0.16); },
    howl() { tone(180, 90, 0.9, 'sawtooth', 0.35); tone(240, 120, 0.9, 'sawtooth', 0.2, 0.05); noise(0.8, 0.15, 500, 2, 0.1); },
    rumble() { noise(1.4, 0.5, 90, 1, 0, 'lowpass'); tone(60, 30, 1.4, 'sine', 0.4); },
    bossHit() { tone(150, 60, 0.15, 'square', 0.3); noise(0.1, 0.3, 500, 2); },
    slay() { noise(1.2, 0.6, 150, 1, 0, 'lowpass'); tone(400, 40, 1.2, 'sawtooth', 0.4); [880, 660, 440].forEach((f, i) => tone(f, f, 0.3, 'triangle', 0.25, 0.3 + i * 0.12)); },
    stun() { tone(700, 1200, 0.4, 'sine', 0.2); },
    drone() { tone(38, 30, 2.5, 'sine', 0.25); tone(57, 45, 2.5, 'sine', 0.15, 0.2); },
    maskCrack() { noise(0.06, 0.5, 4200, 3); tone(3000, 1400, 0.09, 'triangle', 0.26, 0.02); noise(0.14, 0.28, 2400, 2, 0.09); tone(1900, 700, 0.18, 'sine', 0.14, 0.12); },
    focus() { tone(1046.5, 1046.5, 0.5, 'sine', 0.2); tone(1568, 1568, 0.7, 'sine', 0.13, 0.06); tone(2093, 2093, 0.9, 'sine', 0.06, 0.12); },
    memory() { [523.25, 659.25, 784, 1046.5].forEach((f, i) => tone(f, f, 1.7, 'sine', 0.15 - i * 0.02, i * 0.18)); },
  };
})();

// ============================================================= ambient score (quiet, sparse, far away)
const MUS = (() => {
  let started = false;
  function bell(freq, vol, delay = 0, dur = 4) {
    try {
      const c = A.ensure(); const t = c.currentTime + delay;
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(A.musicBus()); o.start(t); o.stop(t + dur + 0.2);
    } catch (e) {}
  }
  function start() {
    if (started) return; started = true;
    try {
      const c = A.ensure();
      const g = c.createGain(); g.gain.value = 0.026; g.connect(A.ambienceBus());
      for (const f of [55, 55.4, 82.41]) {
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); o.start();
      }
      const lfo = c.createOscillator(); lfo.frequency.value = 0.05;
      const lg = c.createGain(); lg.gain.value = 0.011;
      lfo.connect(lg); lg.connect(g.gain); lfo.start();
      const scale = [220, 261.63, 329.63, 392, 440, 523.25];
      (function scheduleBell() {
        if (!started) return;
        const f = scale[Math.floor(Math.random() * scale.length)];
        bell(f, 0.02, 0, 5);
        if (Math.random() < 0.5) bell(f * 1.5, 0.011, 0.9, 4);
        setTimeout(scheduleBell, 9000 + Math.random() * 12000);
      })();
    } catch (e) {}
  }
  return { start, bell };
})();

// ============================================================= soft procedural textures
function softTex(size = 128, inner = 'rgba(255,255,255,1)') {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
const TEX = { fog: softTex(256, 'rgba(180,190,210,0.55)'), glow: softTex(128, 'rgba(255,200,120,1)'), eye: softTex(64, 'rgba(255,255,255,1)') };

// ============================================================= scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
scene.fog = new THREE.FogExp2(0x0a0e1a, V.FOG_DENSITY);
const CAMERA_VIEW_HEIGHT = 28;
const camera = new THREE.OrthographicCamera(
  -CAMERA_VIEW_HEIGHT * innerWidth / innerHeight / 2,
  CAMERA_VIEW_HEIGHT * innerWidth / innerHeight / 2,
  CAMERA_VIEW_HEIGHT / 2,
  -CAMERA_VIEW_HEIGHT / 2,
  0.1,
  400,
);
camera.zoom = userSettings.cameraZoom;
camera.updateProjectionMatrix();
const aimRaycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const aimPointer = new THREE.Vector2(0, 0);
const aimHit = new THREE.Vector3();
const aimDirection = new THREE.Vector2(0, -1);
let pointerHasMoved = false;
let graphicsAvailable = true;
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
} catch (error) {
  graphicsAvailable = false;
  const fallbackCanvas = document.createElement('canvas');
  renderer = {
    domElement: fallbackCanvas,
    setSize(width, height) { fallbackCanvas.width = width; fallbackCanvas.height = height; },
    setPixelRatio() {},
    render() {},
  };
  const warning = document.getElementById('graphics-warning');
  if (warning) {
    warning.hidden = false;
    warning.textContent = 'THE RENDERER COULD NOT START · enable WebGL or open the game in a browser that supports it.';
  }
  console.error('The WebGL renderer could not start.', error);
}
renderer.setSize(innerWidth, innerHeight);
const renderScale = { low: 0.75, balanced: 1, high: 1.5 };
renderer.setPixelRatio(renderScale[userSettings.renderScale]);
if (graphicsAvailable) renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);
renderer.domElement.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;';

// moonlight + sky
const moon = new THREE.DirectionalLight(V.MOON, 0.5);
moon.position.set(40, 80, -60);
scene.add(moon);
scene.add(new THREE.AmbientLight(0x202840, 0.55));
// moon disc in the sky
const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.eye, color: 0xdde4ff, transparent: true, opacity: 0.9, fog: false, depthWrite: false }));
moonSprite.position.set(120, 150, -220); moonSprite.scale.setScalar(40);
scene.add(moonSprite);
// stars
{ const g = new THREE.BufferGeometry(); const n = 300; const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.45, r = 300; pos[i * 3] = Math.cos(a) * Math.cos(e) * r; pos[i * 3 + 1] = Math.sin(e) * r + 20; pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r; }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8899cc, size: 0.7, transparent: true, opacity: 0.7, fog: false }))); }

// drifting fog patches (billboards)
const fogPatches = [];
for (let i = 0; i < V.FOG_PATCHES; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.fog, color: 0x8892aa, transparent: true, opacity: 0.05 + Math.random() * 0.07, depthWrite: false }));
  const a = Math.random() * Math.PI * 2, r = Math.random() * 75;
  s.position.set(Math.cos(a) * r, 0.8 + Math.random() * 4.5, Math.sin(a) * r);
  s.scale.set(14 + Math.random() * 22, 6 + Math.random() * 8, 1);
  s.name = 'Drifting fog';
  s.userData = { vx: (Math.random() - 0.5) * 0.25, vz: (Math.random() - 0.5) * 0.25 };
  scene.add(s); fogPatches.push(s);
}
// ambient rising embers
const emberGeo = new THREE.BufferGeometry();
const emberPos = new Float32Array(V.EMBERS * 3);
const emberVel = [];
for (let i = 0; i < V.EMBERS; i++) { const a = Math.random() * 6.28, r = Math.random() * 75; emberPos[i * 3] = Math.cos(a) * r; emberPos[i * 3 + 1] = Math.random() * 6; emberPos[i * 3 + 2] = Math.sin(a) * r; emberVel.push(0.1 + Math.random() * 0.3); }
emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
const emberField = new THREE.Points(emberGeo, new THREE.PointsMaterial({ color: 0xff9040, size: 0.12, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
emberField.name = 'Ambient embers';
scene.add(emberField);
// fireflies — drifting specks of pale light (more visible when you are dark)
const flyGeo = new THREE.BufferGeometry();
const FLY = 55;
const flyPos = new Float32Array(FLY * 3);
const flyPh = [];
for (let i = 0; i < FLY; i++) { const a = Math.random() * 6.28, r = Math.random() * 75; flyPos[i * 3] = Math.cos(a) * r; flyPos[i * 3 + 1] = 0.5 + Math.random() * 5; flyPos[i * 3 + 2] = Math.sin(a) * r; flyPh.push(Math.random() * 6.28); }
flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3));
const flyField = new THREE.Points(flyGeo, new THREE.PointsMaterial({ color: 0x9fe8ff, size: 0.14, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
flyField.name = 'Fireflies';
scene.add(flyField);

// ============================================================= loaders
const glbCache = new Map();
const MODEL_TEXTURE_PACKS = {
  'character-orc.glb': 'mini-dungeon',
  'character-archer.glb': 'mini-forest',
  'character-female-b.glb': 'mini-characters',
  'character-female-d.glb': 'mini-characters',
};
function loadGLB(url) {
  if (!glbCache.has(url)) {
    const manager = new THREE.LoadingManager();
    const modelName = new URL(url, location.href).pathname.split('/').pop();
    manager.setURLModifier((resourceUrl) => {
      const resource = new URL(resourceUrl, location.href);
      const texture = resource.pathname.match(/\/Textures\/(colormap\.png|texture-[a-z]\.png)$/);
      if (!texture) return resourceUrl;
      const pack = texture[1] === 'colormap.png'
        ? MODEL_TEXTURE_PACKS[modelName] || 'graveyard'
        : 'blocky-characters';
      return new URL(`/assets/kenney/${pack}/Textures/${texture[1]}`, location.origin).href;
    });
    const assetLoader = new GLTFLoader(manager);
    const assetDraco = new DRACOLoader(manager);
    assetDraco.setDecoderPath('/vendor/libs/draco/');
    assetLoader.setDRACOLoader(assetDraco);
    glbCache.set(url, assetLoader.loadAsync(url));
  }
  return glbCache.get(url);
}
const ASSET = (f) => '/assets/' + f;
let lanternTemplatePromise;
async function cloneLantern(targetHeight, emissiveColor = null, emissiveIntensity = 2.5) {
  if (!lanternTemplatePromise) {
    lanternTemplatePromise = loadGLB(ASSET('Lantern.glb')).then((gltf) => {
      const template = gltf.scene.clone(true);
      const bounds = new THREE.Box3().setFromObject(template);
      template.scale.setScalar(1 / ((bounds.max.y - bounds.min.y) || 1));
      template.traverse((object) => {
        if (object.isMesh && object.material?.emissive) object.material.emissiveIntensity = 2.5;
      });
      return template;
    });
  }
  const template = await lanternTemplatePromise;
  const model = template.clone(true);
  model.scale.multiplyScalar(targetHeight);
  if (emissiveColor != null) {
    model.traverse((object) => {
      if (!object.isMesh || !object.material) return;
      const tint = (material) => {
        if (!material.emissive) return material;
        const clone = material.clone();
        clone.emissive.setHex(emissiveColor);
        clone.emissiveIntensity = emissiveIntensity;
        return clone;
      };
      object.material = Array.isArray(object.material) ? object.material.map(tint) : tint(object.material);
    });
  }
  return model;
}

// class roster + boss info come from the server (single source of truth)
let CLASSES = {}, CLASS_IDS = [], BOSSES = {}
let LORE_TEXT = [], FOCUSCFG = { AMBER: 1, FUEL: 40 };
let GAMECFG = { drain: 1.5, rankDrain: 0.04, runDrain: 2.1, run: 1.35, stateHz: 20, fallbackSpeed: 4.8 };
fetch('/classes.json').then(r => r.ok ? r.json() : null).then(d => {
  if (!d) return;
  CLASSES = d.classes; CLASS_IDS = d.classIds; BOSSES = d.bosses;
  LORE_TEXT = d.lore || [];
  FOCUSCFG = d.focus || FOCUSCFG;
  if (d.config) GAMECFG = {
    ...GAMECFG,
    drain: d.config.drain || GAMECFG.drain,
    rankDrain: d.config.rankDrain || GAMECFG.rankDrain,
    runDrain: d.config.runDrain || GAMECFG.runDrain,
    run: d.config.run || GAMECFG.run,
    stateHz: d.config.stateHz || GAMECFG.stateHz,
    fallbackSpeed: d.config.fallbackSpeed || GAMECFG.fallbackSpeed,
  };
  if (Number.isSafeInteger(d.worldSeed)) setWorldSeed(d.worldSeed);
  buildRoster();
  // place the three cages immediately so the title screen shows the street
  const R = d.config ? d.config.wr : 70, CD = (d.config && d.config.cageDist) || 58;
  for (const b of Object.values(BOSSES)) {
    const a = b.cageAng * Math.PI / 180;
    const x = Math.cos(a) * CD, z = Math.sin(a) * CD;
    if (!cageDefs.find((cd) => cd.i === Object.keys(BOSSES).indexOf(b.id))) {
      cageDefs.push({ i: Object.keys(BOSSES).indexOf(b.id), x, z, st: 0 });
      buildCage(cageDefs[cageDefs.length - 1]);
    }
  }
  buildCageProps();
}).catch((error) => {
  const warning = document.getElementById('graphics-warning');
  if (warning) {
    warning.hidden = false;
    warning.textContent = 'The walker roster could not load. Refresh the page and check that the game server is running.';
  }
  console.error('Unable to load the walker roster.', error);
});

// ============================================================= character factory
function makeWeapon(kind, h) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x99a0b0, roughness: 0.4, metalness: 0.7 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 });
  const glowM = new THREE.MeshStandardMaterial({ color: 0x221100, emissive: 0xffa030, emissiveIntensity: 2 });
  const glowP = new THREE.MeshStandardMaterial({ color: 0x110022, emissive: 0x8050ff, emissiveIntensity: 2.5 });
  const B = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; };
  const s = h / 1.75;
  switch (kind) {
    case 'axe': B(new THREE.CylinderGeometry(0.03 * s, 0.04 * s, 0.9 * s), wood, 0, 0, 0, 0, 0, 1.2); B(new THREE.BoxGeometry(0.05 * s, 0.3 * s, 0.22 * s), metal, 0.22 * s, 0.32 * s, 0.08 * s); break;
    case 'bow': { const arc = new THREE.TorusGeometry(0.35 * s, 0.02 * s, 6, 12, Math.PI); B(arc, wood, 0, 0, 0, 0, 0, Math.PI / 2); B(new THREE.BoxGeometry(0.5 * s, 0.02 * s, 0.02 * s), new THREE.MeshStandardMaterial({ color: 0xcccccc }), 0, 0.35 * s, 0); B(new THREE.BoxGeometry(0.03 * s, 0.5 * s, 0.03 * s), wood, 0, 0, -0.02 * s); break; }
    case 'staff': B(new THREE.CylinderGeometry(0.025 * s, 0.03 * s, 1.1 * s), wood, 0, 0, 0, 0.15, 0, 0.2); B(new THREE.SphereGeometry(0.09 * s, 10, 8), glowM, 0.06 * s, 0.55 * s, 0.1 * s); break;
    case 'curse': B(new THREE.SphereGeometry(0.11 * s, 10, 8), glowP, 0, 0.1 * s, 0); break;
    case 'shovel': B(new THREE.CylinderGeometry(0.025 * s, 0.03 * s, 0.95 * s), wood, 0, 0, 0, 0, 0, 1.3); B(new THREE.BoxGeometry(0.16 * s, 0.24 * s, 0.03 * s), metal, -0.2 * s, 0.38 * s, 0); break;
    case 'mace': B(new THREE.CylinderGeometry(0.025 * s, 0.03 * s, 0.8 * s), wood, 0, 0, 0, 0, 0, 1.1); B(new THREE.SphereGeometry(0.12 * s, 8, 6), metal, 0.18 * s, 0.3 * s, 0); break;
    case 'chain': for (let i = 0; i < 4; i++) B(new THREE.TorusGeometry(0.06 * s, 0.015 * s, 6, 10), metal, i * 0.09 * s, -i * 0.05 * s, 0.05 * s, 0.6, 0, 0); break;
    case 'knife': B(new THREE.BoxGeometry(0.04 * s, 0.34 * s, 0.02 * s), metal, 0, 0.15 * s, 0, 0.1, 0, 0.15); B(new THREE.BoxGeometry(0.05 * s, 0.1 * s, 0.03 * s), wood, 0, -0.02 * s, 0); break;
    case 'lantern': B(new THREE.CylinderGeometry(0.09 * s, 0.11 * s, 0.16 * s), glowM, 0, 0.25 * s, 0); B(new THREE.CylinderGeometry(0.02 * s, 0.02 * s, 0.7 * s), wood, 0, -0.1 * s, 0, 0.2, 0, 0.4); break;
    case 'dagger': B(new THREE.BoxGeometry(0.035 * s, 0.3 * s, 0.018 * s), metal, 0, 0.12 * s, 0, 0.1, 0, 0.2); break;
    case 'scythe': B(new THREE.CylinderGeometry(0.025 * s, 0.03 * s, 1.3 * s), wood, 0, 0.1 * s, 0, 0, 0, 0.5); B(new THREE.BoxGeometry(0.5 * s, 0.06 * s, 0.02 * s), metal, 0.25 * s, 0.6 * s, 0.05 * s, 0, 0, -0.25); break;
    case 'drum': B(new THREE.CylinderGeometry(0.16 * s, 0.16 * s, 0.2 * s, 12), wood, -0.3 * s, 0.1 * s, -0.15 * s, 0.3, 0, 0); break;
  }
  return g;
}
function tintModel(root, color, opts = {}) {
  const tint = new THREE.Color(color);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const tintMaterial = (source) => {
      const material = source.clone();
      if (material.color) material.color.lerp(tint, opts.tintStrength ?? 0.14);
      if (opts.transparent) { material.transparent = true; material.opacity = opts.opacity ?? 0.8; material.depthWrite = false; }
      if (opts.emissive) { material.emissive = new THREE.Color(opts.emissive); material.emissiveIntensity = opts.emissiveI ?? 0.6; }
      return material;
    };
    o.material = Array.isArray(o.material) ? o.material.map(tintMaterial) : tintMaterial(o.material);
  });
}
// normalize a loaded gltf to target height, return { group, model, clips }
function normalizeChar(gltf, targetH) {
  const model = cloneSkeleton(gltf.scene);
  const bb = new THREE.Box3().setFromObject(model);
  const h = bb.max.y - bb.min.y || 1;
  const s = targetH / h;
  model.scale.setScalar(s);
  const group = new THREE.Group();
  group.add(model);
  group.position.y = -bb.min.y * s;
  const bb2 = new THREE.Box3().setFromObject(model);
  const clips = {};
  (gltf.animations || []).forEach((c) => { clips[c.name] = c; });
  return { group, model, clips, bb2, center: bb2.getCenter(new THREE.Vector3()) };
}
const HERO_SPRITES = '/assets/itch/elie-automata-heroes-demo/characters/';
const UNDEAD_SPRITES = '/assets/itch/elie-automata-dread-realms-demo/characters/Undead/';
const KNIGHT_SHEETS = '/assets/itch/smallscale-hd-knight-free/2D HD Character Knight/Spritesheets/With shadows/';
const ASSASSIN_SPRITES = '/assets/itch/sovdigital-free-blade-assassin/characters/blade-assassin/_sizes/128/';
const VAMPIRE_SPRITES = '/assets/opengameart/vampires-rework/PNG/48x64_scale2x/';
const SPRITE_DIRECTIONS = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];
const SPRITE_ROWS = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'];
const directionalSprite = (name) => ({ kind: 'directions', root: `${HERO_SPRITES}${name}/rotations/`, preview: `${HERO_SPRITES}${name}/rotations/south.png` });
const undeadSprite = (name) => ({ kind: 'directions', root: `${UNDEAD_SPRITES}${name}/rotations/`, preview: `${UNDEAD_SPRITES}${name}/rotations/south.png` });
const CLASS_SPRITES = {
  barb: { kind: 'sheet', root: KNIGHT_SHEETS, preview: { src: `${KNIGHT_SHEETS}Idle.png`, crop: [0, 0, 128, 128] }, columns: 15, rows: 8, displayScale: 3.7, actions: { idle: 'Idle.png', walk: 'Walk.png', run: 'Run.png', attack: 'Melee.png', dead: 'Die.png' } },
  arch: directionalSprite('Elven_Archer'),
  mage: directionalSprite('Human_Archmage'),
  witch: undeadSprite('Doll_Like_Girl'),
  dig: undeadSprite('Undead_Skeleton_Crusher'),
  monk: directionalSprite('Human_Bard_01'),
  chain: undeadSprite('Undead_Halberdier'),
  knife: { kind: 'frames', root: ASSASSIN_SPRITES, displayScale: 1.65, pivot: [72.332, 109.562, 147, 128], preview: `${ASSASSIN_SPRITES}frames/idle/S/000.png`, actions: { idle: ['idle', 4, 5], walk: ['walk', 6, 7], run: ['run', 6, 11], attack: ['attack3', 6, 10], dead: ['death', 6, 24] } },
  lante: directionalSprite('Dwarf_Engineer_01'),
  moth: { kind: 'atlas', file: `${VAMPIRE_SPRITES}vampire-f-001.png`, preview: { src: `${VAMPIRE_SPRITES}vampire-f-001.png`, crop: [48, 128, 48, 64] }, columns: 3, rows: 4, directionRows: [2, 3, 0, 1], displayScale: 1.8, frames: 3, fps: 4 },
  scythe: undeadSprite('Undead_Skeleton_Knight_02'),
  drum: undeadSprite('Undead_Bone_Guardian_02'),
};
const BOSS_SPRITES = {
  dracula: { kind: 'atlas', file: `${VAMPIRE_SPRITES}vampire-m-001.png`, columns: 3, rows: 4, directionRows: [2, 3, 0, 1], displayScale: 1 },
  vargulf: { ...undeadSprite('Undead_Skeleton_Crusher'), displayScale: 1 },
  lamplight: { ...undeadSprite('Doll_Like_Girl'), displayScale: 1 },
};
const spriteTextureLoader = new THREE.TextureLoader();
const spriteTextures = new Map();
const spriteTexturePromises = new Map();
function loadSpriteTexture(url) {
  if (spriteTextures.has(url)) return Promise.resolve(spriteTextures.get(url));
  if (spriteTexturePromises.has(url)) return spriteTexturePromises.get(url);
  const promise = spriteTextureLoader.loadAsync(encodeURI(url)).then((texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    spriteTextures.set(url, texture);
    spriteTexturePromises.delete(url);
    return texture;
  }).catch((error) => {
    spriteTexturePromises.delete(url);
    throw error;
  });
  spriteTexturePromises.set(url, promise);
  return promise;
}
function directionIndex(angle, count = 8) {
  const steps = count === 4 ? 4 : 8;
  return Math.round((((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2 / steps)) % steps;
}
function cropAtlasMap(map, columns, rows, column, row) {
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  map.repeat.set(1 / columns, 1 / rows);
  map.offset.set(column / columns, 1 - (row + 1) / rows);
}
async function makeSpriteCharacter(config, targetH, boss, bossId) {
  const material = new THREE.SpriteMaterial({ transparent: true, depthWrite: true, alphaTest: 0.12, color: 0xffffff });
  const sprite = new THREE.Sprite(material);
  const group = new THREE.Group();
  group.add(sprite);
  const scale = targetH * (config.displayScale || (boss ? 1.8 : 1.8));
  const atlasMaps = new Map();
  const ownedMaps = new Set();
  const character = {
    group, model: sprite, sprite, clips: {}, mixer: { update() {} }, targetH: scale,
    isSpriteCharacter: true, config, frameTime: 0, frame: 0, action: '', direction: -1, disposed: false,
    _materialColor: new THREE.Color(0xffffff), ownedMaps,
    setTexture: async (url, atlas = null, requestKey = null) => {
      const base = await loadSpriteTexture(url);
      if (character.disposed || (requestKey && character.frameKey !== requestKey)) return;
      let map = base;
      if (atlas) {
        if (!atlasMaps.has(url)) {
          const atlasMap = base.clone();
          atlasMap.needsUpdate = true;
          atlasMaps.set(url, atlasMap);
          ownedMaps.add(atlasMap);
        }
        map = atlasMaps.get(url);
        cropAtlasMap(map, atlas.columns, atlas.rows, atlas.column, atlas.row);
      }
      const hadMap = !!material.map;
      if (material.map !== map) material.map = map;
      if (!hadMap) material.needsUpdate = true;
      const image = base.image;
      const aspect = image?.width && image?.height
        ? (atlas ? image.width * atlas.rows / (image.height * atlas.columns) : image.width / image.height)
        : 1;
      sprite.scale.set(scale * aspect, scale, 1);
      character.activeMap = map;
    },
    updateSprite: (dt, angle, state) => {
      const dirs = directionIndex(angle, config.kind === 'atlas' ? 4 : 8);
      character.frameTime += dt;
      if (state !== character.action) { character.action = state; character.frameTime = 0; character.frame = 0; }
      const mode = state === 'attack' || state === 'dead' || state === 'run' || state === 'walk' ? state : 'idle';
      if (config.kind === 'directions') {
        if (dirs !== character.direction) {
          character.direction = dirs;
          const key = `${config.root}${SPRITE_DIRECTIONS[dirs]}.png`;
          character.frameKey = key;
          character.setTexture(key, null, key).catch((error) => console.error('Unable to load a directional character pose.', error));
        }
        sprite.position.y = 0.04 + (mode === 'walk' || mode === 'run' ? Math.abs(Math.sin(character.frameTime * (mode === 'run' ? 13 : 8))) * 0.06 : 0);
        sprite.position.z = mode === 'attack' ? 0.12 : 0;
      } else if (config.kind === 'atlas') {
        const col = Math.floor(character.frameTime * config.fps) % config.frames;
        const dirRow = config.directionRows[dirs];
        const key = `${config.file}:${col}:${dirRow}`;
        if (key !== character.frameKey) {
          character.frameKey = key;
          character.setTexture(config.file, { columns: config.columns, rows: config.rows, column: col, row: dirRow }, key).catch((error) => console.error('Unable to load an atlas character pose.', error));
        }
        sprite.position.y = 0.04;
      } else if (config.kind === 'sheet') {
        const sheet = config.actions[mode] || config.actions.idle;
        const poseKey = `${sheet}:${dirs}`;
        if (character.sheetKey !== poseKey) {
          character.sheetKey = poseKey;
          character.frame = 0;
          character.frameTime = 0;
        } else if (character.frameTime > 1 / 8) {
          character.frame = (character.frame + 1) % config.columns;
          character.frameTime = 0;
        }
        const key = `${poseKey}:${character.frame}`;
        if (character.frameKey !== key) {
          character.frameKey = key;
          character.setTexture(`${config.root}${sheet}`, { columns: config.columns, rows: config.rows, column: character.frame, row: dirs }, key).catch((error) => console.error('Unable to load an animated character sheet.', error));
        }
      } else if (config.kind === 'frames') {
        const [animation, count, fps] = config.actions[mode] || config.actions.idle;
        const frame = Math.floor(character.frameTime * fps) % count;
        const key = `${animation}:${dirs}:${frame}`;
        if (key !== character.frameKey) {
          character.frameKey = key;
          const file = `${config.root}frames/${animation}/${SPRITE_ROWS[dirs]}/${String(frame).padStart(3, '0')}.png`;
          character.setTexture(file, null, key).catch((error) => console.error('Unable to load an animated assassin frame.', error));
        }
        const pivot = config.pivot;
        sprite.center.set(pivot[0] / pivot[2], 1 - pivot[1] / pivot[3]);
      }
      if (boss && bossId === 'lamplight') material.opacity = 0.82 + Math.sin(performance.now() * 0.007) * 0.08;
    },
  };
  if (config.kind === 'atlas') {
    sprite.center.set(0.5, 0.08);
    const row = config.directionRows[0];
    await character.setTexture(config.file, { columns: config.columns, rows: config.rows, column: 1, row });
    character.frameKey = `${config.file}:1:${row}`;
  } else if (config.kind === 'sheet') {
    sprite.center.set(0.5, 0.08);
    await character.setTexture(`${config.root}${config.actions.idle}`, { columns: config.columns, rows: config.rows, column: 0, row: 0 });
    character.frameKey = `${config.actions.idle}:0`;
  } else if (config.kind === 'frames') {
    const pivot = config.pivot;
    sprite.center.set(pivot[0] / pivot[2], 1 - pivot[1] / pivot[3]);
    await character.setTexture(`${config.root}frames/idle/S/000.png`);
    character.frameKey = 'idle:0:0';
  } else {
    sprite.center.set(0.5, 0.08);
    await character.setTexture(`${config.root}south.png`);
    character.direction = 0;
  }
  if (boss) {
    const color = { dracula: 0xb83d4e, vargulf: 0xc09a68, lamplight: 0x9bb9eb }[bossId] || 0xffffff;
    material.color.setHex(color);
    if (bossId === 'lamplight') material.opacity = 0.82;
  }
  return character;
}
// Build from local directional artwork when available; retain the GLB path for unlisted assets.
async function buildCharacter(clsDef, { targetH = V.PLAYER_H, boss = false, tint, emissive, transparent, opacity } = {}) {
  const spriteConfig = boss ? BOSS_SPRITES[clsDef.id] : CLASS_SPRITES[clsDef.id];
  if (spriteConfig) return makeSpriteCharacter(spriteConfig, targetH, boss, clsDef.id);
  const modelName = clsDef.model;
  if (!modelName) throw new Error(`No sprite or model configured for ${clsDef.id}`);
  const gltf = await loadGLB(ASSET(modelName));
  const n = normalizeChar(gltf, targetH);
  const col = tint != null ? tint : (clsDef.tint || 0x8899aa);
  tintModel(n.model, col, {
    transparent, opacity, emissive: emissive ?? 0x000000, emissiveI: 0.35,
    tintStrength: boss ? 0.55 : 0.14,
  });
  // weapon
  if (!boss && clsDef.weapon) {
    const w = makeWeapon(clsDef.weapon, targetH);
    w.position.set(targetH * 0.24, targetH * 0.52, targetH * 0.14);
    n.model.add(w);
  }
  const mixer = new THREE.AnimationMixer(n.model);
  return { group: n.group, model: n.model, clips: n.clips, mixer, targetH };
}

function setClassPortrait(id, image) {
  const preview = CLASS_SPRITES[id]?.preview;
  if (!preview) return;
  const src = typeof preview === 'string' ? preview : preview.src;
  image.onerror = () => console.error(`Unable to load the ${id} roster portrait: ${src}`);
  if (typeof preview === 'string') {
    image.src = encodeURI(preview);
    return;
  }
  const source = new Image();
  source.onload = () => {
    const [x, y, width, height] = preview.crop;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      console.error(`Unable to create the ${id} roster portrait canvas.`);
      return;
    }
    context.drawImage(source, x, y, width, height, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    let left = width, top = height, right = -1, bottom = -1;
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        if (pixels[(py * width + px) * 4 + 3] < 16) continue;
        left = Math.min(left, px); top = Math.min(top, py);
        right = Math.max(right, px); bottom = Math.max(bottom, py);
      }
    }
    if (right < left || bottom < top) {
      console.error(`The ${id} roster portrait contains no visible artwork.`);
      return;
    }
    const trimmed = document.createElement('canvas');
    trimmed.width = right - left + 1; trimmed.height = bottom - top + 1;
    trimmed.getContext('2d').drawImage(canvas, left, top, trimmed.width, trimmed.height, 0, 0, trimmed.width, trimmed.height);
    image.src = trimmed.toDataURL('image/png');
  };
  source.onerror = () => console.error(`Unable to load the ${id} roster portrait: ${src}`);
  source.src = encodeURI(src);
}

function playClip(ch, name, speed = 1, fade = 0.15) {
  const clip = ch.clips[name];
  if (!clip) return null;
  const a = ch.mixer.clipAction(clip);
  const cur = ch._curAction;
  if (cur === a) return a;
  if (cur) { cur.crossFadeTo(a, fade, true); }
  else a.reset();
  a.setEffectiveTimeScale(speed); a.setLoop(THREE.LoopRepeat); a.play();
  ch._curAction = a; return a;
}
function charAnimUpdate(ch, ch2, dt, state, direction = 0) {
  // state: 'dead' | 'run' | 'walk' | 'idle' | 'attack'
  if (ch.isSpriteCharacter) {
    ch.updateSprite(dt, direction, state);
    return;
  }
  if (state === 'dead' && !ch._died) { const a = playClip(ch, 'die', 1, 0.1); if (a) { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; } ch._died = true; return; }
  if (state === 'attack') { const a = playClip(ch, 'attack-melee-right', 1.4, 0.08); if (a) { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = false; } ch._atkT = 0.45; }
  if (ch._atkT > 0) { ch._atkT -= dt; if (ch._atkT <= 0) playClip(ch, movingState(ch2), 1, 0.1); }
  if (state === 'run' || state === 'walk' || state === 'idle') playClip(ch, state === 'run' && ch.clips['sprint'] ? 'sprint' : state, state === 'run' ? 1.15 : 1, 0.18);
  ch.mixer.update(dt);
}
function movingState(ch2) { return ch2 && ch2._speed > 0.5 ? (ch2._speed > 4.5 ? 'run' : 'walk') : 'idle'; }

// ============================================================= world
const WORLD = globalThis.LightsOutWorld;
const CHUNK_SIZE = 64, CHUNK_RADIUS = 2, CHUNK_RES = 20;
let worldSeed = 0, lastChunkKey = '', activeBiomeId = '';
const worldChunks = new Map();
const worldRoot = new THREE.Group();
worldRoot.name = 'Procedural terrain';
scene.add(worldRoot);
const biomeMaterials = new Map();
const worldGeometry = {
  trunk: new THREE.CylinderGeometry(0.18, 0.28, 1, 7),
  canopy: new THREE.ConeGeometry(1, 1, 7),
  rock: new THREE.DodecahedronGeometry(1, 0),
  marker: new THREE.BoxGeometry(0.75, 1.15, 0.32),
  wall: new THREE.BoxGeometry(1, 1, 0.35),
};
const dummy = new THREE.Object3D();
const MIREGRAVE_ART = '/assets/itch/azwhod-miregrave-hamlet/Miregrave-Hamlet-Dark-Fantasy-Asset-Pack/';
const WORLD_SPRITE_ART = {
  forest: `${MIREGRAVE_ART}02_Vegetation/vegetation_07_mossy_twisted_tree.png`,
  marsh: `${MIREGRAVE_ART}02_Vegetation/vegetation_14_withered_reeds.png`,
  cinder: `${MIREGRAVE_ART}02_Vegetation/vegetation_06_charred_tree.png`,
  hamlet: `${MIREGRAVE_ART}02_Vegetation/vegetation_01_ancient_dead_oak.png`,
};
const HAMLET_BUILDINGS = [
  '01_Buildings/building_05_ruined_cottage.png',
  '01_Buildings/building_03_dark_timber_cabin.png',
  '01_Buildings/building_07_large_gothic_house.png',
].map((file) => MIREGRAVE_ART + file);
const environmentMaterialCache = new Map();
const environmentPlane = new THREE.PlaneGeometry(1, 1);

function addEnvironmentSprites(group, key, path, entries) {
  if (!entries.length) return;
  loadSpriteTexture(path).then((texture) => {
    if (worldChunks.get(key)?.group !== group) return;
    let material = environmentMaterialCache.get(path);
    if (!material) {
      material = new THREE.MeshBasicMaterial({
        map: texture, transparent: true, alphaTest: 0.12, depthWrite: true,
        side: THREE.DoubleSide, toneMapped: false,
      });
      environmentMaterialCache.set(path, material);
    }
    const aspect = texture.image.width / texture.image.height;
    const instances = new THREE.InstancedMesh(environmentPlane, material, entries.length);
    instances.name = `Biome art: ${path.split('/').pop()}`;
    for (let i = 0; i < entries.length; i++) {
      const item = entries[i];
      dummy.position.set(item.x, item.y + item.height / 2, item.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(item.height * aspect, item.height, 1);
      dummy.updateMatrix();
      instances.setMatrixAt(i, dummy.matrix);
    }
    instances.instanceMatrix.needsUpdate = true;
    instances.computeBoundingSphere();
    group.add(instances);
  }).catch((error) => console.error(`Unable to load biome art ${path}.`, error));
}

function makeGroundTexture(biome) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const base = '#' + biome.ground.toString(16).padStart(6, '0');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 850; i++) {
    const shade = WORLD.random(worldSeed, i, biome.id.length, 700) > 0.5 ? 'rgba(210,210,190,0.055)' : 'rgba(0,0,0,0.12)';
    ctx.fillStyle = shade;
    const size = 1 + WORLD.random(worldSeed, i, biome.id.length, 701) * 5;
    ctx.fillRect(WORLD.random(worldSeed, i, biome.id.length, 702) * 128, WORLD.random(worldSeed, i, biome.id.length, 703) * 128, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 5);
  return texture;
}

function materialForBiome(biome) {
  if (biomeMaterials.has(biome.id)) return biomeMaterials.get(biome.id);
  const material = {
    ground: new THREE.MeshStandardMaterial({ map: makeGroundTexture(biome), roughness: 1, vertexColors: true }),
    trunk: new THREE.MeshStandardMaterial({ color: biome.id === 'frost' ? 0x514d49 : 0x42372e, roughness: 1 }),
    canopy: new THREE.MeshStandardMaterial({ color: biome.canopy, roughness: 0.95 }),
    rock: new THREE.MeshStandardMaterial({ color: biome.accent, roughness: 1 }),
    marker: new THREE.MeshStandardMaterial({ color: biome.id === 'frost' ? 0x737b7c : 0x77726a, roughness: 1 }),
    wall: new THREE.MeshStandardMaterial({ color: biome.id === 'cinder' ? 0x43352f : 0x615b4c, roughness: 1 }),
  };
  biomeMaterials.set(biome.id, material);
  return material;
}

function addInstances(group, geometry, material, entries) {
  if (!entries.length) return;
  const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    dummy.position.set(e.x, e.y, e.z);
    dummy.rotation.set(0, e.rot || 0, e.tilt || 0);
    dummy.scale.set(e.sx, e.sy, e.sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
}

function buildWorldChunk(cx, cz) {
  const key = cx + ',' + cz;
  if (worldChunks.has(key)) return;
  const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
  const biome = WORLD.biomeAt(worldSeed, x0 + CHUNK_SIZE / 2, z0 + CHUNK_SIZE / 2);
  const materials = materialForBiome(biome);
  const group = new THREE.Group();
  group.position.set(x0, 0, z0);
  const positions = [], colors = [], uvs = [], indices = [];
  const ground = new THREE.Color(), accent = new THREE.Color(biome.accent);
  for (let iz = 0; iz <= CHUNK_RES; iz++) {
    for (let ix = 0; ix <= CHUNK_RES; ix++) {
      const wx = x0 + ix / CHUNK_RES * CHUNK_SIZE, wz = z0 + iz / CHUNK_RES * CHUNK_SIZE;
      const height = WORLD.heightAt(worldSeed, wx, wz);
      positions.push(ix / CHUNK_RES * CHUNK_SIZE, height, iz / CHUNK_RES * CHUNK_SIZE);
      uvs.push(ix / CHUNK_RES * 5, iz / CHUNK_RES * 5);
      ground.setHex(biome.ground).lerp(accent, Math.max(0, Math.min(0.28, height * 0.12 + WORLD.random(worldSeed, cx * CHUNK_RES + ix, cz * CHUNK_RES + iz, 51) * 0.11)));
      colors.push(ground.r, ground.g, ground.b);
      if (ix < CHUNK_RES && iz < CHUNK_RES) {
        const a = iz * (CHUNK_RES + 1) + ix, b = a + CHUNK_RES + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const terrain = new THREE.BufferGeometry();
  terrain.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  terrain.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  terrain.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  terrain.setIndex(indices);
  terrain.computeVertexNormals();
  group.userData.terrainGeometry = terrain;
  const groundMesh = new THREE.Mesh(terrain, materials.ground);
  groundMesh.receiveShadow = true;
  group.add(groundMesh);

  const trunks = [], canopies = [], rocks = [], markers = [], walls = [];
  const spriteEntries = new Map();
  const addSpriteEntry = (path, item) => {
    if (!spriteEntries.has(path)) spriteEntries.set(path, []);
    spriteEntries.get(path).push(item);
  };
  for (const decoration of WORLD.decorations(worldSeed, cx, cz)) {
    const { x, z } = decoration;
    const wx = x0 + x, wz = z0 + z;
    const y = WORLD.heightAt(worldSeed, wx, wz);
    if (decoration.type === 'tree') {
      const art = WORLD_SPRITE_ART[biome.id];
      if (art) addSpriteEntry(art, { x, y, z, height: (biome.id === 'marsh' ? 4.2 : 7.2) * decoration.scale });
      else {
        trunks.push({ x, y: y + decoration.scale, z, sx: 1, sy: decoration.scale * 2, sz: 1, rot: decoration.rot });
        canopies.push({ x, y: y + decoration.scale * 2.5, z, sx: decoration.scale * 1.4, sy: decoration.scale * 3, sz: decoration.scale * 1.4, rot: decoration.rot });
      }
    } else if (decoration.type === 'marker') {
      markers.push({ x, y: y + 0.58, z, sx: decoration.scale, sy: decoration.scale * 1.45, sz: 0.8, rot: decoration.rot });
    } else if (decoration.type === 'wall') {
      walls.push({ x, y: y + 0.65, z, sx: decoration.scale, sy: 1.3, sz: 1, rot: decoration.rot });
    } else if (decoration.type === 'building') {
      const variant = WORLD.hash(worldSeed, cx, cz, Math.round(decoration.x * 10 + decoration.z * 17)) % HAMLET_BUILDINGS.length;
      addSpriteEntry(HAMLET_BUILDINGS[variant], { x, y: y + 0.03, z, height: 8.5 * decoration.scale });
    } else if (decoration.type === 'rock') {
      rocks.push({ x, y: y + decoration.scale * 0.42, z, sx: decoration.scale * 1.2, sy: decoration.scale * 0.8, sz: decoration.scale, rot: decoration.rot });
    }
  }
  addInstances(group, worldGeometry.trunk, materials.trunk, trunks);
  addInstances(group, worldGeometry.canopy, materials.canopy, canopies);
  addInstances(group, worldGeometry.rock, materials.rock, rocks);
  addInstances(group, worldGeometry.marker, materials.marker, markers);
  addInstances(group, worldGeometry.wall, materials.wall, walls);
  worldRoot.add(group);
  worldChunks.set(key, { group, biome: biome.id });
  for (const [path, entries] of spriteEntries) addEnvironmentSprites(group, key, path, entries);
}

function setWorldSeed(seed) {
  const parsed = Number(seed);
  if (!Number.isSafeInteger(parsed) || parsed === worldSeed) return;
  worldSeed = parsed;
  for (const chunk of worldChunks.values()) {
    worldRoot.remove(chunk.group);
    chunk.group.userData.terrainGeometry.dispose();
  }
  worldChunks.clear();
  chunkBuildQueue = [];
  lastChunkKey = '';
  activeBiomeId = '';
}

function updateWorldBiome(x, z) {
  const biome = WORLD.biomeAt(worldSeed, x, z);
  if (biome.id === activeBiomeId) return;
  activeBiomeId = biome.id;
  scene.background.setHex(biome.fog);
  scene.fog.color.setHex(biome.fog);
  const label = document.getElementById('biome-label');
  if (label) label.textContent = `${biome.name} · ${WARD_NAMES[biome.id] || 'the Street'}`;
  if (inGame) showBanner(WARD_RUMORS[biome.id] || 'The Street has shifted.', 'good');
}

function updateWorldChunks(x, z, force = false) {
  const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
  const centerKey = cx + ',' + cz;
  if (!force && centerKey === lastChunkKey) return;
  lastChunkKey = centerKey;
  const wanted = new Set();
  const missing = [];
  for (let dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz++) {
    for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
      const wx = cx + dx, wz = cz + dz, key = wx + ',' + wz;
      wanted.add(key);
      if (!worldChunks.has(key)) missing.push({ x: wx, z: wz, distance: dx * dx + dz * dz });
    }
  }
  for (const [key, chunk] of worldChunks) {
    if (!wanted.has(key)) {
      worldRoot.remove(chunk.group);
      chunk.group.userData.terrainGeometry.dispose();
      worldChunks.delete(key);
    }
  }
  missing.sort((a, b) => a.distance - b.distance);
  chunkBuildQueue = missing;
  updateWorldBiome(x, z);
}
let chunkBuildQueue = [];
function buildNextWorldChunk() {
  const next = chunkBuildQueue.shift();
  if (next) buildWorldChunk(next.x, next.z);
}

// graveyard props around the cages (Kenney CC0)
const propDefs = ['crypt-small', 'gravestone-broken', 'gravestone-cross', 'gravestone-round', 'pine-crooked', 'pine-fall', 'coffin', 'iron-fence', 'rocks-tall'];
const propCache = new Map();
let propLoadsPending = propDefs.length;
for (const d of propDefs) loadGLB(ASSET(d + '.glb')).then((g) => {
  g.scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const soften = (material) => { material.roughness = Math.max(material.roughness || 0, 0.82); };
    if (Array.isArray(o.material)) o.material.forEach(soften);
    else soften(o.material);
  });
  propCache.set(d, g);
}).catch((error) => {
  console.error(`Unable to load cage prop: ${d}.glb`, error);
}).finally(() => {
  propLoadsPending--;
  buildCageProps();
});
let propsPlaced = false;
function buildCageProps() {
  if (propsPlaced) return;
  if (propLoadsPending || !cageDefs.length) return;
  propsPlaced = true;
  for (const cg of cageDefs) {
    placeProp(cg, 'crypt-small', -4, -3, 1, 0.6);
    placeProp(cg, 'coffin', 3.5, 4, 0.9, 0.3);
    placeProp(cg, 'iron-fence', 5, -2, 1, 0.4);
    placeProp(cg, 'pine-crooked', -6, 2, 1.2, 0);
    placeProp(cg, 'pine-crooked', 6, 5, 1.0, 2);
    placeProp(cg, 'pine-fall', -2, 6, 1, 1);
    placeProp(cg, 'gravestone-broken', 2, -5, 1, 0.5);
    placeProp(cg, 'gravestone-cross', -5, 4, 1, 1.5);
    placeProp(cg, 'gravestone-round', 4.5, 1.5, 1, 2.5);
    placeProp(cg, 'rocks-tall', -3.5, -5.5, 1, 0);
  }
}
function placeProp(cg, name, dx, dz, sc, rot) { placeFree({ x: cg.x + dx, z: cg.z + dz }, name, sc, rot); }
function placeFree(at, name, sc, rot) {
  const g = propCache.get(name);
  if (!g) return;
  const m = g.scene.clone(true);
  m.name = `Cage prop: ${name}`;
  m.position.set(at.x, WORLD.heightAt(worldSeed, at.x, at.z), at.z);
  m.scale.setScalar(sc);
  m.rotation.y = rot || 0;
  scene.add(m);
}

// ============================================================= self character
const selfG = new THREE.Group(); selfG.name = 'Local walker'; scene.add(selfG);
let selfChar = null, selfTint = 0xc96b3f, selfCls = { weapon: 'axe' };
let selfTorch = null, selfLight = null;
function rebuildSelf() {
  const old = selfChar;
  selfChar = null;
  // clear old group contents
  while (selfG.children.length) selfG.remove(selfG.children[0]);
  disposeCharacter(old);
  buildCharacter(selfCls, { tint: selfTint }).then((ch) => {
    selfG.add(ch.group);
    selfChar = ch;
    selfTorch = attachTorch(selfG, ch.targetH, true, !ch.isSpriteCharacter);
  }).catch((error) => console.error('Unable to build the local walker.', error));
}
function attachTorch(group, h, withLight = true, modelLantern = true) {
  const g = new THREE.Group();
  let light = null;
  if (withLight) {
    light = new THREE.PointLight(0xffa050, 2.4, 26, 1.8);
    light.position.set(0.25, h * 0.58, 0.2);
    g.add(light);
  }
  if (modelLantern) {
    cloneLantern(0.5).then((m) => {
      m.position.set(0, -h * 0.62, 0);
      g.add(m);
    }).catch((error) => console.error('Unable to load the torch model.', error));
  } else {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glow, color: 0xffb34a, transparent: true, opacity: 0.86,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.set(0.7, 0.7, 1);
    glow.position.set(0.25, h * 0.42, 0.2);
    g.add(glow);
    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd17a }));
    ember.position.copy(glow.position);
    g.add(ember);
  }
  group.add(g);
  return { g, light };
}

// ============================================================= remote players
const remotes = new Map(); // id -> { group, char, light, name, model, cls, ... }
let myId = null;
const remoteTorchLights = Array.from({ length: 4 }, () => {
  const light = new THREE.PointLight(0xffa050, 0, 24, 1.8);
  light.name = 'Shared remote torch light';
  scene.add(light);
  return light;
});
function disposeCharacter(character) {
  if (!character) return;
  character.model.traverse((object) => {
    if ((!object.isMesh && !object.isSprite) || !object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
  if (character.isSpriteCharacter) {
    character.disposed = true;
    for (const map of character.ownedMaps) map.dispose();
    character.ownedMaps.clear();
  }
}
function getRemote(r) {
  let R = remotes.get(r.i);
  if (!R) {
    R = { i: r.i, group: new THREE.Group(), x: r.x, z: r.z, d: r.d, cls: CLASSES[r.c] || { tint: 0x8899aa, weapon: 'axe' }, char: null, light: null, name: new THREE.Sprite(), nameMat: null, deadT: 0, atkT: 0, _speed: 0, px: r.x, pz: r.z, snapshots: [] };
    R.group.name = 'Remote walker';
    R.nameMat = new THREE.SpriteMaterial({ depthWrite: false, transparent: true });
    R.name = new THREE.Sprite(R.nameMat);
    R.name.scale.set(2.6, 0.5, 1);
    R.group.add(R.name);
    scene.add(R.group);
    remotes.set(r.i, R);
    buildCharacter(R.cls, { tint: R.cls.tint }).then((ch) => {
      if (!remotes.has(r.i)) { disposeCharacter(ch); return; }
      if (ch) { if (R.char) { R.group.remove(R.char.group); disposeCharacter(R.char); } R.char = ch; R.group.add(ch.group); attachTorch(R.group, ch.targetH, false, !ch.isSpriteCharacter); }
      R.light = R.group.children.find((c) => c.isGroup) ? null : null;
      setRemoteTorch(R, r);
    }).catch((error) => console.error(`Unable to build remote walker ${r.i}.`, error));
    setRemoteTorch(R, r);
  }
  R.cls = CLASSES[r.c] || R.cls;
  R.px = R.x; R.pz = R.z; R.x = r.x; R.z = r.z; R.d = r.d;
  const receivedAt = performance.now();
  const previous = R.snapshots[R.snapshots.length - 1];
  if (previous) {
    const seconds = Math.max(0.001, (receivedAt - previous.time) / 1000);
    R._speed = Math.hypot(R.x - previous.x, R.z - previous.z) / seconds;
  }
  R.snapshots.push({ x: R.x, z: R.z, d: R.d, time: receivedAt });
  if (R.snapshots.length > 8) R.snapshots.shift();
  R.atkT = Math.max(0, R.atkT - 0.05);
  return R;
}
function setRemoteTorch(R, r) {
  const fuel = r.f;
  const rank = r.r || 0;
  R._torchIntensity = fuel > 0 ? 1.6 + rank * 0.25 + (fuel / 100) * 1.2 : 0;
  R._torchRadius = fuel > 0 ? 7 + 8 * Math.min(1, fuel / 100) + rank * 0.7 : 0;
}
function updateRemotes(state, dt) {
  const seen = new Set();
  const me = state.p.find((p) => p.i === myId);
  for (const r of state.p) {
    if (r.i === myId) continue;
    seen.add(r.i);
    const R = getRemote(r);
    // torch
    setRemoteTorch(R, r);
    // name tag
    const nameStr = (r.s > 0 ? '⚔' + r.s + ' ' : '') + r.n + (r.st >= 2 ? ' ×' + r.st : '');
    if (R.nameMat.text !== nameStr) {
      R.nameMat.map?.dispose();
      R.nameMat.map = null;
      const c = document.createElement('canvas'); c.width = 512; c.height = 96;
      const x = c.getContext('2d');
      x.font = 'bold 44px monospace';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = r.bk ? '#ffd090' : (r.st >= 2 ? '#ff8060' : '#cfd8ea');
      x.shadowColor = 'rgba(0,0,0,0.9)'; x.shadowBlur = 8;
      x.fillText(nameStr, 256, 48);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      R.nameMat.map = t; R.nameMat.needsUpdate = true; R.nameMat.text = nameStr;
    }
    R.name.position.set(0, 2.5, 0);
    R.name.visible = r.al === 1;
    // death fade
    if (r.al === 0) R.deadT = Math.min(2, R.deadT + dt);
    else R.deadT = 0;
    const vis = r.al === 1 ? 1 : Math.max(0, 1 - R.deadT / 0.8);
    R.group.scale.setScalar(r.al === 1 ? 1 : Math.max(0.001, vis));
    // animation
    if (R.char) {
      const st = r.al === 0 ? 'dead' : (R.atkT > 0 ? 'attack' : movingState({ _speed: R._speed }));
      if (r.al === 1 && R.deadT === 0) R.char._died = false;
      R.animState = st;
      // bloodlit aura
      if (!!r.bk !== R._bloodlit) {
        if (R.char.isSpriteCharacter) {
          R.char.model.material.color.setHex(r.bk ? 0xff8060 : 0xffffff);
        } else R.char.model.traverse((o) => {
          if (!o.isMesh || !o.material) return;
          const materials = Array.isArray(o.material) ? o.material : [o.material];
          for (const material of materials) if (material.emissive) {
            if (!material.userData.bloodlitBase) material.userData.bloodlitBase = { color: material.emissive.clone(), intensity: material.emissiveIntensity };
            if (r.bk) { material.emissive.setHex(0xff5020); material.emissiveIntensity = 0.25; }
            else { material.emissive.copy(material.userData.bloodlitBase.color); material.emissiveIntensity = material.userData.bloodlitBase.intensity; }
          }
        });
        R._bloodlit = !!r.bk;
      }
    }
    // visibility culling by torch radius / silhouette
    const dMe = me ? Math.hypot(R.x - me.x, R.z - me.z) : 100;
    const myR = me && me.f > 0 ? 7 + 8 * Math.min(1, me.f / 100) + (me.r || 0) * 0.7 : 4;
    R.group.visible = r.al === 1 ? dMe < Math.max(myR + 8, 16) : R.deadT < 1.2;
  }
  for (const [id, R] of remotes) if (!seen.has(id)) {
    scene.remove(R.group);
    R.nameMat.map?.dispose();
    R.nameMat.dispose();
    disposeCharacter(R.char);
    remotes.delete(id);
  }
  const nearestLit = [...remotes.values()]
    .filter((R) => R.group.visible && R._torchIntensity > 0)
    .sort((a, b) => Math.hypot(a.x - (me?.x || 0), a.z - (me?.z || 0)) - Math.hypot(b.x - (me?.x || 0), b.z - (me?.z || 0)));
  remoteTorchLights.forEach((light, i) => {
    const R = nearestLit[i];
    if (R) {
    light.userData.playerId = R.i;
    light.position.set(R.x, WORLD.heightAt(worldSeed, R.x, R.z) + 2.1, R.z);
    light.distance = Math.max(3, R._torchRadius * 1.7);
    light.intensity = R._torchIntensity;
    } else {
    light.userData.playerId = null;
    light.intensity = 0;
    }
  });
}
function sampleSnapshots(snapshots, renderAt) {
  if (!snapshots.length) return null;
  while (snapshots.length > 2 && snapshots[1].time < renderAt) snapshots.shift();
  const from = snapshots[0], to = snapshots[1] || from;
  const span = Math.max(1, to.time - from.time);
  const amount = Math.max(0, Math.min(1, (renderAt - from.time) / span));
  const angleDelta = Math.atan2(Math.sin(to.d - from.d), Math.cos(to.d - from.d));
  return {
    x: from.x + (to.x - from.x) * amount,
    z: from.z + (to.z - from.z) * amount,
    d: from.d + angleDelta * amount,
  };
}
function interpolateRemotePositions(now, dt) {
  const renderAt = now - 80;
  for (const R of remotes.values()) {
    const position = sampleSnapshots(R.snapshots, renderAt);
    if (!position) continue;
    R.group.position.set(position.x, WORLD.heightAt(worldSeed, position.x, position.z), position.z);
    R.group.rotation.y = R.char?.isSpriteCharacter ? 0 : position.d;
    if (R.char) charAnimUpdate(R.char, { _speed: R._speed }, dt, R.animState || 'idle', position.d);
  }
  for (const B of bossVis.values()) {
    const position = sampleSnapshots(B.snapshots, renderAt);
    if (!position) continue;
    B.group.position.set(
      position.x,
      WORLD.heightAt(worldSeed, position.x, position.z) + B.floatOffset,
      position.z,
    );
    B.group.rotation.y = B.char?.isSpriteCharacter ? 0 : position.d;
    if (B.char) charAnimUpdate(B.char, { _speed: B._speed }, dt, B.animState || 'idle', position.d);
  }
  for (const light of remoteTorchLights) {
    const R = remotes.get(light.userData.playerId);
    if (R) light.position.set(R.group.position.x, R.group.position.y + 2.1, R.group.position.z);
  }
}

// ============================================================= bosses & cages
const cageDefs = []; // from state.c
const bossVis = new Map(); // cageIdx -> visual
const cageFrameGeo = new THREE.BoxGeometry(1, 1, 1);
const cageBarGeo = new THREE.CylinderGeometry(0.06, 0.06, 7.5, 6);
const cageMaterials = new Map();
function cageMaterial(color) {
  if (!cageMaterials.has(color)) {
    cageMaterials.set(color, new THREE.MeshStandardMaterial({
      color: 0x1c2028, roughness: 0.5, metalness: 0.8, emissive: color, emissiveIntensity: 0.08,
    }));
  }
  return cageMaterials.get(color);
}
function ensureCages(cs) {
  for (const c of cs) {
    if (!cageDefs.find((d) => d.i === c.i)) {
      cageDefs.push({ i: c.i, x: c.x, z: c.z, st: 0 });
      buildCage(c);
    }
  }
}
function buildCage(cg) {
  const def = BOSSES[cg.i];
  const col = V.BOSS_COLORS[def ? def.id : 'dracula'] || 0xff2244;
  const g = new THREE.Group();
  g.name = 'Boss cage';
  g.position.set(cg.x, WORLD.heightAt(worldSeed, cg.x, cg.z), cg.z);
  // rune ring (floor)
  const ring = new THREE.Mesh(new THREE.RingGeometry(4.6, 5.4, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
  g.add(ring);
  // iron frame
  const iron = cageMaterial(col);
  const S = 5.2;
  const frame = new THREE.InstancedMesh(cageFrameGeo, iron, 8);
  frame.name = 'Cage frame';
  let frameIndex = 0;
  for (const [px, pz] of [[-S, -S], [S, -S], [-S, S], [S, S]]) {
    dummy.position.set(px, 3.75, pz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(0.5, 7.5, 0.5);
    dummy.updateMatrix();
    frame.setMatrixAt(frameIndex++, dummy.matrix);
  }
  const bars = new THREE.InstancedMesh(cageBarGeo, iron, 24);
  bars.name = 'Cage bars';
  let barIndex = 0;
  for (const [ax, az, bx, bz] of [[-S, -S, S, -S], [S, -S, S, S], [S, S, -S, S], [-S, S, -S, -S]]) {
    const len = Math.hypot(bx - ax, bz - az);
    for (let i = 1; i < 7; i++) {
      const t = i / 7;
      dummy.position.set(ax + (bx - ax) * t, 3.75, az + (bz - az) * t);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bars.setMatrixAt(barIndex++, dummy.matrix);
    }
    dummy.position.set((ax + bx) / 2, 7.5, (az + bz) / 2);
    dummy.rotation.set(0, -Math.atan2(bz - az, bx - ax), 0);
    dummy.scale.set(len + 0.5, 0.4, 0.4);
    dummy.updateMatrix();
    frame.setMatrixAt(frameIndex++, dummy.matrix);
  }
  frame.instanceMatrix.needsUpdate = true;
  bars.instanceMatrix.needsUpdate = true;
  g.add(frame, bars);
  // orbiting rune shards
  const runes = [];
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9 }));
    m.userData = { a: (i / 5) * Math.PI * 2, s: 0.4 + Math.random() * 0.4 };
    g.add(m); runes.push(m);
  }
  const cl = new THREE.PointLight(col, 1.4, 26, 1.6);
  cl.position.set(0, 4, 0);
  g.add(cl);
  scene.add(g);
  cageDefs[cg.i] = { i: cg.i, x: cg.x, z: cg.z, st: cg.st, ring, runes, group: g };
  if (!cageDefs[cg.i]) cageDefs.push(cageDefs[cg.i]);
}
function ensureBossVisual(b) {
  let B = bossVis.get(b.i);
  if (!B) {
    const def = BOSSES[b.i] || { id: ['dracula', 'vargulf', 'lamplight'][b.i], name: ['DRACULA', 'VARGULF', 'THE LAMPLIGHTER'][b.i], model: ['character-vampire.glb', 'character-zombie.glb', 'character-ghost.glb'][b.i], scale: 2.5 };
    B = { i: b.i, def, group: new THREE.Group(), x: b.x, z: b.z, px: b.x, pz: b.z, hp: b.hp, hpMax: b.hm, st: b.st, h: b.h, tg: b.tg, plat: null, eyes: [], fx: [], light: null, snapshots: [], floatOffset: 0 };
    B.group.name = 'Boss';
    B.platMat = new THREE.SpriteMaterial({ depthWrite: false, transparent: true });
    B.plat = new THREE.Sprite(B.platMat);
    B.plat.scale.set(7, 1.1, 1);
    B.plat.position.y = 6.4;
    B.group.add(B.plat);
    scene.add(B.group);
    // light
    B.light = new THREE.PointLight(V.BOSS_COLORS[def.id] || 0xff2244, 1.2, 18, 1.6);
    B.light.userData.baseIntensity = 1.2;
    B.light.position.y = 3;
    B.group.add(B.light);
    B.group.position.set(b.x, WORLD.heightAt(worldSeed, b.x, b.z), b.z);
    bossVis.set(b.i, B);
    buildCharacter(def, { targetH: V.BOSS_H, boss: true, tint: 0x14161c, emissive: 0x000000, transparent: def.id === 'lamplight', opacity: 0.82 }).then((ch) => {
      if (!bossVis.has(b.i)) return;
      B.char = ch; B.group.add(ch.group);
      if (ch.isSpriteCharacter) {
        const aura = new THREE.Sprite(new THREE.SpriteMaterial({
          map: TEX.fog, color: V.BOSS_COLORS[def.id] || 0xff2244, transparent: true,
          opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        aura.scale.set(6, 6, 1);
        aura.position.set(0, ch.targetH * 0.45, -0.18);
        B.group.add(aura); B.aura = aura;
      } else {
        const headY = ch.targetH * 0.92;
        for (const ex of [-0.14, 0.14]) {
          const e = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: V.BOSS_COLORS[def.id] || 0xff2244 }));
          e.position.set(ex, headY, ch.targetH * 0.42);
          B.group.add(e); B.eyes.push(e);
          const es = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.eye, color: V.BOSS_COLORS[def.id] || 0xff2244, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
          es.scale.setScalar(1.1); es.position.copy(e.position);
          B.group.add(es); B.eyes.push(es);
        }
      }
      if (def.id === 'dracula' && !ch.isSpriteCharacter) {
        const cape = new THREE.Mesh(new THREE.ConeGeometry(1.5, 4.2, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0x1a080c, roughness: 1, side: THREE.DoubleSide }));
        cape.position.set(0, 1.9, -0.5); B.group.add(cape); B.cape = cape;
        for (let i = 0; i < 14; i++) {
          const bat = new THREE.Mesh(new THREE.TetrahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: 0x111118 }));
          bat.userData = { a: Math.random() * 6.28, r: 1.5 + Math.random() * 1.6, y: 2 + Math.random() * 3, s: 1 + Math.random() * 2 };
          B.group.add(bat); B.fx.push(bat);
        }
      }
      if (def.id === 'vargulf') {
        if (!ch.isSpriteCharacter) B.char.model.rotation.x = 0.32;
        B.char.model.scale.y *= 0.88;
      }
      if (def.id === 'lamplight') {
        if (!ch.isSpriteCharacter) cloneLantern(1.1, 0x60a0ff, 3).then((m) => {
          m.position.set(1.1, 1.6, 0.4);
          B.group.add(m);
          const gl = new THREE.PointLight(0x60a0ff, 1.4, 14, 1.8); gl.userData.baseIntensity = 1.4; gl.position.set(1.1, 1.7, 0.4); B.group.add(gl);
        }).catch((error) => console.error('Unable to load the Lamplighter lantern.', error));
        for (let i = 0; i < 10; i++) {
          const wisp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.fog, color: 0x88aaff, transparent: true, opacity: 0.25, depthWrite: false }));
          wisp.scale.set(1.6, 1.6, 1);
          wisp.userData = { a: Math.random() * 6.28, r: 1 + Math.random() * 1.5, y: 0.5 + Math.random() * 3.5, s: 0.5 + Math.random() };
          B.group.add(wisp); B.fx.push(wisp);
        }
      }
    }).catch((error) => console.error(`Unable to build boss ${def.id}.`, error));
  }
  B.px = B.x; B.pz = B.z; B.x = b.x; B.z = b.z; B.hp = b.hp; B.hpMax = b.hm; B.st = b.st; B.h = b.h; B.tg = b.tg;
  const receivedAt = performance.now();
  const previous = B.snapshots[B.snapshots.length - 1];
  if (previous) {
    const seconds = Math.max(0.001, (receivedAt - previous.time) / 1000);
    B._speed = Math.hypot(B.x - previous.x, B.z - previous.z) / seconds;
  }
  B.snapshots.push({ x: B.x, z: B.z, d: b.ang, time: receivedAt });
  if (B.snapshots.length > 8) B.snapshots.shift();
  return B;
}
function updateBosses(state, dt, t) {
  const local = state.p.find((p) => p.i === myId);
  for (const b of state.b) {
    const B = ensureBossVisual(b);
    const inRange = !local || Math.hypot(B.x - local.x, B.z - local.z) <= 128;
    B.group.visible = true;
    for (const child of B.group.children) {
      if (child.isLight) child.intensity = inRange && B.st !== 'dead' ? (child.userData.baseIntensity || 0) : 0;
      else child.visible = inRange && B.st !== 'dead';
    }
    if (!inRange || B.st === 'dead') {
      if (B.hpBar) B.hpBar.visible = false;
      continue;
    }
    // nameplate
    const stateWord = B.st === 'dormant' ? '⚰ caged' : B.h === 'windup' ? '⚠ CROUCHING' : B.h === 'dash' ? '!!!' : B.h === 'hold' ? '👁 HOLDING' : 'hunting';
    const str = B.def.name + (B.st === 'dead' ? '  —  UNBANNED' : '   ·   ' + stateWord);
    if (B.platMat.text !== str) {
      const c = document.createElement('canvas'); c.width = 1024; c.height = 128;
      const x = c.getContext('2d');
      x.font = 'bold 54px monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = B.st === 'dead' ? '#556' : (B.h === 'windup' || B.h === 'hold' ? '#ff5050' : (B.st === 'dormant' ? '#8899aa' : V2HEX(V.BOSS_COLORS[B.def.id] || 0xff2244)));
      x.shadowColor = 'rgba(0,0,0,0.95)'; x.shadowBlur = 12;
      x.fillText(str, 512, 64);
      const tt = new THREE.CanvasTexture(c); tt.colorSpace = THREE.SRGBColorSpace;
      B.platMat.map?.dispose();
      B.platMat.map = tt; B.platMat.needsUpdate = true; B.platMat.text = str;
    }
    B.plat.visible = B.st !== 'dead';
    // hp bar in world (above)
    ensureBossHpBar(B);
    B.hpBarFill.scale.x = Math.max(0.001, B.hp / Math.max(1, B.hpMax));
    B.hpBar.visible = B.st === 'awake';
    // dormant = sleeping inside cage (rise on awake)
    const targetY = B.st === 'dormant' ? -0.4 : 0;
    B.floatOffset += (targetY - B.floatOffset) * Math.min(1, dt * 2);
    if (B.st === 'dead') { B.hpBar.visible = false; B.plat.visible = false; return; }
    // breathing / float
    if (B.char) {
      if (B.def.id === 'lamplight') {
        B.char.group.position.y = Math.sin(t * 1.6) * 0.25 + 0.25;
        if (B.char.isSpriteCharacter) B.char.model.material.opacity = 0.82 + Math.sin(t * 7) * 0.1;
        else if (B.char.model) B.char.model.traverse((o) => { if (o.isMesh) o.material.opacity = 0.6 + Math.sin(t * 7 + o.id) * 0.15; });
      }
      const st = B.st === 'dormant' ? 'idle' : (B.h === 'windup' ? 'idle' : (B._speed > 1 ? 'run' : 'walk'));
      B.animState = st;
      if (B.aura) B.aura.material.opacity = (B.h === 'windup' ? 0.42 : 0.22) + Math.sin(t * 3) * 0.04;
    }
    // cape sway
    if (B.cape) B.cape.rotation.y = Math.sin(t * 2) * 0.2;
    // eye glow pulse (windup = bright red)
    const pulse = B.h === 'windup' ? 1.6 + Math.sin(t * 20) * 0.8 : 1 + Math.sin(t * 3) * 0.3;
    B.eyes.forEach((e, i) => { if (e.material) e.material.opacity = Math.min(1, pulse) * (i % 2 ? 0.8 : 1); if (e.isMesh) e.scale.setScalar(0.8 + pulse * 0.3); });
    // orbiting fx
    for (const f of B.fx) {
      const u = f.userData; u.a += dt * u.s;
      f.position.set(Math.cos(u.a) * u.r, u.y + Math.sin(t * 2 + u.a) * 0.3, Math.sin(u.a) * u.r);
    }
    // boss light flicker
    B.light.intensity = (B.st === 'awake' ? 1.3 : 0.6) * (0.8 + Math.sin(t * 9) * 0.2);
    // cage rune pulse when awake
    const cg = cageDefs[b.i];
    if (cg && cg.ring) cg.ring.material.opacity = (b.st === 'awake' ? 0.7 + Math.sin(t * 6) * 0.25 : 0.35);
    if (cg) for (const r of cg.runes) { r.userData.a += dt * 0.6; r.position.set(Math.cos(r.userData.a) * 5, 0.8 + Math.sin(t * 2 + r.userData.a * 3) * 0.4, Math.sin(r.userData.a) * 5); r.rotation.y += dt; }
  }
}
function V2HEX(c) { return '#' + c.toString(16).padStart(6, '0'); }
function ensureBossHpBar(B) {
  if (B.hpBar) return;
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.35), new THREE.MeshBasicMaterial({ color: 0x111318, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.22), new THREE.MeshBasicMaterial({ color: V.BOSS_COLORS[B.def.id] || 0xff2244, side: THREE.DoubleSide, depthWrite: false }));
  fill.position.z = 0.01; fill.position.x = -2.1; fill.geometry.translate(2.1, 0, 0);
  const g = new THREE.Group(); g.add(bg); g.add(fill);
  g.position.y = 5.6;
  B.group.add(g);
  B.hpBar = g; B.hpBarFill = fill;
}

// ============================================================= LIGHT-STEALING VFX (the Hogwarts moment)
const zaps = [];
function makeZap(from, to, color = 0xa0d8ff, power = 1) {
  const pts = [];
  const N = V.ZAP_SEGS;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = new THREE.Vector3().lerpVectors(from, to, t);
    if (i > 0 && i < N) {
      p.x += (Math.random() - 0.5) * 1.6 * power;
      p.y += (Math.random() - 0.5) * 1.2 * power + Math.sin(t * Math.PI) * 0.8;
      p.z += (Math.random() - 0.5) * 1.6 * power;
    }
    pts.push(p);
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(line);
  // bright core
  const core = new THREE.Line(geo.clone(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(core);
  // sparks at the receiver end
  const sg = new THREE.BufferGeometry(); const n = 14; const sp = new Float32Array(n * 3); const sv = [];
  for (let i = 0; i < n; i++) { sp[i * 3] = to.x; sp[i * 3 + 1] = to.y; sp[i * 3 + 2] = to.z; sv.push(new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6)); }
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const sparks = new THREE.Points(sg, new THREE.PointsMaterial({ color, size: 0.22, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(sparks);
  zaps.push({ line, core, sparks, sv, t: 0, life: V.ZAP_LIFE, from, to, power });
  if (zaps.length > 10) { const z = zaps.shift(); killZap(z); }
  A.zap();
}
function killZap(z) {
  scene.remove(z.line, z.core, z.sparks);
  z.line.geometry.dispose(); z.core.geometry.dispose(); z.sparks.geometry.dispose();
  z.line.material.dispose(); z.core.material.dispose(); z.sparks.material.dispose();
}
function updateZaps(dt) {
  for (let i = zaps.length - 1; i >= 0; i--) {
    const z = zaps[i];
    z.t += dt;
    const k = 1 - z.t / z.life;
    if (k <= 0) { killZap(z); zaps.splice(i, 1); continue; }
    // re-jitter every frame for crackle
    const pos = z.line.geometry.attributes.position;
    const N = pos.count;
    for (let j = 1; j < N - 1; j++) {
      const t = j / (N - 1);
      pos.setXYZ(j,
        THREE.MathUtils.lerp(z.from.x, z.to.x, t) + (Math.random() - 0.5) * 1.6 * z.power * k,
        THREE.MathUtils.lerp(z.from.y, z.to.y, t) + (Math.random() - 0.5) * 1.2 * z.power * k + Math.sin(t * Math.PI) * 0.8 * k,
        THREE.MathUtils.lerp(z.from.z, z.to.z, t) + (Math.random() - 0.5) * 1.6 * z.power * k);
    }
    pos.needsUpdate = true;
    z.line.geometry.attributes.position.needsUpdate = true;
    z.core.geometry.copy(z.line.geometry);
    z.line.material.opacity = k;
    z.core.material.opacity = 0.5 * k;
    z.sparks.material.opacity = k;
    const sp = z.sparks.geometry.attributes.position;
    for (let j = 0; j < z.sv.length; j++) { sp.setXYZ(j, sp.getX(j) + z.sv[j].x * dt, sp.getY(j) + z.sv[j].y * dt, sp.getZ(j) + z.sv[j].z * dt); }
    sp.needsUpdate = true;
  }
}
// generic burst (ash on death, rank embers, boss death)
const bursts = [];
function burst(at, color, n = 24, up = 4, spread = 3, size = 0.16, life = 1) {
  const g = new THREE.BufferGeometry(); const p = new Float32Array(n * 3); const v = [];
  for (let i = 0; i < n; i++) { p[i * 3] = at.x; p[i * 3 + 1] = at.y; p[i * 3 + 2] = at.z; v.push(new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * up, (Math.random() - 0.5) * spread)); }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(pts);
  bursts.push({ pts, v, t: 0, life });
}
function updateBursts(dt) {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.t += dt;
    const k = 1 - b.t / b.life;
    if (k <= 0) { scene.remove(b.pts); b.pts.geometry.dispose(); bursts.splice(i, 1); continue; }
    const p = b.pts.geometry.attributes.position;
    for (let j = 0; j < b.v.length; j++) { b.v[j].y -= 2.5 * dt; p.setXYZ(j, p.getX(j) + b.v[j].x * dt, Math.max(0.05, p.getY(j) + b.v[j].y * dt), p.getZ(j) + b.v[j].z * dt); }
    p.needsUpdate = true;
    b.pts.material.opacity = k;
  }
}

// ============================================================= ambers
const amberGeometry = new THREE.IcosahedronGeometry(0.42, 1);
const amberMaterial = new THREE.MeshStandardMaterial({
  color: 0xffa62b, emissive: 0x9a3b05, emissiveIntensity: 1.5, roughness: 0.34, metalness: 0.2,
});
let amberInstances = new THREE.InstancedMesh(amberGeometry, amberMaterial, 64);
amberInstances.name = 'Amber pickups';
amberInstances.count = 0;
amberInstances.frustumCulled = false;
scene.add(amberInstances);
const amberDummy = new THREE.Object3D();
function syncAmbers(list) {
  const active = list.filter((a) => a.on);
  if (active.length > amberInstances.instanceMatrix.count) {
    const replacement = new THREE.InstancedMesh(amberGeometry, amberMaterial, Math.max(active.length, amberInstances.instanceMatrix.count * 2));
    replacement.name = 'Amber pickups';
    replacement.frustumCulled = false;
    scene.remove(amberInstances);
    amberInstances.dispose();
    amberInstances = replacement;
    scene.add(amberInstances);
  }
  const t = performance.now() / 1000;
  active.forEach((a, i) => {
    amberDummy.position.set(a.x, WORLD.heightAt(worldSeed, a.x, a.z) + 0.7, a.z);
    amberDummy.rotation.set(0, t * 0.8 + a.i, Math.sin(t * 1.7 + a.i) * 0.12);
    amberDummy.updateMatrix();
    amberInstances.setMatrixAt(i, amberDummy.matrix);
  });
  amberInstances.count = active.length;
  amberInstances.instanceMatrix.needsUpdate = true;
}

// ============================================================= arrows (glowing bolts)
const boltMeshes = [];
const boltGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6);
boltGeo.rotateX(Math.PI / 2);
function syncBolts(list) {
  while (boltMeshes.length < list.length) {
    const m = new THREE.Mesh(boltGeo, new THREE.MeshBasicMaterial({ color: V.BOLT, blending: THREE.AdditiveBlending, transparent: true }));
    scene.add(m); boltMeshes.push(m);
  }
  for (let i = 0; i < boltMeshes.length; i++) {
    const m = boltMeshes[i];
    if (i < list.length) { m.visible = true;     m.position.set(list[i].x, WORLD.heightAt(worldSeed, list[i].x, list[i].z) + 1.2, list[i].z); }
    else m.visible = false;
  }
}

// ============================================================= input
const keys = {};
let bindingCapture = null;
const bindingNames = {
  up: 'Move up',
  down: 'Move down',
  left: 'Move left',
  right: 'Move right',
  attack: 'Attack',
  run: 'Run',
  bait: 'Bait',
  focus: 'Focus',
};
function keyLabel(code) {
  const labels = {
    Space: 'SPACE',
    ShiftLeft: 'LEFT SHIFT',
    ShiftRight: 'RIGHT SHIFT',
    ControlLeft: 'LEFT CTRL',
    ControlRight: 'RIGHT CTRL',
    AltLeft: 'LEFT ALT',
    AltRight: 'RIGHT ALT',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  };
  return labels[code] || code.replace(/^Key/, '').replace(/^Digit/, '');
}
function refreshBindings() {
  for (const button of document.querySelectorAll('[data-bind]')) {
    const action = button.dataset.bind;
    button.textContent = bindingCapture === action ? 'PRESS A KEY…' : keyLabel(userSettings.bindings[action]);
    button.classList.toggle('listening', bindingCapture === action);
    button.setAttribute('aria-label', `${bindingNames[action]}: ${keyLabel(userSettings.bindings[action])}. Click to change.`);
  }
  for (const label of document.querySelectorAll('[data-action-keys]')) {
    const action = label.dataset.actionKeys;
    const code = action === 'move'
      ? ['up', 'left', 'down', 'right'].map((name) => keyLabel(userSettings.bindings[name])).join(' / ')
      : keyLabel(userSettings.bindings[action]);
    label.textContent = code;
  }
}
for (const button of document.querySelectorAll('[data-bind]')) {
  button.addEventListener('click', () => {
    bindingCapture = button.dataset.bind;
    $('settings-status').textContent = `PRESS A KEY FOR ${bindingNames[bindingCapture].toUpperCase()} · ESC TO CANCEL`;
    refreshBindings();
  });
}
addEventListener('keydown', (e) => {
  if (bindingCapture) {
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') {
      bindingCapture = null;
      $('settings-status').textContent = '';
      refreshBindings();
      return;
    }
    if (/^(Control|Alt|Meta)(Left|Right)$/.test(e.code)
      || (e.code.startsWith('Shift') && bindingCapture !== 'run')
      || e.code === 'Tab') return;
    const previous = userSettings.bindings[bindingCapture];
    const duplicate = Object.keys(userSettings.bindings).find((action) => action !== bindingCapture && userSettings.bindings[action] === e.code);
    if (duplicate) userSettings.bindings[duplicate] = previous;
    userSettings.bindings[bindingCapture] = e.code;
    bindingCapture = null;
    $('settings-status').textContent = duplicate ? 'KEYS SWAPPED' : 'BINDING SAVED';
    saveSettings();
    refreshBindings();
    return;
  }
  if (document.getElementById('settings-controls')?.open || e.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
  keys[e.code] = true;
  if (!e.repeat) {
    if (e.code === userSettings.bindings.bait) doBait();
    if (e.code === userSettings.bindings.focus) doFocus();
    if (e.code === userSettings.bindings.attack) doAttack();
  }
  if (inGame && Object.values(userSettings.bindings).includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
refreshBindings();
const isTouch = 'ontouchstart' in window;
if (!isTouch) addEventListener('pointermove', (e) => {
  if (document.getElementById('settings-controls')?.open) return;
  aimPointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  pointerHasMoved = true;
});
// touch controls
const T = { jx: null, joyBase: null, look: null, lookId: null, run: false };
const joyEl = document.getElementById('joy'); const joyKnob = document.getElementById('joyknob');
addEventListener('blur', () => {
  for (const code of Object.keys(keys)) keys[code] = false;
  T.run = false;
});
if (isTouch) {
  renderer.domElement.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.4 && !T.jx) { T.jx = t.identifier; T.joyBase = { x: t.clientX, y: t.clientY }; joyEl.style.display = 'block'; joyEl.style.left = (t.clientX - 60) + 'px'; joyEl.style.top = (t.clientY - 60) + 'px'; moveKnob(t); }
      else if (!T.lookId) { T.lookId = t.identifier; T.look = { x: t.clientX, y: t.clientY }; }
    }
  }, { passive: true });
  renderer.domElement.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === T.jx) moveKnob(t);
      else if (t.identifier === T.lookId) {
        aimDirection.set(t.clientX - innerWidth / 2, t.clientY - innerHeight / 2);
        if (aimDirection.lengthSq() > 0.001) aimDirection.normalize();
        T.look = { x: t.clientX, y: t.clientY };
      }
    }
  }, { passive: true });
  renderer.domElement.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === T.jx) { T.jx = null; joyEl.style.display = 'none'; joyKnob.style.transform = 'translate(0,0)'; }
      if (t.identifier === T.lookId) T.lookId = null;
    }
  }, { passive: true });
}
function moveKnob(t) {
  const dx = t.clientX - T.joyBase.x, dy = t.clientY - T.joyBase.y;
  const d = Math.hypot(dx, dy), m = Math.min(d, 48);
  joyKnob.style.transform = d > 0 ? `translate(${dx / d * m}px,${dy / d * m}px)` : 'translate(0,0)';
  T.joyVec = d > 8 ? { x: dx / d, y: dy / d, m: m / 48 } : null;
}
// ---- memories (quiet fragments of the street) ----
const memMeshes = new Map();
function syncMems(list, t) {
  const seen = new Set();
  for (const m of list) {
    if (!m.on) continue;
    seen.add(m.i);
    let sp = memMeshes.get(m.i);
    if (!sp) {
      sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: 0x9fd8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.name = 'Memory fragment';
      sp.userData = { ph: Math.random() * 6.28 };
      scene.add(sp);
      memMeshes.set(m.i, sp);
    }
    sp.position.set(m.x, WORLD.heightAt(worldSeed, m.x, m.z) + 0.9 + Math.sin(t * 1.4 + sp.userData.ph) * 0.25, m.z);
    sp.scale.setScalar(0.55 + Math.sin(t * 2.2 + sp.userData.ph) * 0.18);
  }
  for (const [i, sp] of memMeshes) if (!seen.has(i)) { scene.remove(sp); sp.material.dispose(); memMeshes.delete(i); }
}
function showMemory(i) {
  const L = LORE_TEXT[i];
  if (!L) return;
  A.memory();
  if (meState) burst(new THREE.Vector3(meState.x, 1.4, meState.z), 0x9fd8ff, 30, 6, 3, 0.18, 1.2);
  $('memotitle').textContent = 'ORUVEL · ' + L.title + '  ·  ' + (i + 1) + '/' + LORE_TEXT.length;
  $('memotext').textContent = L.text;
  $('memov').style.display = 'flex';
}
let inGame = false, myFuel = 100;
function sendGameMessage(message) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}
function doAttack() { if (!inGame) return; A.ensure(); if (meState && meState.al) { const target = aimTarget(); sendGameMessage({ t: 'attack', tgt: target.tgt, id: target.id }); } attackAnim(); }
function doBait() { if (!inGame) return; A.ensure(); if (meState && meState.al && meState.f >= 11) sendGameMessage({ t: 'bait' }); A.blip(); }
function doFocus() {
  if (!inGame || !ws || ws.readyState !== WebSocket.OPEN) return; A.ensure();
  if (!meState || !meState.al) return;
  if ((meState.a || 0) < FOCUSCFG.AMBER) { showBanner('No Mael to spend.', ''); A.blip(); return; }
  sendGameMessage({ t: 'focus' });
  A.focus();
  burst(new THREE.Vector3(meState.x, 1.4, meState.z), 0x9fd8ff, 26, 5, 2.6, 0.16, 1);
  showBanner('FOCUS · Mael becomes flame', 'good');
}
function attackAnim() { if (selfChar) { selfChar._atkT = 0; } attackT = 0.4; A.swing(); }
let attackT = 0;
// aim: nearest player or boss near the crosshair ray
function aimTarget() {
  const origin = new THREE.Vector3(meState.x, 1.5, meState.z);
  let best = null, bd = 7;
  const tryHit = (x, z, tgt, id) => {
    const dx = x - origin.x, dz = z - origin.z, d = Math.hypot(dx, dz);
    if (d > 0 && (dx * aimDirection.x + dz * aimDirection.y) / d > 0.5 && d < bd) {
      bd = d;
      best = { tgt, id };
    }
  };
  if (lastState) {
    for (const p of lastState.p) if (p.i !== myId && p.al) tryHit(p.x, p.z, 'p', p.i);
    for (const b of lastState.b) if (b.st === 'awake') tryHit(b.x, b.z, 'b', b.i);
  }
  return best || { tgt: 'p', id: null };
}

// camera shake
let shake = 0;
function addShake(v) { if (!userSettings.reducedMotion) shake = Math.min(1, shake + v); }
function updateCamera(dt) {
  const ground = WORLD.heightAt(worldSeed, meState.x, meState.z);
  const bob = userSettings.reducedMotion ? 0 : Math.sin(performance.now() * 0.004) * 0.02 * (moving ? 2 : 1);
  camera.position.set(meState.x, ground + 34 + bob, meState.z + 22);
  camera.lookAt(meState.x, ground, meState.z);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.3;
    camera.position.z += (Math.random() - 0.5) * shake * 0.3;
    shake = Math.max(0, shake - dt * 2.5);
  }
  camera.updateMatrixWorld();
}
function updateAim() {
  if (!pointerHasMoved || !meState) return;
  aimRaycaster.setFromCamera(aimPointer, camera);
  if (!aimRaycaster.ray.intersectPlane(aimPlane, aimHit)) return;
  const dx = aimHit.x - meState.x, dz = aimHit.z - meState.z;
  const length = Math.hypot(dx, dz);
  if (length > 0.05) aimDirection.set(dx / length, dz / length);
}
let moving = false, stateSendAccum = 0;
function updateMovement(dt) {
  if (!meState || !meState.al) { moving = false; return; }
  let mx = 0, mz = 0, run = false;
  if (keys[userSettings.bindings.up] || (userSettings.bindings.up === 'KeyW' && keys.ArrowUp)) mz -= 1;
  if (keys[userSettings.bindings.down] || (userSettings.bindings.down === 'KeyS' && keys.ArrowDown)) mz += 1;
  if (keys[userSettings.bindings.left] || (userSettings.bindings.left === 'KeyA' && keys.ArrowLeft)) mx -= 1;
  if (keys[userSettings.bindings.right] || (userSettings.bindings.right === 'KeyD' && keys.ArrowRight)) mx += 1;
  if (T.joyVec) { mx = T.joyVec.x; mz = T.joyVec.y; }
  run = !!(keys[userSettings.bindings.run] || T.run);
  if (meState.su) { mx = 0; mz = 0; run = false; } // stunned
  const d = Math.hypot(mx, mz);
  moving = d > 0.1 && !meState.su;
  const classSpeed = (CLASSES[myClsId] && CLASSES[myClsId].speed) || GAMECFG.fallbackSpeed;
  const moveSpeed = classSpeed * (run ? GAMECFG.run : 1);
  if (moving) {
    const length = Math.hypot(mx, mz);
    if (length > 1) { mx /= length; mz /= length; }
    const next = WORLD.resolveMove(worldSeed, meState.x, meState.z, meState.x + mx * moveSpeed * dt, meState.z + mz * moveSpeed * dt);
    meState.x = next.x;
    meState.z = next.z;
  }
  const facing = Math.atan2(aimDirection.x, aimDirection.y);
  // Fixed CONFIG rate: never one state packet per rendered frame.
  stateSendAccum += dt;
  const stateInterval = 1 / (GAMECFG.stateHz || 20);
  if (stateSendAccum >= stateInterval) {
    stateSendAccum %= stateInterval;
    sendGameMessage({ t: 'state', x: +meState.x.toFixed(2), z: +meState.z.toFixed(2), d: +facing.toFixed(2), r: run ? 1 : 0 });
  }
  selfG.position.set(meState.x, WORLD.heightAt(worldSeed, meState.x, meState.z), meState.z);
  if (selfChar) {
    const st = meState.al ? (attackT > 0 ? 'attack' : (moving ? (run ? 'run' : 'walk') : 'idle')) : 'dead';
    charAnimUpdate(selfChar, { _speed: moving ? moveSpeed : 0 }, dt, st, facing);
    selfChar._died = meState.al ? false : selfChar._died;
    selfG.rotation.y = selfChar.isSpriteCharacter ? 0 : facing;
  }
  attackT = Math.max(0, attackT - dt);
  // torch
  if (selfTorch) {
    const f = meState.f;
    const flick = 1 + Math.sin(performance.now() * 0.02) * 0.08 + Math.random() * 0.05;
    selfTorch.light.intensity = f > 0 ? (2.2 + (f / 100) * 1.4 + (meState.r || 0) * 0.3) * flick : 0;
    selfTorch.light.distance = f > 0 ? 14 + 10 * Math.min(1, f / 100) + (meState.r || 0) * 1.2 : 0;
    selfTorch.g.visible = f > 0;
  }
  // fog density rises in the dark
  scene.fog.density += ((meState.f > 0 ? V.FOG_DENSITY : 0.05) - scene.fog.density) * Math.min(1, dt * 2);
}

// ============================================================= HUD
const $ = (id) => document.getElementById(id);
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const fuelBar = $('fuelbar'), fuelTxt = $('fueltxt'), fuelTimeEl = $('fueltime'), rankTxt = $('ranktxt'), streakTxt = $('streaktxt'), feedEl = $('feed'), darkCd = $('darkcd'), banner = $('banner'), deathOv = $('deathov'), deathMsg = $('deathmsg'), bossBar = $('bossbar'), bossName = $('bossname'), bossFill = $('bossfill'), threatEl = $('threat'), stunEl = $('stun'), vignette = $('vignette'), flashEl = $('flash'), miniEl = $('mini'), pipsEl = $('pips'), memcountEl = $('memcount'), rogrid = $('rogrid'), loreEl = $('lorebox'), rosterWrap = $('roster'), nameInp = $('name'), playBtn = $('play'), killboard = $('kblines');
if (!graphicsAvailable) {
  playBtn.disabled = true;
  playBtn.textContent = 'RENDERER UNAVAILABLE';
  playBtn.title = 'This browser could not create a WebGL renderer. Enable WebGL or try another browser.';
}

let rosterBuilt = false, myClsId = 'barb';
function buildRoster() {
  if (rosterBuilt) return;
  rosterBuilt = true;
  rogrid.replaceChildren();
  for (const id of CLASS_IDS) {
    const c = CLASSES[id];
    const card = document.createElement('div');
    card.className = 'rclass';
    card.style.setProperty('--tint', '#' + c.tint.toString(16).padStart(6, '0'));
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-pressed', 'false');
    card.setAttribute('aria-label', `${c.name}, ${c.title}, ${c.kind}`);
    const portrait = el('div', 'rportrait');
    portrait.setAttribute('aria-label', `${c.name} character preview`);
    const portraitImage = el('img', 'fallback-sprite');
    portraitImage.alt = '';
    portraitImage.draggable = false;
    portraitImage.style.setProperty('--idle-delay', `${-(CLASS_IDS.indexOf(id) * 0.13)}s`);
    portrait.appendChild(portraitImage);
    card.replaceChildren(
      portrait,
      el('div', 'rname', c.name),
      el('div', 'rtitle', c.title),
      el('div', 'rkind', c.kind === 'melee' ? 'MELEE' : 'RANGED'),
    );
    setClassPortrait(id, portraitImage);
    const selectCard = (playSound = true) => {
      if (playSound) { A.ensure(); A.blip(); }
      myClsId = id;
      [...rogrid.children].forEach((el) => { el.classList.remove('sel'); el.setAttribute('aria-pressed', 'false'); });
      card.classList.add('sel');
      card.setAttribute('aria-pressed', 'true');
      const stats = el('div', 'lorestats');
      stats.append(
        el('span', '', `speed ${'▮'.repeat(Math.round(c.speed))}`),
        el('span', '', `reach ${c.range}m`),
        el('span', '', `tempo ${(10 / c.cd).toFixed(1)}/10s`),
      );
      loreEl.replaceChildren(
        el('div', 'lorename', `${c.name}, ${c.title}`),
        el('div', 'loretext', c.lore),
        stats,
      );
    };
    card.onclick = selectCard;
    card.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCard(); } };
    rogrid.appendChild(card);
  }
  const firstCard = rogrid.children[0];
  if (firstCard) firstCard.onclick(false);
  // boss dossier
  const dossier = document.createDocumentFragment();
  for (const b of Object.values(BOSSES)) {
    const details = document.createElement('details');
    details.className = 'bcard';
    const summary = document.createElement('summary');
    const title = document.createElement('b');
    title.style.color = V2HEX(V.BOSS_COLORS[b.id]);
    title.textContent = b.name;
    summary.append(title, el('span', 'rumor', 'a street rumor · open to listen'));
    details.append(summary, el('span', '', b.lore));
    dossier.appendChild(details);
  }
  $('bosslore').replaceChildren(dossier);
}
function showBanner(txt, cls = '') {
  banner.textContent = txt;
  banner.className = 'banner show ' + cls;
  clearTimeout(banner._t);
  banner._t = setTimeout(() => { banner.className = 'banner'; }, 2600);
}
function flash(color, op = 0.5) {
  flashEl.style.background = color;
  flashEl.style.opacity = op;
  clearTimeout(flashEl._t);
  flashEl._t = setTimeout(() => { flashEl.style.opacity = 0; }, 90);
}
let prevAlive = new Set(), lastState = null, meState = null;
let lastFeedKey = '', lastZapT = 0, lastSiphonZap = 0, lastDrainZap = 0, lastHpFlash = 0;
function hudTick(state, dt, t) {
  meState = state.p.find((p) => p.i === myId);
  lastState = state;
  if (!meState) return;
  if (meState.al && deathOv.style.display === 'flex') deathOv.style.display = 'none';
  // fuel
  const f = meState.f;
  fuelBar.style.width = Math.min(100, (f / 100) * 100) + '%';
  fuelBar.className = f > 40 ? 'f-ok' : f > 15 ? 'f-warn' : 'f-crit';
  fuelTxt.textContent = f > 0 ? Math.ceil(f) : 'DARK';
  fuelTxt.style.color = f <= 15 ? '#ff6050' : f <= 40 ? '#ffca70' : '';
  const rk = meState.r || 0;
  const drainRate = GAMECFG.drain * (1 + rk * GAMECFG.rankDrain) * (meState.lu ? GAMECFG.runDrain : 1);
  fuelTimeEl.textContent = f > 0 ? `wick holds ~${Math.ceil(f / drainRate)}s${meState.lu ? ' · running' : ''}` : 'wick gone · the Pause begins';
  rankTxt.textContent = EMBER_RANKS[Math.max(0, Math.min(10, rk))].toUpperCase();
  rankTxt.style.color = rk >= 10 ? '#ffd080' : '';
  pipsEl.replaceChildren(...Array.from({ length: 10 }, (_, i) => {
    const pip = document.createElement('span');
    pip.className = i < rk ? 'pip on' : 'pip';
    return pip;
  }));
  streakTxt.textContent = meState.st >= 2 ? '🔥 ×' + meState.st + (meState.bk ? ' BLOODLIT' : '') : '';
  // dark countdown
  if (f <= 0 && meState.dn > 0) { darkCd.textContent = 'THE PAUSE ENDS IN ' + Math.ceil(meState.dn / 1000); darkCd.style.display = 'block'; }
  else darkCd.style.display = 'none';
  // stunned
  stunEl.style.display = meState.su ? 'block' : 'none';
  // memories collected (per-player, server-authoritative)
  if (memcountEl) memcountEl.textContent = 'ORUVEL · ' + (meState.mc || 0) + '/' + (LORE_TEXT.length || 10);
  // threat
  threatEl.textContent = 'street ' + (state.hi.tf > 110 ? 'FEEDS' : state.hi.tf > 90 ? 'wary' : 'quiet') + ' · ' + state.hi.tf + '%';
  // vignette by darkness + boss proximity
  let vig = f <= 0 ? 0.55 : Math.max(0, (40 - f) / 40) * 0.25;
  let nearBoss = 1e9;
  for (const b of state.b) if (b.st === 'awake') nearBoss = Math.min(nearBoss, Math.hypot(b.x - meState.x, b.z - meState.z));
  if (nearBoss < 24) vig = Math.max(vig, (1 - nearBoss / 24) * 0.5);
  vignette.style.opacity = vig;
  // feed
  const fk = state.f.map((x) => x.t + '|' + x.m).join('\n');
  if (fk !== lastFeedKey) {
    feedEl.replaceChildren(...state.f.map((line) => el('div', 'fline', line.m)));
    lastFeedKey = fk;
    for (const line of state.f) {
      if (line.m.includes(meState.n + ' takes') || line.m.includes(meState.n + ' slays')) { showBanner(line.m.replace(meState.n, 'YOU'), 'good'); }
    }
  }
  // death transitions (zaps, bursts, flash)
  const aliveNow = new Set(state.p.filter((p) => p.al).map((p) => p.i));
  for (const p of state.p) {
    if (p.al && !prevAlive.has(p.i)) {
      // respawned
    }
    if (!p.al && prevAlive.has(p.i)) {
      const R = remotes.get(p.i);
      const at = R ? new THREE.Vector3(R.x, 1, R.z) : new THREE.Vector3(p.x, 1, p.z);
      burst(at, 0xff4020, 26, 5, 3.4, 0.2, 1.1);
      burst(at, 0x909090, 14, 3, 2, 0.14, 1.4);
      if (p.i === myId) {
        flash('#ff2020', 0.75); A.die(); A.maskCrack(); addShake(1);
        deathOv.style.display = 'flex';
        const line = state.f.find((x) => x.m.includes(' ' + p.n)) || { m: 'THE DARK takes ' + p.n };
        deathMsg.textContent = line.m;
      }
      // did I take them?
      const iKilled = state.f.some((x) => x.m.startsWith(meState.n + ' '));
      const victimName = p.n;
      if (iKilled && state.f.some((x) => x.m.startsWith(meState.n + ' takes ' + victimName) || x.m.startsWith(meState.n + ' slays'))) {
        const to = new THREE.Vector3(meState.x, 1.6, meState.z);
        makeZap(at, to, 0x9fd8ff, 1.4);
        burst(to, 0x9fd8ff, 18, 3, 2, 0.18, 0.7);
        flash('#9fd8ff', 0.22); A.kill(); addShake(0.5);
      }
    }
  }
  prevAlive = aliveNow;
  // siphon zap (I'm dark, draining a lit neighbour)
  if (f <= 0 && t - lastSiphonZap > 0.3) {
    let victim = null, bd = 6;
    for (const p of state.p) { if (p.i === myId || !p.al || p.f <= 2) continue; const d = Math.hypot(p.x - meState.x, p.z - meState.z); if (d < bd) { bd = d; victim = p; } }
    if (victim) {
      lastSiphonZap = t;
      makeZap(new THREE.Vector3(victim.x, 1.6, victim.z), new THREE.Vector3(meState.x, 1.4, meState.z), 0x60ff90, 0.55);
      A.siphon();
    }
  }
  // Dracula is feeding on ME
  for (const b of state.b) {
    const B = bossVis.get(b.i);
    if (!B) continue;
    if (b.st === 'awake' && B && B.def.id === 'dracula' && f > 0 && Math.hypot(b.x - meState.x, b.z - meState.z) < 9 && t - lastDrainZap > 0.4) {
      lastDrainZap = t;
      makeZap(new THREE.Vector3(meState.x, 1.6, meState.z), new THREE.Vector3(b.x, 2.5, b.z), 0xff2244, 0.8);
    }
    // boss hit feedback
    if (B && B._hp !== undefined && b.hp < B._hp) { A.bossHit(); burst(new THREE.Vector3(b.x, 2, b.z), 0xffffff, 8, 3, 2, 0.12, 0.4); if (b.hp <= 0) { A.slay(); burst(new THREE.Vector3(b.x, 2, b.z), V.BOSS_COLORS[B.def.id] || 0xff2244, 60, 8, 6, 0.3, 1.6); showBanner('💀 ' + B.def.name + ' is UNBANNED', 'good'); } B._hp = b.hp; }
    // state transitions
    if (B && B._st !== b.st) {
      if (b.st === 'awake' && B._st === 'dormant' && nearBoss < 60) { A.rumble(); A.drone(); addShake(0.7); flash('#ff2244', 0.25); showBanner('⚰ ' + B.def.name + ' IS LOOSE'); }
      if (b.st === 'dead' && B._st === 'awake') { /* handled above */ }
      B._st = b.st;
    }
    if (B && B.def.id === 'vargulf' && b.h === 'windup' && nearBoss < 45 && B._h !== 'windup') A.howl();
    if (B) B._h = b.h;
  }
  // heartbeat by nearest boss
  if (nearBoss < 22) {
    const iv = 1.5 - (nearBoss / 22) * 1.0;
    if (t - (hudTick._hb || 0) > iv) { hudTick._hb = t; A.heartbeat(); }
  }
  // boss bar (top center) — show the nearest awake boss, or the one holding me
  let show = null;
  for (const b of state.b) {
    if (b.st !== 'awake') continue;
    const d = Math.hypot(b.x - meState.x, b.z - meState.z);
    const held = b.tg === myId;
    if (held || d < 32) show = { b, d, held };
  }
  if (show) {
    const B = bossVis.get(show.b.i);
    bossBar.style.display = 'block';
    bossName.textContent = (show.held ? '👁 IT IS HOLDING YOU — ' : '') + (B ? B.def.name : '???') + '  ' + Math.round((1 - show.b.hp / Math.max(1, show.b.hm)) * 100) + '%';
    bossName.style.color = show.held ? '#ff5050' : '#e8e0c8';
    bossFill.style.width = (100 - (show.b.hp / Math.max(1, show.b.hm)) * 100) + '%';
    bossFill.style.background = V2HEX(V.BOSS_COLORS[(B && B.def.id) || 'dracula']);
  } else bossBar.style.display = 'none';
  // killboard
  const claimants = state.p.filter((p) => p.s > 0).sort((a, b) => b.s - a.s).slice(0, 5);
  if (!claimants.length) {
    const empty = el('div', '', 'no claims yet');
    empty.style.color = '#4a5268';
    killboard.replaceChildren(empty);
  } else {
    const rows = document.createDocumentFragment();
    for (const p of claimants) {
      const row = document.createElement('div');
      row.append(document.createTextNode(p.n + ' '));
      const score = document.createElement('b');
      score.textContent = String(p.s);
      row.appendChild(score);
      if (p.st >= 2) row.append(' 🔥');
      rows.appendChild(row);
    }
    killboard.replaceChildren(rows);
  }
}
function drawMini(state) {
  const c = miniEl.getContext('2d'); const S = miniEl.width;
  const originX = state && meState ? meState.x : 0, originZ = state && meState ? meState.z : 0;
  const range = 72, scale = (S - 24) / (range * 2);
  c.clearRect(0, 0, S, S);
  c.fillStyle = 'rgba(8,10,16,0.9)'; c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 2, 0, 7); c.fill();
  c.strokeStyle = 'rgba(255,150,40,0.18)'; c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 12, 0, 7); c.stroke();
  const P = (x, z) => [S / 2 + (x - originX) * scale, S / 2 + (z - originZ) * scale];
  // cages (server state when in game, local config on the title screen)
  const cgs = state ? state.c : cageDefs;
  const bossesNow = state ? state.b : null;
  for (const cg of cgs) {
    const [x, y] = P(cg.x, cg.z);
    if (x < 8 || x > S - 8 || y < 8 || y > S - 8) continue;
    const bcol = V2HEX(V.BOSS_COLORS[['dracula', 'vargulf', 'lamplight'][cg.i]]);
    c.fillStyle = bcol;
    c.globalAlpha = 0.85; c.fillRect(x - 3, y - 3, 6, 6); c.globalAlpha = 1;
  }
  if (!state) {
    c.fillStyle = 'rgba(160,170,200,0.5)'; c.font = '8px monospace'; c.textAlign = 'center';
    c.fillText('T H E   S T R E E T', S / 2, S - 14);
    return;
  }
  // ambers
  for (const a of state.a) if (a.on) {
    const [x, y] = P(a.x, a.z);
    if (x >= 8 && x <= S - 8 && y >= 8 && y <= S - 8) { c.fillStyle = '#ffb040'; c.fillRect(x - 1, y - 1, 2, 2); }
  }
  // players
  for (const p of state.p) {
    if (!p.al) continue;
    const [x, y] = P(p.x, p.z);
    if (x < 8 || x > S - 8 || y < 8 || y > S - 8) continue;
    c.fillStyle = p.i === myId ? '#ffffff' : (p.f > 0 ? '#ffca70' : '#606060');
    c.beginPath(); c.arc(x, y, p.i === myId ? 3 : 2, 0, 7); c.fill();
  }
  // bosses (pulsing)
  const tt = performance.now() / 1000;
  for (const b of state.b) {
    if (b.st !== 'awake') continue;
    const [x, y] = P(b.x, b.z);
    if (x < 8 || x > S - 8 || y < 8 || y > S - 8) continue;
    c.fillStyle = V2HEX(V.BOSS_COLORS[['dracula', 'vargulf', 'lamplight'][b.i]]);
    const pr = 4 + Math.sin(tt * 6) * 1.2;
    c.beginPath(); c.arc(x, y, pr, 0, 7); c.fill();
  }
  // north tick
  c.fillStyle = 'rgba(160,170,200,0.6)'; c.font = '8px monospace'; c.textAlign = 'center';
  c.fillText('N', S / 2, 10);
}

// ============================================================= netcode
let ws = null;
let reconnectTimer = null, reconnectDelay = 1000, reconnectRequested = false;
function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
  clearTimeout(reconnectTimer);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(proto + '://' + location.host);
  ws = socket;
  socket.onopen = () => { socket.send(JSON.stringify({ t: 'join', name: nameInp.value.trim() || 'Wanderer', cls: myClsId })); };
  socket.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); }
    catch (error) { console.error('The server sent an invalid game message.', error); return; }
    if (m.t === 'welcome') {
      reconnectDelay = 1000;
      myId = m.id;
      if (Number.isSafeInteger(m.seed)) setWorldSeed(m.seed);
      CLASSES = m.classes || CLASSES;
      selfCls = CLASSES[myClsId] || CLASSES[myClsId] || CLASSES.barb;
      selfTint = selfCls.tint;
      rebuildSelf();
      rosterWrap.style.display = 'none';
      document.querySelector('.hud').style.display = 'block';
      inGame = true;
      renderer.domElement.style.zIndex = '0';
      renderer.domElement.style.pointerEvents = 'auto';
      renderer.domElement.style.cursor = isTouch ? 'default' : 'crosshair';
      deathOv.style.display = 'none';
      A.ensure();
      MUS.start();
      showBanner('Stay bright. Stay brief.');
    }
    if (m.t === 'memory') showMemory(m.i);
    if (m.t === 'correct') { if (meState) { meState.x = m.x; meState.z = m.z; } return; }
    if (m.t === 'whiff') {
      if (m.reason === 'light') { A.swing(); showBanner('THE LIGHT BETRAYS YOU — strike only in the dark', ''); }
      return;
    }
    if (m.t === 'afk') showBanner('THE STREET LET YOU GO — you stood too still', '');
    if (m.t === 'state') onState(m);
    if (m.t === 'full') {
      reconnectRequested = false;
      clearTimeout(reconnectTimer);
      showBanner('THE STREET IS FULL');
    }
  };
  socket.onerror = (event) => console.error('Game connection error.', event);
  socket.onclose = (event) => {
    console.warn('Game connection closed.', { code: event.code, reason: event.reason, wasClean: event.wasClean });
    if (socket !== ws || !reconnectRequested) return;
    deathOv.style.display = 'flex';
    deathMsg.textContent = inGame ? 'the street flickers · reconnecting…' : 'the street is quiet · reconnecting…';
    const delay = reconnectDelay;
    reconnectDelay = Math.min(15000, reconnectDelay * 2);
    reconnectTimer = setTimeout(connect, delay);
  };
}
function onState(m) {
  ensureCages(m.c);
  hudTick(m, 0.05, performance.now() / 1000);
  updateRemotes(m, 0.05);
  updateBosses(m, 0.05, performance.now() / 1000);
  syncAmbers(m.a);
  syncMems(m.m || [], performance.now() / 1000);
  syncBolts(m.r);
}
playBtn.onclick = () => {
  A.ensure(); A.blip();
  reconnectRequested = true;
  reconnectDelay = 1000;
  connect();
};
nameInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') playBtn.click(); });

// ============================================================= main loop
const performanceHud = new URLSearchParams(location.search).get('perf') === '1'
  ? document.createElement('output')
  : null;
if (performanceHud) {
  performanceHud.style.cssText = 'position:fixed;left:12px;top:12px;z-index:1000;padding:8px 10px;background:#080a10e8;border:1px solid #5a4010;color:#ffc66d;font:11px monospace;pointer-events:none;white-space:pre;';
  performanceHud.textContent = graphicsAvailable ? 'GPU telemetry warming up…' : 'GPU telemetry unavailable in this browser context.';
  document.body.appendChild(performanceHud);
}
let perfFrames = 0, perfSince = performance.now();
function sceneBreakdown() {
  const frustum = new THREE.Frustum();
  frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const byKind = Object.create(null), byRoot = Object.create(null);
  let visibleMeshes = 0;
  const visit = (object, rootName, parentVisible) => {
    if (!parentVisible || !object.visible) return;
    if (object.isMesh || object.isPoints || object.isSprite) {
      if (object.frustumCulled && object.geometry) {
        if (object.isInstancedMesh && !object.boundingSphere) object.computeBoundingSphere();
        else if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
        if (!frustum.intersectsObject(object)) return;
      }
      visibleMeshes++;
      const kind = object.isInstancedMesh ? 'instanced' : object.isSkinnedMesh ? 'skinned' : object.isSprite ? 'sprite' : object.isPoints ? 'points' : 'mesh';
      const triangles = object.geometry?.index
        ? object.geometry.index.count / 3
        : (object.geometry?.attributes.position?.count || 0) / 3;
      const instances = object.isInstancedMesh ? object.count : 1;
      const materialCount = Array.isArray(object.material) ? object.material.length : 1;
      const groups = object.geometry?.groups?.length || 1;
      const calls = Math.max(materialCount, groups);
      byKind[kind] = byKind[kind] || { objects: 0, calls: 0, triangles: 0 };
      byKind[kind].objects++;
      byKind[kind].calls += calls;
      byKind[kind].triangles += triangles * instances;
      byRoot[rootName] = byRoot[rootName] || { objects: 0, calls: 0, triangles: 0 };
      byRoot[rootName].objects++;
      byRoot[rootName].calls += calls;
      byRoot[rootName].triangles += triangles * instances;
    }
    for (const child of object.children) visit(child, rootName, true);
  };
  for (const root of scene.children) visit(root, root.name || root.type, true);
  const topRoots = Object.entries(byRoot)
    .map(([name, counts]) => ({ name, ...counts }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 6);
  return { visibleMeshes, byKind, topRoots };
}
function reportPerformance(now, rendered) {
  if (!performanceHud || !graphicsAvailable) return;
  if (rendered) perfFrames++;
  if (now - perfSince < 2000) return;
  const seconds = (now - perfSince) / 1000;
  const main = renderer.info;
  const breakdown = inGame && rendered ? sceneBreakdown() : null;
  const frames = Math.max(1, perfFrames);
  const stats = {
    fps: Math.round(perfFrames / seconds),
    mode: inGame ? 'match' : 'lobby',
    callsPerFrame: Math.round(main.render.calls / frames),
    trianglesPerFrame: Math.round(main.render.triangles / frames),
    programs: main.programs.length,
    pixelRatio: renderer.getPixelRatio().toFixed(2),
    breakdown,
  };
  const top = breakdown?.topRoots.map((root) => `${root.name}: ${root.calls} calls / ${Math.round(root.triangles).toLocaleString()} tris`).join('\n') || 'lobby roster pass';
  const kinds = breakdown
    ? Object.entries(breakdown.byKind).map(([kind, counts]) => `${kind} ${counts.objects}/${counts.calls}`).join(' · ')
    : '';
  performanceHud.textContent = `${stats.mode.toUpperCase()} · ${stats.fps} FPS · ${stats.callsPerFrame} DRAW/FRAME\n${stats.trianglesPerFrame.toLocaleString()} TRI/FRAME · ${breakdown?.visibleMeshes || 0} VISIBLE · ${stats.programs} SHADERS\n${kinds}\n${top}\nPIXEL RATIO ${stats.pixelRatio}`;
  console.info('[LIGHTS OUT PERF]', stats);
  main.reset();
  perfFrames = 0;
  perfSince = now;
}
let lastT = performance.now(), lastBiomeCheck = 0, lastLobbyFrame = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (!inGame) {
    if (now - lastLobbyFrame < 1000 / 30) return;
    lastLobbyFrame = now;
  }
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  const t = now / 1000;
  if (inGame) {
    const worldX = meState ? meState.x : 0;
    const worldZ = meState ? meState.z : 0;
    updateWorldChunks(worldX, worldZ);
    buildNextWorldChunk();
    if (now - lastBiomeCheck > 350) {
      lastBiomeCheck = now;
      updateWorldBiome(worldX, worldZ);
    }
  }
  if (inGame && meState) {
    updateMovement(dt);
    updateCamera(dt);
    updateAim();
    interpolateRemotePositions(now, dt);
  }
  if (inGame) {
    for (const fp of fogPatches) {
      fp.position.x += fp.userData.vx * dt; fp.position.z += fp.userData.vz * dt;
      if (Math.hypot(fp.position.x, fp.position.z) > 80) { fp.userData.vx *= -1; fp.userData.vz *= -1; }
    }
    const ep = emberGeo.attributes.position;
    for (let i = 0; i < V.EMBERS; i++) {
      ep.setY(i, ep.getY(i) + emberVel[i] * dt);
      if (ep.getY(i) > 6) ep.setY(i, 0);
    }
    ep.needsUpdate = true;
    emberField.material.opacity = meState && meState.f <= 0 ? 0.15 : 0.5;
    const fp = flyGeo.attributes.position;
    for (let i = 0; i < FLY; i++) {
      fp.setXYZ(i, fp.getX(i) + Math.sin(t * 0.3 + flyPh[i]) * 0.006, 3 + Math.sin(t * 0.5 + flyPh[i] * 2) * 2.5, fp.getZ(i) + Math.cos(t * 0.27 + flyPh[i]) * 0.006);
    }
    fp.needsUpdate = true;
    const darkish = meState && meState.f <= 0;
    flyField.material.opacity += ((darkish ? 0.8 : 0.3) - flyField.material.opacity) * Math.min(1, dt * 2);
    updateZaps(dt);
    updateBursts(dt);
    drawMini(lastState);
    renderer.domElement.style.zIndex = '0';
    renderer.render(scene, camera);
    reportPerformance(now, true);
  } else {
    reportPerformance(now, false);
  }
}
requestAnimationFrame(loop);
addEventListener('resize', () => {
  camera.left = -CAMERA_VIEW_HEIGHT * innerWidth / innerHeight / 2;
  camera.right = CAMERA_VIEW_HEIGHT * innerWidth / innerHeight / 2;
  camera.top = CAMERA_VIEW_HEIGHT / 2;
  camera.bottom = -CAMERA_VIEW_HEIGHT / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// touch action buttons
for (const [id, fn, hold] of [['t-attack', doAttack, true], ['t-run', (on) => { T.run = on; }, true], ['t-bait', doBait, false], ['t-focus', doFocus, false]]) {
  const el = $(id);
  if (!el) continue;
  const on = (e) => { e.preventDefault(); A.ensure(); fn(true); };
  const off = (e) => { e.preventDefault(); if (hold) fn(false); };
  el.addEventListener('touchstart', on, { passive: false });
  el.addEventListener('touchend', off, { passive: false });
  el.addEventListener('mousedown', on);
  el.addEventListener('mouseup', off);
}

const zoomInput = $('camera-zoom-setting');
const renderScaleInput = $('render-scale-setting');
const motionInput = $('motion-setting');
zoomInput.value = userSettings.cameraZoom;
renderScaleInput.value = userSettings.renderScale;
motionInput.checked = userSettings.reducedMotion;
document.body.classList.toggle('reduce-motion', userSettings.reducedMotion);
zoomInput.addEventListener('input', () => {
  userSettings.cameraZoom = Number(zoomInput.value);
  camera.zoom = userSettings.cameraZoom;
  camera.updateProjectionMatrix();
  saveSettings();
});
renderScaleInput.addEventListener('change', () => {
  userSettings.renderScale = renderScaleInput.value;
  renderer.setPixelRatio(renderScale[userSettings.renderScale]);
  saveSettings();
});
motionInput.addEventListener('change', () => {
  userSettings.reducedMotion = motionInput.checked;
  document.body.classList.toggle('reduce-motion', userSettings.reducedMotion);
  if (userSettings.reducedMotion) shake = 0;
  saveSettings();
});
for (const input of document.querySelectorAll('#settings-controls [data-mix]')) {
  input.value = userSettings.audio[input.dataset.mix];
  input.addEventListener('input', () => A.setMix(input.dataset.mix, Number(input.value)));
}
$('settings-reset').addEventListener('click', () => {
  Object.assign(userSettings, {
    bindings: { ...DEFAULT_BINDINGS },
    audio: { effects: 0.85, music: 0.45, ambience: 0.6 },
    cameraZoom: 1,
    renderScale: 'balanced',
    reducedMotion: false,
  });
  zoomInput.value = userSettings.cameraZoom;
  renderScaleInput.value = userSettings.renderScale;
  motionInput.checked = userSettings.reducedMotion;
  document.body.classList.remove('reduce-motion');
  camera.zoom = userSettings.cameraZoom;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(renderScale[userSettings.renderScale]);
  for (const input of document.querySelectorAll('#settings-controls [data-mix]')) input.value = userSettings.audio[input.dataset.mix];
  for (const [name, value] of Object.entries(userSettings.audio)) A.setMix(name, value);
  bindingCapture = null;
  refreshBindings();
  $('settings-status').textContent = 'DEFAULTS RESTORED';
  saveSettings();
});
