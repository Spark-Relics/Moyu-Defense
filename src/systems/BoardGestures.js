const DRAG_DISTANCE = 8;

/** One captured pointer owns one gesture. Game state only commits on release. */
export class BoardGestures {
  constructor(interaction) {
    this.interaction = interaction;
    this.game = interaction.game;
    this.active = null;
  }

  begin(event, kind, extra = {}, owner = this.game.canvas) {
    if (this.active || !this.game.ui.canInteract() || event.isPrimary === false) return false;
    this.active = { kind, id: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, moved: false, owner, ...extra };
    owner.setPointerCapture?.(event.pointerId);
    return true;
  }

  startCard(event, type, owner) {
    const g = this.game;
    // Touch users tap to select and swipe the tray to browse. Capturing here
    // would turn a horizontal inventory swipe into an accidental deployment.
    if (event.pointerType === 'touch') return false;
    if (event.button !== 0 || event.isPrimary === false || this.active || !g.ui.canInteract()) return false;
    const wasSelected = g.selectedCard === type;
    if (!wasSelected) g._onCardClick(type);
    if (g.selectedCard !== type) return false;
    g.ui._hideCardTooltip();
    return this.begin(event, 'card', { type, wasSelected }, owner);
  }

  down(event) {
    const g = this.game, i = this.interaction;
    if (event.defaultPrevented || event.isPrimary === false) return;
    if (event.button === 2 && this.active) { event.preventDefault(); g._cancelActiveTool(); return; }
    if (event.button !== 0) return;
    if (!g.ui.canInteract()) {
      // The event ghost remains clickable while the decision panel is open.
      if (g.running && !g.paused && !g._contextLost && g.ui.isNiuActive?.()
        && g.ui.helpOverlay?.classList.contains('hidden')) i._smashGhostAt(event);
      return;
    }
    i._pointer = event;
    if (g.selectedCard) { this.begin(event, 'placement'); this.render(event); return; }
    if (i._smashGhostAt(event)) return;
    const plant = i._plantAt(event);
    if (plant) {
      if (!this.begin(event, 'plant', { plant })) return;
      if (plant.type === 'peashooter') i._startCharge(plant, event);
    } else {
      this.begin(event, 'pan', { anchor: g._boardPoint(event) });
    }
  }

  move(event) {
    const a = this.active, g = this.game, i = this.interaction;
    if (!a || event.pointerId !== a.id) return;
    if (!g.ui.canInteract() || a.plant?.dead) { this.cancel(); return; }
    a.x = event.clientX; a.y = event.clientY;
    if (!a.moved && Math.hypot(a.x - a.startX, a.y - a.startY) >= DRAG_DISTANCE) {
      a.moved = true;
      g.ui._hideCardTooltip?.();
      if (a.kind === 'plant') i._cancelCharge();
    }
    i._pointer = event;
    if (a.kind === 'pan' && a.moved) {
      g._panBoard(a.anchor, event);
      g.canvas.style.cursor = 'grabbing';
      g.ui.hideEntityFeedback();
    } else this.render(event);
  }

  render(event = null) {
    const a = this.active, g = this.game, i = this.interaction;
    if (!a) return false;
    if (a.plant?.dead) { this.cancel(); return false; }
    const e = event || { clientX: a.x, clientY: a.y };
    if (a.kind === 'pan') return true;
    if (a.kind === 'plant' && !a.moved) return false;
    g.ui.hideEntityFeedback();
    if (a.kind === 'placement' || (a.kind === 'card' && a.moved)) {
      if (i._isBoardPoint(e)) i._updatePlacementPreview(e, g.selectedCard);
      else i._clearPlacementPreview();
      if (a.moved) g.ui.showDragGhost(g.selectedCard, a.x, a.y, '松手部署');
    } else if (a.kind === 'plant' && a.moved) {
      const tile = i._isBoardPoint(e) ? i._tileAt(e) : null;
      const valid = tile && (!g.grid.isOccupied(tile.row, tile.col)
        || g.grid.getTile(tile.row, tile.col).occupied === a.plant);
      if (tile) {
        g.grid.showPlacementPreview(tile.row, tile.col, Boolean(valid), a.plant.type);
        g.ui.showPlacementFeedback(a.x, a.y, valid, valid ? '松手换位 · 免费' : '已有植物 · 松手返回原位');
      } else i._clearPlacementPreview();
      g.ui.showDragGhost(a.plant.type, a.x, a.y, '移动植物');
    }
    return true;
  }

  up(event) {
    const a = this.active, g = this.game, i = this.interaction;
    if (!a || event.pointerId !== a.id) return;
    this.active = null;
    const canCommit = g.ui.canInteract() && !a.plant?.dead;
    const tile = canCommit && i._isBoardPoint(event) ? i._tileAt(event) : null;
    if (canCommit) {
      if (a.kind === 'card' && !a.moved) {
        if (a.wasSelected) g._cancelActiveTool(false);
      } else if (a.kind === 'card' || a.kind === 'placement') {
        if (tile) i._tryPlant(tile.row, tile.col);
        else g.ui.toast('已取消部署');
        if (a.kind === 'card' || !tile) g._cancelActiveTool(false);
      } else if (a.kind === 'plant') {
        if (a.moved) this.relocate(a.plant, tile);
        else if (i._isBoardPoint(event)) i._releasePlant(a.plant);
      }
    }
    i._cancelCharge();
    i._clearPlacementPreview();
    g.ui.hideDragGhost();
    g.canvas.style.cursor = '';
    if (a.owner.hasPointerCapture?.(a.id)) a.owner.releasePointerCapture(a.id);
  }

  relocate(plant, tile) {
    const g = this.game;
    if (!g.ui.canInteract() || plant.dead) return false;
    if (!tile || (g.grid.isOccupied(tile.row, tile.col) && g.grid.getTile(tile.row, tile.col).occupied !== plant)) {
      g.ui.toast('位置不可用，植物留在原位'); return false;
    }
    if (plant.row === tile.row && plant.col === tile.col) return true;
    g.grid.setOccupied(plant.row, plant.col, null);
    plant.row = tile.row; plant.col = tile.col;
    plant.mesh.position.copy(g.grid.gridToWorld(tile.row, tile.col));
    g.grid.setOccupied(tile.row, tile.col, plant);
    g.particles.spawnPlant(g.grid.group, plant.mesh.position);
    g.audio.play('plant');
    g.ui.toast(`${plant.cfg.name} 已换位`);
    return true;
  }

  cancel() {
    const a = this.active;
    this.active = null;
    this.interaction._cancelCharge();
    this.interaction._clearPlacementPreview();
    this.game.ui.hideDragGhost?.();
    if (a?.owner.hasPointerCapture?.(a.id)) a.owner.releasePointerCapture(a.id);
  }
}
