import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { getBoardOrbitRadius } from '../src/utils/CameraFraming.js';

function setup() {
  const noop = () => {};
  globalThis.window = { addEventListener: noop };
  const g = {
    running: true, paused: false, blocked: false, clock: 10, selectedCard: 'sunflower', cardCooldowns: {}, plants: [],
    canvas: { addEventListener: noop, setPointerCapture: noop, style: {},
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }) },
    camera: new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 200),
    ui: { canInteract: () => g.running && !g.paused && !g.blocked, cardEls: { sunflower: {} },
      toast: noop, hideEntityFeedback: noop, hidePlacementFeedback: noop, clearSelection: noop,
      hideDragGhost: noop, showDragGhost: noop, showPlacementFeedback: noop },
    grid: { isOccupied: () => Boolean(g.occupied), clearPlacementPreview: noop, group: {},
      setOccupied: (r, c, p) => { g.occupied = p; }, gridToWorld: () => new THREE.Vector3() },
    items: { isUltMoyu: () => false },
    resource: { value: 100, canAfford: n => g.resource.value >= n, spend: n => { g.resource.value -= n; } },
    createPlant: (type, row, col) => ({ type, row, col }),
    _setCD: (type, cd) => { g.cardCooldowns[type] = g.clock + cd; },
    audio: { play: noop }, particles: { spawnPlant: noop }, effects: { spawnFloatText: noop },
  };
  return { g, interaction: new InteractionSystem(g) };
}

test('placement spends once and occupies the tile; repeated click cannot duplicate it', () => {
  const { g, interaction } = setup();
  interaction._tryPlant(2, 3);
  assert.equal(g.resource.value, 75);
  assert.equal(g.plants.length, 1);
  assert.equal(g.selectedCard, null);
  g.selectedCard = 'sunflower';
  interaction._tryPlant(2, 3);
  assert.equal(g.resource.value, 75);
  assert.equal(g.plants.length, 1);
});

for (const state of ['paused', 'blocked', 'cooldown', 'poor', 'locked', 'skill']) {
  test(`placement is rejected without spending for ${state}`, () => {
    const { g, interaction } = setup();
    if (state === 'paused') g.paused = true;
    if (state === 'blocked') g.blocked = true;
    if (state === 'cooldown') g.cardCooldowns.sunflower = 11;
    if (state === 'poor') g.resource.value = 0;
    if (state === 'locked') g.ui.cardEls = {};
    if (state === 'skill') g.selectedCard = 'hammer';
    const before = g.resource.value;
    interaction._tryPlant(0, 0);
    assert.equal(g.resource.value, before);
    assert.equal(g.plants.length, 0);
  });
}

test('ray picking accounts for a canvas offset within the page', () => {
  const { interaction } = setup();
  interaction._setMouse({ clientX: 500, clientY: 350 });
  assert.equal(interaction.mouse.x, 0);
  assert.equal(Math.abs(interaction.mouse.y), 0);
});

test('only the charging pointer may release; paused or dead plants never fire', () => {
  for (const state of ['alive', 'paused', 'dead']) {
    const { g, interaction } = setup();
    let shots = 0;
    const plant = { type: 'peashooter', charging: true, dead: state === 'dead', onEggClick: () => {}, chargeShoot: () => shots++ };
    interaction._chargePlant = plant;
    interaction.gestures.active = { kind: 'plant', id: 7, owner: g.canvas, plant, moved: false };
    interaction._isBoardPoint = () => true;
    interaction._tileAt = () => null;
    interaction._chargeStart = performance.now() - 800;
    g.paused = state === 'paused';
    interaction._onPointerUp({ pointerId: 8 });
    assert.equal(plant.charging, true);
    interaction._onPointerUp({ pointerId: 7 });
    assert.equal(plant.charging, false);
    assert.equal(shots, state === 'alive' ? 1 : 0);
  }
});

test('cancelling a gesture restores automatic shooting without releasing a shot', () => {
  const { interaction } = setup();
  const plant = { charging: true, chargeFx: 1 };
  interaction._chargePlant = plant;
  interaction.gestures.active = { kind: 'placement', id: 3, owner: {} };
  interaction.reset();
  assert.equal(plant.charging, false);
  assert.equal(plant.chargeFx, 0);
  assert.equal(interaction.gestures.active, null);
});

test('touch deployment commits on release, allowing finger adjustment before spending', () => {
  const { g, interaction } = setup();
  interaction._setMouse = () => {};
  interaction._updatePlacementPreview = () => {};
  g.grid.getTileMeshes = () => [];
  interaction.raycaster.intersectObjects = () => [{ object: { userData: { row: 2, col: 4 } } }];
  const event = { button: 0, pointerType: 'touch', pointerId: 1, clientX: 400, clientY: 300 };
  interaction._onPointerDown(event);
  assert.equal(g.plants.length, 0);
  interaction._onPointerUp(event);
  assert.equal(g.plants.length, 1);
  assert.equal(g.plants[0].col, 4);
});

