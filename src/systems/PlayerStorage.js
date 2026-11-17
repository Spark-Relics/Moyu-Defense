const GRADES = ['F', 'C', 'B', 'A', 'S'];
const PROGRESS_KEY = 'niuma_save_v1';
const SETTINGS_KEY = 'niuma_settings_v1';
const bounded = (value, min, max, fallback = min) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

// Storage is optional: private browsing and a full disk must never stop a game.
export class PlayerStorage {
  constructor(storage, levelCount = 6) {
    this.storage = storage;
    this.levelCount = levelCount;
    this.available = Boolean(storage);
  }

  read(key) {
    try { return this.storage?.getItem(key) ?? null; }
    catch { this.available = false; return null; }
  }

  write(key, value) {
    try {
      if (!this.storage) { this.available = false; return false; }
      this.storage.setItem(key, value);
      return true;
    } catch { this.available = false; return false; }
  }

  loadProgress() {
    let saved;
    try { saved = JSON.parse(this.read(PROGRESS_KEY)); } catch { /* Recover malformed saves. */ }
    const legacy = Number(this.read('niuma_progress'));
    const maxUnlocked = Math.floor(bounded(saved?.version === 1 ? saved.maxUnlocked : legacy, 1, this.levelCount));
    const records = {};
    if (saved?.version === 1) for (let id = 1; id <= this.levelCount; id++) {
      const record = saved.records?.[id];
      if (!record || !GRADES.includes(record.grade)) continue;
      records[id] = {
        grade: record.grade,
        score: Math.floor(bounded(record.score, 0, 1e9)),
        kills: Math.floor(bounded(record.kills, 0, 1e6)),
        duration: bounded(record.duration, 0, 86400),
        hpRatio: bounded(record.hpRatio, 0, 1),
        clears: Math.floor(bounded(record.clears, 0, 1e6)),
      };
    }
    return { version: 1, maxUnlocked, records };
  }

  saveProgress(progress) { return this.write(PROGRESS_KEY, JSON.stringify(progress)); }

  loadSettings() {
    let saved;
    try { saved = JSON.parse(this.read(SETTINGS_KEY)); } catch { /* Use defaults. */ }
    return {
      volume: bounded(saved?.volume, 0, 1, 0),
      quality: ['auto', 'high', 'low'].includes(saved?.quality) ? saved.quality : 'auto',
      reducedMotion: typeof saved?.reducedMotion === 'boolean' ? saved.reducedMotion : null,
    };
  }

  saveSettings(settings) { return this.write(SETTINGS_KEY, JSON.stringify(settings)); }
}

export function mergeRecord(previous, result) {
  const cleared = result.grade !== 'F';
  return {
    grade: GRADES[Math.max(GRADES.indexOf(previous?.grade ?? 'F'), GRADES.indexOf(result.grade))],
    score: Math.max(previous?.score ?? 0, result.score),
    kills: Math.max(previous?.kills ?? 0, result.kills),
    duration: cleared && (!previous?.clears || result.duration < previous.duration) ? result.duration : (previous?.duration ?? result.duration),
    hpRatio: Math.max(previous?.hpRatio ?? 0, result.hpRatio),
    clears: (previous?.clears ?? 0) + Number(cleared),
  };
}
