import { LEVELS } from '../levels/LevelConfig.js';
import { PLANT_TYPES } from '../entities/Plant.js';

export function formatDuration(seconds = 0) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export class LevelUI {
  constructor(levelSystem) {
    this.levelSystem = levelSystem;
    this._build();
  }

  _build() {
    const menu = document.createElement('main');
    menu.id = 'level-menu';
    menu.innerHTML = `
      <header class="menu-header">
        <a class="game-wordmark" href="#" aria-label="摸鱼保卫战首页"><span class="brand-mark" aria-hidden="true">鱼</span><span>摸鱼保卫战<small>办公室生存塔防</small></span></a>
        <nav aria-label="游戏选项"><button type="button" class="text-button menu-help">玩法说明</button><button type="button" class="text-button menu-settings">游戏设置 <span aria-hidden="true">⚙</span></button></nav>
      </header>
      <div class="menu-body">
        <section class="menu-hero" aria-labelledby="game-title">
          <div class="hero-stamp"><i></i> 今日打工状态：坚守工位</div>
          <h1 id="game-title">摸鱼<br>保卫战<span class="title-period">。</span></h1>
          <p class="hero-tagline">需求会来，防线不退。</p>
          <p class="hero-description">种下你的牛马搭子，挡住甲方和老板。<br>这一次，把准时下班的主动权拿回来。</p>
          <button type="button" class="primary-button start-shift" id="start-shift"><span>开始值班</span><span aria-hidden="true">▶</span></button>
          <p class="hero-save" id="save-status"></p>
          <div class="hero-controls"><span><kbd>拖拽</kbd> 部署与换位</span><span><kbd>空格</kbd> 随时暂停</span></div>
        </section>
        <section class="mission-route" aria-labelledby="route-title">
          <div class="route-heading"><div><p>从入职到年终，一起守住防线</p><h2 id="route-title">你的值班路线</h2></div><span id="route-progress"></span></div>
          <div class="route-progress-track"><i id="route-progress-fill"></i></div>
          <div id="lm-grid" class="mission-grid"></div>
          <div class="route-note"><span aria-hidden="true">✦</span><p>通关解锁新搭子与道具，保留最高评级和最佳战绩。</p></div>
        </section>
      </div>
      <footer class="menu-footer"><span>打工人，今天也要平安下班。</span><span>6 个关卡 <i>/</i> 本地存档 <i>/</i> v1.1</span></footer>`;
    document.getElementById('ui-root').appendChild(menu);
    this.menu = menu;
    this.grid = menu.querySelector('#lm-grid');
    menu.querySelector('.game-wordmark').addEventListener('click', event => event.preventDefault());
    menu.querySelector('.menu-help').addEventListener('click', () => this.onHelp?.());
    menu.querySelector('.menu-settings').addEventListener('click', () => this.onSettings?.());
    menu.querySelector('#start-shift').addEventListener('click', () => this.prepareLevel(Math.min(this.levelSystem.maxUnlocked, LEVELS.length)));
  }

  showMenu() {
    this._renderGrid();
    this.menu.classList.remove('hidden');
    this.menu.querySelector('#start-shift').focus({ preventScroll: true });
  }

  hideMenu() { this.menu.classList.add('hidden'); }

  _renderGrid() {
    this.grid.replaceChildren();
    const nextId = Math.min(this.levelSystem.maxUnlocked, LEVELS.length);
    const completed = Object.values(this.levelSystem.records).filter(record => record.clears > 0).length;
    this.menu.querySelector('#route-progress').textContent = `${completed} / ${LEVELS.length} 已通关`;
    this.menu.querySelector('#route-progress-fill').style.width = `${completed / LEVELS.length * 100}%`;
    this.menu.querySelector('#start-shift span').textContent = completed === LEVELS.length ? '再战年终决战' : `${nextId === 1 ? '开始值班' : '继续挑战'} · 第 ${nextId} 关`;
    this.menu.querySelector('#save-status').textContent = this.levelSystem.game.storage.available
      ? (completed ? '值班记录已保存，随时回来接着玩' : '进度自动保存在当前浏览器')
      : '当前浏览器无法保存进度，仍可正常游玩';
    for (const level of LEVELS) {
      const locked = !this.levelSystem.isUnlocked(level.id);
      const record = this.levelSystem.records[level.id];
      const cleared = record?.clears > 0;
      const current = level.id === nextId && !cleared;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `mission-card${locked ? ' locked' : ''}${current ? ' current' : ''}${cleared ? ' cleared' : ''}`;
      card.disabled = locked;
      card.setAttribute('aria-label', locked ? `第 ${level.id} 关 ${level.name}，通关上一关解锁` : `开始第 ${level.id} 关：${level.name}${cleared ? `，最佳评级 ${record.grade}` : ''}`);
      card.innerHTML = `
        <div class="mission-top"><span class="mission-number">${String(level.id).padStart(2, '0')}</span><span class="mission-state">${locked ? '待解锁' : cleared ? `已通关 · ${record.grade} 级` : current ? '当前挑战' : '可挑战'}</span><span class="mission-symbol" aria-hidden="true">${locked ? '◇' : cleared ? '✓' : '↗'}</span></div>
        <h3>${level.name}</h3><p>${level.desc}</p>
        <div class="mission-bottom"><span>${level.waves.length} 波来袭</span><span>${locked ? '通关上一关解锁' : cleared ? `最高 ${record.score.toLocaleString()} 分` : `开局 ${level.startResource} 摸鱼值`}</span></div>`;
      card.addEventListener('click', () => this.prepareLevel(level.id));
      this.grid.appendChild(card);
    }
  }

  prepareLevel(id) {
    document.getElementById('level-briefing')?.remove();
    const level = LEVELS.find(level => level.id === id);
    if (!level || !this.levelSystem.isUnlocked(id)) return;
    const tips = [
      '先在右侧种向日葵积攒资源，再把射手放在敌人同行。射手朝左攻击；五行都要有人守。',
      'KPI 会持续扣工位生命，优先集火。坚果放在射手左侧挡路，换鱼锤可打断危险敌人。',
      '甲方更频繁地后退和冲锋。审批员可以减速；随时把已有射手免费换到受压的一行。',
      '老板会蓄力开除植物，看到提示及时用换鱼锤打断。留一部分资源和续命咖啡救急。',
      '叛徒会策反向日葵。分散经济来源，善用本关应急日报的免疫时间，给前排补上坚果。',
      '先建立五行输出，再用审批员和坚果支援。给最终首领保留年终奖炸弹，怒气满时可用大招。',
    ];
    const fresh = id > 1 ? LEVELS[id - 2].unlocks : ['sunflower', 'peashooter'];
    const dialog = document.createElement('dialog');
    dialog.id = 'level-briefing';
    dialog.setAttribute('aria-labelledby', 'briefing-title');
    dialog.innerHTML = `<div class="briefing-content"><p class="panel-eyebrow">上岗前，先看一眼防线</p><h2 id="briefing-title" tabindex="-1" autofocus>${level.icon} 第 ${id} 关 · ${level.name}</h2><p>${tips[id - 1]}</p><dl><div><dt>本关目标</dt><dd>守住工位，击退 ${level.waves.length} 波敌人</dd></div><div><dt>${id === 1 ? '基础搭子' : '新解锁'}</dt><dd>${fresh.map(type => PLANT_TYPES[type]?.name || type).join('、')}</dd></div><div><dt>本关特供 · ${level.special.limit} 次</dt><dd>${level.special.name}：${level.special.desc}</dd></div></dl><p class="briefing-note">阅读时战斗尚未开始。卡牌可点选后点空格部署；两侧箭头可翻看全部卡牌。战斗中点 ? 可暂停查看完整说明。</p><button type="button" class="primary-button briefing-start">开始本关</button><button type="button" class="text-button briefing-menu">返回选关</button></div>`;
    document.getElementById('ui-root').appendChild(dialog);
    const close = callback => { dialog.close(); dialog.remove(); callback?.(); };
    dialog.querySelector('.briefing-start').addEventListener('click', () => close(() => this.onStartLevel?.(id)));
    dialog.querySelector('.briefing-menu').addEventListener('click', () => close(() => this.onBackToMenu?.()));
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(() => this.onBackToMenu?.()); });
    dialog.showModal();
  }

  showResult(grade, level, maxUnlocked, failed = false, hpRatio = 0) {
    document.getElementById('level-result')?.remove();
    const result = document.createElement('dialog');
    result.id = 'level-result';
    result.setAttribute('aria-labelledby', 'result-title');
    const last = this.levelSystem.lastResult;
    const isLast = level.id === LEVELS.length;
    const next = !failed && !isLast && this.levelSystem.isUnlocked(level.id + 1);
    const titles = failed ? '防线失守，重整旗鼓' : isLast ? '年终通关，准时下班！' : '今日防线，成功守住！';
    result.innerHTML = `
      <div class="result-content">
        <div class="result-stamp ${failed ? 'failed' : ''}"><span>${failed ? '再战' : grade}</span><small>${failed ? '挑战未完成' : '本次评级'}</small></div>
        <p class="panel-eyebrow">第 ${level.id} 关 · ${level.name}</p><h2 id="result-title">${titles}</h2>
        <p class="result-description">${failed ? '让射手与来袭敌人处于同一行，拖动已有植物也能免费补防。' : isLast ? '从新手入职到年终决战，你守住了每一道防线。' : `工位剩余 ${Math.round(hpRatio * 100)}% 生命。下一班，搭子们继续陪你。`}</p>
        <dl class="result-stats"><div><dt>本关得分</dt><dd>${(last?.score ?? 0).toLocaleString()}</dd></div><div><dt>击退敌人</dt><dd>${last?.kills ?? 0}</dd></div><div><dt>值班用时</dt><dd>${formatDuration(last?.duration)}</dd></div></dl>
        ${!failed && level.unlocks?.length ? `<div class="result-rewards"><span>新搭子已就位</span><strong>${level.unlocks.map(type => PLANT_TYPES[type]?.name || type).join('、')}</strong></div>` : ''}
        <div class="result-actions">${next ? '<button type="button" class="primary-button result-next">挑战下一关 <span aria-hidden="true">▶</span></button>' : ''}<button type="button" class="${failed ? 'primary-button' : 'secondary-button'} result-retry">${failed ? '重新挑战' : '重玩本关'}</button><button type="button" class="text-button result-menu">返回选关</button></div>
      </div>`;
    document.getElementById('ui-root').appendChild(result);
    const act = callback => { result.close(); result.remove(); callback?.(); };
    result.querySelector('.result-next')?.addEventListener('click', () => act(() => this.prepareLevel(level.id + 1)));
    result.querySelector('.result-retry').addEventListener('click', () => act(() => this.onRetry?.()));
    result.querySelector('.result-menu').addEventListener('click', () => act(() => this.onBackToMenu?.()));
    result.addEventListener('cancel', event => { event.preventDefault(); act(() => this.onBackToMenu?.()); });
    result.showModal();
  }
}
