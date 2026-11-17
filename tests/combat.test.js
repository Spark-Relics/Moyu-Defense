import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ItemSystem } from '../src/systems/ItemSystem.js';
import { Zombie } from '../src/entities/Zombie.js';
import { Plant } from '../src/entities/Plant.js';
import { getZombieSpeed } from '../src/utils/CombatRules.js';

function fixture() {
  const noop = () => {};
  const g = {
    cfg: { ROWS: 5, COLS: 9, CELL: 3 }, running: true, clock: 0,
    zombies: [], plants: [],
    grid: { group: new THREE.Group(), gridToWorld: (row, col) => new THREE.Vector3(col * 3, 0, row * 3) },
    ui: new Proxy({}, { get: () => noop }), audio: { play: noop },
    effects: { spawnFloatText: noop }, particles: { spawnDeath: noop, spawnUlt: noop },
    resource: { add: noop },
  };
  return { g, items: new ItemSystem(g) };
}

function zombie(type = 'client', hp = 240) {
  return Object.assign(Object.create(Zombie.prototype), { type, hp, maxHp: hp, cfg: { hp }, dead: false, vulnerableFor: 0, _bossCast: null, mesh: new THREE.Group() });
}

test('rain and phase-two speed survive repeated per-frame speed computation', () => {
  const z = { baseSpeed: .6, _phaseTwo: true };
  for (let frame = 0; frame < 120; frame++) assert.ok(Math.abs(getZombieSpeed(z, frame / 60, { rain: true }) - .3) < 1e-9);
  assert.equal(getZombieSpeed(z, 3), .75);
  assert.ok(Math.abs(getZombieSpeed(z, 3, { rain: true, globalSlow: true }) - .3) < 1e-9);
});

test('approval resistance begins after actual slow time, and expired slows do not apply', () => {
  const z = { baseSpeed: 1, _slowEnd: 30, _slowMul: .5, _slowTotal: 14 };
  assert.equal(getZombieSpeed(z, 20), .5);
  z._slowTotal = 16;
  assert.equal(getZombieSpeed(z, 20), .75);
  assert.equal(getZombieSpeed(z, 31), 1);
});

test('hammer deals its stated 60 damage before applying a temporary vulnerability', () => {
  const { g, items } = fixture();
  const z = zombie(); g.zombies = [z];
  assert.equal(items.hammer(g), true);
  assert.equal(z.hp, 180); assert.equal(z.vulnerableFor, 3);
  z.takeDamage(10); assert.equal(z.hp, 160);
  z.vulnerableFor = 0;
  z.takeDamage(10); assert.equal(z.hp, 150);
});

test('meeting uses five simulated seconds, affects only attendees, and preserves both boss types', () => {
  const { g, items } = fixture();
  const client = zombie(), boss = zombie('boss'), traitor = zombie('traitor');
  g.zombies = [client, boss, traitor];
  assert.equal(items.ultMeeting(g), true);
  const late = zombie(); g.zombies.push(late);
  for (let i = 0; i < 100; i++) items.update(0, g);
  assert.equal(client.hp, 240);
  items.update(4.9, g); assert.equal(client.hp, 240);
  items.update(.11, g);
  assert.equal(client.hp, 0);
  assert.equal(boss.hp, 240); assert.equal(traitor.hp, 240); assert.equal(late.hp, 240);
});

test('clearing a round cancels a meeting and bombing effects before another round', () => {
  const { g, items } = fixture();
  const before = zombie(); g.zombies = [before];
  items.ultMeeting(g); items.ultBomb(g); items.clear(g);
  const after = zombie(); g.zombies = [after];
  let effects = 0; g.particles.spawnDeath = () => effects++;
  items.update(10, g);
  assert.equal(after.hp, 240); assert.equal(effects, 0); assert.equal(items.meetingTargets.length, 0);
});

