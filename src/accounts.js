// 本机玩家账号 + 圈速 PB 存档。
//
// 一台街机、多个玩家共用同一台机器：每个玩家一个名字（零密码），成绩按
// 「赛道 × 昼夜 × 方向」分别记一条 PB —— 白天正向和夜晚反向是两个完全不同的挑战，
// 不能混在一张榜上比。
//
// 全部存在 localStorage 里，没有后端，所以双击 dist 文件也能用。榜的性质是
// “这台机器的战绩”，不是防作弊的权威记录 —— 本机存档本来就改得动，这点在 README 里写明。

const STORE_KEY = 'ikc-players';
const ACTIVE_KEY = 'ikc-active-player';
const VERSION = 1;
const NAME_MAX = 12;

/** 名字规范化：去首尾空白、压缩内部空白、去掉控制字符。用于显示与查重。 */
export function cleanName(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

/** 玩家名字是用户输入，拼进 innerHTML 前必须转义。 */
export function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 查重用的键：大小写和空格都不敏感，避免出现 “Yhyu” / “yhyu ” 两个账号。 */
const nameKey = (name) => cleanName(name).toLowerCase();

export const COURSE_LABEL = { day: 'DAY', night: 'NIGHT' };
export const DIR_LABEL = { fwd: 'FORWARD', rev: 'REVERSE' };

/** 成绩桶的键：一条 PB 只属于一个「赛道 · 昼夜 · 方向」组合。 */
export function bucketKey(trackId, course, dir) {
  return `${trackId || 'unknown'}|${course === 'night' ? 'night' : 'day'}|${dir === 'rev' ? 'rev' : 'fwd'}`;
}

export function bucketParts(key) {
  const [trackId, course, dir] = String(key || '').split('|');
  return { trackId: trackId || 'unknown', course: course === 'night' ? 'night' : 'day', dir: dir === 'rev' ? 'rev' : 'fwd' };
}

/** 人类可读的桶名，用于榜单标题。 */
export function bucketLabel(key, trackName) {
  const p = bucketParts(key);
  return `${trackName || p.trackId} · ${COURSE_LABEL[p.course]} · ${DIR_LABEL[p.dir]}`;
}

/** localStorage 在隐私模式/无存储环境下会抛异常，这里降级成“本次有效、不落盘”。 */
function makeStorage() {
  try {
    const s = window.localStorage;
    const probe = '__ikc_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch (e) {
    const mem = new Map();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
    };
  }
}

const fmtTime = (t) => (t == null || !isFinite(t) ? null : t);

export class Accounts {
  constructor(storage) {
    this.storage = storage || makeStorage();
    this.data = { v: VERSION, players: {} };
    this.activeName = null;
    this.load();
  }

  load() {
    try {
      const raw = this.storage.getItem(STORE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && parsed.players) this.data = { v: VERSION, players: parsed.players };
    } catch (e) { /* 存档坏了就当空档，不要卡住启动 */ }
    for (const p of Object.values(this.data.players)) {
      if (!p || typeof p !== 'object') continue;
      p.best = p.best && typeof p.best === 'object' ? p.best : {};
      p.laps = p.laps | 0;
      p.races = p.races | 0;
      p.wins = p.wins | 0;
    }
    const active = this.storage.getItem(ACTIVE_KEY);
    this.activeName = active && this.data.players[active] ? active : null;
  }

  save() {
    try {
      this.storage.setItem(STORE_KEY, JSON.stringify(this.data));
      if (this.activeName) this.storage.setItem(ACTIVE_KEY, this.activeName);
      else this.storage.removeItem(ACTIVE_KEY);
    } catch (e) { /* 配额满/被禁用：游戏继续，只是这次不落盘 */ }
  }

  // ---------------------------------------------------------------- 账号
  /** 玩家列表，最近玩过的排前面（街机上最常玩的人就在第一位）。 */
  list() {
    return Object.values(this.data.players)
      .map((p) => ({
        name: p.name,
        lastSeen: p.lastSeen || 0,
        created: p.created || 0,
        laps: p.laps | 0,
        races: p.races | 0,
        wins: p.wins | 0,
        pbs: Object.keys(p.best).length,
        counts: Object.values(p.best).filter((b) => b && fmtTime(b.lap) != null).length,
      }))
      .sort((a, b) => b.lastSeen - a.lastSeen || a.name.localeCompare(b.name));
  }

  has(name) { return !!this.data.players[cleanName(name)]; }

  find(name) {
    const want = nameKey(name);
    return Object.values(this.data.players).find((p) => nameKey(p.name) === want) || null;
  }

  /** 注册（或选中同名的已有账号 —— 街机上打错一个字不应该变成两个档）。 */
  create(name) {
    const clean = cleanName(name);
    if (!clean) return { ok: false, reason: 'empty' };
    const existing = this.find(clean);
    if (existing) return { ok: true, name: existing.name, existing: true };
    const now = Date.now();
    const profile = { name: clean, created: now, lastSeen: now, laps: 0, races: 0, wins: 0, best: {} };
    this.data.players[clean] = profile;
    this.activeName = clean;
    this.save();
    return { ok: true, name: clean, existing: false };
  }

