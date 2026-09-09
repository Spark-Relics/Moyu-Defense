import * as THREE from 'three';
import { PLANT_TYPES } from '../entities/Plant.js';
import { BoardGestures } from './BoardGestures.js';

export class InteractionSystem {
  constructor(game) {
    this.game = game;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this._pointer = null;
    this._chargePlant = null;
    this.gestures = new BoardGestures(this);
    game.canvas.addEventListener('pointerdown', e => this._onPointerDown(e));
    window.addEventListener('pointermove', e => this._onPointerMove(e));
    window.addEventListener('pointerup', e => this._onPointerUp(e));
    window.addEventListener('pointercancel', e => {
      if (e.pointerId === this.gestures.active?.id) this.reset();
    });
    window.addEventListener('blur', () => this.reset());
    game.canvas.addEventListener('pointerleave', () => {
      if (!this.gestures.active) {
        this._pointer = null; this._clearPlacementPreview(); game.ui.hideEntityFeedback();
      }
    });
    game.canvas.addEventListener('lostpointercapture', () => {
      if (this.gestures.active) this.reset();
    });
  }

  _setMouse(e) {
    const rect = this.game.canvas.getBoundingClientRect();
    this.mouse.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    this.game.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.mouse, this.game.camera);
  }

  _isBoardPoint(e) {
    const rect = this.game.canvas.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientY < rect.top || e.clientX > rect.left + rect.width || e.clientY > rect.top + rect.height) return false;
    return typeof document === 'undefined' || document.elementFromPoint(e.clientX, e.clientY) === this.game.canvas;
  }

  _tileAt(e) {
    this._setMouse(e);
    const hits = this.raycaster.intersectObjects(this.game.grid.getTileMeshes());
    return hits.length ? hits[0].object.userData : null;
  }

  _plantAt(e) {
    this._setMouse(e);
    const g = this.game;
    const hits = this.raycaster.intersectObjects(g.plants.filter(p => !p.dead).map(p => p.mesh), true);
    if (hits.length) {
      const plant = this._findEntityFromObject(hits[0].object, g.plants, 'plant');
      if (plant && !plant.dead) return plant;
    }
    const tile = this._tileAt(e);
    const plant = tile && g.grid.getTile(tile.row, tile.col)?.occupied;
    return plant && !plant.dead ? plant : null;
  }

  _smashGhostAt(e) {
    const ghosts = this.game.eventSystem?.getGhosts() || [];
    if (!ghosts.length) return false;
    this._setMouse(e);
    const hits = this.raycaster.intersectObjects(ghosts.map(g => g.mesh), true);
    const ghost = hits.length ? this._findGhostFromObject(hits[0].object, ghosts) : null;
    if (ghost) this.game.eventSystem.smashGhost(ghost);
    return Boolean(ghost);
  }

  _onPointerDown(e) { this.gestures.down(e); }
  _onPointerMove(e) {
    if (e.isPrimary === false) return;
    if (this.gestures.active) { this.gestures.move(e); return; }
    if (!this._isBoardPoint(e)) {
      this._pointer = null; this._clearPlacementPreview(); this.game.ui.hideEntityFeedback(); return;
    }
    this._pointer = e;
  }
  _onPointerUp(e) { this.gestures.up(e); }

  _startCharge(plant, event) {
    this._chargePlant = plant;
    this._chargeStart = performance.now();
    plant.startCharge(this.game);
  }

  _releasePlant(plant) {
    if (plant.type === 'sunflower') this._onSunflowerClick(plant);
    else if (plant.type === 'wallnut') plant.onEggClick(this.game);
    else if (plant.type === 'peashooter') {
      plant.onEggClick(this.game);
      plant.chargeShoot(this.game, (performance.now() - this._chargeStart) / 1000);
    }
  }

  _cancelCharge() {
    if (this._chargePlant) { this._chargePlant.charging = false; this._chargePlant.chargeFx = 0; }
    this._chargePlant = null;
  }

  /** 向日葵点击：产出摸鱼值，有概率触发老板路过警告 */
  _onSunflowerClick(plant) {
    const g = this.game;
    const CFG = g.cfg;
    if (g.patrolWarning > 0) {
      g.damageBase(CFG.PATROL_PENALTY);
      g.ui.toast('⚠️ 老板还在路过！工位血量-' + CFG.PATROL_PENALTY);
      g.ui.flashRed();
      g.patrolWarning = CFG.PATROL_DURATION;
      const p = plant.mesh.position.clone(); p.y += 1.4;
      g.effects.spawnFloatText(g.grid.group, p, '-' + CFG.PATROL_PENALTY, '#ff3333');
      g.audio.play('basehit');
      return;
    }
    plant.onClick(g);
    // 金币收集粒子
    g.particles.spawnCoin(g.grid.group, plant.mesh.position.clone());
    if (Math.random() < CFG.PATROL_CHANCE) {
      g.patrolWarning = CFG.PATROL_DURATION;
      g.ui.toast('🚨 老板路过！2秒内别再点向日葵！');
      g.ui.flashRed();
    }
  }

  _tryPlant(row, col) {
    const g = this.game;
    if (!g.ui.canInteract()) return;
    const type = g.selectedCard;
    const cfg = PLANT_TYPES[type];
    if (!cfg || cfg.isSkill || cfg.isUlt || cfg.isTicket || !g.ui.cardEls[type]) return;
    if (g.grid.isOccupied(row, col)) { g.ui.toast('这里已经有植物了'); return; }
    if (g.clock < (g.cardCooldowns[type] || 0)) { g.ui.toast('卡片冷却中…'); return; }
    const cost = g.items.isUltMoyu() ? 0 : cfg.cost;
    if (cost > 0 && !g.resource.canAfford(cost)) { g.ui.toast('摸鱼值不足！'); return; }
    if (cost > 0) g.resource.spend(cost);
    const plant = g.createPlant(type, row, col);
    g.plants.push(plant);
    g.grid.setOccupied(row, col, plant);
    g._setCD(type, cfg.cd);
    g.particles.spawnPlant(g.grid.group, g.grid.gridToWorld(row, col));
    g.audio.play('plant');
    const pos = g.grid.gridToWorld(row, col); pos.y += 2.5;
    g.effects.spawnFloatText(g.grid.group, pos, `${cfg.name} 已部署`, '#b6ffcc');
    g.ui.clearSelection();
    g.selectedCard = null;
    this._clearPlacementPreview();
  }

  _updatePlacementPreview(e, type) {
    const g = this.game;
    if (!g.ui.canInteract() || !type) {
      this._clearPlacementPreview();
      return;
    }
    const cfg = PLANT_TYPES[type];
    if (!cfg || cfg.isSkill || cfg.isUlt || cfg.isTicket) {
      this._clearPlacementPreview();
      return;
    }
    this._setMouse(e);
    const hits = this.raycaster.intersectObjects(g.grid.getTileMeshes());
    if (hits.length === 0) {
      this._clearPlacementPreview();
      return;
    }
    const { row, col } = hits[0].object.userData;
    const cost = g.items.isUltMoyu() ? 0 : cfg.cost;
    const valid = !g.grid.isOccupied(row, col)
      && g.clock >= (g.cardCooldowns[type] || 0)
      && (cost === 0 || g.resource.canAfford(cost));
    g.grid.showPlacementPreview(row, col, valid, type);
    let label = `${row + 1}排 · ${col + 1}列 · ${cfg.name} · ${cost === 0 ? '免费' : '−' + cost + '🐟'}`;
    if (g.grid.isOccupied(row, col)) label = '该工位已占用';
    else if (g.clock < (g.cardCooldowns[type] || 0)) label = '卡片冷却中';
    else if (cost > 0 && !g.resource.canAfford(cost)) label = `还差 ${cost - g.resource.value} 摸鱼值`;
    g.ui.showPlacementFeedback(e.clientX, e.clientY, valid, label);
  }

  _clearPlacementPreview() {
    this.game.grid.clearPlacementPreview();
    this.game.ui.hidePlacementFeedback();
  }

  update() {
    const g = this.game;
    if (!g.ui.canInteract()) { this.reset(); return; }
    if (this.gestures.render()) return;
    if (!this._pointer || g._orbitActive) return;
    if (this._chargePlant) {
      if (this._chargePlant.dead) { this.reset(); return; }
      const progress = (performance.now() - this._chargeStart) / 600;
      const cost = this._chargePlant.cfg.chargeCost;
      const hint = !g.resource.canAfford(cost) ? `摸鱼值不足，需要 ${cost}` : progress >= 1 ? `松开发射 · 消耗 ${cost} 摸鱼值` : '按住蓄力… 松开不足 0.6 秒可取消';
      g.ui.showEntityFeedback(this._pointer.clientX, this._pointer.clientY, 'PPT射手 · 年终总结', hint, progress);
      return;
    }
    if (g.selectedCard) {
      g.ui.hideEntityFeedback();
      this._updatePlacementPreview(this._pointer, g.selectedCard);
      return;
    }
    if (performance.now() < (this._nextHover || 0)) return;
    this._nextHover = performance.now() + 75;
    this._clearPlacementPreview();
    this._setMouse(this._pointer);
    const hits = this.raycaster.intersectObjects(g.plants.filter(p => !p.dead).map(p => p.mesh), true);
    let plant = hits.length ? this._findEntityFromObject(hits[0].object, g.plants, 'plant') : null;
    if (!plant) {
      const tiles = this.raycaster.intersectObjects(g.grid.getTileMeshes());
      if (tiles.length) { const { row, col } = tiles[0].object.userData; plant = g.grid.getTile(row, col)?.occupied; }
    }
    if (!plant || plant.dead) { g.ui.hideEntityFeedback(); g.canvas.style.cursor = 'grab'; return; }
    g.canvas.style.cursor = 'pointer';
    const hint = plant.type === 'sunflower' ? (g.patrolWarning > 0 ? '老板巡逻中！点击会扣工位血量' : `点击 +${plant.cfg.clickGain} 摸鱼值 · 拖动换位`)
      : plant.type === 'peashooter' ? `拖动换位 · 原地按住蓄力（${plant.cfg.chargeCost}摸鱼值）`
      : plant.type === 'wallnut' ? '拖动换位 · 连点触发彩蛋' : '拖动换位 · 自动减速同排敌人';
    g.ui.showEntityFeedback(this._pointer.clientX, this._pointer.clientY, `${plant.cfg.name} · ${Math.ceil(plant.hp)}/${plant.maxHp} HP`, hint);
  }

  _findGhostFromObject(obj, ghosts) {
    let cur = obj;
    while (cur && !cur.userData.isGhost) cur = cur.parent;
    return ghosts.find((g) => g.mesh === cur) || null;
  }

  _findEntityFromObject(obj, list, key) {
    let cur = obj;
    while (cur && !cur.userData[key]) cur = cur.parent;
    if (!cur) return null;
    return cur.userData[key] || null;
  }

  /** 重置蓄力状态(新一局开始时调用) */
  reset(keepPointer = false) {
    if (this._chargePlant) { this._chargePlant.charging = false; this._chargePlant.chargeFx = 0; }
    this._chargePlant = null;
    this.gestures.cancel();
    if (!keepPointer) this._pointer = null;
    this.game.canvas.style.cursor = '';
    this._clearPlacementPreview();
    this.game.ui.hideEntityFeedback();
  }
}
