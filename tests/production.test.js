import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerStorage, mergeRecord } from '../src/systems/PlayerStorage.js';
import { LevelSystem } from '../src/systems/LevelSystem.js';
import { LEVELS, getUnlockedItems } from '../src/levels/LevelConfig.js';
import { advanceSimulation, STEP } from '../src/utils/Simulation.js';
import { disposeObject } from '../src/utils/disposeObject.js';
import { AudioSystem } from '../src/systems/AudioSystem.js';
import { findProjectileTarget } from '../src/utils/ProjectileCollision.js';

function memoryStorage() {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
}

test('new players start muted; malformed settings cannot enable sound or invalid quality', () => {
  const storage = memoryStorage();
  const player = new PlayerStorage(storage);
  assert.equal(player.loadSettings().volume, 0);
  storage.setItem('niuma_settings_v1', '{');
  assert.equal(player.loadSettings().volume, 0);
  storage.setItem('niuma_settings_v1', JSON.stringify({ volume: 'loud', quality: 'ultra', reducedMotion: 'yes' }));
  assert.deepEqual(player.loadSettings(), { volume: 0, quality: 'auto', reducedMotion: null });
});

test('muted playback never constructs an AudioContext', () => {
  let constructions = 0;
  globalThis.window = { AudioContext: class { constructor() { constructions++; } } };
  const audio = new AudioSystem();
  audio.ensure(); audio.play('shoot');
  assert.equal(constructions, 0);
});

test('legacy unlocks migrate and corrupted progress is bounded to existing levels', () => {
  for (const [saved, expected] of [['4', 4], ['99', 6], ['-1', 1], ['NaN', 1]]) {
    const storage = memoryStorage();
    storage.setItem('niuma_progress', saved);
    assert.equal(new PlayerStorage(storage).loadProgress().maxUnlocked, expected);
  }
  const storage = memoryStorage();
  storage.setItem('niuma_save_v1', '{bad');
  assert.equal(new PlayerStorage(storage).loadProgress().maxUnlocked, 1);
});

test('unavailable storage allows play and reports that saving failed', () => {
  const unavailable = { getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); } };
  const player = new PlayerStorage(unavailable);
  assert.equal(player.loadProgress().maxUnlocked, 1);
  assert.equal(player.saveProgress({}), false);
  assert.equal(player.available, false);
});

test('settings and records survive a fresh storage wrapper', () => {
  const storage = memoryStorage();
  const player = new PlayerStorage(storage);
  const record = { grade: 'S', score: 1200, kills: 8, duration: 92, hpRatio: 1, clears: 1 };
  player.saveProgress({ version: 1, maxUnlocked: 2, records: { 1: record } });
  player.saveSettings({ volume: 0, quality: 'low', reducedMotion: true });
  const restored = new PlayerStorage(storage);
  assert.deepEqual(restored.loadProgress().records[1], record);
  assert.equal(restored.loadSettings().quality, 'low');
});

test('a failed replay cannot replace the best grade, score, health or successful time', () => {
  const previous = { grade: 'A', score: 900, kills: 8, duration: 90, hpRatio: .7, clears: 1 };
  const failed = mergeRecord(previous, { grade: 'F', score: 20, kills: 1, duration: 20, hpRatio: 0 });
  assert.deepEqual(failed, previous);
  const better = mergeRecord(previous, { grade: 'S', score: 1500, kills: 8, duration: 80, hpRatio: 1 });
  assert.equal(better.grade, 'S'); assert.equal(better.clears, 2); assert.equal(better.duration, 80);
});

test('records with invalid grades and unbounded numeric fields are sanitized', () => {
  const storage = memoryStorage();
  storage.setItem('niuma_save_v1', JSON.stringify({ version: 1, maxUnlocked: 900, records: { 1: { grade: 'S', score: -2, hpRatio: 20 }, 2: { grade: '<script>' } } }));
  const saved = new PlayerStorage(storage).loadProgress();
  assert.equal(saved.maxUnlocked, 6); assert.equal(saved.records[1].score, 0);
  assert.equal(saved.records[1].hpRatio, 1); assert.equal(saved.records[2], undefined);
});

for (const fps of [15, 30, 60, 144]) for (const speed of [1, 2, 3]) {
  test(`${speed}x simulation advances accurately at ${fps} fps`, () => {
    let accumulator = 0, advanced = 0, maxStep = 0;
    for (let i = 0; i < fps; i++) accumulator = advanceSimulation(accumulator, 1 / fps, speed, dt => { advanced += dt; maxStep = Math.max(maxStep, dt); });
    assert.ok(Math.abs(advanced - speed) < .0001);
    assert.ok(maxStep <= STEP);
  });
}

test('ending a round stops remaining substeps immediately', () => {
  let calls = 0;
  const remaining = advanceSimulation(0, .1, 3, () => { calls++; return false; });
  assert.equal(calls, 1); assert.equal(remaining, 0);
});

