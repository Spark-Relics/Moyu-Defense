import { LEVELS, getLevel, getUnlockedItems } from '../levels/LevelConfig.js';
import { PLANT_TYPES } from '../entities/Plant.js';
import { mergeRecord } from './PlayerStorage.js';

/**
 * 关卡系统：管理关卡流转、波次生成控制、解锁进度、结算评分。
 * 替代原 main.js 中的倒计时+波次逻辑。
 */
export class LevelSystem {
  constructor(game) {
    this.game = game;
    this.records = {};
    this.currentLevelId = 1;
    this.maxUnlocked = 1;          // 最大已解锁关卡
    this.currentLevel = null;      // 当前关卡配置
    this.currentWaveIndex = -1;    // 当前波次索引(-1未开始)
    this.waveTimer = 0;            // 下一波倒计时
    this.waveSpawnQueue = [];      // 当前波待生成僵尸队列
    this.specialUses = 0;          // 特供道具使用次数
    this.waveCleared = false;      // 当前波是否已清完生成
  }

  /** 加载已解锁进度(localStorage) */
  loadProgress() {
    const saved = this.game.storage.loadProgress();
    this.maxUnlocked = saved.maxUnlocked;
    this.records = saved.records;
  }

  saveProgress() {
    return this.game.storage.saveProgress({ version: 1, maxUnlocked: this.maxUnlocked, records: this.records });
  }

  /** 指定关卡是否可选(vite.config.js 的 UNLOCK_ALL_LEVELS 为 true 时全解锁) */
  isUnlocked(id) {
    return Boolean(getLevel(id)) && ((typeof __UNLOCK_ALL_LEVELS__ !== 'undefined' && __UNLOCK_ALL_LEVELS__) || id <= this.maxUnlocked);
  }

  /** 获取当前关卡可用道具列表(含基础+解锁+特供) */
  getAvailableCards() {
    const items = getUnlockedItems(this.currentLevelId);
    // 加特供道具
    if (this.currentLevel && this.currentLevel.special) {
      const sp = this.currentLevel.special;
      items.push(sp.type);
      // 确保特供道具在PLANT_TYPES中有配置(动态注册)
      PLANT_TYPES[sp.type] = {
        cost: 0, hp: 0, icon: '⭐', cd: 0, ...PLANT_TYPES[sp.type],
        name: sp.name, desc: sp.desc, isSpecial: true, isSkill: true, specialLimit: sp.limit,
      };
    }
    return items.map((t) => ({ type: t, ...PLANT_TYPES[t] })).filter((c) => c.name);
  }

  /** 开始指定关卡 */
  startLevel(levelId) {
    if (!this.isUnlocked(levelId)) return null;
    this.currentLevelId = levelId;
    this.currentLevel = getLevel(levelId);
    this.currentWaveIndex = -1;
    this.waveTimer = levelId === 1 ? 12 : 8;
    this._waveClock = 0;
    this.waveSpawnQueue = [];
    this.specialUses = 0;
    this.waveCleared = false;
    this.game.ui.updateWaveCountdown(this.waveTimer, '开局');
    return this.currentLevel;
  }

  /** 每帧更新：波次推进+生成僵尸 */
  update(dt, game) {
    if (!this.currentLevel || !game.running) return;

    // 处理当前波次的僵尸生成队列
    this._updateSpawnQueue(dt, game);

    // 波次倒计时
    if (this.waveTimer > 0) {
      this.waveTimer -= dt;
      game.ui.updateWaveCountdown(this.waveTimer, this.currentWaveIndex < 0 ? '开局' : '下一波');
      if (this.waveTimer <= 0) {
        this._startNextWave(game);
      }
      return;
    }

    // 检查当前波是否已全部生成且全部消灭
    if (this.waveSpawnQueue.length === 0 && this.waveCleared) {
      const aliveCount = game.zombies.filter((z) => !z.dead).length;
      if (aliveCount === 0) {
        // 本波清完，准备下一波
        if (this.currentWaveIndex < this.currentLevel.waves.length - 1) {
          this.waveTimer = 6; // 波间间隔6秒(给玩家恢复时间)
          this.waveCleared = false;
          game.ui.toast(`第 ${this.currentWaveIndex + 1}/${this.currentLevel.waves.length} 波清除！准备下一波…`);
        } else {
          // 全部波次清完 → 通关
          this._onLevelClear(game);
        }
      }
    }
  }

