export class SettingsUI {
  constructor(settings, onChange, onOpen) {
    this.settings = settings;
    this.onChange = onChange;
    this.onOpen = onOpen;
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'settings-dialog';
    this.dialog.setAttribute('aria-labelledby', 'settings-title');
    this.dialog.innerHTML = `
      <form method="dialog" class="settings-box">
        <div class="panel-heading"><div><span class="panel-eyebrow">休息一下，调整状态</span><h2 id="settings-title">游戏设置</h2></div><button class="icon-button" aria-label="关闭设置" value="close">×</button></div>
        <label class="setting-row" for="setting-volume"><span><strong>音效音量</strong><small>部署、攻击和战斗提示</small></span><output id="volume-value" for="setting-volume"></output></label>
        <input id="setting-volume" type="range" min="0" max="100" step="5" />
        <label class="setting-row" for="setting-quality"><span><strong>画面质量</strong><small>省电模式会降低像素密度并关闭阴影</small></span><select id="setting-quality"><option value="auto">自动</option><option value="high">精细</option><option value="low">省电</option></select></label>
        <label class="setting-row" for="setting-motion"><span><strong>减少动态效果</strong><small>关闭镜头震动、闪屏和界面动画</small></span><input id="setting-motion" type="checkbox" /></label>
        <p class="settings-note">设置和通关记录保存在当前浏览器中。</p>
        <button class="primary-button" value="done">完成设置</button>
      </form>`;
    document.getElementById('ui-root').appendChild(this.dialog);
    this.volume = this.dialog.querySelector('#setting-volume');
    this.quality = this.dialog.querySelector('#setting-quality');
    this.motion = this.dialog.querySelector('#setting-motion');
    this.volume.addEventListener('input', () => { settings.volume = Number(this.volume.value) / 100; this._change(); });
    this.quality.addEventListener('change', () => { settings.quality = this.quality.value; this._change(); });
    this.motion.addEventListener('change', () => { settings.reducedMotion = this.motion.checked; this._change(); });
    this.dialog.addEventListener('click', event => { if (event.target === this.dialog) this.dialog.close(); });
  }

  _change() {
    this.dialog.querySelector('output').textContent = `${Math.round(this.settings.volume * 100)}%`;
    this.onChange(this.settings);
  }

  get open() { return this.dialog.open; }

  show() {
    if (this.open) return;
    this.onOpen();
    this.volume.value = String(this.settings.volume * 100);
    this.quality.value = this.settings.quality;
    this.motion.checked = this.settings.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._change();
    this.dialog.showModal();
  }
}
