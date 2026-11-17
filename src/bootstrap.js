import('./main.js').catch(error => {
  console.error('Game initialization failed:', error);
  let screen = document.getElementById('boot-screen');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'boot-screen';
    document.body.appendChild(screen);
  }
  screen.setAttribute('role', 'alert');
  screen.replaceChildren();
  const box = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = '工位暂时未能就绪';
  const detail = document.createElement('p');
  detail.textContent = '请检查网络并重新加载。如果仍然无法进入，请使用支持 WebGL 的现代浏览器，并开启硬件加速。';
  const retry = document.createElement('button');
  retry.textContent = '重新加载';
  retry.addEventListener('click', () => location.reload());
  box.append(title, detail, retry);
  screen.appendChild(box);
});