test('entire board and landmarks stay within HUD margins at portrait and landscape sizes', () => {
  for (const [width, height] of [[390, 844], [716, 920], [1440, 900], [844, 390]]) {
    const phi = 0.65, halfWidth = 27.9, halfDepth = 15;
    const radius = getBoardOrbitRadius({ halfWidth, halfDepth, phi, fov: 45, aspect: width / height, height });
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, radius * 3);
    camera.position.set(0, radius * Math.cos(phi), radius * Math.sin(phi));
    camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    for (const x of [-halfWidth, halfWidth]) for (const z of [-halfDepth, halfDepth]) {
      const ndc = new THREE.Vector3(x, 0, z).project(camera);
      assert.ok(Math.abs(ndc.x) <= 0.92001, `${width}×${height}: horizontal clipping`);
      assert.ok(Math.abs(ndc.y) <= Math.max(0.3, 1 - 250 / height), `${width}×${height}: HUD overlap`);
    }
  }
});

test('dragging a card commits exactly once on release, even if a second pointer releases first', () => {
  const { g, interaction: i } = setup();
  i._isBoardPoint = () => true;
  i._tileAt = () => ({ row: 1, col: 2 });
  i._updatePlacementPreview = () => {};
  g._cancelActiveTool = () => { g.selectedCard = null; i.reset(); };
  const e = { button: 0, pointerId: 4, clientX: 140, clientY: 620 };
  i.gestures.begin(e, 'card', { type: 'sunflower' });
  i._onPointerMove({ ...e, clientY: 300 });
  assert.equal(g.plants.length, 0);
  i._onPointerUp({ ...e, pointerId: 5 });
  assert.equal(g.plants.length, 0);
  i._onPointerUp(e);
  i._onPointerUp(e);
  assert.equal(g.plants.length, 1);
  assert.equal(g.resource.value, 75);
});

test('cancelled or out-of-board card drops never spend resources', () => {
  for (const cancel of [false, true]) {
    const { g, interaction: i } = setup();
    i._isBoardPoint = () => false;
    g._cancelActiveTool = () => { g.selectedCard = null; i.reset(); };
    const e = { pointerId: 2, clientX: 200, clientY: 400 };
    i.gestures.begin(e, 'card', { moved: true });
    if (cancel) i.reset();
    i._onPointerUp(e);
    assert.equal(g.resource.value, 100);
    assert.equal(g.plants.length, 0);
  }
});

test('relocation is atomic, preserves stats and resources, and rejects occupied destinations', () => {
  const { g, interaction: i } = setup();
  const cells = new Map();
  const plant = { row: 0, col: 0, hp: 63, timer: 2.5, mesh: new THREE.Group(), cfg: { name: 'test' } };
  const blocker = {};
  cells.set('0,0', plant); cells.set('2,2', blocker);
  g.grid.isOccupied = (r, c) => cells.has(`${r},${c}`);
  g.grid.getTile = (r, c) => ({ occupied: cells.get(`${r},${c}`) });
  g.grid.setOccupied = (r, c, p) => p ? cells.set(`${r},${c}`, p) : cells.delete(`${r},${c}`);
  g.grid.gridToWorld = (r, c) => new THREE.Vector3(c * 3, 0, r * 3);
  assert.equal(i.gestures.relocate(plant, { row: 2, col: 2 }), false);
  assert.equal(cells.get('0,0'), plant);
  assert.equal(i.gestures.relocate(plant, { row: 1, col: 3 }), true);
  assert.equal(cells.has('0,0'), false);
  assert.equal(cells.get('1,3'), plant);
  assert.deepEqual(plant.mesh.position.toArray(), [9, 0, 3]);
  assert.equal(plant.hp, 63); assert.equal(plant.timer, 2.5); assert.equal(g.resource.value, 100);
});

test('drag threshold separates a sunflower click from relocation', () => {
  for (const drag of [false, true]) {
    const { g, interaction: i } = setup();
    let clicks = 0, moves = 0;
    const plant = { type: 'sunflower' };
    i._isBoardPoint = () => true;
    i._tileAt = () => ({ row: 0, col: 1 });
    i._releasePlant = () => clicks++;
    i.gestures.relocate = () => moves++;
    i.gestures.render = () => {};
    const e = { pointerId: 1, clientX: 200, clientY: 300 };
    i.gestures.begin(e, 'plant', { plant });
    i._onPointerMove({ ...e, clientX: 200 + (drag ? 24 : 3) });
    i._onPointerUp(e);
    assert.equal(clicks, drag ? 0 : 1);
    assert.equal(moves, drag ? 1 : 0);
  }
});

test('dragging a shooter cancels charge without triggering its click or charged attack', () => {
  const { g, interaction: i } = setup();
  const plant = { type: 'peashooter', charging: true, chargeFx: 1 };
  i._chargePlant = plant;
  i.gestures.render = () => {};
  const e = { pointerId: 6, clientX: 300, clientY: 300 };
  i.gestures.begin(e, 'plant', { plant });
  i._onPointerMove({ ...e, clientX: 340 });
  assert.equal(plant.charging, false);
  assert.equal(i._chargePlant, null);
  i.reset();
  assert.equal(i.gestures.active, null);
});

test('empty ground only pans after the drag threshold and never deploys', () => {
  const { g, interaction: i } = setup();
  let pans = 0;
  g._panBoard = () => pans++;
  i._isBoardPoint = () => true;
  i._tileAt = () => null;
  const e = { pointerId: 8, clientX: 300, clientY: 300 };
  i.gestures.begin(e, 'pan', { anchor: new THREE.Vector3() });
  i._onPointerMove({ ...e, clientX: 303 });
  assert.equal(pans, 0);
  i._onPointerMove({ ...e, clientX: 330 });
  assert.equal(pans, 1);
  i._onPointerUp(e);
  assert.equal(g.resource.value, 100);
  assert.equal(g.plants.length, 0);
});
