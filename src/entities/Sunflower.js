import * as THREE from 'three';
import { Plant } from './Plant.js';
import { attachSunflowerModel } from '../systems/CharacterModelLoader.js';

/**
 * 向日葵社畜：方头棕脸+黄色花瓣+深灰西装+红领带+工牌+汗滴
 * 产出摸鱼值，附带"抖腿"待机动画；点击额外产出(有老板路过风险)
 */
export class Sunflower extends Plant {
  build() {
    // ===== 腿部(深灰西裤+黑皮鞋) =====
    const pantsMat = new THREE.MeshLambertMaterial({ color: 0x3a3a4a });
    const shoeMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    this.legL = new THREE.Group(); this.legL.position.set(-0.1, 0.3, 0); this.mesh.add(this.legL);
    this.legR = new THREE.Group(); this.legR.position.set(0.1, 0.3, 0); this.mesh.add(this.legR);
    this._part(new THREE.BoxGeometry(0.12, 0.3, 0.12), pantsMat, 0, -0.15, 0, this.legL);
    this._part(new THREE.BoxGeometry(0.12, 0.3, 0.12), pantsMat, 0, -0.15, 0, this.legR);
    this._part(new THREE.BoxGeometry(0.14, 0.06, 0.2), shoeMat, 0, -0.32, 0.03, this.legL);
    this._part(new THREE.BoxGeometry(0.14, 0.06, 0.2), shoeMat, 0, -0.32, 0.03, this.legR);

    // ===== 躯干(深灰西装) =====
    const suitMat = new THREE.MeshLambertMaterial({ color: 0x3a3a4a });
    this.body = this._part(new THREE.BoxGeometry(0.4, 0.45, 0.25), suitMat, 0, 0.6, 0);
    // 肩膀
    this._part(new THREE.SphereGeometry(0.09, 8, 6), suitMat, -0.24, 0.78, 0);
    this._part(new THREE.SphereGeometry(0.09, 8, 6), suitMat, 0.24, 0.78, 0);

    // ===== 白色衬衫领口 =====
    const shirtMat = new THREE.MeshLambertMaterial({ color: 0xf0f0f0 });
    this._part(new THREE.BoxGeometry(0.16, 0.1, 0.02), shirtMat, 0, 0.8, 0.13);

    // ===== 红领带 =====
    const tieMat = new THREE.MeshLambertMaterial({ color: 0xcc2222 });
    this._part(new THREE.BoxGeometry(0.04, 0.04, 0.02), tieMat, 0, 0.78, 0.14); // 领结
    this._part(new THREE.BoxGeometry(0.045, 0.2, 0.015), tieMat, 0, 0.63, 0.14); // 领带身
    this._part(new THREE.ConeGeometry(0.035, 0.06, 4), tieMat, 0, 0.5, 0.14);    // 领带尖

    // ===== 手臂(西装袖+肤色手) =====
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xd4a574 });
    this.armL = new THREE.Group(); this.armL.position.set(-0.26, 0.74, 0); this.mesh.add(this.armL);
    this.armR = new THREE.Group(); this.armR.position.set(0.26, 0.74, 0); this.mesh.add(this.armR);
    this._part(new THREE.BoxGeometry(0.1, 0.22, 0.1), suitMat, 0, -0.11, 0, this.armL);
    this._part(new THREE.BoxGeometry(0.1, 0.22, 0.1), suitMat, 0, -0.11, 0, this.armR);
    this._part(new THREE.SphereGeometry(0.05, 6, 5), skinMat, 0, -0.24, 0, this.armL);
    this._part(new THREE.SphereGeometry(0.05, 6, 5), skinMat, 0, -0.24, 0, this.armR);

    // ===== 工牌(左胸,绿色边框) =====
    const badgeBorderMat = new THREE.MeshLambertMaterial({ color: 0x2e8b3e });
    const badgeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this._part(new THREE.BoxGeometry(0.1, 0.13, 0.02), badgeBorderMat, -0.1, 0.68, 0.14);
    this._part(new THREE.BoxGeometry(0.08, 0.11, 0.015), badgeMat, -0.1, 0.68, 0.145);
    // 工牌上的小叶子图标(绿色)
    this._part(new THREE.BoxGeometry(0.03, 0.03, 0.005), badgeBorderMat, -0.1, 0.7, 0.155);
    // 挂绳
    this._part(new THREE.BoxGeometry(0.015, 0.12, 0.005), badgeBorderMat, -0.1, 0.78, 0.14);

    // ===== 向日葵花瓣(头部周围,14片黄色花瓣) =====
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 1.15, 0);
    this.mesh.add(this.headGroup);

    const petalMat = new THREE.MeshLambertMaterial({ color: 0xffc107 });
    const petalMat2 = new THREE.MeshLambertMaterial({ color: 0xffb300 });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const petal = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.32, 0.05),
        i % 2 === 0 ? petalMat : petalMat2
      );
      petal.position.set(Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0);
      petal.rotation.z = a - Math.PI / 2;
      petal.castShadow = true;
      this.headGroup.add(petal);
    }

    // ===== 方头(棕色,向日葵花盘) =====
    const faceMat = new THREE.MeshLambertMaterial({ color: 0x6d4c2a });
    this.head = this._part(new THREE.BoxGeometry(0.5, 0.48, 0.35, 2, 2, 2), faceMat, 0, 0, 0, this.headGroup);
    // 花盘纹理(深棕色小点,模拟葵花籽排列)
    const seedMat = new THREE.MeshLambertMaterial({ color: 0x4a3520 });
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        this._part(new THREE.SphereGeometry(0.02, 4, 3), seedMat,
          -0.12 + c * 0.08, 0.06 - r * 0.08, 0.18, this.headGroup, false);
      }
    }

    // ===== 疲惫表情(社畜的眼睛) =====
    // 眼白(半闭的疲惫眼)
    const whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this._part(new THREE.BoxGeometry(0.09, 0.04, 0.02), whiteMat, -0.1, 0.06, 0.18, this.headGroup, false);
    this._part(new THREE.BoxGeometry(0.09, 0.04, 0.02), whiteMat, 0.1, 0.06, 0.18, this.headGroup, false);
    // 瞳孔(小,往下看,疲惫)
    const pupilMat = new THREE.MeshLambertMaterial({ color: 0x1a1a2a });
    this._part(new THREE.BoxGeometry(0.04, 0.035, 0.01), pupilMat, -0.1, 0.05, 0.19, this.headGroup, false);
    this._part(new THREE.BoxGeometry(0.04, 0.035, 0.01), pupilMat, 0.1, 0.05, 0.19, this.headGroup, false);
    // 眼袋(深色,加班熬夜)
    const bagMat = new THREE.MeshLambertMaterial({ color: 0x5a4030 });
    this._part(new THREE.BoxGeometry(0.1, 0.02, 0.01), bagMat, -0.1, 0.02, 0.18, this.headGroup, false);
    this._part(new THREE.BoxGeometry(0.1, 0.02, 0.01), bagMat, 0.1, 0.02, 0.18, this.headGroup, false);
    // 撇嘴(苦笑)
    const mouthMat = new THREE.MeshLambertMaterial({ color: 0x4a3020 });
    const mouth = this._part(new THREE.BoxGeometry(0.12, 0.02, 0.02), mouthMat, 0, -0.1, 0.18, this.headGroup, false);
    mouth.rotation.z = 0.15; // 微微歪斜苦笑

    // ===== 汗滴(额头左侧,社畜标配) =====
    const sweatMat = new THREE.MeshStandardMaterial({ color: 0x88bbdd, transparent: true, opacity: 0.7 });
    // 大汗滴
    const sweat1 = new THREE.Group();
    sweat1.position.set(-0.2, 0.2, 0.18);
    this.headGroup.add(sweat1);
    this._part(new THREE.SphereGeometry(0.03, 6, 5), sweatMat, 0, -0.02, 0, sweat1, false);
    this._part(new THREE.ConeGeometry(0.025, 0.05, 5), sweatMat, 0, 0.02, 0, sweat1, false);
    // 小汗滴
    const sweat2 = new THREE.Group();
    sweat2.position.set(-0.14, 0.24, 0.17);
    this.headGroup.add(sweat2);
    this._part(new THREE.SphereGeometry(0.02, 5, 4), sweatMat, 0, -0.01, 0, sweat2, false);
    this._part(new THREE.ConeGeometry(0.015, 0.035, 4), sweatMat, 0, 0.015, 0, sweat2, false);
    this.sweatDrops = [sweat1, sweat2];

    // 僵尸从左侧房区来袭，角色正面朝向来敌方向(-x)，与僵尸面对面。
    this.mesh.rotation.y = -Math.PI / 2;

    // Keep the procedural version only as an async-load fallback. Once the
    // authored GLB is ready it becomes the entire visible character.
    const fallbackParts = [...this.mesh.children];
    attachSunflowerModel(this, fallbackParts).then((visual) => {
      // GLB 不可用时同步放大程序化替身，观感与正式模型(高2.15)接近
      if (!visual && !this.dead) this.mesh.scale.setScalar(1.25);
    });
  }

  /** 辅助：创建网格 */
  _part(geo, mat, x, y, z, parent, cast = true) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    (parent || this.mesh).add(m);
    return m;
  }

  behavior(dt, game) {
    if (this.modelMixer) this.modelMixer.update(dt);

    // 血量越低，越想摸鱼，产出越慢
    const baseHp = (game.cfg ? game.cfg.BASE_HP : 100);
    const hpRatio = Math.max(0.3, (game.baseHp || baseHp) / baseHp);
    const interval = this.cfg.produceInterval / hpRatio;
    if (this.timer >= interval) {
      this.timer = 0;
      const mul = game.moyuMul || 1;
      const amount = Math.round(this.cfg.produce * mul);
      game.resource.add(amount);
      const p = this.mesh.position.clone(); p.y += 2.25;
      game.effects.spawnFloatText(game.grid.group, p, '+' + amount, '#ffd34d');
      game.audio.play('produce');
    }
    // 抖腿：头部小幅度快速横向抖动(社畜焦虑)
    if (this.headGroup) {
      this.headGroup.position.x = Math.sin(performance.now() * 0.02) * 0.03;
    }
    // 汗滴动画(微微下落+循环)
    if (this.sweatDrops) {
      const t = performance.now() * 0.003;
      this.sweatDrops[0].position.y = 0.2 - (t % 0.4) * 0.15;
      this.sweatDrops[0].visible = (t % 0.5) < 0.4;
      this.sweatDrops[1].position.y = 0.24 - ((t + 0.2) % 0.35) * 0.12;
      this.sweatDrops[1].visible = ((t + 0.2) % 0.45) < 0.35;
    }
    // 手臂微微摆动(焦虑搓手)
    if (this.armL) this.armL.rotation.x = Math.sin(performance.now() * 0.008) * 0.1;
    if (this.armR) this.armR.rotation.x = Math.sin(performance.now() * 0.008 + 1) * 0.1;
    // 腿部走路摆动(待机时小幅度)
    if (this.legL) this.legL.rotation.x = Math.sin(performance.now() * 0.01) * 0.05;
    if (this.legR) this.legR.rotation.x = -Math.sin(performance.now() * 0.01) * 0.05;
    // 点击放大反馈缓动恢复
    if (this.head) {
      const targetS = 1;
      this.head.scale.x += (targetS - this.head.scale.x) * Math.min(1, dt * 8);
      this.head.scale.y = this.head.scale.z = this.head.scale.x;
    }
  }

  /** 点击产出摸鱼值(老板路过机制由game控制) */
  onClick(game) {
    const mul = game.moyuMul || 1;
    const amount = Math.round(this.cfg.clickGain * mul);
    game.resource.add(amount);
    const p = this.mesh.position.clone(); p.y += 2.25;
    game.effects.spawnFloatText(game.grid.group, p, '+' + amount, '#ffd34d');
    game.audio.play('produce');
    if (this.head) this.head.scale.setScalar(1.2);
  }
}
