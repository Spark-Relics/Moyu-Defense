import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { balanceFingerprint } from './balance-fingerprint.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFile(resolve(root, `tests/reports/balance-${name}.json`), 'utf8').then(JSON.parse);
const [baseline, final, campaign, replay] = await Promise.all(['baseline', 'final', 'final-campaign', 'final-replay'].map(read));
const fingerprint = await balanceFingerprint(root);
if ([final, campaign, replay].some(report => report.sourceHash !== fingerprint)) throw Error('Reports are stale. Run all three suites in the built-in browser again.');
const names = ['新手保护期', 'KPI风暴', '甲方地狱', '老板巡视', '大老板降临', '年终决战'];
const wins = rows => `${rows.filter(row => row.result === 'win').length}/${rows.length}`;
const average = (rows, field) => (rows.reduce((sum, row) => sum + row[field], 0) / rows.length).toFixed(1);
const rowsFor = (report, level, profile) => report.results.filter(row => row.level === level && row.profile === profile);
const table = names.map((name, index) => {
  const level = index + 1, standard = rowsFor(final, level, 'standard'), tactical = rowsFor(final, level, 'tactical');
  return `| ${level} ${name} | ${wins(rowsFor(final, level, 'idle'))} | ${wins(rowsFor(final, level, 'novice'))} | ${wins(standard)} | ${wins(tactical)} | ${average(standard, 'hp')} | ${average(tactical, 'duration')} 秒 |`;
}).join('\n');
const beforeSix = rowsFor(baseline, 6, 'standard'), afterSix = rowsFor(final, 6, 'standard');
const campaignWins = campaign.results.filter(row => row.level === 6 && row.result === 'win').length;
const content = `# 关卡通关与难度平衡验证

验证日期：2026-11-17。全部交互与批量对局在内置浏览器完成，始终静音。

## 样本与方法

- 修改前基线 ${baseline.results.length} 局；最终独立关卡 ${final.results.length} 局；连续战役 ${campaign.results.length} 局；种子复现 ${replay.results.length} 局。
- 每种主动策略使用 ${final.seeds} 个固定随机种子；每关另运行一局挂机对照。
- 使用实际 Game、LevelSystem、植物、敌人、道具、碰撞及资源逻辑，以 1/60 秒固定步长运行。没有增加资源、修改生命或直接清怪。
- 自动代理调用与玩家相同的选卡、部署和技能校验入口，遵守费用、卡牌解锁、冷却、特供次数及事件选择时限。
- 批量模式关闭装饰粒子、持续渲染及 GLB 加载，使用程序化角色；使用隔离的内存存档，不改动玩家记录。它验证战斗和平衡，不代表 GPU 性能或人工玩家通关率。
- 单局上限 720 游戏秒；最终报告不存在超时或中途停止。

策略定义：

| 策略 | 操作方式 |
| --- | --- |
| 挂机 | 不部署、不选择事件，让时限正常结算 |
| 保守 | 每 2.5 秒决策，两棵向日葵，射手位于第 7 列，不用主动技能 |
| 完整布局 | 每 0.8 秒决策，三棵向日葵、前排射手、审批员与坚果墙；第 2 关使用日报生产加成 |
| 战术 | 完整布局加换鱼锤、回血、工时券与终极技能，并使用关卡特供 |

保守策略与完整布局在修改前后保持一致；战术代理在复测时改为等待免疫结束再补应急日报，避免浪费次数。

## 最终难度结果

表中比例为通关局数/样本数；生命和用时是相应策略的样本均值。

| 关卡 | 挂机 | 保守 | 完整布局 | 战术 | 完整布局剩余生命 | 战术用时 |
| --- | --- | --- | --- | --- | --- | --- |
${table}

第 6 关完整布局从基线 ${wins(beforeSix)} 调整为 ${wins(afterSix)}。修复的是终极老板每 0.75 秒策反的异常：普通形态间隔 10 秒，最终形态改为 5 秒，恢复说明中的双倍频率，同时保留三倍生命和 1.5 倍移动速度。

前四关保留学习容错；第五、六关要求更靠前的火力覆盖和完整阵容。保守策略在后期受压，正确布阵能够稳定通关；挂机无法通关。

## 连续通关与解锁

${campaignWins}/${campaign.seeds} 次完整战役通过，从第 1 关顺序进入第 6 关，共 ${campaign.results.length} 次真实结算。

每一关均检查：正确初始资源、原生结算弹窗、下一关按钮、内存存档写入、重新加载解锁记录、最高分和评级一致。连续战役还通过新加入的关前简报与“开始本关”按钮进入下一关。最后一关提供最终通关结算，不再出现下一关入口。第 6 关全部 17 张卡牌都有唯一快捷键。

六关各用同一种子重复两次，生命、耗时、击杀、得分、资源、部署、事件、存档和卡牌结果完全一致，复现证据保存在 balance-final-replay.json。

## 已修复的问题

1. 暴雨减速被每帧速度重算覆盖；Boss 二阶段移速同样被覆盖。
2. 紧急会议使用现实时间定时器，暂停和重开后仍可能生效；改为游戏时间，仅作用于参会敌人，并保留两类 Boss。
3. 换鱼锤原本直接造成 120 伤害且永久易伤；改为说明中的 60 伤害和 3 秒易伤。
4. 调休护盾错误选中后排，并把 500 点吸收变成 10 秒完全无敌；改为真正的前排限额护盾，冻结期间也会正常到期。
5. 大饼诱饵把敌人额外向前移动，反而使其加速；改为可被啃食的 80 生命障碍。
6. 地雷的减速字段未被读取，还会解除其他技能眩晕；接入统一减速逻辑并保留已有眩晕。
7. 审批抗性重复累加每次命中的标称持续时间；改为累计实际被减速的时间。
8. 合照等技能直接标记死亡，漏记击杀与奖励；统一走敌人死亡结算，已被击败的敌人不再执行一次攻击或扣款。
9. 工时券可通过失败重试累积；改为通关后入账，重开和换关恢复已入账余额。
10. 最后几张卡牌没有键盘快捷键；补全所有卡牌的独立快捷键。
11. 人工试玩发现高倍速下事件阅读时间过短；改为 12 秒，并在事件打开时回到 1 倍速，选择期间禁止加速。

## 复现与证据

运行 npm run dev，在内置浏览器打开 http://localhost:5179/?balance，选择 10 个种子与“修复后复测”，分别执行“验证种子复现”、“运行全部关卡”和“运行连续通关与解锁”。开发实验室不进入正式构建。

报告保存在 tests/reports/balance-final.json 与 balance-final-campaign.json，基线保存在 balance-baseline.json。报告由开发服务器保存，并附带当前全部源代码 JS 的 SHA-256 指纹。CI 回归检查数据完整性和指纹，源码变化后需要重新验证。

当前源码指纹：${fingerprint}

执行 node tools/summarize-balance.mjs 可从原始报告重新生成本文。本轮已经另行完成正常玩家流程的六关手动通关与手机布局检查，见 [手动试玩记录](manual-playtest.md)。这些自动策略结果不替代真实玩家研究。
`;
await mkdir(resolve(root, 'docs'), { recursive: true });
await writeFile(resolve(root, 'docs/balance-report.md'), content);
console.log(`Saved docs/balance-report.md (${final.results.length + campaign.results.length + replay.results.length} final runs)`);
