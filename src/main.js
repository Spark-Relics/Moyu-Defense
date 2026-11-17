import './style.css';
import './production.css';
import * as THREE from 'three';

import { GridSystem } from './systems/GridSystem.js';
import { ResourceSystem } from './systems/ResourceSystem.js';
import { EventSystem } from './systems/EventSystem.js';
import { UIManager } from './ui/UIManager.js';
import { AudioSystem } from './systems/AudioSystem.js';
import { ParticleSystem } from './systems/ParticleSystem.js';
import { EffectSystem } from './systems/EffectSystem.js';
import { InteractionSystem } from './systems/InteractionSystem.js';
import { ItemSystem } from './systems/ItemSystem.js';
import { LevelSystem } from './systems/LevelSystem.js';
import { LevelUI } from './ui/LevelUI.js';
import { PLANT_TYPES } from './entities/Plant.js';
import { createPlant } from './entities/PlantFactory.js';
import { createZombie } from './entities/Zombie.js';
import { preloadCharacterModels } from './systems/CharacterModelLoader.js';
import { tweenManager } from './utils/Tween.js';
import { GridDebugger } from './utils/GridDebugger.js';
import { getBoardOrbitRadius } from './utils/CameraFraming.js';
import { advanceSimulation } from './utils/Simulation.js';
import { findProjectileTarget } from './utils/ProjectileCollision.js';
import { getZombieSpeed } from './utils/CombatRules.js';
import { PlayerStorage } from './systems/PlayerStorage.js';
import { SettingsUI } from './ui/SettingsUI.js';

export const CFG = {
  ROWS: 5, COLS: 9, CELL: 3.00,
  BASE_HP: 100,
  PATROL_CHANCE: 0.15,
  PATROL_DURATION: 2,
  PATROL_PENALTY: 8,
  RAGE_MAX: 100,
  RAGE_PER_KILL: 8,
  TICKET_DROP_CHANCE: 0.15,
};

