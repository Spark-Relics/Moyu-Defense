import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { balanceFingerprint } from '../tools/balance-fingerprint.mjs';
import { LEVELS, getLevel, getUnlockedItems } from '../src/levels/LevelConfig.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFile(new URL(`./reports/balance-${name}.json`, import.meta.url), 'utf8').then(JSON.parse);
const [final, campaign, replay] = await Promise.all(['final', 'final-campaign', 'final-replay'].map(read));

test('browser balance evidence matches the current source, not an older build', async () => {
  const hash = await balanceFingerprint(root);
  for (const report of [final, campaign, replay]) {
    assert.equal(report.version, 2);
    assert.equal(report.sourceHash, hash, 'Run the browser balance lab again after changing source code');
  }
});

test('independent samples cover all six levels and all expected strategy/seed combinations', () => {
  assert.equal(final.seeds, 10);
  assert.equal(final.results.length, 186);
  const keys = new Set(final.results.map(row => `${row.profile}/${row.level}/${row.seed}`));
  assert.equal(keys.size, final.results.length);
  for (const level of LEVELS) for (const profile of ['idle', 'novice', 'standard', 'tactical']) {
    for (let seed = 1; seed <= (profile === 'idle' ? 1 : 10); seed++) assert.ok(keys.has(`${profile}/${level.id}/${seed}`));
  }
});

test('browser outcomes have real result dialogs, correct budgets, saved scores and complete keyboard loadouts', () => {
  for (const report of [final, campaign, replay]) for (const row of report.results) {
    assert.ok(['win', 'loss'].includes(row.result), `${row.profile}/${row.level}: must finish, not time out`);
    assert.equal(row.initialResource, getLevel(row.level).startResource);
    assert.equal(row.resultDialog, true);
    assert.equal(row.nextButton, row.result === 'win' && row.level < LEVELS.length);
    assert.equal(row.persistedUnlocked, row.unlocked);
    assert.equal(row.savedScore, row.score);
    assert.equal(row.savedGrade, row.grade);
    assert.equal(row.cardCount, getUnlockedItems(row.level).length + 1);
    assert.equal(row.hotkeyCount, row.cardCount);
    if (row.result === 'win') assert.ok(row.hp > 0 && row.hp <= 100);
    else { assert.equal(row.hp, 0); assert.equal(row.grade, 'F'); }
  }
});

test('all ten campaigns advance through all six levels and end with the final win screen', () => {
  assert.equal(campaign.campaign, true); assert.equal(campaign.results.length, 60);
  for (let seed = 1; seed <= 10; seed++) {
    const rows = campaign.results.filter(row => row.seed === seed);
    assert.deepEqual(rows.map(row => row.level), [1, 2, 3, 4, 5, 6]);
    for (const row of rows) {
      assert.equal(row.result, 'win'); assert.equal(row.unlocked, Math.min(row.level + 1, 6));
      assert.equal(row.briefingShown, row.level > 1, 'next-level flow must pass through the new briefing');
    }
    assert.equal(rows[5].resultTitle, '年终通关，准时下班！');
    assert.equal(rows[5].nextButton, false); assert.equal(rows[5].cardCount, 17);
  }
});

test('fixed seeds reproduce identical outcomes when replayed in the browser', () => {
  assert.equal(replay.replay, true); assert.equal(replay.results.length, 12);
  for (const level of LEVELS) {
    const rows = replay.results.filter(row => row.level === level.id);
    assert.equal(rows.length, 2); assert.deepEqual(rows[0], rows[1]);
  }
});

test('balance keeps early learning forgiving, rewards complete defenses, and rejects idle wins', () => {
  const count = (profile, level) => final.results.filter(row => row.profile === profile && row.level === level && row.result === 'win').length;
  for (const level of LEVELS) {
    assert.equal(count('idle', level.id), 0);
    assert.ok(count('standard', level.id) >= 8);
    assert.ok(count('tactical', level.id) >= 9);
    if (level.id <= 4) assert.ok(count('novice', level.id) >= 8);
  }
  assert.ok(count('standard', 6) > count('novice', 6));
});