  /** 开始下一波 */
  _startNextWave(game) {
    this.currentWaveIndex++;
    const wave = this.currentLevel.waves[this.currentWaveIndex];
    if (!wave) return;
    this.waveCleared = false;
    this.waveSpawnQueue = [];
    let spawnTime = 0;
    for (const group of wave.zombies) {
      for (let i = 0; i < group.count; i++) {
        this.waveSpawnQueue.push({
          type: group.type,
          hpMul: group.hpMul || 1,
          at: spawnTime,
        });
        spawnTime += group.delay;
      }
    }
    game.ui.toast(`第 ${this.currentWaveIndex + 1}/${this.currentLevel.waves.length} 波来活儿了！`);
    game.ui.updateWaveProgress(this.currentWaveIndex + 1, this.currentLevel.waves.length);
    game.ui.updateWaveCountdown(null);
    // 波次横幅特效
    const waveNum = this.currentWaveIndex + 1;
    const totalWaves = this.currentLevel.waves.length;
    const bannerTexts = [
      '僵尸来袭！准备迎战！',
      '新一波需求到了！',
      '更多僵尸涌来！',
      '压力升级！坚持住！',
      '老板放大招了！小心！',
      '关键时刻！别松懈！',
      '最后一搏！冲！',
      '终局之战！拼命！',
      '最终冲刺！不能输！',
    ];
    game.ui.showWaveBanner(waveNum, totalWaves, bannerTexts[Math.min(waveNum - 1, bannerTexts.length - 1)], this._getFeaturedEnemyType(wave));
    // 第一波立即开始生成
    this._waveClock = 0;
  }

  _updateSpawnQueue(dt, game) {
    if (this.waveSpawnQueue.length === 0) return;
    this._waveClock = (this._waveClock || 0) + dt;
    while (this.waveSpawnQueue.length && this._waveClock >= this.waveSpawnQueue[0].at) {
      const spawn = this.waveSpawnQueue.shift();
      this._spawnZombie(game, spawn.type, spawn.hpMul);
      if (this.waveSpawnQueue.length === 0) this.waveCleared = true;
    }
  }

  _getFeaturedEnemyType(wave) {
    if (!wave || !Array.isArray(wave.zombies) || wave.zombies.length === 0) return null;
    const threat = { traitor: 500, boss: 300, kpi: 120, client: 40 };
    return wave.zombies
      .slice()
      .sort((a, b) => ((threat[b.type] || 0) + (b.count || 0)) - ((threat[a.type] || 0) + (a.count || 0)))[0].type;
  }

  _spawnZombie(game, type, hpMul) {
    const row = Math.floor(Math.random() * game.cfg.ROWS);
    // 超级大老板
    if (type === 'super_traitor') {
      const z = game._createZombie('traitor', row);
      z.maxHp = z.hp = Math.round(z.hp * 3);
      z.baseSpeed *= 1.5;
      z.speed = z.baseSpeed;
      z._traitorInterval = 5; // 普通大老板 10 秒，终极形态频率翻倍。
      game.zombies.push(z);
      game.audio.play('spawn_traitor');
      game.ui.toast('💀 超级大老板出现！hp×3 速度×1.5 策反翻倍！');
      return;
    }
    const z = game._createZombie(type, row);
    if (hpMul > 1) { z.maxHp = z.hp = Math.round(z.hp * hpMul); }
    // Lv3 甲方需求变更频率翻倍(每1.5步后退，而非3步)
    if (this.currentLevel.flags && this.currentLevel.flags.clientDoubleRevert && type === 'client') {
      z.revertThreshold = 1.5;
    }
    game.zombies.push(z);
    // 按僵尸类型播放专属生成音效
    game.audio.play('spawn_' + type);
  }

  /** 通关 */
  _onLevelClear(game) {
    if (!game.running) return;
    if (game.baseHp <= 0) { this.onLevelFail(game); return; }
    const hpRatio = game.baseHp / game.cfg.BASE_HP;
    const grade = hpRatio > 0.8 ? 'S' : hpRatio > 0.6 ? 'A' : hpRatio > 0.4 ? 'B' : 'C';
    if (Number.isInteger(game.tickets)) game.bankedTickets = game.tickets;
    // 解锁下一关
    if (this.currentLevelId >= this.maxUnlocked && this.currentLevelId < LEVELS.length) {
      this.maxUnlocked = this.currentLevelId + 1;
    }
    this._recordResult(game, grade, hpRatio);
    game.finishRound();
    game.ui.showLevelResult(grade, this.currentLevel, this.maxUnlocked, false, hpRatio);
  }

  /** 失败 */
  onLevelFail(game) {
    if (!game.running) return;
    this._recordResult(game, 'F', 0);
    game.finishRound();
    game.ui.showLevelResult('F', this.currentLevel, this.maxUnlocked, true, 0);
  }

  _recordResult(game, grade, hpRatio) {
    this.lastResult = { grade, hpRatio, score: game.score, kills: game.totalKills, duration: game.clock };
    this.records[this.currentLevelId] = mergeRecord(this.records[this.currentLevelId], this.lastResult);
    if (!this.saveProgress()) game.ui.toast('浏览器暂时无法保存进度，本次游戏仍可继续');
  }

  /** 特供道具是否可用 */
  canUseSpecial() {
    if (!this.currentLevel || !this.currentLevel.special) return false;
    return this.specialUses < this.currentLevel.special.limit;
  }

  /** 记录特供道具使用 */
  useSpecial() {
    if (!this.canUseSpecial()) return false;
    this.specialUses++;
    this.game.ui.updateSpecialUses(this.getSpecial(), this.specialUses);
    return true;
  }

  /** 获取特供道具配置 */
  getSpecial() { return this.currentLevel ? this.currentLevel.special : null; }
}