test('a plant shield absorbs exactly 500 damage and then exposes plant health', () => {
  const plant = Object.assign(Object.create(Plant.prototype), { hp: 120, dead: false, invincible: 0, shieldTimer: 10, shieldHp: 500 });
  plant.takeDamage(300); assert.equal(plant.hp, 120); assert.equal(plant.shieldHp, 200);
  plant.takeDamage(250); assert.equal(plant.hp, 70); assert.equal(plant.shieldHp, 0);
  plant.takeDamage(70); assert.equal(plant.dead, true);
});

test('shield expiry is measured in game time even when a plant is frozen', () => {
  const plant = Object.assign(Object.create(Plant.prototype), { hp: 120, frozen: 2, invincible: 0, shieldTimer: 1, shieldHp: 500, mesh: new THREE.Group(), applyColorTint() {} });
  plant.update(1.1, {});
  assert.equal(plant.shieldTimer, 0); assert.equal(plant.shieldHp, 0);
});

test('shield selects the actual front line rather than the back-row producer', () => {
  const { g, items } = fixture();
  const back = { col: 8, mesh: new THREE.Group() }, front = { col: 2, mesh: new THREE.Group() };
  g.plants = [back, front]; items.tiaoxiu(g);
  assert.equal(front.shieldHp, 500); assert.equal(back.shieldHp, undefined); assert.equal(front.invincible, undefined);
});

test('bait never accelerates enemies and remains a damageable obstacle', () => {
  const { g, items } = fixture();
  const z = zombie(); z.mesh.position.x = -10; g.zombies = [z];
  items.dabing(g); items._updateBaits(1, g);
  assert.equal(z.mesh.position.x, -10);
  const bait = items.baits[0]; assert.equal(bait.hp, 80);
  bait.takeDamage(80); assert.equal(bait.dead, true);
  items._updateBaits(.01, g); assert.equal(items.baits.length, 0);
});

test('photo lethal damage still goes through the normal death and reward path', () => {
  const { g, items } = fixture();
  const z = zombie('client', 100); z.hp = 5; g.zombies = [z];
  items.photo(g);
  assert.equal(z.dead, false); assert.ok(z.hp <= 0);
  let deaths = 0; z._die = () => { z.dead = true; deaths++; };
  z.update(1 / 60, g);
  assert.equal(deaths, 1);
});

test('dead enemies cannot act or award a second death callback', () => {
  const { g } = fixture(); const z = zombie(); z.hp = 0;
  let deaths = 0;
  g.onZombieKilled = () => deaths++;
  z.update(1 / 60, g); z.update(1 / 60, g);
  assert.equal(deaths, 1);
});

test('vulnerability expires during the normal stunned update rather than lasting forever', () => {
  const { g } = fixture(), z = zombie();
  Object.assign(z, { vulnerableFor: 3, aliveTime: 0, stunned: 4, stunFxTimer: 0, stunGroup: new THREE.Group(), mainMaterials: [], _updateHpBar() {} });
  z.update(3.1, g);
  assert.equal(z.vulnerableFor, 0);
  z.takeDamage(10); assert.equal(z.hp, 230);
});

test('boss ticket skill recognizes the final boss as well as the manager', () => {
  const { g, items } = fixture();
  const z = zombie('traitor', 500); g.zombies = [z];
  assert.equal(items.readback(g), true); assert.equal(z.hp, 400);
});

test('a mine applies its slow without cancelling an existing stun', () => {
  const { g, items } = fixture();
  items.mine(g);
  const mine = items.mines[0], z = zombie();
  z.row = mine.row; z.mesh.position.x = mine.x; z.stunned = 3; g.zombies = [z];
  g._applySlow = (target, mul, duration) => { target.slow = [mul, duration]; };
  items._updateMines(.1, g);
  assert.equal(z.stunned, 3); assert.deepEqual(z.slow, [.5, 4]); assert.equal(z.hp, 160);
});