class Game {
  constructor() {
    let storage;
    try { storage = window.localStorage; } catch { /* In-memory play remains available. */ }
    this.storage = new PlayerStorage(storage);
    this.settings = this.storage.loadSettings();
    this._accumulator = 0;
    this._renderDirty = true;
    this.canvas = document.getElementById('game-canvas');
    this.canvas.tabIndex = -1;
    this.running = false;
    this._contextLost = false;
    this._pausedBeforeContextLoss = false;
    this.clock = 0;
    this.lastT = 0;
    this.cfg = CFG;

    this.plants = []; this.zombies = []; this.projectiles = [];
    this.audio = new AudioSystem();
    this.particles = new ParticleSystem();
    this.effects = new EffectSystem();

    this._atkDebuffMul = 1;  this._atkDebuffEnd = 0;
    this._atkSpeedMul = 1;   this._atkSpeedEnd = 0;
    this._zombieSlowEnd = 0;

    this.cardCooldowns = {};
    this.selectedCard = null;
    this.hammerMode = false;
    this.patrolWarning = 0;
    this.shieldCount = 0;
    this.bossCount = 0;
    this.moyuMul = 1;

    // 怨气值 & 工时券
    this.rage = 0;
    this.tickets = 0;
    this.bankedTickets = 0;

    // 游戏控制
    this.paused = false;
    this.speedMul = 1;

    // 连击/得分
    this.killStreak = 0;
    this.streakTimer = 0;
    this.totalKills = 0;
    this.score = 0;

    // 屏幕震动
    this._shakeIntensity = 0;
    this._shakeDuration = 0;

    this._initThree();
    this._initUI();
    this.items = new ItemSystem(this);
    this.interaction = new InteractionSystem(this);
    this.levels = new LevelSystem(this);
    this.levelUI = new LevelUI(this.levels);
    this.ui.setLevelUI(this.levelUI);
    this.settingsUI = new SettingsUI(this.settings, () => {
      this.storage.saveSettings(this.settings);
      this._applySettings();
    }, () => { this.interaction.reset(); this._orbitActive = false; });
    this.levelUI.onSettings = () => this.settingsUI.show();
    this.levelUI.onHelp = () => this.ui._toggleHelp();
    this.ui.onSettings = () => this.settingsUI.show();
    this.ui.onResume = () => this._togglePause();
    this.ui.onRestart = () => this.startLevel(this.levels.currentLevelId);
    this.ui.onMenu = () => this.returnToMenu();
    this.ui.onDecisionOpen = () => { if (this.speedMul > 1) this._setSpeed(1); };
    this._applySettings();
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => this._applySettings());
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('debug')) {
      this.debugger = new GridDebugger(this);
    }

    // 关卡UI回调
    this.levelUI.onStartLevel = (id) => this.startLevel(id);
    this.levelUI.onNextLevel = (id) => this.startLevel(id);
    this.levelUI.onRetry = () => this.startLevel(this.levels.currentLevelId);
    this.levelUI.onBackToMenu = () => this.returnToMenu();

    // 加载进度，显示选关界面
    this.levels.loadProgress();
    this.ui.hideOverlay();
    this.levelUI.showMenu();
    document.getElementById('boot-screen')?.remove();
    this.lastT = performance.now();
    this._loop();
  }

  _applySettings() {
    const low = this.settings.quality === 'low' || (this.settings.quality === 'auto' && (navigator.hardwareConcurrency <= 4 || matchMedia('(max-width: 700px)').matches));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1 : 2));
    this.renderer.shadowMap.enabled = !low;
    this.audio.volume = this.settings.volume;
    this.reducedMotion = this.settings.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.body.classList.toggle('reduced-motion', this.reducedMotion);
    this._renderDirty = true;
  }

  _initThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xdce6df);
    // 视角预设: [名称, position, target]
    this._camPresets = [
      { name: '高俯视', pos: [0, 32, 38], tgt: [0, 0, 0] },    // 当前视角
      { name: '斜视角', pos: [22, 20, 22], tgt: [-4, 0, 0] },  // 更立体的斜45度
      { name: '平视', pos: [18, 8, 12], tgt: [-6, 1, 0] },     // 接近地面，沉浸感强
    ];

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(
      this._camPresets[0].pos[0],
      this._camPresets[0].pos[1],
      this._camPresets[0].pos[2]
    );
    this._camTarget = new THREE.Vector3(...this._camPresets[0].tgt);
    this.camera.lookAt(this._camTarget);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas.addEventListener('webglcontextlost', (event) => this._onContextLost(event), false);
    this.canvas.addEventListener('webglcontextrestored', () => this._onContextRestored(), false);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dir = new THREE.DirectionalLight(0xffedcf, 2.1);
    dir.position.set(-10, 28, 14); dir.castShadow = true;
    dir.shadow.bias = -0.0003;
    dir.shadow.normalBias = 0.025;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -30; dir.shadow.camera.right = 30;
    dir.shadow.camera.top = 30; dir.shadow.camera.bottom = -30;
    this.scene.add(dir);
    this.scene.add(new THREE.HemisphereLight(0xe5f5ff, 0x829c8a, 1.2));

    // 棋盘下方大地基底(避免悬浮感)
    const groundGeo = new THREE.PlaneGeometry(200, 200);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xc9d6cc, roughness: 1 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.1;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.grid = new GridSystem(this.scene, CFG.ROWS, CFG.COLS, CFG.CELL);

    this._camIdx = 0;
    this._camAnimating = false;
    this._camAnimStart = 0;
    this._camAnimDur = 800; // ms
    this._camFromPos = [0, 0, 0];
    this._camFromTgt = [0, 0, 0];
    this._camToPos = [0, 0, 0];
    this._camToTgt = [0, 0, 0];
    this._camBasePos = new THREE.Vector3();

    // 自由相机轨道控制(右键拖拽旋转 + 滚轮缩放)
    this._orbitActive = false;       // 是否正在拖拽
    this._orbitTheta = 0;            // 水平旋转角(弧度)
    this._orbitPhi = 0;              // 垂直旋转角(弧度, 0=正上方)
    this._orbitRadius = 40;          // 到目标点的距离
    this._orbitMinRadius = 15;       // 最近缩放距离
    this._orbitMaxRadius = 80;       // 最远缩放距离
    this._orbitMinPhi = 0.15;        // 最小垂直角(防止翻到地下)
    this._orbitMaxPhi = Math.PI / 2 - 0.05; // 最大垂直角(接近水平)
    this._orbitTarget = new THREE.Vector3(0, 0, 0); // 相机注视点
    this._initOrbitFromCamera();
    this._fitBoard();

    // 创建视角切换UI
    this._buildCamUI();

    // 相机拖拽事件
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerdown', (e) => this._onOrbitDown(e));
    window.addEventListener('pointermove', (e) => this._onOrbitMove(e));
    window.addEventListener('pointerup', (e) => this._onOrbitUp(e));
    this.canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });

    // 游戏控制按钮(暂停/加速)
    this._buildGameControls();

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.isContentEditable) return;
      if (this.settingsUI?.open) return;
      // Let native dialogs handle Escape and focused-button activation.
      // The board shortcut handler must not cancel their default behavior.
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.ui.dismissTopOverlay()) return;
        if (this.selectedCard || this.hammerMode || this.interaction?.gestures.active) this._cancelActiveTool();
        else this._togglePause();
        return;
      }
      if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); this._togglePause(); return; }
      if (!this.running || this.paused || this.ui.isInteractionBlocked()) return;
      const cardType = this.ui.getCardTypeForHotkey(e.key);
      if (cardType) { e.preventDefault(); this._onCardClick(cardType); return; }
      if (e.key === 'c' || e.key === 'C') this._cycleCamera();
      if (e.key === '1') this._setSpeed(1);
      if (e.key === '2') this._setSpeed(2);
      if (e.key === '3') this._setSpeed(3);
    });
    window.addEventListener('resize', () => this._onResize());
    window.addEventListener('blur', () => {
      this._orbitActive = false;
      if (this.running && !this.paused) this._togglePause();
    });
    document.addEventListener('visibilitychange', () => {
      this._accumulator = 0;
      if (document.hidden) {
        if (this.running && !this.paused) this._togglePause();
        cancelAnimationFrame(this._raf);
        this.audio.audioCtx?.suspend().catch(() => {});
      } else {
        this.lastT = performance.now();
        this._loop();
      }
    });
  }

  /** 构建视角切换按钮 */
  _buildCamUI() {
    const container = document.createElement('div');
    container.id = 'cam-switch';
    const names = ['高俯视', '斜视角', '平视'];
    names.forEach((name, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cam-btn' + (i === 0 ? ' active' : '');
      btn.textContent = name;
      btn.setAttribute('aria-pressed', String(i === 0));
      btn.addEventListener('click', () => {
        this._camIdx = i;
        this._animateToPreset(i);
      });
      container.appendChild(btn);
    });
    const hint = document.createElement('div');
    hint.className = 'cam-hint';
    hint.innerHTML = '右键拖拽旋转<br>滚轮缩放';
    container.appendChild(hint);
    for (const [label, title, action] of [
      ['全景', '恢复完整棋盘视角', () => this._fitBoard()],
      ['−', '缩小视野中的棋盘', () => this._zoomCamera(1.12)],
      ['+', '放大棋盘', () => this._zoomCamera(1 / 1.12)],
    ]) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'cam-tool'; btn.textContent = label;
      btn.setAttribute('aria-label', title);
      btn.addEventListener('click', action);
      container.appendChild(btn);
    }
    document.getElementById('ui-root').appendChild(container);
    this._camButtons = container.querySelectorAll('.cam-btn');
  }

  /** 构建游戏控制按钮(暂停/加速) */
  _buildGameControls() {
    const container = document.createElement('div');
    container.id = 'game-controls';

    // 暂停按钮
    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.className = 'gc-btn';
    pauseBtn.id = 'gc-pause';
    pauseBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
    pauseBtn.title = '暂停 [空格]';
    pauseBtn.setAttribute('aria-label', '暂停游戏');
    pauseBtn.setAttribute('aria-pressed', 'false');
    pauseBtn.addEventListener('click', () => this._togglePause());
    container.appendChild(pauseBtn);

    // 速度按钮组(水平排列)
    const speedRow = document.createElement('div');
    speedRow.className = 'gc-speed-row';
    for (const spd of [1, 2, 3]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gc-btn gc-speed' + (spd === 1 ? ' active' : '');
      btn.id = 'gc-speed-' + spd;
      btn.textContent = spd + 'x';
      btn.setAttribute('aria-label', `设置游戏速度为 ${spd} 倍`);
      btn.setAttribute('aria-pressed', String(spd === 1));
      btn.addEventListener('click', () => this._setSpeed(spd));
      speedRow.appendChild(btn);
    }
    container.appendChild(speedRow);

    // 击杀计数
    const killInfo = document.createElement('div');
    killInfo.id = 'gc-info';
    killInfo.innerHTML = '<span id="kill-count">0</span>击杀<br><span id="combo-display" style="color:#ff8a80"></span>';
    container.appendChild(killInfo);

    document.getElementById('ui-root').appendChild(container);
  }

  _togglePause() {
    if (!this.running || this._contextLost || this.settingsUI?.open) return;
    this.paused = !this.paused;
    this._accumulator = 0;
    if (!this.paused) this.audio.ensure();
    this.interaction?.reset();
    this._orbitActive = false;
    this.ui.setPaused(this.paused);
    this._syncPauseButton();
  }

  _syncPauseButton() {
    const btn = document.getElementById('gc-pause');
    if (this.paused) {
      btn.classList.add('paused');
      btn.setAttribute('aria-label', '继续游戏');
      btn.setAttribute('aria-pressed', 'true');
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>';
    } else {
      btn.classList.remove('paused');
      btn.setAttribute('aria-label', '暂停游戏');
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
    }
  }

  _setSpeed(spd) {
    if (!this.running) return;
    if (spd > 1 && this.ui.isNiuActive()) {
      this.ui.toast('先完成事件选择，再切换倍速');
      return;
    }
    this.speedMul = spd;
    for (const s of [1, 2, 3]) {
      const btn = document.getElementById('gc-speed-' + s);
      if (btn) {
        btn.classList.toggle('active', s === spd);
        btn.setAttribute('aria-pressed', String(s === spd));
      }
    }
    this.ui.toast('速度: ' + spd + 'x');
  }

  /** 触发屏幕震动 */
  shake(intensity = 0.3, duration = 0.3) {
    if (this.reducedMotion) return;
    this._shakeIntensity = Math.max(this._shakeIntensity, intensity);
    this._shakeDuration = Math.max(this._shakeDuration, duration);
  }

  /** 更新按钮选中状态 */
  _updateCamButtons() {
    this._camButtons?.forEach((btn, i) => {
      const active = i === this._camIdx;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  /** 平滑切换到指定预设 */
  _animateToPreset(idx) {
    if (this.paused || this.ui?.isInteractionBlocked()) return;
    if (idx === 0) { this._fitBoard(); return; }
    if (this._camAnimating) return;
    const p = this._camPresets[idx];
    this._camIdx = idx;
    // 计算当前轨道参数作为起点
    this._fromTheta = this._orbitTheta;
    this._fromPhi = this._orbitPhi;
    this._fromRadius = this._orbitRadius;
    this._fromTgtX = this._orbitTarget.x;
    this._fromTgtY = this._orbitTarget.y;
    this._fromTgtZ = this._orbitTarget.z;
    // 从预设 pos/tgt 计算目标轨道参数
    const ox = p.pos[0] - p.tgt[0];
    const oy = p.pos[1] - p.tgt[1];
    const oz = p.pos[2] - p.tgt[2];
    const r = Math.sqrt(ox*ox + oy*oy + oz*oz);
    this._toTheta = Math.atan2(ox, oz);
    this._toPhi = Math.acos(Math.max(-1, Math.min(1, oy / Math.max(0.001, r))));
    this._toRadius = r;
    this._toTgtX = p.tgt[0];
    this._toTgtY = p.tgt[1];
    this._toTgtZ = p.tgt[2];
    this._camAnimating = true;
    if (this.reducedMotion) this._camAnimDur = 0;
    else this._camAnimDur = 800;
    this._camAnimStart = performance.now();
    this._updateCamButtons();
    this.ui?.toast(`视角: ${p.name}`);
  }

  /** 循环切换视角 */
  _cycleCamera() {
    if (this._camAnimating) return;
    this._camIdx = (this._camIdx + 1) % this._camPresets.length;
    this._animateToPreset(this._camIdx);
  }

  /** 初始化轨道参数(从当前 camera position 推算) */
  _initOrbitFromCamera() {
    const offset = new THREE.Vector3().subVectors(this.camera.position, this._orbitTarget);
    this._orbitRadius = offset.length();
    this._orbitTheta = Math.atan2(offset.x, offset.z);
    this._orbitPhi = Math.acos(Math.max(-1, Math.min(1, offset.y / Math.max(0.001, this._orbitRadius))));
  }

  /** 右键按下：开始拖拽 */
  _onOrbitDown(e) {
    if (e.button !== 2) return; // 右键
    if (!this.running || this.paused || this.ui.isInteractionBlocked()) return;
    if (e.defaultPrevented) return;
    if (this.selectedCard || this.hammerMode || this.interaction?.gestures.active) {
      e.preventDefault();
      this._cancelActiveTool();
      return;
    }
    this._orbitActive = true;
    this._orbitPrevX = e.clientX;
    this._orbitPrevY = e.clientY;
    this._camAnimating = false; // 中断动画
    this._camIdx = -1;
    this._updateCamButtons();
    this.canvas.style.cursor = 'grabbing';
  }

  /** 拖拽移动 */
  _onOrbitMove(e) {
    if (!this._orbitActive) return;
    const dx = e.clientX - this._orbitPrevX;
    const dy = e.clientY - this._orbitPrevY;
    this._orbitPrevX = e.clientX;
    this._orbitPrevY = e.clientY;
    // 水平旋转灵敏度
    this._orbitTheta -= dx * 0.006;
    // 垂直旋转灵敏度(取反：向下拖→相机下降)
    this._orbitPhi += dy * 0.006;
    // 限制 phi 范围
    this._orbitPhi = Math.max(this._orbitMinPhi, Math.min(this._orbitMaxPhi, this._orbitPhi));
  }

  /** 右键松开 */
  _onOrbitUp(e) {
    if (!this._orbitActive) return;
    if (e.button === 2 || e.button === undefined) {
      this._orbitActive = false;
      this.canvas.style.cursor = '';
    }
  }

  /** 滚轮缩放 */
  _onWheel(e) {
    e.preventDefault();
    if (this.interaction?.gestures.active) return;
    const before = this._boardPoint(e);
    this._zoomCamera(Math.exp(THREE.MathUtils.clamp(e.deltaY, -100, 100) * 0.0015));
    if (before && this.ui.canInteract()) this._panBoard(before, e);
  }

  _boardPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.camera.updateMatrixWorld();
    const ray = new THREE.Raycaster(); ray.setFromCamera(pointer, this.camera);
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  }

  _panBoard(anchor, event) {
    if (!anchor || !this.ui.canInteract()) return;
    const point = this._boardPoint(event);
    if (!point) return;
    this._camAnimating = false;
    this._orbitTarget.add(anchor.clone().sub(point));
    this._orbitTarget.x = THREE.MathUtils.clamp(this._orbitTarget.x, -CFG.COLS * CFG.CELL * 0.65, CFG.COLS * CFG.CELL * 0.65);
    this._orbitTarget.z = THREE.MathUtils.clamp(this._orbitTarget.z, -CFG.ROWS * CFG.CELL * 0.8, CFG.ROWS * CFG.CELL * 0.8);
    this._camIdx = -1;
    this._applyOrbit(); this._updateCamButtons();
  }

  _zoomCamera(factor) {
    if (!this.running || this.paused || this.ui.isInteractionBlocked()) return;
    this._camAnimating = false;
    this._orbitRadius = THREE.MathUtils.clamp(this._orbitRadius * factor, this._orbitMinRadius, this._orbitMaxRadius);
    this._camIdx = -1;
    this._applyOrbit();
    this._updateCamButtons();
  }

  // Frame the entire board, including both landmarks, inside the HUD's safe area.
  _fitBoard() {
    this._camAnimating = false;
    this._orbitTheta = 0;
    this._orbitPhi = 0.65;
    this._orbitTarget.set(0, 0, 0);
    const halfW = (CFG.COLS / 2 + 1.8) * CFG.CELL;
    const halfD = (CFG.ROWS / 2 + 0.85) * CFG.CELL;
    const compact = window.innerHeight < 560 && window.innerWidth > window.innerHeight;
    if (compact) this.camera.setViewOffset(window.innerWidth, window.innerHeight, -window.innerWidth * .13, 0, window.innerWidth, window.innerHeight);
    else this.camera.clearViewOffset();
    const radius = getBoardOrbitRadius({ halfWidth: halfW, halfDepth: halfD,
      phi: this._orbitPhi, fov: this.camera.fov, aspect: this.camera.aspect, height: window.innerHeight,
      ...(compact ? { verticalReserve: 150, headroom: 1, safeX: .64 } : {}) });
    this._orbitRadius = radius;
    this.scene.fog = new THREE.Fog(0xdce6df, radius * 2, radius * 5);
    this._orbitMaxRadius = Math.max(120, radius * 1.5);
    this.camera.far = Math.max(200, radius * 3);
    this.camera.updateProjectionMatrix();
    this._applyOrbit();
    this._camIdx = 0;
    this._updateCamButtons?.();
  }

  /** 从轨道参数更新 camera 位置 */
  _applyOrbit() {
    const sinPhi = Math.sin(this._orbitPhi);
    const x = this._orbitTarget.x + this._orbitRadius * sinPhi * Math.sin(this._orbitTheta);
    const y = this._orbitTarget.y + this._orbitRadius * Math.cos(this._orbitPhi);
    const z = this._orbitTarget.z + this._orbitRadius * sinPhi * Math.cos(this._orbitTheta);
    this.camera.position.set(x, y, z);
    this._camTarget.copy(this._orbitTarget);
    this.camera.lookAt(this._camTarget);
  }

  /** 更新动画相机 */
  _updateCamera(dt) {
    if (this._camAnimating) {
      const t = this._camAnimDur === 0 ? 1 : Math.min(1, (performance.now() - this._camAnimStart) / this._camAnimDur);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // easeInOutCubic
      // 插值轨道参数
      const theta = this._fromTheta + (this._toTheta - this._fromTheta) * ease;
      const phi = this._fromPhi + (this._toPhi - this._fromPhi) * ease;
      const radius = this._fromRadius + (this._toRadius - this._fromRadius) * ease;
      const tx = this._fromTgtX + (this._toTgtX - this._fromTgtX) * ease;
      const ty = this._fromTgtY + (this._toTgtY - this._fromTgtY) * ease;
      const tz = this._fromTgtZ + (this._toTgtZ - this._fromTgtZ) * ease;
      const sinPhi = Math.sin(phi);
      this.camera.position.set(
        tx + radius * sinPhi * Math.sin(theta),
        ty + radius * Math.cos(phi),
        tz + radius * sinPhi * Math.cos(theta)
      );
      this._camTarget.set(tx, ty, tz);
      this.camera.lookAt(this._camTarget);
      this._orbitTheta = theta;
      this._orbitPhi = phi;
      this._orbitRadius = radius;
      this._orbitTarget.set(tx, ty, tz);
      if (t >= 1) {
        this._camAnimating = false;
        // 同步轨道参数到最终值
        this._orbitTheta = this._toTheta;
        this._orbitPhi = this._toPhi;
        this._orbitRadius = this._toRadius;
        this._orbitTarget.set(this._toTgtX, this._toTgtY, this._toTgtZ);
      }
      return;
    }

    // 自由拖拽：从轨道参数更新相机
    this._applyOrbit();

    // 屏幕震动叠加
    if (this._shakeDuration > 0) {
      this._shakeDuration -= dt;
      const decay = Math.max(0, this._shakeDuration / 0.3);
      const offset = this._shakeIntensity * decay;
      this.camera.position.x += (Math.random() - 0.5) * offset * 2;
      this.camera.position.y += (Math.random() - 0.5) * offset;
      this.camera.lookAt(this._camTarget);
      if (this._shakeDuration <= 0) { this._shakeIntensity = 0; }
    }
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this._fitBoard();
    this._renderDirty = true;
  }

  _onContextLost(event) {
    event.preventDefault();
    if (this._contextLost) return;
    this._contextLost = true;
    this._pausedBeforeContextLoss = this.paused;
    this.paused = true;
    this.interaction?.reset();
    this._orbitActive = false;
    this.canvas.style.cursor = '';
    this.ui?.showRendererStatus('显卡连接中断', '正在等待浏览器恢复 3D 画面，游戏进度已安全暂停…');
  }

  _onContextRestored() {
    this._contextLost = false;
    this._onResize();
    this.paused = this._pausedBeforeContextLoss;
    this.ui?.hideRendererStatus();
    this.ui?.setPaused(this.paused);
    this._syncPauseButton();
    this.ui?.toast('3D 画面已恢复');
    this.lastT = performance.now();
  }

  _initUI() {
    // 先用空列表初始化，startLevel时会重新设置
    this.ui = new UIManager([]);
    this.ui.onCardClick = (type) => this._onCardClick(type);
    this.ui.onCardPointerDown = (event, type, card) => this.interaction.gestures.startCard(event, type, card);
    this.ui.onCardCaptureLost = () => { if (this.interaction.gestures.active) this.interaction.reset(); };
    this.ui.onCancelSelection = () => this._cancelActiveTool();
    this.ui.canInteract = () => this.running && !this.paused && !this._contextLost && !this.settingsUI?.open && !this.ui.isInteractionBlocked();
    this.ui.isFreePlacement = () => Boolean(this.items?.isUltMoyu());
    this.ui.onHelpChange = (open) => {
      this.interaction?.reset();
      this._orbitActive = false;
      if (open) this.ui._hideCardTooltip();
    };
  }

  /** 根据关卡更新可用卡片 */
  _refreshCards() {
    const cards = this.levels.getAvailableCards();
    this.ui.setCards(cards);
  }

  _createZombie(type, row) { return createZombie(this.grid.group, type, row, this.grid); }

  createPlant(type, row, col) { return createPlant(this.grid.group, type, row, col, this.grid); }
  playSound(type) { this.audio.play(type); }

  // ---------- 卡片点击 ----------
  _onCardClick(type) {
    if (!this.ui.canInteract()) return;
    const cfg = PLANT_TYPES[type];
    if (!cfg || !this.ui.cardEls[type]) return;
    this.interaction.reset(true);

    if (this.selectedCard === type || (type === 'hammer' && this.hammerMode)) {
      this._cancelActiveTool();
      return;
    }

    // 大招(消耗怨气值)
    if (cfg.isUlt) {
      if (this.rage < cfg.rageCost) { this.ui.toast('怨气值不足！'); return; }
      if (this._useUlt(type)) {
        this.rage -= cfg.rageCost;
        this.ui.setRage(this.rage, CFG.RAGE_MAX);
        this.ui.showStatDelta('rage-text', -cfg.rageCost, 'rage');
      }
      return;
    }

    // 工时券消耗品
    if (cfg.isTicket) {
      if (this.tickets < cfg.ticketCost) { this.ui.toast('工时券不足！'); return; }
      if (this._useTicket(type)) {
        this.tickets -= cfg.ticketCost;
        this.ui.updateTickets(this.tickets);
        this.ui.showStatDelta('ticket-value', -cfg.ticketCost, 'ticket');
      }
      return;
    }

    // 技能类道具
    if (cfg.isSkill) {
      if (this.clock < (this.cardCooldowns[type] || 0)) { this.ui.toast('冷却中…'); return; }
      // 终极摸鱼期间免费
      const cost = this.items.isUltMoyu() ? 0 : cfg.cost;
      if (cost > 0 && !this.resource.canAfford(cost)) { this.ui.toast('摸鱼值不足！'); return; }
      if (this._useSkill(type)) {
        if (cost > 0) this.resource.spend(cost);
        this._setCD(type, cfg.cd);
      }
      return;
    }

    // 植物卡片
    this.hammerMode = false; this.ui.setHammerMode(false);
    if (this.clock < (this.cardCooldowns[type] || 0)) { this.ui.toast('卡片冷却中…'); return; }
    const plantCost = this.items.isUltMoyu() ? 0 : cfg.cost;
    if (plantCost > 0 && !this.resource.canAfford(plantCost)) { this.ui.toast('摸鱼值不足！'); return; }
    this.ui.selectCard(type); this.selectedCard = type;
  }

  _cancelActiveTool(showToast = true) {
    this.interaction?.reset();
    const hadTool = Boolean(this.selectedCard || this.hammerMode);
    this.selectedCard = null;
    this.hammerMode = false;
    this.ui.setHammerMode(false);
    this.ui.clearSelection();
    this.grid.clearPlacementPreview();
    if (hadTool && showToast) this.ui.toast('已取消选择');
  }

  _setCD(type, cd) { this.cardCooldowns[type] = this.clock + cd; this.ui.setCardCooldown(type, this.clock + cd, cd); }

  _useSkill(type) {
    if (type === 'hammer') return this.items.hammer(this) !== false;
    // 特供道具(本关限定，需校验使用次数)
    const special = this.levels.getSpecial();
    if (special && type === special.type) {
      if (!this.levels.canUseSpecial()) { this.ui.toast('特供道具次数已用完！'); return false; }
      const fn = this.items[type];
      if (!fn) return false;
      const used = fn.call(this.items, this) !== false;
      if (used) this.levels.useSpecial();
      return used;
    }
    const fn = { shield:1, read:1, photo:1, mine:1, tiaoxiu:1, dabing:1, coffee:1, report:1, optimize:1 }[type];
    return fn ? this.items[type](this) !== false : false;
  }
  _useUlt(type) {
    const fn = { ult_moyu:'ultMoyu', ult_meeting:'ultMeeting', ult_bomb:'ultBomb' }[type];
    return fn && this.items[fn] ? this.items[fn](this) !== false : false;
  }
  _useTicket(type) {
    const fn = { weather:'weather', readback:'readback' }[type];
    return fn ? this.items[fn](this) !== false : false;
  }

  _toggleHammer() {
    this.hammerMode = !this.hammerMode;
    if (this.hammerMode) {
      this.ui.selectCard('hammer'); this.ui.setHammerMode(true);
      this.selectedCard = null;
      this.ui.toast('换鱼锤已就绪！点僵尸定身3秒+伤害翻倍');
    } else { this.ui.clearSelection(); this.ui.setHammerMode(false); }
  }

  // ---------- 关卡开始 ----------
  startLevel(levelId) {
    if (!this.levels.isUnlocked(levelId) || this._contextLost) return;
    this.finishRound();
    this.tickets = this.bankedTickets;
    document.body.classList.add('in-game');
    this.levelUI.hideMenu();
    this.audio.ensure();
    this._clearEntities();
    const level = this.levels.startLevel(levelId);
    preloadCharacterModels([...this.levels.getAvailableCards().map(card => card.type), ...level.waves.flatMap(wave => wave.zombies.map(group => group.type === 'super_traitor' ? 'traitor' : group.type))]);
    this.clock = 0; this.running = true;
    this.canvas.tabIndex = 0;
    this.baseHp = CFG.BASE_HP;
    this.resource = new ResourceSystem(this.ui, level.startResource);
    this.eventSystem = new EventSystem(this);
    this.items = new ItemSystem(this);
    this._refreshCards(); // 按关卡刷新可用道具
    this.ui.updateSpecialUses(level.special, 0);
    this.ui.showOnboarding(level.id === 1);
    this.ui.updateResource(level.startResource);
    this.ui.updateBaseHp(1);
    this.ui.clearSelection(); this.ui.setHammerMode(false);
    this.ui.setShield(0); this.ui.setBossDarken(false);
    this.ui.setWeather(false); this.ui.setPoison(false);
    this.ui.setRage(0, CFG.RAGE_MAX);
    this.ui.updateTickets(this.tickets); // 工时券跨关保留
    this.ui.showLevelInfo(level); // 显示关卡标题
    this.selectedCard = null; this.hammerMode = false;
    this.cardCooldowns = {}; this.ui.cardCooldowns = {}; this.ui.cardCdTotal = {};
    this.patrolWarning = 0; this.shieldCount = 0; this.bossCount = 0;
    this.moyuMul = 1; this.rage = 0;
    this.interaction.reset();
    this.paused = false; this.speedMul = 1;
    this.ui.setPaused(false);
    this._syncPauseButton();
    for (const s of [1, 2, 3]) {
      const btn = document.getElementById('gc-speed-' + s);
      btn.classList.toggle('active', s === 1);
      btn.setAttribute('aria-pressed', String(s === 1));
    }
    this._fitBoard();
    this._accumulator = 0;
    this._shakeDuration = 0; this._shakeIntensity = 0;
    this.killStreak = 0; this.streakTimer = 0; this.totalKills = 0; this.score = 0;
    this._updateKillDisplay();
    this._atkDebuffMul = 1; this._atkDebuffEnd = 0;
    this._atkSpeedMul = 1;  this._atkSpeedEnd = 0;
    this._zombieSlowEnd = 0;
    this.ui.toast(`${level.icon} 第${level.id}关：${level.name}！${level.desc}`);
    this.ui.update(0, 0);
  }

  finishRound() {
    this.running = false;
    this.canvas.tabIndex = -1;
    this.paused = false;
    this._accumulator = 0;
    this._orbitActive = false;
    this._cancelActiveTool(false);
    this.eventSystem?.reset();
    this.ui.resetRound();
    this._syncPauseButton();
    this._renderDirty = true;
  }

  returnToMenu() {
    this.finishRound();
    this._clearEntities();
    document.body.classList.remove('in-game');
    document.getElementById('level-result')?.remove();
    this.levelUI.showMenu();
  }

  _clearEntities() {
    tweenManager.clear();
    for (const p of this.plants) p.destroy(this);
    for (const z of this.zombies) z.destroy(this);
    for (const pr of this.projectiles) pr.destroy();
    this.particles.clear(this.grid.group);
    this.effects.clear(this.grid.group);
    if (this.eventSystem) this.eventSystem.clearGhosts();
    if (this.items) this.items.clear(this);
    this.plants = []; this.zombies = []; this.projectiles = [];
    for (let r = 0; r < CFG.ROWS; r++)
      for (let c = 0; c < CFG.COLS; c++) this.grid.setOccupied(r, c, null);
  }

  // ---------- 主循环 ----------
  _loop = () => {
    if (document.hidden) return;
    this._raf = requestAnimationFrame(this._loop);
    const now = performance.now();
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    const helpOpen = this.ui.helpOverlay && !this.ui.helpOverlay.classList.contains('hidden');
    const active = this.running && !this.paused && !helpOpen && !this.settingsUI?.open && !this._contextLost;
    if (active) {
      this._accumulator = advanceSimulation(this._accumulator, dt, this.speedMul, step => {
        this._update(step);
        return this.running;
      });
      tweenManager.update(Math.min(dt, 0.05));
      this.interaction.update();
    } else {
      this._accumulator = 0;
    }
    if (!this._contextLost && (active || this._renderDirty)) {
      this.renderer.render(this.scene, this.camera);
      this._renderDirty = false;
    }
  };

  _update(dt) {
    this.clock += dt;
    if (this.patrolWarning > 0) { this.patrolWarning -= dt; if (this.patrolWarning <= 0) this.patrolWarning = 0; }
    // 摸鱼值倍率：日报生成器×3 + 终极摸鱼×2
    this.moyuMul = 1;
    if (this.items.reportTimer > 0) this.moyuMul *= this.items.reportMul;
    if (this.items.ultMoyuTimer > 0) this.moyuMul *= 2;

    this.resource.update(dt);
    this.items.update(dt, this);
    this._updateCamera(dt);
    // 关卡系统驱动波次生成与通关判定
    this.levels.update(dt, this);
    if (!this.running) return;

    const slowOn = this.clock < this._zombieSlowEnd;
    for (const z of this.zombies) {
      if (z.stunned > 0) continue;
      if (this.clock < z._slowEnd) {
        z._slowTotal = (z._slowTotal || 0) + dt;
        if (z._slowTotal > 15 && !z._resistMark) {
          z._resistMark = true;
          this.ui.toast('僵尸持续被控制，已加急处理：审批减速效果衰减');
        }
      }
      z.speed = getZombieSpeed(z, this.clock, { globalSlow: slowOn, rain: this.items.weatherTimer > 0 });
    }

    this._refreshPlantBuffs();
    for (const p of this.plants) { if (!p.dead) p.update(dt, this); }
    for (const z of this.zombies) { if (!z.dead) z.update(dt, this); }
    this._updateProjectiles(dt);
    this._cleanup();
    this.particles.update(dt, this.grid.group);
    this.effects.update(dt, this.grid.group);
    this.eventSystem.updateGhosts(dt);
    this.eventSystem.update(dt, this.clock);

    this.ui.updateBaseHp(Math.max(0, this.baseHp / CFG.BASE_HP));
    this.ui.update(dt, this.clock);
    this.ui.updateEnemyCount(this.zombies.filter((z) => !z.dead).length);
    this.ui.updateScore(this.score);
    this.ui.updateOnboarding(this.plants);
    this._updateStreak(dt);
    this._checkEnd();
  }

  /** Combo 连击衰减与UI更新 */
  _updateStreak(dt) {
    if (this.streakTimer > 0) {
      this.streakTimer -= dt;
      if (this.streakTimer <= 0) {
        this.killStreak = 0;
        this._updateKillDisplay();
      }
    }
  }

  /** 更新击杀/连击 UI */
  _updateKillDisplay() {
    const kc = document.getElementById('kill-count');
    if (kc) kc.textContent = this.totalKills;
    const cd = document.getElementById('combo-display');
    if (cd) {
      if (this.killStreak >= 3) {
        cd.textContent = `${this.killStreak}连击!`;
        cd.style.color = this.killStreak >= 7 ? '#ffd700' : this.killStreak >= 5 ? '#ff6600' : '#ff8a80';
      } else {
        cd.textContent = '';
      }
    }
  }

  _refreshPlantBuffs() {
    const atkDebuffMul = this.clock < this._atkDebuffEnd ? this._atkDebuffMul : 1;
    const speedMul = this.clock < this._atkSpeedEnd ? this._atkSpeedMul : 1;
    const bosses = this.zombies.filter((z) => z.type === 'boss' && !z.dead);
    const plantStopped = this.items.isPlantStopped();
    for (const p of this.plants) {
      if (p.dead || p.frozen > 0) continue;
      let mul = atkDebuffMul;
      for (const b of bosses) { if (p.mesh.position.distanceTo(b.mesh.position) < 2.0) { mul *= 0.5; break; } }
      p.attackMul = plantStopped ? 0 : mul;
      p.fireRateMul = speedMul;
    }
  }

  _updateProjectiles(dt) {
    for (const pr of this.projectiles) {
      if (pr.dead) continue;
      pr.update(dt);
      const target = findProjectileTarget(pr, this.zombies);
      if (target) {
        target.takeDamage(pr.damage);
        if (pr.isApproval) this._applySlow(target, pr.slowMul, pr.slowDuration);
        pr.destroy();
      }
      if (!pr.dead && (pr.mesh.position.x < this.grid.getSpawnX() - 4 || pr.mesh.position.x > this.grid.getBaseX() + 4)) pr.destroy();
    }
  }

  _cleanup() {
    for (let i = this.plants.length - 1; i >= 0; i--) {
      const p = this.plants[i];
      if (p.dead) { this.grid.setOccupied(p.row, p.col, null); p.destroy(this); this.plants.splice(i, 1); }
    }
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      if (z.dead) { z.destroy(this); this.zombies.splice(i, 1); }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) { if (this.projectiles[i].dead) this.projectiles.splice(i, 1); }
  }

  // ---------- 查询辅助 ----------
  hasZombieAhead(row, plantX) {
    for (const z of this.zombies) {
      if (z.dead || z.row !== row) continue;
      const zx = z.mesh.position.x;
      if (zx < plantX + 0.3 && zx > plantX - 14) return true;
    }
    return false;
  }

  getPlantBlocking(row, zombieX) {
    let best = null, bestDx = Infinity;
    for (const p of [...this.plants, ...this.items.baits]) {
      if (p.dead || p.row !== row) continue;
      const dx = p.mesh.position.x - zombieX;
      if (dx > -0.1 && dx <= 0.7 && dx < bestDx) { best = p; bestDx = dx; }
    }
    return best;
  }

  // ---------- 基地/资源辅助 ----------
  damageBase(amount) {
    if (this.shieldCount > 0) {
      this.shieldCount--; this.ui.setShield(this.shieldCount);
      this.ui.toast('🛡️ 护盾抵挡！(剩余' + this.shieldCount + ')'); this.audio.play('plant'); return;
    }
    this.baseHp = Math.max(0, this.baseHp - amount);
    this.shake(0.4, 0.3);
    this.ui.flashRed();
  }
  healBase(amount) { this.baseHp = Math.min(CFG.BASE_HP, this.baseHp + amount); }
  spendOrForce(amount) {
    // 摸鱼值可以为负(允许透支)
    if (this.resource.canAfford(amount)) this.resource.spend(amount);
    else this.resource.value -= amount;
  }
  buffAttackSpeed(mul, dur) { this._atkSpeedMul = mul; this._atkSpeedEnd = this.clock + dur; }
  buffAttackMul(mul, dur) { this._atkDebuffMul = mul; this._atkDebuffEnd = this.clock + dur; }
  slowAllZombies(dur) { this._zombieSlowEnd = this.clock + dur; }

  /** 审批员减速+抗性衰减：连续减速超15秒效果减半(防无限控死Boss) */
  _applySlow(zombie, slowMul, duration) {
    if (!(zombie._slowEnd > this.clock)) { zombie._slowTotal = 0; zombie._resistMark = false; }
    zombie._slowEnd = this.clock + duration;
    zombie._slowMul = slowMul;
  }

  killWeakestZombies(n) {
    const alive = this.zombies.filter((z) => !z.dead).sort((a, b) => a.hp - b.hp);
    for (let i = 0; i < Math.min(n, alive.length); i++) {
      alive[i].takeDamage(alive[i].hp);
    }
  }

  spawnFreePlant(type) {
    const empties = [];
    for (let r = 0; r < CFG.ROWS; r++)
      for (let c = 0; c < CFG.COLS; c++)
        if (!this.grid.isOccupied(r, c)) empties.push({ r, c });
    if (empties.length === 0) { this.ui.toast('没有空位种了！'); return; }
    const { r, c } = empties[Math.floor(Math.random() * empties.length)];
    const plant = this.createPlant(type, r, c);
    this.plants.push(plant); this.grid.setOccupied(r, c, plant);
    this.particles.spawnPlant(this.grid.group, this.grid.gridToWorld(r, c));
    this.audio.play('plant');
  }

  freezeRandomPlant(dur) {
    const alive = this.plants.filter((p) => !p.dead && p.frozen <= 0);
    if (alive.length === 0) return;
    alive[Math.floor(Math.random() * alive.length)].frozen = dur;
  }

  removeRandomPlant() {
    const alive = this.plants.filter((p) => !p.dead);
    if (alive.length === 0) return;
    alive[Math.floor(Math.random() * alive.length)].dead = true;
  }

  toast(msg) { this.ui.toast(msg); }

  // ---------- 怨气值/工时券 ----------
  /** 击杀僵尸：加怨气值+概率掉工时券+连击得分 */
  onZombieKilled(zombie) {
    this.rage = Math.min(CFG.RAGE_MAX, this.rage + CFG.RAGE_PER_KILL);
    this.ui.setRage(this.rage, CFG.RAGE_MAX);
    this.ui.showStatDelta('rage-text', CFG.RAGE_PER_KILL, 'rage');
    // 连击系统：3秒内连续击杀
    this.killStreak++;
    this.streakTimer = 3;
    this.totalKills++;
    // 得分：基础10分 + Boss 50分 + 连击奖励
    let pts = zombie.type === 'boss' ? 50 : 10;
    if (this.killStreak >= 3) pts += this.killStreak * 5;
    this.score += pts;
    this._updateKillDisplay();
    // 高连击显示特效
    if (this.killStreak >= 5 && this.killStreak % 5 === 0) {
      const p = zombie.mesh.position.clone(); p.y += 2.5;
      const text = this.killStreak >= 10 ? '🔥 ' + this.killStreak + '连杀!' : '⚡ ' + this.killStreak + '连击!';
      this.effects.spawnFloatText(this.grid.group, p, text, this.killStreak >= 10 ? '#ffd700' : '#ff6600');
    }
    if (Math.random() < CFG.TICKET_DROP_CHANCE) {
      this.tickets++;
      this.ui.updateTickets(this.tickets);
      this.ui.showStatDelta('ticket-value', 1, 'ticket');
      const p = zombie.mesh.position.clone(); p.y += 1.5;
      this.effects.spawnFloatText(this.grid.group, p, '+🎫', '#c9a0ff');
    }
  }

  // ---------- Boss 回调 ----------
  onBossSpawn() {
    this.bossCount++;
    if (this.bossCount === 1) { this.ui.setBossDarken(true); this.audio.play('basehit'); }
    this.shake(0.6, 0.5);
  }
  onBossDie() { this.bossCount = Math.max(0, this.bossCount - 1); if (this.bossCount === 0) this.ui.setBossDarken(false); }
  onBossKilled() {
    const drop = 200;
    this.resource.add(drop);
    const pos = this.zombies.length > 0 ? this.zombies[this.zombies.length - 1].mesh.position.clone() : new THREE.Vector3(0, 1, 0);
    this.effects.spawnFloatText(this.grid.group, pos, '+' + drop + '🐟', '#ffd34d');
    this.ui.toast('🎉 击杀大老板！掉落' + drop + '摸鱼值！');
    this.shake(0.5, 0.4);
  }

  _checkEnd() {
    if (!this.running) return;
    if (this.baseHp <= 0) {
      this.levels.onLevelFail(this);
    }
    // 通关判定由 LevelSystem.update 在所有波次清完后触发
  }

  _end(win) {
    // 兼容旧调用：失败走关卡结算
    this.running = false;
    this.paused = false;
    this.ui.setPaused(false);
    this.ui.hideTip();
    this.ui.clearSelection(); this.ui.setHammerMode(false);
    this.ui.setBossDarken(false); this.ui.setWeather(false); this.ui.setPoison(false);
    this.hammerMode = false;
    if (this.eventSystem) this.eventSystem.clearGhosts();
  }
}

const game = new Game();
if (import.meta.env.DEV && new URLSearchParams(location.search).has('balance')) {
  import('./testing/BalanceLab.js').then(({ BalanceLab }) => new BalanceLab(game));
}
