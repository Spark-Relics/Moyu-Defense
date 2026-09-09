import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Shared geometry/materials keep the miniature office inexpensive to render.
export class OfficeDiorama {
  constructor(grid) {
    this.grid = grid;
    this.root = grid.group;
    this.geometries = new Map();
    this.materials = new Map();
  }

  material(color, glow = false) {
    const key = `${color}:${glow}`;
    if (!this.materials.has(key)) this.materials.set(key, new THREE.MeshStandardMaterial({
      color, roughness: 0.72, metalness: 0.05,
      ...(glow ? { emissive: color, emissiveIntensity: 0.5 } : {}),
    }));
    return this.materials.get(key);
  }

  box(parent, size, pos, color, radius = 0.06) {
    const key = `${size.join(':')}:${radius}`;
    if (!this.geometries.has(key)) this.geometries.set(key,
      radius ? new RoundedBoxGeometry(...size, 2, Math.min(radius, Math.min(...size) / 2)) : new THREE.BoxGeometry(...size));
    const mesh = new THREE.Mesh(this.geometries.get(key), this.material(color));
    mesh.position.set(...pos); mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  label(text, width, height, color = '#e3efdf', background = '#233f40') {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = Math.round(1024 * height / width);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color; ctx.font = `700 ${Math.round(canvas.height * 0.5)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width * 0.92);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
    return mesh;
  }

  floorLabel(text, size, pos, color, background) {
    const label = this.label(text, ...size, color, background);
    label.rotation.x = -Math.PI / 2; label.position.set(...pos); this.root.add(label);
    return label;
  }

  build() {
    const g = this.grid, w = g.cols * g.cell, d = g.rows * g.cell;
    // A rounded plinth and inset felt surface, not repeated noisy grass images.
    this.box(this.root, [w + 10.6, 0.8, d + 4.4], [0.5, -0.66, 0], 0x253e40, 0.28);
    this.box(this.root, [w + 10.2, 0.16, d + 4], [0.5, -0.18, 0], 0xe2e8db, 0.18);
    this.box(this.root, [w + 0.3, 0.14, d + 0.3], [0, -0.11, 0], 0x3d6558, 0.12);
    for (let row = 0; row < g.rows; row++) {
      g.tiles[row] = [];
      for (let col = 0; col < g.cols; col++) {
        const pos = g.gridToWorld(row, col);
        const color = row % 2 === 0 ? 0x92b594 : 0x83a888;
        const mesh = this.box(this.root, [g.cell - 0.045, 0.12, g.cell - 0.06], [pos.x, -0.055, pos.z], color, 0.035);
        mesh.userData = { row, col, isTile: true };
        g.tiles[row][col] = { mesh, occupied: null, baseColor: color };
        // Tiny registration dots make individual deployment slots readable.
        for (const side of [-1, 1]) this.box(this.root, [0.06, 0.012, 0.06],
          [pos.x + side * (g.cell / 2 - 0.18), 0.012, pos.z - g.cell / 2 + 0.18], 0xc8dcc3, 0);
      }
    }
    const left = -w / 2 - 2, right = w / 2 + 2.4;
    this.box(this.root, [3.6, 0.1, d + 0.3], [left, -0.05, 0], 0xcabaaa);
    this.box(this.root, [4.8, 0.1, d + 0.3], [right, -0.05, 0], 0xb9d0c9);
    for (let r = 0; r < g.rows; r++) {
      const z = g.gridToWorld(r, 0).z;
      this.buildDesk(right, z, r);
      this.buildEntry(left, z, r);
    }
    this.floorLabel('NIUMA  /  OFFICE DEFENSE', [11.5, 0.9], [-5.5, -0.08, d / 2 + 1.1]);
    this.floorLabel('守住工位 · 准时下班', [8.5, 0.9], [6.7, -0.08, d / 2 + 1.1], '#38534b', '#e2e8db');
    this.floorLabel('来袭入口  →', [4.8, 0.75], [left, -0.08, -d / 2 - 1.1], '#a44e3e', '#e2e8db');
    this.floorLabel('工位保护区', [4.8, 0.75], [right, -0.08, -d / 2 - 1.1], '#286d62', '#e2e8db');
    for (const z of [-d / 2 - 1, d / 2 + 1]) {
      this.planter(w / 2 + 4.2, z);
    }
  }

  buildDesk(x, z, index) {
    const desk = new THREE.Group(); desk.position.set(x, 0, z); this.root.add(desk);
    desk.rotation.y = Math.PI / 2;
    // Workstations face the incoming lane. Partitions separate each desk.
    this.box(desk, [2.5, 0.17, 1.85], [0.35, 1.07, 0], 0xe9ce9f, 0.12);
    this.box(desk, [0.6, 0.92, 1.4], [1.12, 0.51, 0], 0xf1f0df, 0.08);
    for (const dz of [-0.68, 0.68]) this.box(desk, [0.09, 0.93, 0.09], [-0.6, 0.51, dz], 0x405a55);
    for (const y of [0.36, 0.64, 0.86]) this.box(desk, [0.022, 0.025, 0.24], [0.81, y, 0], 0x728880, 0);
    this.box(desk, [2.95, 1.28, 0.10], [0.25, 0.68, -1.35], 0x6e9d94);
    this.box(desk, [2.97, 0.06, 0.15], [0.25, 1.35, -1.35], 0xb5d2c4);
    // Wide screen + stand, with a deliberately legible miniature spreadsheet.
    this.box(desk, [0.25, 0.08, 0.66], [0.5, 1.2, 0], 0x344d50);
    this.box(desk, [0.08, 0.34, 0.10], [0.64, 1.4, 0], 0x344d50);
    this.box(desk, [0.11, 0.8, 1.28], [0.66, 1.89, 0], 0x243c44);
    const screen = this.box(desk, [0.013, 0.66, 1.12], [0.595, 1.89, 0], 0x92ebd2, 0.006);
    screen.material = this.material(0x92ebd2, true);
    for (let i = 0; i < 4; i++) this.box(desk, [0.016, 0.025, 0.65 - i * 0.08], [0.585, 2.05 - i * 0.13, -0.13], 0x386c68, 0);
    this.box(desk, [0.45, 0.045, 0.68], [-0.23, 1.19, -0.12], 0xf4f1e1);
    for (let i = 0; i < 3; i++) this.box(desk, [0.025, 0.01, 0.54], [-0.37 + i * 0.13, 1.219, -0.12], 0xa7b9ad, 0);
    this.box(desk, [0.19, 0.055, 0.13], [-0.28, 1.21, 0.5], 0x344d50);
    // Swivel chair, backrest and five-star base.
    this.box(desk, [0.7, 0.15, 0.76], [-1.25, 0.64, 0], 0xd4a455, 0.15);
    this.box(desk, [0.13, 0.72, 0.78], [-1.58, 1.02, 0], 0x365b5c, 0.12);
    this.box(desk, [0.10, 0.48, 0.10], [-1.25, 0.3, 0], 0x34464a);
    for (const angle of [0, Math.PI / 3, Math.PI * 2 / 3]) {
      const foot = this.box(desk, [0.92, 0.07, 0.07], [-1.25, 0.10, 0], 0x34464a);
      foot.rotation.y = angle;
    }
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.10, 0.25, 12), this.material(0xf1edda));
    mug.position.set(0.1, 1.32, 0.66); desk.add(mug);
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), this.material(0x604632));
    coffee.rotation.x = -Math.PI / 2; coffee.position.set(0.1, 1.45, 0.66); desk.add(coffee);
    this.box(desk, [0.35, 0.025, 0.26], [0.9, 1.18, -0.63], 0xf3d67e);
    this.floorLabel(`0${index + 1}`, [0.7, 0.48], [x - 2.18, 0.023, z], '#f2f6df', '#537f70');
  }

  buildEntry(x, z, index) {
    for (const side of [-1, 1]) {
      this.box(this.root, [0.38, 1.75, 0.25], [x - 0.6, 0.83, z + side * 1.05], 0x6c7271);
      this.box(this.root, [0.41, 0.14, 0.28], [x - 0.6, 1.75, z + side * 1.05], 0xe89172);
    }
    this.box(this.root, [0.4, 0.16, 2.35], [x - 0.6, 1.9, z], 0xdba68b);
    this.floorLabel(`→  0${index + 1}`, [1.65, 0.65], [x + 0.5, 0.02, z], '#f9efdc', '#ac6854');
    for (let i = 0; i < 6; i++) this.box(this.root, [0.17, 0.025, 0.22],
      [x + 1.65, 0.015, z - 0.9 + i * 0.36], i % 2 ? 0x435654 : 0xe0b56f, 0);
  }

  planter(x, z) {
    this.box(this.root, [0.85, 0.65, 0.8], [x, 0.2, z], 0xc28964, 0.1);
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 6), this.material(i % 2 ? 0x588976 : 0x7ba576));
      leaf.scale.set(0.65, 1.8, 0.65);
      leaf.position.set(x + Math.cos(i * 2.4) * 0.22, 0.9, z + Math.sin(i * 2.4) * 0.22);
      leaf.rotation.z = Math.cos(i) * 0.4; this.root.add(leaf);
    }
  }
}
