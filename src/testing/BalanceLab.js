import { LEVELS } from '../levels/LevelConfig.js';
import { PLANT_TYPES } from '../entities/Plant.js';
import { PlayerStorage } from '../systems/PlayerStorage.js';
import { STEP } from '../utils/Simulation.js';

function randomFor(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

// The agent submits the same paid, cooldown-checked actions as a player.
// No resource, health, damage, enemy or wave values are changed by this driver.
class Strategy {
  constructor(game, profile) { this.game = game; this.profile = profile; this.nextDecision = 0; this.eventAt = null; }

  available(type) {
    const g = this.game, config = PLANT_TYPES[type];
    return config && g.ui.cardEls[type] && g.clock >= (g.cardCooldowns[type] || 0)
      && g.resource.canAfford(config.cost || 0)
      && (!config.isUlt || g.rage >= config.rageCost)
      && (!config.isTicket || g.tickets >= config.ticketCost)
      && (!(g.levels.getSpecial()?.type === type) || g.levels.canUseSpecial());
  }

  play(type, row, col) {
    const g = this.game;
    if (!this.available(type)) return false;
    if (row != null && g.grid.isOccupied(row, col)) return false;
    g._onCardClick(type);
    if (row != null && g.selectedCard === type) g.interaction._tryPlant(row, col);
    return true;
  }

  act() {
    const g = this.game;
    if (this.profile === 'idle') return;
    if (g.eventSystem.active) {
      this.eventAt ??= g.clock;
      if (g.clock - this.eventAt >= (this.profile === 'novice' ? 4 : 1.5)) g.eventSystem.choose(0);
      return;
    }
    this.eventAt = null;
    if (g.clock < this.nextDecision) return;
    this.nextDecision = g.clock + (this.profile === 'novice' ? 2.5 : .8);
    const plants = g.plants.filter(p => !p.dead), enemies = g.zombies.filter(z => !z.dead);
    const flowers = plants.filter(p => p.type === 'sunflower');
    const shooters = plants.filter(p => p.type === 'peashooter');
    const frontCol = this.profile === 'novice' ? 6 : 4;
    const priorityRows = [...Array(g.cfg.ROWS).keys()].sort((a, b) => {
      const threat = row => enemies.filter(z => z.row === row).reduce((n, z) => n + 20 + z.mesh.position.x + (z.type === 'kpi' ? 15 : 0), 0);
      return threat(b) - threat(a);
    });
    // Two early producers, then defensive coverage before further investment.
    if (flowers.length < 2 && g.clock < 12) {
      for (const row of [2, 0, 4, 1, 3]) if (this.play('sunflower', row, 8)) return;
    }
    if (this.profile === 'tactical') {
      if (g.baseHp <= 65 && this.play('coffee_boost')) return;
      if (g.baseHp <= 65 && this.play('coffee')) return;
      if (enemies.some(z => z._bossCast || z.type === 'kpi' && z.aliveTime > 12 || z.mesh.position.x > 3) && this.play('hammer')) return;
      if (enemies.filter(z => z.type === 'traitor' || z.type === 'boss').length && this.play('readback')) return;
      if (enemies.length >= 4 && this.play('ult_bomb')) return;
      if (!g.items.emergencyReportTimer && enemies.some(z => z.type === 'traitor') && this.play('emergency_report')) return;
      if (enemies.some(z => z.maxHp >= 500) && this.play('year_bonus')) return;
    }
    for (const row of priorityRows) {
      if (!shooters.some(p => p.row === row) && enemies.some(z => z.row === row)) {
        if (this.play('peashooter', row, frontCol)) return;
      }
    }
    const targetFlowers = this.profile === 'novice' ? 2 : 3;
    if (flowers.length < targetFlowers) for (const row of [2, 0, 4, 1, 3]) if (this.play('sunflower', row, 8)) return;
    for (const row of priorityRows) if (!shooters.some(p => p.row === row) && this.play('peashooter', row, frontCol)) return;
    if (this.profile !== 'novice') {
      for (const row of priorityRows) if (enemies.some(z => z.row === row) && !plants.some(p => p.row === row && p.type === 'auditor') && this.play('auditor', row, 3)) return;
      for (const row of priorityRows) if (enemies.some(z => z.row === row) && !plants.some(p => p.row === row && p.type === 'wallnut') && this.play('wallnut', row, 2)) return;
      if (flowers.length >= 2 && !g.items.reportTimer && this.play('report')) return;
    }
    for (const row of priorityRows) if (shooters.filter(p => p.row === row).length < 2 && this.play('peashooter', row, frontCol + 1)) return;
  }
}

export class BalanceLab {
  constructor(game) {
    this.game = game;
    cancelAnimationFrame(game._raf);
    game._loop = () => {};
    game._togglePause = () => {};
    game.audio.volume = 0;
    this.results = [];
    this.busy = false;
    this._quietVisuals();
    this.panel = document.createElement('section');
    this.panel.id = 'balance-lab';
    this.panel.style.cssText = 'position:fixed;inset:0;z-index:300;background:#173c33;color:#f5f0dd;overflow:auto;padding:24px;font:14px/1.6 system-ui;user-select:text';
    this.panel.innerHTML = `<h1 style="margin-bottom:8px">关卡平衡实验室</h1><p>开发模式专用 · 真实战斗逻辑 · 固定随机种子 · 费用与冷却照常 · 静音 · 隔离存档</p>
      <p style="margin:14px 0"><label>每种策略种子数 <select id="balance-seeds"><option>3</option><option>10</option><option>20</option></select></label> <label>报告 <select id="balance-phase"><option value="baseline">修改前基线</option><option value="final">修复后复测</option></select></label></p>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button id="balance-run">运行全部关卡</button><button id="balance-campaign">运行连续通关与解锁</button><button id="balance-replay">验证种子复现</button><button id="balance-stop">停止测试</button><a href="/">返回游戏</a></div>
      <p id="balance-status" role="status" style="margin:18px 0">等待运行</p><div id="balance-summary"></div>
      <table style="width:100%;text-align:left;border-spacing:8px"><thead><tr><th>模式</th><th>关卡</th><th>种子</th><th>结果</th><th>生命</th><th>用时</th><th>击杀</th><th>最低资源</th><th>剩余资源</th></tr></thead><tbody id="balance-results"></tbody></table>
      <details><summary>完整 JSON 证据</summary><pre id="balance-json" style="white-space:pre-wrap"></pre></details>`;
    document.body.appendChild(this.panel);
    for (const button of this.panel.querySelectorAll('button')) button.style.cssText = 'font:inherit;padding:10px 16px;border-radius:6px;border:1px solid #b9cbb8;background:#f1c45c;color:#173c33;cursor:pointer';
    this.panel.querySelector('#balance-run').addEventListener('click', () => this.run(false));
    this.panel.querySelector('#balance-campaign').addEventListener('click', () => this.run(true));
    this.panel.querySelector('#balance-replay').addEventListener('click', () => this.run(false, true));
    this.panel.querySelector('#balance-stop').addEventListener('click', () => { this.stop = true; });
    this.originalStorage = game.storage;
  }

  _quietVisuals() {
    const g = this.game, noop = () => {};
    for (const method of ['toast', 'showStatDelta', 'flashRed', 'flashWhite', 'showBossWarning', 'showBossSkill', 'hideBossSkill', 'setBossDarken', 'setWeather', 'setPoison', 'setRage', 'updateBaseHp', 'updateWaveCountdown', 'updateWaveProgress', 'showWaveBanner', 'updateEnemyCount', 'updateScore', 'updateOnboarding', 'update', 'showOnboarding']) g.ui[method] = noop;
    g.ui.updateResource = value => { g.ui._resourceAfford = value; };
    g.particles = new Proxy({}, { get: () => noop });
    g.effects = new Proxy({}, { get: () => noop });
    g._updateCamera = noop; g._updateKillDisplay = noop; g.shake = noop;
  }

  async run(campaign, replay = false) {
    if (this.busy) return;
    this.busy = true; this.stop = false; this.results = [];
    this.panel.querySelector('#balance-results').replaceChildren();
    this.panel.querySelector('#balance-run').disabled = true;
    this.panel.querySelector('#balance-campaign').disabled = true;
    this.panel.querySelector('#balance-replay').disabled = true;
    const count = Number(this.panel.querySelector('#balance-seeds').value);
    try {
      for (const profile of campaign || replay ? ['tactical'] : ['idle', 'novice', 'standard', 'tactical']) {
        for (let seed = 1; seed <= (replay ? 2 : profile === 'idle' ? 1 : count); seed++) {
          const g = this.game;
          g.storage = new PlayerStorage(memoryStorage()); g.levels.loadProgress(); g.tickets = 0; g.bankedTickets = 0;
          for (const level of LEVELS) {
            if (this.stop) break;
            if (!campaign) { g.levels.maxUnlocked = level.id; g.tickets = 0; g.bankedTickets = 0; }
            const result = await this.simulate(level.id, replay ? 1 : seed, profile, campaign);
            this.results.push(result); this._render(result);
            if (campaign && result.result !== 'win') break;
          }
          if (this.stop) break;
        }
        if (this.stop) break;
      }
      if (replay && !this.stop) for (const level of LEVELS) {
        const pair = this.results.filter(result => result.level === level.id);
        if (pair.length !== 2 || JSON.stringify(pair[0]) !== JSON.stringify(pair[1])) throw Error(`第 ${level.id} 关相同种子未能复现相同结果`);
      }
      const report = { version: 2, campaign, replay, seeds: replay ? 1 : count, step: STEP, limitSeconds: 720, results: this.results };
      this.panel.querySelector('#balance-json').textContent = JSON.stringify(report, null, 2);
      const phase = this.panel.querySelector('#balance-phase').value;
      const response = await fetch('/__balance_report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase: replay ? `${phase}-replay` : campaign ? `${phase}-campaign` : phase, report }) });
      this.panel.querySelector('#balance-status').textContent = `${this.stop ? '已停止' : '测试完成'}：${this.results.length} 局。${response.ok ? '报告已保存至 tests/reports。' : '报告保存失败，可展开 JSON 查看。'}`;
    } catch (error) {
      this.panel.querySelector('#balance-status').textContent = `测试失败：${error.stack}`;
      console.error(error);
    } finally {
      this.busy = false;
      this.panel.querySelector('#balance-run').disabled = false;
      this.panel.querySelector('#balance-campaign').disabled = false;
      this.panel.querySelector('#balance-replay').disabled = false;
    }
  }

  async simulate(levelId, seed, profile, campaign) {
    const g = this.game, nativeRandom = Math.random, rng = randomFor(seed * 1009 + levelId * 17);
    let briefingShown = false;
    // Old-round teardown can consume cosmetic RNG. Isolate it before seeding an
    // independent fixture, so a fresh page and repeated batches agree exactly.
    if (!campaign || levelId === 1) {
      g.finishRound(); g._clearEntities(); g.eventSystem = null;
    }
    Math.random = rng;
    try {
      if (campaign && levelId > 1) {
        const next = document.querySelector('#level-result .result-next');
        if (!next) throw Error(`第 ${levelId - 1} 关未提供下一关入口`);
        next.click();
        const briefing = document.getElementById('level-briefing');
        const start = briefing?.querySelector('.briefing-start');
        if (!start || !briefing.querySelector('#briefing-title')?.textContent.includes(LEVELS[levelId - 1].name)) throw Error(`第 ${levelId} 关开战前简报不完整`);
        briefingShown = true;
        start.click();
      } else {
        document.getElementById('level-result')?.remove();
        g.startLevel(levelId);
      }
    } finally { Math.random = nativeRandom; }
    if (!g.running || g.levels.currentLevelId !== levelId) throw Error(`第 ${levelId} 关未真正启动`);
    const initialResource = g.resource.value;
    const bot = new Strategy(g, profile);
    let minResource = g.resource.value, deployments = 0, maxPlants = 0, maxEnemies = 0, eventCount = 0, previousEvent = false;
    let step = 0;
    while (g.running && g.clock < 720 && !this.stop) {
      Math.random = rng;
      try {
        const before = g.plants.length;
        bot.act();
        deployments += Math.max(0, g.plants.length - before);
        g._update(STEP);
        minResource = Math.min(minResource, g.resource.value);
        maxPlants = Math.max(maxPlants, g.plants.length); maxEnemies = Math.max(maxEnemies, g.zombies.length);
        if (g.eventSystem.active && !previousEvent) eventCount++;
        previousEvent = g.eventSystem.active;
      } finally { Math.random = nativeRandom; }
      if (++step % 1200 === 0) {
        this.panel.querySelector('#balance-status').textContent = `运行中：${profile} / 第 ${levelId} 关 / 种子 ${seed} / ${g.clock.toFixed(0)} 秒 / 工位 ${g.baseHp}`;
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    const status = g.running ? (this.stop ? 'stopped' : 'timeout') : g.levels.lastResult?.grade === 'F' ? 'loss' : 'win';
    const dialog = document.getElementById('level-result');
    const nextButton = Boolean(dialog?.querySelector('.result-next'));
    if (status !== 'timeout' && status !== 'stopped' && (!dialog || nextButton !== (status === 'win' && levelId < LEVELS.length))) throw Error(`第 ${levelId} 关结算或下一关入口错误`);
    const saved = g.storage.loadProgress();
    const result = { profile, level: levelId, seed, result: status, hp: g.baseHp, duration: Math.round(g.clock * 10) / 10, kills: g.totalKills, score: g.score, minResource, resource: g.resource.value, deployments, maxPlants, maxEnemies, events: eventCount, grade: g.levels.lastResult?.grade, resultDialog: Boolean(dialog), unlocked: g.levels.maxUnlocked,
      initialResource, nextButton, briefingShown, resultTitle: dialog?.querySelector('#result-title')?.textContent,
      persistedUnlocked: saved.maxUnlocked, savedGrade: saved.records[levelId]?.grade, savedScore: saved.records[levelId]?.score,
      cardCount: Object.keys(g.ui.cardEls).length, hotkeyCount: Object.keys(g.ui.cardHotkeys).length,
    };
    if (campaign) g.levels.loadProgress();
    if (g.running) g.finishRound();
    if (!campaign) document.getElementById('level-result')?.remove();
    return result;
  }

  _render(result) {
    const row = document.createElement('tr');
    for (const value of [result.profile, result.level, result.seed, result.result, result.hp, result.duration, result.kills, result.minResource, result.resource]) {
      const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell);
    }
    this.panel.querySelector('tbody').appendChild(row);
    const groups = new Map();
    for (const item of this.results) {
      const key = `${item.profile} / 第 ${item.level} 关`;
      const group = groups.get(key) || { wins: 0, count: 0 };
      group.count++; group.wins += Number(item.result === 'win'); groups.set(key, group);
    }
    this.panel.querySelector('#balance-summary').textContent = [...groups].map(([key, group]) => `${key}：${group.wins}/${group.count}`).join(' | ');
  }
}
