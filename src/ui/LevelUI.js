import { LEVELS } from '../levels/LevelConfig.js';
import { PLANT_TYPES } from '../entities/Plant.js';
import { ZOMBIE_TYPES } from '../entities/Zombie.js';

/**
 * 关卡UI：选关界面 + 关卡结算弹窗。
 * 从 UIManager 分离，独立管理关卡相关的HTML覆盖层。
 */
export class LevelUI {
  constructor(levelSystem) {
    this.levelSystem = levelSystem;
    this.onStartLevel = null; // 由 game 注入: (levelId) => void
    this.onNextLevel = null;  // (levelId) => void
    this.onRetry = null;      // () => void
    this.onBackToMenu = null; // () => void
    this._build();
  }

  _build() {
    const root = document.getElementById('ui-root');

    // 选关界面
    const menu = document.createElement('div');
    menu.id = 'level-menu';
    const taunts = [
      '今天也要努力(摸鱼)打工！',
      '坚持到下班就是胜利！',
      '你有几个肝可以给公司献？',
      '打工人，打工魂，打工都是人上人',
      '向日葵会发光，但你的头发不会了',
      '只要不背锅，(markdown)就是好员工',
    ];
    menu.innerHTML = `
      <div class="lm-topline">
        <span class="lm-kicker">NIUMA DEFENSE / 06</span>
        <span class="lm-status"><i></i> 工位系统在线</span>
      </div>
      <div class="lm-layout">
        <section class="lm-hero">
          <div class="lm-hero-overline">办公室生存档案 · 2026</div>
          <h1 class="lm-title">植物大战僵尸<br><em>牛马版</em></h1>
          <p class="lm-subtitle">${taunts[Math.floor(Math.random() * taunts.length)]}</p>
          <div class="lm-hero-rule"></div>
          <div class="lm-brief">
            <span class="lm-brief-label">今日任务</span>
            <strong>守住工位，熬到下班</strong>
            <small>部署牛马植物，处理突发需求，别让甲方越过防线。</small>
          </div>
          <div class="lm-hero-meta"><span>9 × 5 防线</span><span>实时波次</span><span>低多边形 3D</span></div>
        </section>
        <section class="lm-route" aria-label="关卡路线">
          <div class="lm-route-head"><div><span class="lm-route-kicker">防线档案</span><h2>选择关卡</h2></div><span class="lm-route-count">01—06</span></div>
          <div class="lm-grid" id="lm-grid"></div>
        </section>
      </div>
      <div class="lm-footer"><span>拖拽卡牌部署植物</span><span>右键旋转视角</span><span>Esc 暂停 / 返回</span></div>`;
    root.appendChild(menu);
    this.menu = menu;
    this.grid = menu.querySelector('#lm-grid');
  }

  /** 显示选关界面 */
  showMenu() {
    this._renderGrid();
    this.menu.classList.remove('hidden');
  }

  hideMenu() { this.menu.classList.add('hidden'); }

  _renderGrid() {
    this.grid.innerHTML = '';
    for (const lv of LEVELS) {
      const locked = lv.id > this.levelSystem.maxUnlocked;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'lm-card' + (locked ? ' locked' : '');
      card.disabled = locked;
      card.setAttribute('aria-label', locked
        ? `第 ${lv.id} 关 ${lv.name}，尚未解锁`
        : `开始第 ${lv.id} 关：${lv.name}`);
      const threat = this._levelThreat(lv);
      card.innerHTML = `
        <div class="lm-card-icon">${String(lv.id).padStart(2, '0')}</div>
        <div class="lm-card-main"><div class="lm-card-num">${locked ? 'LOCKED' : `第 ${lv.id} 关`}</div>
        <div class="lm-card-name">${lv.name}</div>
        <div class="lm-card-desc">${locked ? '通关上一关解锁' : lv.desc}</div></div>
        <div class="lm-card-arrow">${locked ? '×' : '→'}</div>
        <div class="lm-card-meta">
          <span>${lv.waves.length} 波</span>
          <span>${locked ? '未解锁' : threat.label}</span>
        </div>
        ${locked ? '' : `<div class="lm-card-reward">${lv.unlocks?.length ? `解锁 ${lv.unlocks.map((t) => this._itemName(t)).join(' · ')}` : '最终考核'}</div>`}`;
      if (!locked) {
        card.addEventListener('click', () => {
          if (this.onStartLevel) this.onStartLevel(lv.id);
        });
      }
      this.grid.appendChild(card);
    }
  }

