import { defineConfig } from 'vite';

// ===== 关卡解锁开关 =====
// true  = 所有关卡全部解锁(测试/演示用)
// false = 按通关进度逐关解锁(默认)
const UNLOCK_ALL_LEVELS = false;

export default defineConfig({
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