test('rewards unlock after completing their level; final level has the ultimate loadout', () => {
  assert.deepEqual(getUnlockedItems(1), ['sunflower', 'peashooter']);
  assert.ok(getUnlockedItems(2).includes('wallnut'));
  assert.ok(!getUnlockedItems(2).includes('auditor'));
  for (const type of ['ult_moyu', 'ult_meeting', 'ult_bomb']) assert.ok(getUnlockedItems(6).includes(type));
});

function setupLevel() {
  const noop = () => {};
  const game = {
    storage: new PlayerStorage(memoryStorage()), running: true, baseHp: 100, score: 800, totalKills: 8, clock: 90,
    cfg: { ROWS: 5, BASE_HP: 100 }, zombies: [], audio: { play: noop },
    ui: { toast: noop, updateWaveCountdown: noop, updateWaveProgress: noop, showWaveBanner: noop, showLevelResult: noop, updateSpecialUses: noop },
    finishRound() { this.running = false; },
    _createZombie(type, row) { return { type, row, hp: 100, maxHp: 100, baseSpeed: 1, speed: 1 }; },
  };
  const levels = new LevelSystem(game);
  levels.loadProgress();
  return { game, levels };
}

test('locked and nonexistent levels cannot start or mutate the current round', () => {
  const { levels } = setupLevel();
  assert.equal(levels.startLevel(2), null); assert.equal(levels.startLevel(-1), null);
  assert.equal(levels.currentLevel, null); assert.equal(levels.isUnlocked(7), false);
});

for (const level of LEVELS) test(`level ${level.id} spawns every wave and saves its completion`, () => {
  const { game, levels } = setupLevel();
  levels.maxUnlocked = level.id;
  levels.startLevel(level.id);
  let spawned = 0;
  for (let step = 0; step < 20000 && game.running; step++) {
    levels.update(.1, game);
    spawned += game.zombies.length;
    game.zombies = []; // Emulate combat clearing each scheduled enemy.
  }
  const expected = level.waves.reduce((sum, wave) => sum + wave.zombies.reduce((n, group) => n + group.count, 0), 0);
  assert.equal(spawned, expected); assert.equal(game.running, false);
  assert.equal(levels.records[level.id].grade, 'S');
  assert.equal(levels.records[level.id].clears, 1);
  assert.equal(game.storage.loadProgress().records[level.id].clears, 1);
  assert.equal(levels.maxUnlocked, Math.min(level.id + 1, LEVELS.length));
});

test('an empty final wave cannot award a win to a destroyed base', () => {
  const { game, levels } = setupLevel();
  levels.startLevel(1); game.baseHp = 0;
  levels._onLevelClear(game);
  assert.equal(levels.records[1].grade, 'F'); assert.equal(levels.maxUnlocked, 1);
});

test('only a completed level banks its ticket rewards for later rounds', () => {
  for (const cleared of [true, false]) {
    const { game, levels } = setupLevel();
    levels.startLevel(1); game.tickets = 7; game.bankedTickets = 2;
    if (cleared) levels._onLevelClear(game);
    else levels.onLevelFail(game);
    assert.equal(game.bankedTickets, cleared ? 7 : 2);
  }
});

test('limited special uses cannot exceed the per-round allowance and reset on retry', () => {
  const { levels } = setupLevel();
  levels.startLevel(1);
  for (let i = 0; i < 3; i++) assert.equal(levels.useSpecial(), true);
  assert.equal(levels.useSpecial(), false); assert.equal(levels.specialUses, 3);
  levels.startLevel(1); assert.equal(levels.specialUses, 0);
});

test('disposing an entity releases array materials and shared texture references once', () => {
  const texture = new THREE.Texture(), material = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture });
  const geometry = new THREE.BoxGeometry();
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, [material, material]), new THREE.Mesh(geometry, material));
  let textures = 0, materials = 0, geometries = 0;
  texture.addEventListener('dispose', () => textures++); material.addEventListener('dispose', () => materials++); geometry.addEventListener('dispose', () => geometries++);
  disposeObject(root);
  assert.deepEqual([textures, materials, geometries], [1, 1, 1]);
});

test('fast projectiles hit the nearest crossed enemy without tunneling or crossing lanes', () => {
  const enemy = (x, row = 2, dead = false) => ({ mesh: { position: { x } }, row, dead });
  const shot = { previousX: 10, mesh: { position: { x: 6 } }, row: 2 };
  const near = enemy(9), far = enemy(7), otherRow = enemy(9.5, 1), dead = enemy(9.8, 2, true);
  assert.equal(findProjectileTarget(shot, [far, otherRow, dead, near]), near);
  assert.equal(findProjectileTarget(shot, [enemy(4), enemy(12)]), null);
  shot.previousX = 6; shot.mesh.position.x = 10;
  assert.equal(findProjectileTarget(shot, [near, far]), far);
});
