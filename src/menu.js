// Title screen, character select (with difficulty / laps options + controls help), pause menu, gamepad navigation.
import { bus } from './events.js';
import { CONTROLS_HTML } from './controls-help.js';
import { CHARACTERS, GAME_TITLE } from './config.js';
import { accounts, bucketLabel, escHtml } from './accounts.js';

const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0').slice(-6);
const DIFFS = ['easy', 'normal', 'hard'];
const DIFF_LABEL = { easy: '50cc · EASY', normal: '100cc · NORMAL', hard: '150cc · HARD' };
const LAPS = [1, 3, 5];
const COURSES = ['day', 'night'];
const COURSE_LABEL = { day: 'DAY', night: 'NIGHT' };
const DIRECTIONS = ['forward', 'reverse'];
const DIRECTION_LABEL = { forward: 'FORWARD', reverse: 'REVERSE' };
const STAT_KEYS = [['speed', 'SPEED', 'SPD'], ['accel', 'ACCEL', 'ACC'], ['handling', 'HANDLING', 'HDL'], ['weight', 'WEIGHT', 'WGT']];
const NAME_MAX = 12;
/** 方向/昼夜在成绩桶里的短标签，和 accounts.js 的 bucketKey 对齐。 */
const BUCKET_COURSE = ['day', 'night'];
const BUCKET_DIR = ['fwd', 'rev'];
const TRACK_ID = 'campus';

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}
const statBar = (v) => `<div class="bar">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= v ? 'on' : ''}"></i>`).join('')}</div>`;


export class Menu {
  constructor(uiRoot, handlers = {}) {
    this.uiRoot = uiRoot;
    this.h = handlers; // { onStart({characterIndex, difficulty, laps}), onResume, onRestart, onQuit }
    this.screen = null; // 'title' | 'select' | 'pause' | null
    this.portraitFn = null;
    this.charIndex = 0;
    this.diffIndex = 1;
    this.lapsIndex = 1;
    this.courseIndex = 0;      // 0 = day, 1 = night
    this.dirIndex = 0;         // 0 = forward, 1 = reverse
    this.zone = 'grid';
    this.optIndex = 0;
    this.pauseIndex = 0;
    this.playerIndex = 0;
    this.boardCourse = 0;   // 榜单自己的浏览开关（不改动选人页要跑的设置）
    this.boardDir = 0;
    this._deleteArmed = null;
    this._pad = { prev: {}, repeatT: 0, dir: null };
    this.gameState = 'title';
    try {
      const s = JSON.parse(localStorage.getItem('ikc-settings') || '{}');
      if (s.charIndex >= 0 && s.charIndex < CHARACTERS.length) this.charIndex = s.charIndex;
      if (s.diffIndex >= 0 && s.diffIndex < DIFFS.length) this.diffIndex = s.diffIndex;
      if (s.lapsIndex >= 0 && s.lapsIndex < LAPS.length) this.lapsIndex = s.lapsIndex;
      if (s.courseIndex >= 0 && s.courseIndex < COURSES.length) this.courseIndex = s.courseIndex;
      if (s.dirIndex >= 0 && s.dirIndex < DIRECTIONS.length) this.dirIndex = s.dirIndex;
    } catch (e) { /* storage unavailable */ }

    this._buildTitle();
    this._buildSelect();
    this._buildPause();
    this._buildLoading();
    this._buildPlayers();
    this._buildBoard();
    this.refreshAccountUI();

    this._onKey = (e) => this._key(e);
    window.addEventListener('keydown', this._onKey);
  }

  setPortraitProvider(fn) {
    this.portraitFn = fn;
    this._portraits = new Map();
    this.cards.forEach((c, i) => {
      const url = this.portrait(CHARACTERS[i]);
      if (url) { c.img.src = url; c.img.style.display = ''; c.initial.style.display = 'none'; }
    });
    this._refreshPreview();
  }
  portrait(ch) {
    if (!ch || !this.portraitFn) return '';
    this._portraits = this._portraits || new Map();
    if (this._portraits.has(ch.id)) return this._portraits.get(ch.id);
    let url = '';
    try { url = this.portraitFn(ch) || ''; } catch (e) { url = ''; }
    this._portraits.set(ch.id, url);
    return url;
  }

  // ------------------------------------------------------------------ build
  _buildTitle() {
    const t = this.titleEl = el('div', 'screen title-screen', this.uiRoot);
    const words = GAME_TITLE.toUpperCase().split(' ');
    const first = words.shift();
    t.innerHTML = `
      <div class="title-vignette"></div>
      <div class="logo">
        <div class="logo-line l1" data-text="${first}">${first}</div>
        <div class="logo-line l2" data-text="${words.join(' ')}">${words.join(' ')}</div>
        <div class="logo-swoosh"></div>
      </div>
      <div class="press-start">PRESS ENTER / CLICK TO START</div>
      <div class="title-account">
        <button class="acct-chip" data-act="players"><span class="kc">N</span><b class="acct-name">GUEST</b><i>PLAYER</i></button>
        <button class="acct-chip" data-act="board"><span class="kc">L</span><i>LEADERBOARD</i></button>
      </div>
      <div class="title-foot">
        <span>© ${GAME_TITLE} · fan project · no official UIUC marks used</span>
        <span class="kc">M</span> mute
      </div>`;
    t.addEventListener('click', () => { if (this.screen === 'title') this._toSelect(); });
    t.querySelectorAll('.acct-chip').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.screen !== 'title') return;
        bus.emit('ui:confirm');
        if (b.dataset.act === 'players') this.showPlayers(); else this.showBoard();
      });
    });
  }

  _buildSelect() {
    const s = this.selectEl = el('div', 'screen select-screen', this.uiRoot);
    s.innerHTML = `
      <div class="sel-header"><div class="sel-title">CHOOSE YOUR RACER</div><div class="sel-back">ESC · BACK</div></div>
      <div class="sel-body">
        <div class="sel-grid"></div>
        <div class="sel-side">
          <div class="preview">
            <div class="pv-portrait"><img alt=""><span class="pv-initial"></span></div>
            <div class="pv-info">
              <div class="pv-name"></div>
              <div class="pv-kart"><span class="swatch"></span><span class="pv-kart-lbl"></span></div>
              <div class="pv-stats"></div>
            </div>
          </div>
          <div class="opts">
            <div class="opt" data-i="0"><span class="opt-lbl">CLASS</span><span class="opt-arrow l">◀</span><span class="opt-val"></span><span class="opt-arrow r">▶</span></div>
            <div class="opt" data-i="1"><span class="opt-lbl">LAPS</span><span class="opt-arrow l">◀</span><span class="opt-val"></span><span class="opt-arrow r">▶</span></div>
            <div class="opt" data-i="2"><span class="opt-lbl">COURSE</span><span class="opt-arrow l">◀</span><span class="opt-val"></span><span class="opt-arrow r">▶</span></div>
            <div class="opt" data-i="3"><span class="opt-lbl">DIRECTION</span><span class="opt-arrow l">◀</span><span class="opt-val"></span><span class="opt-arrow r">▶</span></div>
            <button class="btn primary race-btn" data-i="4">RACE!</button>
          </div>
          <div class="sel-record"></div>
        </div>
      </div>
      <div class="controls-help">${CONTROLS_HTML}</div>`;
    const grid = s.querySelector('.sel-grid');
    this.cards = CHARACTERS.map((ch, i) => {
      const card = el('div', 'card', grid);
      card.style.setProperty('--kc', hex(ch.color));
      card.style.setProperty('--ka', hex(ch.accent));
      card.innerHTML = `
        <div class="card-portrait"><img alt="" style="display:none"><span class="initial">${ch.name[0]}</span></div>
        <div class="card-name">${ch.name}</div>
        <div class="card-stats">${STAT_KEYS.map(([k, , sh]) => `<div class="st"><span>${sh}</span>${statBar(ch.stats[k])}</div>`).join('')}</div>`;
      card.addEventListener('mouseenter', () => { if (this.screen === 'select') { this.zone = 'grid'; this._setChar(i); } });
      card.addEventListener('click', () => { if (this.screen === 'select') { this._setChar(i); this._confirmChar(); } });
      card.addEventListener('dblclick', () => { if (this.screen === 'select') this._start(); });
      return { card, img: card.querySelector('img'), initial: card.querySelector('.initial') };
    });
    this.pv = {
      img: s.querySelector('.pv-portrait img'),
      initial: s.querySelector('.pv-initial'),
      portrait: s.querySelector('.pv-portrait'),
      name: s.querySelector('.pv-name'),
      swatch: s.querySelector('.swatch'),
      kartLbl: s.querySelector('.pv-kart-lbl'),
      stats: s.querySelector('.pv-stats'),
    };
    this.optEls = [...s.querySelectorAll('.opts [data-i]')];
    // Every row except the last is an option; the last element is the RACE! button. (Do not hard-code
    // the index — adding a row used to send its clicks straight into _start().)
    const raceBtnIndex = this.optEls.length - 1;
    this.optEls.forEach((o, i) => {
      o.addEventListener('mouseenter', () => { if (this.screen === 'select') { this.zone = 'opts'; this.optIndex = i; this._refreshFocus(); } });
      if (i < raceBtnIndex) {
        o.querySelector('.l').addEventListener('click', (e) => { e.stopPropagation(); this.zone = 'opts'; this.optIndex = i; this._changeOpt(-1); });
        o.querySelector('.r').addEventListener('click', (e) => { e.stopPropagation(); this.zone = 'opts'; this.optIndex = i; this._changeOpt(1); });
        o.querySelector('.opt-val').addEventListener('click', () => { this.zone = 'opts'; this.optIndex = i; this._changeOpt(1); });
      } else {
        o.addEventListener('click', () => this._start());
      }
    });
    s.querySelector('.sel-back').addEventListener('click', () => this._toTitle());
    this._refreshPreview();
    this._refreshOpts();
  }

  _buildPause() {
    const p = this.pauseEl = el('div', 'screen pause-screen', this.uiRoot);
    p.innerHTML = `
      <div class="pause-panel">
        <div class="pause-title">PAUSED</div>
        <button class="btn" data-a="resume">RESUME</button>
        <button class="btn" data-a="restart">RESTART</button>
        <button class="btn" data-a="quit">QUIT TO MENU</button>
        <div class="controls-help compact">${CONTROLS_HTML}</div>
      </div>`;
    this.pauseBtns = [...p.querySelectorAll('.btn')];
    this.pauseBtns.forEach((b, i) => {
      b.addEventListener('mouseenter', () => { if (this.pauseIndex !== i) { this.pauseIndex = i; this._refreshPause(); bus.emit('ui:move'); } });
      b.addEventListener('click', () => this._pauseAct(b.dataset.a));
    });
  }

  _buildLoading() {
    this.loadingEl = el('div', 'screen loading-screen', this.uiRoot, '<div class="spinner"></div><div class="loading-text">LOADING</div>');
  }

  // 玩家账号（本机多档，只有名字）与成绩榜。街机场景：一台机器、一群人共用。
  _buildPlayers() {
    const s = this.playersEl = el('div', 'screen players-screen', this.uiRoot);
    s.innerHTML = `
      <div class="pl-panel">
        <div class="pl-title">PLAYERS</div>
        <div class="pl-sub">ONE CABINET · EVERY PLAYER KEEPS THEIR OWN PBs · SAVED IN THIS BROWSER</div>
        <div class="pl-create">
          <input class="pl-input" maxlength="${NAME_MAX}" spellcheck="false" autocomplete="off" placeholder="TYPE A NAME…">
          <button class="btn primary" data-act="create">CREATE</button>
        </div>
        <div class="pl-list"></div>
        <div class="pl-foot"><span class="kc">↑↓</span> choose <span class="kc wide">ENTER</span> play as <span class="kc">X</span> delete <span class="kc wide">ESC</span> back</div>
      </div>`;
    this.plInput = s.querySelector('.pl-input');
    this.plList = s.querySelector('.pl-list');
    this.plFoot = s.querySelector('.pl-foot');
    s.querySelector('[data-act="create"]').addEventListener('click', () => this._createPlayer());
    this.plInput.addEventListener('input', () => { this.playerIndex = -1; this._refreshPlayers(); });
    this.plInput.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); this._createPlayer(); }
    });
  }

  _buildBoard() {
    const b = this.boardEl = el('div', 'screen board-screen', this.uiRoot);
    b.innerHTML = `
      <div class="bd-panel">
        <div class="bd-title">LEADERBOARD</div>
        <div class="bd-toggles">
          <div class="bd-opt" data-k="course"><span class="bd-lbl">COURSE</span><span class="opt-arrow l">◀</span><span class="bd-val"></span><span class="opt-arrow r">▶</span></div>
          <div class="bd-opt" data-k="dir"><span class="bd-lbl">DIRECTION</span><span class="opt-arrow l">◀</span><span class="bd-val"></span><span class="opt-arrow r">▶</span></div>
        </div>
        <div class="bd-sub"></div>
        <div class="bd-table"></div>
        <div class="bd-foot"><span class="kc">◀▶</span> switch board <span class="kc wide">ESC</span> back <span class="kc wide">ENTER</span> choose this setup</div>
      </div>`;
    this.bdSub = b.querySelector('.bd-sub');
    this.bdTable = b.querySelector('.bd-table');
    b.querySelectorAll('.bd-opt').forEach((o) => {
      const k = o.dataset.k;
      const bump = (d) => {
        if (k === 'course') this.boardCourse = (this.boardCourse + d + 2) % 2;
        else this.boardDir = (this.boardDir + d + 2) % 2;
        bus.emit('ui:move');
        this._refreshBoard();
      };
      o.querySelector('.l').addEventListener('click', (e) => { e.stopPropagation(); bump(-1); });
      o.querySelector('.r').addEventListener('click', (e) => { e.stopPropagation(); bump(1); });
      o.querySelector('.bd-val').addEventListener('click', (e) => { e.stopPropagation(); bump(1); });
    });
  }

  _players() { return accounts.list(); }

  // ------------------------------------------------------------------ screens
  _showOnly(elm) {
    for (const s of [this.titleEl, this.selectEl, this.pauseEl, this.loadingEl, this.playersEl, this.boardEl]) s.classList.toggle('active', s === elm);
  }
  showTitle() { this.screen = 'title'; this._prevScreen = 'title'; this._showOnly(this.titleEl); this.refreshAccountUI(); }
  showSelect() {
    this.screen = 'select'; this._prevScreen = 'select'; this.zone = 'grid';
    this._showOnly(this.selectEl);
    this._setChar(this.charIndex, true);
    this._refreshOpts();
    this.refreshAccountUI();
  }
  /** 玩家页：输入框自动聚焦，键盘直接打字就能建号。 */
  showPlayers() {
    this.screen = 'players';
    // 从结算页进来的话，退出就回到结算页（而不是跳到选人页）
    this._fromScreen = this.gameState === 'results' ? 'results' : this._prevScreen;
    this._showOnly(this.playersEl);
    this._deleteArmed = null;
    this.playerIndex = this._players().length ? 0 : -1;
    this._refreshPlayers();
    setTimeout(() => { try { this.plInput.focus(); } catch (e) { /* ignore */ } }, 0);
  }
  /** 榜单页：默认看的就是选人页当前要跑的那一套（但浏览不改设置）。 */
  showBoard() {
    this.screen = 'board';
    this._fromScreen = this.gameState === 'results' ? 'results' : this._prevScreen;
    this.boardCourse = this.courseIndex;
    this.boardDir = this.dirIndex;
    this._showOnly(this.boardEl);
    this._refreshBoard();
  }
  showPause() { this.screen = 'pause'; this.pauseIndex = 0; this._refreshPause(); this._showOnly(this.pauseEl); }
  showLoading(text = 'LOADING') {
    this.screen = 'loading';
    this.loadingEl.querySelector('.loading-text').textContent = text;
    this._showOnly(this.loadingEl);
  }
  hideAll() { this.screen = null; this._showOnly(null); }
  get settings() {
    return {
      characterIndex: this.charIndex,
      difficulty: DIFFS[this.diffIndex],
      laps: LAPS[this.lapsIndex],
      night: COURSES[this.courseIndex] === 'night',
      reverse: DIRECTIONS[this.dirIndex] === 'reverse',
    };
  }

  _toSelect() { bus.emit('ui:confirm'); this.showSelect(); this.h.onScreen && this.h.onScreen('select'); }
  _toTitle() { bus.emit('ui:back'); this.showTitle(); this.h.onScreen && this.h.onScreen('title'); }

  // ------------------------------------------------------------------ accounts / board
  /** 上次退出的界面（玩家页/榜单页都是叠在它上面的）。 */
  _back() {
    bus.emit('ui:back');
    if (this._fromScreen === 'results') { this.hideAll(); this.h.onScreen && this.h.onScreen('results'); }
    else if (this._fromScreen === 'select') { this.showSelect(); this.h.onScreen && this.h.onScreen('select'); }
    else this._toTitle();
  }

  /** 标题页的账号条 + 选人页的本桶成绩，两处一起刷新。 */
  refreshAccountUI() {
    const name = accounts.activeLabel;
    this.titleEl.querySelectorAll('.acct-name').forEach((e) => { e.textContent = name; });
    this.titleEl.querySelector('.acct-chip').classList.toggle('guest', !accounts.active);
    const el2 = this.selectEl.querySelector('.sel-record');
    if (!el2) return;
    const course = BUCKET_COURSE[this.courseIndex], dir = BUCKET_DIR[this.dirIndex];
    const key = `${TRACK_ID}|${course}|${dir}`;
    const mine = accounts.best(TRACK_ID, course, dir);
    const top = accounts.leaderboard(TRACK_ID, course, dir, 1)[0];
    const fmt = (t) => (t == null ? '—' : t.toFixed(2) + 's');
    el2.innerHTML = `
      <div class="rec-line"><span class="rec-k">${escHtml(name)} · BEST LAP</span><span class="rec-v">${fmt(mine && mine.lap)}</span></div>
      <div class="rec-line"><span class="rec-k">CABINET RECORD</span><span class="rec-v">${top ? fmt(top.lap) : '—'}</span>${top ? `<span class="rec-who">${escHtml(top.name)}</span>` : ''}</div>
      ${accounts.active ? '' : '<div class="rec-hint"><b>N</b> to create a player and save your PBs · <b>L</b> leaderboard</div>'}`;
  }

  _refreshPlayers() {
    const list = this._players();
    if (this.playerIndex >= list.length) this.playerIndex = list.length - 1;
    const armed = this._deleteArmed;
    this.plList.innerHTML = list.length
      ? list.map((p, i) => `
        <div class="pl-row${i === this.playerIndex ? ' focus' : ''}${p.name === accounts.activeName ? ' me' : ''}" data-i="${i}">
          <span class="pl-name">${escHtml(p.name)}${p.name === accounts.activeName ? ' <em>ACTIVE</em>' : ''}</span>
          <span class="pl-stat">${p.counts} PB${p.counts === 1 ? '' : 's'} · ${p.laps} LAP${p.laps === 1 ? '' : 'S'} · ${p.races} RACE${p.races === 1 ? '' : 'S'}${p.wins ? ` · ${p.wins} WIN${p.wins === 1 ? '' : 'S'}` : ''}</span>
          <button class="pl-del" data-del="${i}">${armed === p.name ? 'SURE?' : '✕'}</button>
        </div>`).join('')
      : '<div class="pl-empty">No players yet — type a name above and press CREATE.</div>';
    this.plList.querySelectorAll('.pl-row').forEach((row) => {
      const i = Number(row.dataset.i);
      row.addEventListener('mouseenter', () => { if (this.playerIndex !== i) { this.playerIndex = i; this.plInput.blur(); bus.emit('ui:move'); this._refreshPlayers(); } });
      row.addEventListener('click', () => { this.playerIndex = i; this._pickPlayer(); });
    });
    this.plList.querySelectorAll('[data-del]').forEach((b) => {
      b.addEventListener('click', (e) => { e.stopPropagation(); this._deletePlayer(this._players()[Number(b.dataset.del)]); });
    });
  }

  _createPlayer() {
    const raw = this.plInput ? this.plInput.value : '';
    if (!raw.trim()) { this.plInput.focus(); return; }
    const res = accounts.create(raw);
    if (!res.ok) { bus.emit('ui:back'); this.plInput.focus(); return; }
    bus.emit('ui:confirm');
    this.plInput.value = '';
    this._leavePlayers();
  }

  _pickPlayer() {
    const p = this._players()[this.playerIndex];
    if (!p) { this.plInput.focus(); return; }
    accounts.select(p.name);
    bus.emit('ui:confirm');
    this._leavePlayers();
  }

  /** 选完/建完账号之后的去向：从结算页来就回结算页（重画榜单），否则进选人页。 */
  _leavePlayers() {
    if (this._fromScreen === 'results') { this.hideAll(); this.h.onScreen && this.h.onScreen('results'); return; }
    this.showSelect();
    this.h.onScreen && this.h.onScreen('select');
  }

  /** 删档需要点两次（第一次变成 SURE?），避免街机上误删别人的 PB。 */
  _deletePlayer(p) {
    if (!p) return;
    if (this._deleteArmed !== p.name) { this._deleteArmed = p.name; bus.emit('ui:move'); this._refreshPlayers(); return; }
    accounts.remove(p.name);
    this._deleteArmed = null;
    bus.emit('ui:back');
    this._refreshPlayers();
  }

  _refreshBoard() {
    const course = BUCKET_COURSE[this.boardCourse], dir = BUCKET_DIR[this.boardDir];
    const opts = this.boardEl.querySelectorAll('.bd-opt');
    opts[0].querySelector('.bd-val').textContent = COURSE_LABEL[course];
    opts[1].querySelector('.bd-val').textContent = DIRECTION_LABEL[dir === 'fwd' ? 'forward' : 'reverse'];
    const rows = accounts.leaderboard(TRACK_ID, course, dir, 10);
    this.bdSub.textContent = bucketLabel(`${TRACK_ID}|${course}|${dir}`, 'ILLINI CAMPUS CIRCUIT');
    this.bdTable.innerHTML = rows.length
      ? rows.map((r) => `
        <div class="bd-row${r.own ? ' me' : ''}">
          <span class="bd-rank">${r.rank}</span>
          <span class="bd-name">${escHtml(r.name)}${r.own ? ' <em>YOU</em>' : ''}</span>
          <span class="bd-time">${r.lap.toFixed(2)}s</span>
          <span class="bd-race">${r.race != null ? 'race ' + r.race.toFixed(2) + 's' : ''}</span>
          <span class="bd-chip">${r.cls ? escHtml(r.cls) : ''}</span>
        </div>`).join('')
      : '<div class="bd-empty">No times on this board yet. Be the first.</div>';
  }

  _setChar(i, silent) {
    i = (i + CHARACTERS.length) % CHARACTERS.length;
    if (i !== this.charIndex && !silent) bus.emit('ui:move');
    this.charIndex = i;
    this.cards.forEach((c, j) => c.card.classList.toggle('selected', j === i));
    this._refreshPreview();
    this._refreshFocus();
  }
  _confirmChar() {
    bus.emit('ui:confirm');
    this.zone = 'opts'; this.optIndex = this.optEls.length - 1;
    const c = this.cards[this.charIndex].card;
    c.classList.remove('picked'); void c.offsetWidth; c.classList.add('picked');
    this._refreshFocus();
  }
  _refreshPreview() {
    if (!this.pv) return;
    const ch = CHARACTERS[this.charIndex];
    const url = this.portrait(ch);
    if (url) { this.pv.img.src = url; this.pv.img.style.display = ''; this.pv.initial.style.display = 'none'; }
    else { this.pv.img.style.display = 'none'; this.pv.initial.style.display = ''; this.pv.initial.textContent = ch.name[0]; }
    this.pv.portrait.style.setProperty('--kc', hex(ch.color));
    this.pv.name.textContent = ch.name.toUpperCase();
    this.pv.swatch.style.background = `linear-gradient(135deg, ${hex(ch.color)} 60%, ${hex(ch.accent)} 60%)`;
    this.pv.kartLbl.textContent = `${ch.hat.toUpperCase()} · KART`;
    this.pv.stats.innerHTML = STAT_KEYS.map(([k, l]) => `<div class="st big"><span>${l}</span>${statBar(ch.stats[k])}</div>`).join('');
    this.pv.portrait.classList.remove('pop'); void this.pv.portrait.offsetWidth; this.pv.portrait.classList.add('pop');
  }
  _refreshOpts() {
    if (!this.optEls) return;
    this.optEls[0].querySelector('.opt-val').textContent = DIFF_LABEL[DIFFS[this.diffIndex]];
    this.optEls[1].querySelector('.opt-val').textContent = `${LAPS[this.lapsIndex]} LAP${LAPS[this.lapsIndex] > 1 ? 'S' : ''}`;
    this.optEls[2].querySelector('.opt-val').textContent = COURSE_LABEL[COURSES[this.courseIndex]];
    this.optEls[3].querySelector('.opt-val').textContent = DIRECTION_LABEL[DIRECTIONS[this.dirIndex]];
  }
  _refreshFocus() {
    this.cards.forEach((c, j) => c.card.classList.toggle('focus', this.zone === 'grid' && j === this.charIndex));
    this.optEls.forEach((o, j) => o.classList.toggle('focus', this.zone === 'opts' && j === this.optIndex));
  }
  _changeOpt(d) {
    if (this.optIndex === 0) this.diffIndex = (this.diffIndex + d + DIFFS.length) % DIFFS.length;
    else if (this.optIndex === 1) this.lapsIndex = (this.lapsIndex + d + LAPS.length) % LAPS.length;
    else if (this.optIndex === 2) this.courseIndex = (this.courseIndex + d + COURSES.length) % COURSES.length;
    else if (this.optIndex === 3) this.dirIndex = (this.dirIndex + d + DIRECTIONS.length) % DIRECTIONS.length;
    else return;
    bus.emit('ui:move');
    this._refreshOpts();
    this._refreshFocus();
    this.refreshAccountUI();
    const v = this.optEls[this.optIndex].querySelector('.opt-val');
    v.classList.remove('bump'); void v.offsetWidth; v.classList.add('bump');
  }
  _start() {
    if (this.screen !== 'select') return;
    try { localStorage.setItem('ikc-settings', JSON.stringify({ charIndex: this.charIndex, diffIndex: this.diffIndex, lapsIndex: this.lapsIndex, courseIndex: this.courseIndex, dirIndex: this.dirIndex })); } catch (e) { /* ignore */ }
    bus.emit('ui:confirm');
    this.h.onStart && this.h.onStart(this.settings);
  }
  _gridCols() {
    try {
      const g = this.selectEl.querySelector('.sel-grid');
      const n = getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length;
      return n >= 1 && n <= 8 ? n : 2;
    } catch (e) { return 2; }
  }
  _refreshPause() { this.pauseBtns.forEach((b, i) => b.classList.toggle('focus', i === this.pauseIndex)); }
  _pauseAct(a) {
    if (this.screen !== 'pause') return;
    bus.emit('ui:confirm');
    if (a === 'resume') this.h.onResume && this.h.onResume();
    else if (a === 'restart') this.h.onRestart && this.h.onRestart();
    else if (a === 'quit') this.h.onQuit && this.h.onQuit();
  }

  // ------------------------------------------------------------------ input
  _key(e) {
    const c = e.code;
    const isEnter = c === 'Enter' || c === 'NumpadEnter' || c === 'Space';
    if (this.screen === 'title') {
      if ((isEnter || c === 'KeyE') && !e.repeat) { e.preventDefault(); this._toSelect(); }
      return;
    }
    if (this.screen === 'select') {
      const up = c === 'ArrowUp' || c === 'KeyW', down = c === 'ArrowDown' || c === 'KeyS';
      const left = c === 'ArrowLeft' || c === 'KeyA', right = c === 'ArrowRight' || c === 'KeyD';
      if (up || down || left || right || isEnter) e.preventDefault();
      if (c === 'Escape' || c === 'Backspace') {
        if (this.zone === 'opts') { this.zone = 'grid'; this._refreshFocus(); bus.emit('ui:back'); }
        else this._toTitle();
        return;
      }
      if (this.zone === 'grid') {
        const cols = this._gridCols(), i = this.charIndex, col = i % cols, row = Math.floor(i / cols), rows = Math.ceil(CHARACTERS.length / cols);
        if (left) this._setChar(col === 0 ? i + cols - 1 : i - 1);
        else if (right) {
          if (col === cols - 1) { this.zone = 'opts'; this.optIndex = 0; bus.emit('ui:move'); this._refreshFocus(); }
          else this._setChar(i + 1);
        } else if (up) this._setChar(((row - 1 + rows) % rows) * cols + col);
        else if (down) this._setChar(((row + 1) % rows) * cols + col);
        else if (isEnter && !e.repeat) this._confirmChar();
      } else {
        const lastOpt = this.optEls.length - 1;      // the RACE! button
        if (up) {
          if (this.optIndex === 0) { this.zone = 'grid'; } else this.optIndex--;
          bus.emit('ui:move'); this._refreshFocus();
        } else if (down) { this.optIndex = Math.min(lastOpt, this.optIndex + 1); bus.emit('ui:move'); this._refreshFocus(); }
        else if (left) {
          if (this.optIndex === lastOpt) { this.zone = 'grid'; bus.emit('ui:move'); this._refreshFocus(); } else this._changeOpt(-1);
        } else if (right) { if (this.optIndex < lastOpt) this._changeOpt(1); }
        else if (isEnter && !e.repeat) { if (this.optIndex === lastOpt) this._start(); else this._changeOpt(1); }
      }
      return;
    }
    if (this.screen === 'pause') {
      if (c === 'ArrowUp' || c === 'KeyW') { this.pauseIndex = (this.pauseIndex + 2) % 3; this._refreshPause(); bus.emit('ui:move'); e.preventDefault(); }
      else if (c === 'ArrowDown' || c === 'KeyS') { this.pauseIndex = (this.pauseIndex + 1) % 3; this._refreshPause(); bus.emit('ui:move'); e.preventDefault(); }
      else if (isEnter && !e.repeat) { e.preventDefault(); this._pauseAct(this.pauseBtns[this.pauseIndex].dataset.a); }
      return;
    }
    if (this.screen === 'players') {
      // 输入框保持焦点，可以直接打字；这里只拦上下选人、回车确认、Esc 返回、X 删档。
      const up = c === 'ArrowUp', down = c === 'ArrowDown';
      if (up || down) {
        const list = this._players();
        if (list.length) {
          e.preventDefault();
          this.playerIndex = this.playerIndex < 0
            ? (down ? 0 : list.length - 1)
            : (this.playerIndex + (down ? 1 : -1) + list.length) % list.length;
          try { this.plInput.blur(); } catch (err) { /* ignore */ }
          bus.emit('ui:move');
          this._refreshPlayers();
        }
        return;
      }
      if (c === 'Escape' || c === 'Backspace') {
        if (this._deleteArmed) { this._deleteArmed = null; this._refreshPlayers(); }
        else this._back();
        return;
      }
      if (isEnter && !e.repeat) {
        e.preventDefault();
        if (this.plInput && this.plInput.value.trim()) this._createPlayer(); else this._pickPlayer();
        return;
      }
      if (c === 'KeyX' && !e.repeat && this.plInput && !this.plInput.value) {
        e.preventDefault();
        this._deletePlayer(this._players()[this.playerIndex]);
        return;
      }
      // 其余按键交给输入框（字母、退格、空格…）
      if (this.playerIndex >= 0) { this.playerIndex = -1; this._refreshPlayers(); }
      return;
    }
    if (this.screen === 'board') {
      const left = c === 'ArrowLeft' || c === 'KeyA', right = c === 'ArrowRight' || c === 'KeyD';
      const up = c === 'ArrowUp' || c === 'KeyW', down = c === 'ArrowDown' || c === 'KeyS';
      if (left || right) {
        e.preventDefault();
        const d = right ? 1 : -1;
        if (up || down) this.boardDir = (this.boardDir + d + 2) % 2; else this.boardCourse = (this.boardCourse + d + 2) % 2;
        bus.emit('ui:move'); this._refreshBoard();
        return;
      }
      if (up || down) {
        e.preventDefault();
        this.boardDir = (this.boardDir + (down ? 1 : -1) + 2) % 2;
        bus.emit('ui:move'); this._refreshBoard();
        return;
      }
      if (c === 'Escape' || c === 'Backspace') { e.preventDefault(); this._back(); return; }
      if (isEnter && !e.repeat) {
        // 回车 = 切到看这一套设置去跑（不直接开赛，避免误触）
        e.preventDefault();
        this.courseIndex = this.boardCourse; this.dirIndex = this.boardDir;
        this._refreshOpts(); this.refreshAccountUI();
        this._back();
      }
    }
  }

  /** Poll gamepads; translate to synthetic key presses for menus (and Start -> Escape for pause). */
  update(dt, gameState) {
    this.gameState = gameState;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads || []) if (p && p.connected) { gp = p; break; }
    if (!gp) return;
    const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    const now = {
      up: b(12) || ay < -0.6, down: b(13) || ay > 0.6, left: b(14) || ax < -0.6, right: b(15) || ax > 0.6,
      a: b(0), b: b(1), start: b(9),
    };
    const prev = this._pad.prev;
    const inMenu = this.screen === 'title' || this.screen === 'select' || this.screen === 'pause'
      || this.screen === 'players' || this.screen === 'board' || gameState === 'results';
    const fire = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
    if (inMenu) {
      const dirs = [['up', 'ArrowUp'], ['down', 'ArrowDown'], ['left', 'ArrowLeft'], ['right', 'ArrowRight']];
      let held = null;
      for (const [k, code] of dirs) {
        if (now[k] && !prev[k]) { fire(code); this._pad.repeatT = 0.4; }
        if (now[k]) held = code;
      }
      if (held) { this._pad.repeatT -= dt; if (this._pad.repeatT <= 0) { fire(held); this._pad.repeatT = 0.14; } }
      if (now.a && !prev.a) fire('Enter');
      if (now.b && !prev.b) fire(this.screen === 'pause' ? 'Escape' : 'Backspace');
    }
    if (now.start && !prev.start) fire(this.screen === 'title' ? 'Enter' : 'Escape');
    if (gameState === 'intro' && now.a && !prev.a) fire('Enter');
    this._pad.prev = now;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    for (const s of [this.titleEl, this.selectEl, this.pauseEl, this.loadingEl, this.playersEl, this.boardEl]) s.remove();
  }
}
