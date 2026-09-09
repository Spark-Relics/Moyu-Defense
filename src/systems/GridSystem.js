import * as THREE from 'three';
import { OfficeDiorama } from './OfficeDiorama.js';

/**
 * 网格系统：生成 5x9 草地棋盘，处理 行/列 <-> 世界坐标 转换，管理地块占用。
 * 约定：左侧(col<0)为房区僵尸生成点，右侧(col>=cols)为玩家工位基地。
 *       僵尸向 +x 方向(向右)移动进攻基地。
 */
export class GridSystem {
  constructor(scene, rows = 5, cols = 9, cell = 2) {
    this.scene = scene;
    this.rows = rows;
    this.cols = cols;
    this.cell = cell;
    this.group = new THREE.Group();
    // 整体偏移(轻微俯视视角)
    this.group.position.set(0, 0, 0);
    this.scene.add(this.group);
    this.tiles = []; // tiles[r][c] = { mesh, occupied, baseColor }
    this.diorama = new OfficeDiorama(this);
    this.diorama.build();

    this.buildPlacementPreview();
  }

  buildPlacementPreview() {
    this.previewGroup = new THREE.Group();
    this.previewGroup.visible = false;

    const planeGeo = new THREE.PlaneGeometry(this.cell * 0.92, this.cell * 0.92);
    this.previewFill = new THREE.Mesh(
      planeGeo,
      new THREE.MeshBasicMaterial({
        color: 0x8eff6a,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      })
    );
    this.previewFill.rotation.x = -Math.PI / 2;
    this.previewFill.position.y = 0.06;
    this.previewGroup.add(this.previewFill);

    const edgeMat = new THREE.MeshBasicMaterial({
      color: 0x8eff6a,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.previewEdges = [];
    const edgeLen = this.cell * 0.86;
    const edgeThick = 0.045;
    for (let i = 0; i < 4; i++) {
      const horizontal = i < 2;
      const geo = new THREE.BoxGeometry(horizontal ? edgeLen : edgeThick, 0.035, horizontal ? edgeThick : edgeLen);
      const edge = new THREE.Mesh(geo, edgeMat.clone());
      edge.position.y = 0.09;
      edge.position.x = horizontal ? 0 : (i === 2 ? -edgeLen / 2 : edgeLen / 2);
      edge.position.z = horizontal ? (i === 0 ? -edgeLen / 2 : edgeLen / 2) : 0;
      this.previewEdges.push(edge);
      this.previewGroup.add(edge);
    }

    this.group.add(this.previewGroup);
    this.previewLane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, this.cell * 0.86),
      new THREE.MeshBasicMaterial({ color: 0x8effd1, transparent: true, opacity: 0.13, depthWrite: false })
    );
    this.previewLane.rotation.x = -Math.PI / 2;
    this.previewLane.visible = false;
    this.group.add(this.previewLane);
  }

  /** 行列 -> 世界坐标 (格子中心, y=0) */
  gridToWorld(row, col) {
    const x = (col - (this.cols - 1) / 2) * this.cell;
    const z = (row - (this.rows - 1) / 2) * this.cell;
    return new THREE.Vector3(x, 0, z);
  }

  /** 世界坐标 -> 行列 (越界返回 null) */
  worldToGrid(point) {
    const col = Math.round(point.x / this.cell + (this.cols - 1) / 2);
    const row = Math.round(point.z / this.cell + (this.rows - 1) / 2);
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return null;
    return { row, col };
  }

  /** 基地(工位)的 x 坐标，僵尸越过即扣血 */
  getBaseX() {
    return this.gridToWorld(0, this.cols - 1).x + this.cell * 0.9;
  }

  /** 僵尸生成点 x (左侧外) */
  getSpawnX() {
    return this.gridToWorld(0, -1).x;
  }

  isOccupied(row, col) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return true;
    return this.tiles[row][col].occupied != null;
  }

  setOccupied(row, col, obj) {
    if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
      this.tiles[row][col].occupied = obj;
    }
  }

  getTile(row, col) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return null;
    return this.tiles[row][col];
  }

  highlight(row, col, on) {
    const t = this.getTile(row, col);
    if (!t) return;
    t.mesh.material.color.setHex(on ? 0x9fff6a : t.baseColor);
  }

  showPlacementPreview(row, col, valid, type) {
    const tile = this.getTile(row, col);
    if (!tile || !this.previewGroup) return;
    const pos = this.gridToWorld(row, col);
    const color = valid ? 0x8eff6a : 0xff5d6c;
    this.previewGroup.position.set(pos.x, 0, pos.z);
    this.previewGroup.visible = true;
    this.previewFill.material.color.setHex(color);
    this.previewEdges.forEach((edge) => edge.material.color.setHex(color));
    this.previewFill.material.opacity = valid ? 0.22 : 0.18;
    const attack = type === 'peashooter' || type === 'auditor';
    this.previewLane.visible = valid && attack;
    if (attack) {
      const startX = this.gridToWorld(row, 0).x - this.cell / 2;
      this.previewLane.position.set((startX + pos.x) / 2, 0.035, pos.z);
      this.previewLane.scale.x = pos.x - startX;
    }
  }

  clearPlacementPreview() {
    if (this.previewGroup) this.previewGroup.visible = false;
    if (this.previewLane) this.previewLane.visible = false;
  }

  /** 提供给 Raycaster 检测的地块网格列表 */
  getTileMeshes() {
    if (this._tileMeshes) return this._tileMeshes;
    const list = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) list.push(this.tiles[r][c].mesh);
    this._tileMeshes = list;
    return list;
  }
}