  select(name) {
    const p = this.find(name);
    if (!p) return false;
    p.lastSeen = Date.now();
    this.activeName = p.name;
    this.save();
    return true;
  }

  rename(from, to) {
    const p = this.find(from);
    const clean = cleanName(to);
    if (!p || !clean) return false;
    if (nameKey(clean) !== nameKey(p.name) && this.find(clean)) return false;
    delete this.data.players[p.name];
    p.name = clean;
    this.data.players[clean] = p;
    if (nameKey(this.activeName) === nameKey(p.name)) this.activeName = clean;
    this.save();
    return true;
  }

  remove(name) {
    const p = this.find(name);
    if (!p) return false;
    delete this.data.players[p.name];
    if (nameKey(this.activeName) === nameKey(p.name)) this.activeName = null;
    this.save();
    return true;
  }

  signOut() { this.activeName = null; this.save(); }

  get active() { return this.activeName ? this.data.players[this.activeName] : null; }
  get activeLabel() { return this.activeName || 'GUEST'; }

  // ---------------------------------------------------------------- 成绩
  /** 当前玩家的某桶成绩，没有就返回 null。 */
  best(trackId, course, dir) {
    const p = this.active;
    if (!p) return null;
    return p.best[bucketKey(trackId, course, dir)] || null;
  }

  /** 全机器榜：某个桶里所有玩家按单圈 PB 排序。 */
  leaderboard(trackId, course, dir, limit = 10) {
    const key = bucketKey(trackId, course, dir);
    return Object.values(this.data.players)
      .map((p) => {
        const b = p.best[key];
        return b && fmtTime(b.lap) != null ? { name: p.name, own: p.name === this.activeName, ...b } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.lap - b.lap)
      .slice(0, Math.max(1, limit))
      .map((row, i) => ({ ...row, rank: i + 1 }));
  }

  /**
   * 记一圈。返回 { pb, prev, delta } —— delta 为负表示快了，HUD 拿它做“NEW BEST”反馈。
   * 只有真的进不了榜的圈也会计数（laps+1），因为“跑了多少”本身也是战绩。
   */
  recordLap({ trackId, course, dir, lapTime, cls, kart }) {
    const p = this.active;
    if (!p || !isFinite(lapTime) || lapTime <= 0) return { pb: false, prev: null, delta: null };
    const key = bucketKey(trackId, course, dir);
    const prev = p.best[key] || null;
    p.laps = (p.laps | 0) + 1;
    p.lastSeen = Date.now();
    let pb = false;
    let delta = null;
    if (!prev || fmtTime(prev.lap) == null || lapTime < prev.lap) {
      pb = true;
      delta = prev && fmtTime(prev.lap) != null ? lapTime - prev.lap : null;
      p.best[key] = { ...(prev || {}), lap: lapTime, at: Date.now(), cls: cls || (prev && prev.cls) || null, kart: kart || (prev && prev.kart) || null };
    }
    this.save();
    return { pb, prev: prev ? prev.lap : null, delta };
  }

  /** 记一场完整比赛（总时间）。只在刷新总时间时更新，单圈 PB 由 recordLap 负责。 */
  recordRace({ trackId, course, dir, totalTime, cls, kart, won }) {
    const p = this.active;
    if (!p) return { pb: false, delta: null };
    const key = bucketKey(trackId, course, dir);
    const prev = p.best[key] || null;
    p.races = (p.races | 0) + 1;
    if (won) p.wins = (p.wins | 0) + 1;
    p.lastSeen = Date.now();
    let pb = false;
    let delta = null;
    if (isFinite(totalTime) && totalTime > 0 && (!prev || fmtTime(prev.race) == null || totalTime < prev.race)) {
      pb = true;
      delta = prev && fmtTime(prev.race) != null ? totalTime - prev.race : null;
      p.best[key] = { ...(prev || {}), race: totalTime, raceAt: Date.now(), cls: cls || (prev && prev.cls) || null, kart: kart || (prev && prev.kart) || null };
    }
    this.save();
    return { pb, delta };
  }

  /** 玩家自己的总览（玩家页和选人页的小字用）。 */
  summary(name) {
    const p = name ? this.find(name) : this.active;
    if (!p) return null;
    const entries = Object.values(p.best || {});
    const laps = entries.map((b) => b.lap).filter((t) => fmtTime(t) != null);
    return {
      name: p.name,
      laps: p.laps | 0,
      races: p.races | 0,
      wins: p.wins | 0,
      pbs: entries.length,
      bestLap: laps.length ? Math.min(...laps) : null,
    };
  }
}

export const accounts = new Accounts();
