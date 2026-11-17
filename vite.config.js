import { defineConfig } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { balanceFingerprint } from './tools/balance-fingerprint.mjs';

// ===== 关卡解锁开关 =====
// true  = 所有关卡全部解锁(测试/演示用)
// false = 按通关进度逐关解锁(默认)
const UNLOCK_ALL_LEVELS = false;

export default defineConfig({
  plugins: [{
    name: 'local-balance-report',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__balance_report', async (request, response) => {
        if (request.method !== 'POST' || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(request.headers.origin || '')) { response.writeHead(403).end(); return; }
        try {
          let body = '';
          for await (const chunk of request) { body += chunk; if (body.length > 1e6) throw Error('Report too large'); }
          const { phase, report } = JSON.parse(body);
          if (!['baseline', 'final', 'baseline-campaign', 'final-campaign', 'baseline-replay', 'final-replay'].includes(phase) || !Array.isArray(report.results)) throw Error('Invalid report');
          report.sourceHash = await balanceFingerprint(server.config.root);
          report.recordedAt = new Date().toISOString();
          const directory = resolve(server.config.root, 'tests/reports');
          await mkdir(directory, { recursive: true });
          await writeFile(resolve(directory, `balance-${phase}.json`), JSON.stringify(report, null, 2) + '\n');
          response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"saved":true}');
        } catch { response.writeHead(400).end(); }
      });
    },
  }],
  base: './',
  define: {
    // 编译期注入全局常量，LevelSystem.isUnlocked 读取
    __UNLOCK_ALL_LEVELS__: JSON.stringify(UNLOCK_ALL_LEVELS),
  },
  server: {
    open: false,
    port: 5179,
    host: '127.0.0.1'
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    rolldownOptions: {
      output: { manualChunks: (id) => id.includes('/node_modules/three/') ? 'three' : undefined },
    },
  }
});