  _levelThreat(level) {
    const scoreByType = { client: 1, kpi: 2, boss: 4, traitor: 5, super_traitor: 8 };
    const seen = new Set();
    let score = 0;
    for (const wave of level.waves) {
      for (const group of wave.zombies) {
        seen.add(group.type);
        score += (scoreByType[group.type] || 1) * (group.count || 1) * (group.hpMul || 1);
      }
    }
    const label = score >= 46 ? '高压' : score >= 26 ? '紧张' : '入门';
    return {
      label,
      enemies: [...seen].map((type) => this._enemyName(type)).slice(0, 4),
    };
  }

  _levelUnlocksHtml(level) {
    if (!level.unlocks || level.unlocks.length === 0) return '<div class="lm-card-unlocks muted">通关奖励：最终考核</div>';
    const items = level.unlocks.map((type) => `<span>${this._itemName(type)}</span>`).join('');
    return `<div class="lm-card-unlocks"><b>解锁</b>${items}</div>`;
  }

  _levelSpecialHtml(level) {
    if (!level.special) return '';
    return `
      <div class="lm-card-special">
        <b>特供</b>
        <span>${level.special.name}</span>
        <em>${level.special.limit} 次</em>
      </div>`;
  }

  _enemyName(type) {
    if (type === 'super_traitor') return '超级大老板';
    return ZOMBIE_TYPES[type]?.name || type;
  }

  /**
   * 显示关卡结算弹窗
   * @param {string} grade 评级 S/A/B/C/F
   * @param {object} level 关卡配置
   * @param {number} maxUnlocked 最大已解锁
   * @param {boolean} failed 是否失败
   * @param {number} hpRatio 剩余工位血量比例(0~1)
   */
  showResult(grade, level, maxUnlocked, failed = false, hpRatio = 0) {
    const root = document.getElementById('ui-root');
    // 移除旧弹窗
    const old = document.getElementById('level-result');
    if (old) old.remove();

    const isLastLevel = level.id >= LEVELS.length;
    const canNext = !failed && !isLastLevel && level.id < maxUnlocked;
    const result = document.createElement('div');
    result.id = 'level-result';

    const gradeColors = { S: '#ffd700', A: '#8effc1', B: '#66ccff', C: '#ffaa66', F: '#ff5d6c' };
    const gradeText = failed ? '💀 挑战失败' : `${grade} 级评价`;

    result.innerHTML = `
      <div class="lr-box">
        <div class="lr-grade" style="color:${gradeColors[grade] || '#fff'}">${gradeText}</div>
        <div class="lr-level">${level.icon} 第${level.id}关 · ${level.name}</div>
        ${failed ? '<div class="lr-fail">工位血量归零，僵尸攻陷了你的工位！</div>' : `<div class="lr-success">剩余工位血量：${Math.round(hpRatio * 100)}%</div>`}
        ${!failed && level.unlocks ? `<div class="lr-unlock">🔓 解锁道具：${level.unlocks.map((t) => this._itemName(t)).join('、')}</div>` : ''}
        ${!failed && isLastLevel ? '<div class="lr-end">🎉 恭喜通关全部关卡！你被评为年度最佳员工！</div>' : ''}
        <div class="lr-btns">
          ${canNext ? '<button class="lr-btn lr-next" id="lr-next">下一关 →</button>' : ''}
          <button class="lr-btn lr-retry" id="lr-retry">${failed ? '重试' : '重玩本关'}</button>
          <button class="lr-btn lr-menu" id="lr-menu">返回选关</button>
        </div>
      </div>`;
    root.appendChild(result);

    // 绑定按钮
    const nextBtn = result.querySelector('#lr-next');
    if (nextBtn) nextBtn.addEventListener('click', () => { result.remove(); if (this.onNextLevel) this.onNextLevel(level.id + 1); });
    result.querySelector('#lr-retry').addEventListener('click', () => { result.remove(); if (this.onRetry) this.onRetry(); });
    result.querySelector('#lr-menu').addEventListener('click', () => { result.remove(); if (this.onBackToMenu) this.onBackToMenu(); });
  }

  _itemName(type) {
    if (PLANT_TYPES[type]?.name) return PLANT_TYPES[type].name;
    const names = {
      wallnut: '996坚果墙', hammer: '换鱼锤', auditor: '行政审批员', tiaoxiu: '调休单护盾',
      shield: '甩锅盾牌', read: '已读不回', coffee: '续命咖啡', mine: '带薪拉屎地雷',
      readback: '已读乱回', photo: '团建大合照', weather: '天气之子',
      ult_moyu: '终极摸鱼', ult_meeting: '紧急会议', ult_bomb: '钉钉轰炸',
    };
    return names[type] || type;
  }
}
