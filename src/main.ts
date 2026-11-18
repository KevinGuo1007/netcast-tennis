import { AudioManager } from './audio/audio';
import { Keyboard } from './input/keyboard';
import { isTouchDevice, mergeInputs, TouchControls } from './input/touch';
import { cssColor, SHOT_COLORS } from './render/colors';
import { GameScene } from './render/scene';
import { AI_LEVELS, AiController } from './sim/ai';
import { DT, HUMAN, ShotType, TUNING } from './sim/constants';
import {
  contactEta,
  GameEvent,
  GameState,
  Grade,
  newGame,
  NO_INPUT,
  Phase,
  PlayerInput,
  PointReason,
  step,
} from './sim/game';
import { makeRng, Rng } from './sim/rng';
import { pointLabels, pointStatus } from './sim/score';
import { Tutorial } from './tutorial';

type Level = keyof typeof AI_LEVELS;
/** menu:开始页面(背景是电脑互打的演示);playing:对局中;paused:暂停;result:比赛结束 */
type Mode = 'menu' | 'playing' | 'paused' | 'result';
type Panel = 'home' | 'level' | 'pause' | 'result' | 'credits';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

const audio = new AudioManager();
const keyboard = new Keyboard();
const touch = new TouchControls($('touch'));
const touchMode = isTouchDevice();
document.body.classList.toggle('touch', touchMode);
const portrait = window.matchMedia('(orientation: portrait)');

const readInput = (): PlayerInput => mergeInputs(keyboard.read(), touch.read());
const newSeed = (): number => (Date.now() ^ (Math.random() * 2 ** 31)) >>> 0;

let scene: GameScene;
let mode: Mode = 'menu';
let level: Level = 'normal';
let rng: Rng = makeRng(1);
let state: GameState = newGame(HUMAN, AI_LEVELS.normal);
let ai = new AiController(1, AI_LEVELS.normal, rng);
let demoAi = new AiController(0, AI_LEVELS.normal, rng);
let bannerTimer = 0;
let gradeTimer = 0;
let helpTimer = 0;
let myHits = 0;
let lastReason: PointReason = 'out';
let prevPhase: Phase = 'serve';
let debugPaused = false;
/** 正在进行的新手教学;为 null 表示是正常比赛 */
let tutorial: Tutorial | null = null;
const TUTORIAL_DONE_KEY = 'netcast.tutorialDone';
const ASSIST_KEY = 'netcast.assist';
/** 击球辅助(默认开):按住击球键不放,球到位时自动挥拍 */
let assist = true;
try {
  assist = localStorage.getItem(ASSIST_KEY) !== '0';
} catch {
  // 读不到就用默认值
}

function setText(id: string, text: string): void {
  const el = $(id);
  if (el.textContent !== text) el.textContent = text;
}

function showBanner(text: string, seconds = 1.5): void {
  setText('banner', text);
  $('banner').classList.add('show');
  bannerTimer = seconds;
}

const GRADE_TEXT: Record<Grade, string> = { perfect: '完美!', good: '不错', ok: '勉强', poor: '没打好' };

function showGrade(grade: Grade, text = GRADE_TEXT[grade]): void {
  setText('grade', text);
  $('grade').className = `show ${grade}`;
  gradeTimer = 0.8;
}

// ---------------------------------------------------------------- 菜单和流程

function showPanel(panel: Panel | null): void {
  $('menu').classList.toggle('show', panel !== null);
  document.querySelectorAll<HTMLElement>('#menu .panel').forEach((el) => {
    el.classList.toggle('show', el.dataset.panel === panel);
  });
}

function setMode(next: Mode): void {
  mode = next;
  const inGame = next === 'playing' || next === 'paused';
  document.body.classList.toggle('in-game', inGame);
  // 菜单里音乐为主;对局中压低音乐,打开场馆环境声
  audio.setMusicLevel(inGame ? 0.2 : 0.5);
  audio.setAmbience(next === 'playing');
}

/** 开始页面的背景:两个电脑自己打 */
function startDemo(): void {
  rng = makeRng(newSeed());
  state = newGame(AI_LEVELS.normal, AI_LEVELS.normal);
  demoAi = new AiController(0, AI_LEVELS.normal, rng);
  ai = new AiController(1, AI_LEVELS.normal, rng);
}

function goHome(): void {
  tutorial = null;
  document.body.classList.remove('tutorial');
  scene.setGoal(null);
  startDemo();
  setMode('menu');
  refreshHome();
  showPanel('home');
}

/** 开始页面:没做过教学的新玩家,把"新手教学"作为推荐入口突出显示 */
function refreshHome(): void {
  let done = false;
  try {
    done = localStorage.getItem(TUTORIAL_DONE_KEY) === '1';
  } catch {
    // 隐私模式下读不到,按没做过处理
  }
  setText('tutorial-sub', done ? '已完成 · 随时可以重玩' : '推荐新玩家先玩:几分钟熟悉操作');
  $('tutorial-btn').classList.toggle('primary', !done);
  document.querySelector('[data-action="single"]')!.classList.toggle('primary', done);
}

function resetHud(): void {
  myHits = 0;
  prevPhase = 'serve';
  bannerTimer = gradeTimer = helpTimer = 0;
  $('banner').classList.remove('show');
  $('grade').classList.remove('show');
  $('help').classList.remove('show');
}

/** 新手教学:用喂球代替对手,一课练一件事;学完(或中途退出)回到开始页面,可以随时重玩 */
function startTutorial(): void {
  rng = makeRng(newSeed());
  state = newGame(HUMAN, HUMAN, 0);
  state.players[0].assist = assist;
  tutorial = new Tutorial(state, key, stick, touchMode, assist);
  document.body.classList.add('tutorial');
  resetHud();
  showPanel(null);
  setMode('playing');
  readInput();
  if (touchMode) enterFullscreenLandscape();
}

function finishTutorial(): void {
  try {
    localStorage.setItem(TUTORIAL_DONE_KEY, '1');
  } catch {
    // 记不住也不影响使用
  }
  audio.synth('win');
  goHome();
}

function startMatch(chosen: Level): void {
  level = chosen;
  rng = makeRng(newSeed());
  state = newGame(HUMAN, AI_LEVELS[level]);
  ai = new AiController(1, AI_LEVELS[level], rng);
  state.players[0].assist = assist;
  tutorial = null;
  document.body.classList.remove('tutorial');
  scene.setGoal(null);
  resetHud();
  showPanel(null);
  setMode('playing');
  readInput(); // 丢弃开始前积压的按键
  if (touchMode) enterFullscreenLandscape();
}

function pause(): void {
  if (mode !== 'playing') return;
  setMode('paused');
  showPanel('pause');
}

function resume(): void {
  if (mode !== 'paused') return;
  showPanel(null);
  setMode('playing');
  readInput();
}

function finishMatch(): void {
  const won = state.score.winner === 0;
  setText('result-title', won ? '你赢了!' : '电脑赢了');
  setText('result-score', `${state.score.games[0]} : ${state.score.games[1]}`);
  setMode('result');
  showPanel('result');
  audio.synth(won ? 'win' : 'lose');
}

/** 手机上尽量全屏并锁定横屏;浏览器不支持时静默跳过(例如 iPhone 的 Safari) */
function enterFullscreenLandscape(): void {
  const el = document.documentElement;
  const lock = (): void => {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    o.lock?.('landscape').catch(() => {});
  };
  if (el.requestFullscreen && !document.fullscreenElement) {
    el.requestFullscreen().then(lock, () => {});
  } else {
    lock();
  }
}

function refreshToggles(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((btn) => {
    const which = btn.dataset.toggle as 'music' | 'sfx' | 'assist';
    const on = which === 'assist' ? assist : audio.settings[which];
    const label = { music: '音乐', sfx: '音效', assist: '击球辅助' }[which];
    btn.textContent = `${label}:${on ? '开' : '关'}`;
    btn.classList.toggle('off', !on);
  });
}

/** 击球辅助开关:记在本机,对局中切换立刻生效 */
function setAssist(on: boolean): void {
  assist = on;
  try {
    localStorage.setItem(ASSIST_KEY, on ? '1' : '0');
  } catch {
    // 记不住也不影响使用
  }
  if (mode !== 'menu') state.players[0].assist = on;
}

function bindMenu(): void {
  $('menu').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn || btn.disabled) return;
    audio.synth('click');
    const { action, level: chosen, toggle } = btn.dataset;
    if (chosen) startMatch(chosen as Level);
    else if (toggle === 'music') audio.setMusicEnabled(!audio.settings.music);
    else if (toggle === 'sfx') audio.setSfxEnabled(!audio.settings.sfx);
    else if (toggle === 'assist') setAssist(!assist);
    else if (action === 'single') showPanel('level');
    else if (action === 'tutorial') startTutorial();
    else if (action === 'credits') showPanel('credits');
    else if (action === 'home' || action === 'quit') goHome();
    else if (action === 'resume') resume();
    else if (action === 'rematch') startMatch(level);
    else if (action === 'next-track') audio.nextTrack();
    refreshToggles();
  });
  $('pause-btn').addEventListener('click', () => pause());
  $('t-skip').addEventListener('click', () => tutorial?.skip());
  $('t-quit').addEventListener('click', () => goHome());
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    if (mode === 'playing') pause();
    else if (mode === 'paused') resume();
  });
  audio.onTrack = (title) => setText('now-playing', `♪ ${title} — Kevin MacLeod`);
  refreshToggles();
}

// ---------------------------------------------------------------- 操作提示

const SHOT_KEY: Record<ShotType, string> = { flat: 'J', top: 'K', slice: 'L', lob: 'I' };
const SHOT_NAME: Record<ShotType, string> = { flat: '平击', top: '上旋', slice: '切削', lob: '挑高球' };

/** 提示文字里的按键:键盘显示键帽,触屏显示对应的按钮名 */
function key(k: string): string {
  if (!touchMode) return `<kbd>${k}</kbd>`;
  const names: Record<string, string> = { J: '平击', K: '上旋', L: '切削', I: '挑高' };
  return `<kbd class="word">${names[k] ?? k}</kbd>`;
}
const stick = (keys: string): string =>
  touchMode ? '<kbd class="word">摇杆</kbd>' : [...keys].map((k) => `<kbd>${k}</kbd>`).join('');

/** 左上角的帮助提示:每条在一次会话里只出现一次,像教学一样随进度逐条给出 */
const seenTips = new Set<string>();
function tip(id: string, html: string, seconds = 7): void {
  if (seenTips.has(id)) return;
  seenTips.add(id);
  const el = $('help');
  el.innerHTML = html;
  el.classList.add('show');
  helpTimer = seconds;
}

function updateTips(): void {
  const me = state.players[0];
  const myServe = state.phase === 'serve' && state.score.server === 0;
  if (myServe && !state.tossing) {
    tip('serve1', `轮到你发球。按 ${key('J')} 抛球。`);
  } else if (myServe && state.tossing) {
    tip(
      'serve2',
      `球升到最高点时再按 ${key('J')} 击球:力度计越接近顶端的绿色区,发球越快越准。用 ${stick('AD')} 选择内角或外角。`,
    );
  } else if (state.phase === 'serve' && state.score.server === 1) {
    tip('return', `对手发球。球过网后跑向落点圆环,按住 ${key('J')} 回击。`);
  } else if (state.phase === 'rally' && state.lastHitter === 1 && me.stroke === 'none') {
    tip(
      'move',
      me.assist
        ? `用 ${stick('WASD')} 跑到落点附近,然后<b>按住</b> ${key('J')} 不要松:球到位时会自动挥拍。按得越早,力度越大。`
        : `用 ${stick('WASD')} 跑到落点附近,<b>按住</b> ${key('J')} 蓄力,等脚边收缩的白圈进入色带、变成<b style="color:#b8e62e">青柠色</b>时<b>松开</b>。松早一点没关系,球员会等球到位再挥。`,
      10,
    );
  } else if (me.stroke === 'prep') {
    tip(
      'aim',
      me.assist
        ? `蓄力时 ${stick('WASD')} 改为瞄准。力度计到<b style="color:#b8e62e">绿色区</b>最稳;不想打太重就提前松手。想拿「完美」,在脚边白圈变成青柠色时自己松手。`
        : `蓄力时 ${stick('WASD')} 改为瞄准。越接近亮绿色窄环松手,评级越高;按得越久力度越大,力度计停在<b style="color:#b8e62e">绿色区</b>最稳。松得太晚会<b>打空</b>。`,
      10,
    );
  } else if (me.stroke === 'recover') {
    tip('recover', '挥拍之后要调整姿势才能再次挥拍:力度越大调整越久,打空了更久。身旁的灰色条是剩余时间。', 8);
  } else if (myHits >= 2 && state.phase === 'rally' && state.lastHitter === 1) {
    tip(
      'sprint',
      touchMode
        ? '<b>双击摇杆</b>再推方向可以冲刺(很费体力)。球快到了又够不着时,双击会直接<b>鱼跃扑救</b>。'
        : '<b>双击方向键</b>并按住可以冲刺(很费体力)。球快到了又够不着时,双击会直接<b>鱼跃扑救</b>。',
      9,
    );
  } else if (myHits >= 4) {
    tip(
      'spin',
      `换个球种试试:${key('K')} 上旋,弹得高、落得快;${key('L')} 切削,飘得久、弹得低;${key('I')} 挑高球,越过上网的对手。落点标记的颜色表示球种。`,
      10,
    );
  }
  if (myHits >= 7) tip('tactics', '多变换角度和球种,调动对手跑动!记分牌下方的细条是体力,体力不足时跑得慢、失误多。', 8);
}

interface KeyItem {
  label: string;
  keys: string[];
  color?: number;
}

/** 右下角的按键提示栏:只列出当前情境下用得上的操作 */
function keyItems(): KeyItem[] {
  if (mode !== 'playing') return [];
  const me = state.players[0];
  const shots = (['lob', 'slice', 'top', 'flat'] as ShotType[]).map((s) => ({
    label: SHOT_NAME[s],
    keys: [SHOT_KEY[s]],
    color: SHOT_COLORS[s],
  }));
  if (state.phase === 'serve' && state.score.server === 0) {
    return state.tossing
      ? [
          { label: '瞄准', keys: ['A', 'D'] },
          { label: '发球', keys: ['J'] },
        ]
      : [{ label: '开始发球', keys: ['J'] }];
  }
  if (me.stroke === 'prep') {
    return [
      { label: '瞄准', keys: ['W', 'A', 'S', 'D'] },
      {
        label: me.assist ? '按住蓄力 · 球到自动挥拍' : '按住蓄力 · 松开挥拍',
        keys: [SHOT_KEY[me.shot]],
        color: SHOT_COLORS[me.shot],
      },
    ];
  }
  if (me.stroke === 'swing' && me.strokeT < 0) {
    return [
      { label: '瞄准', keys: ['W', 'A', 'S', 'D'] },
      { label: '已出手,等球到位', keys: [] },
    ];
  }
  if (me.stroke === 'swing' || me.stroke === 'recover' || me.stroke === 'dive') {
    return [{ label: me.stroke === 'dive' ? '爬起来…' : '调整姿势中,暂时不能挥拍', keys: [] }];
  }
  return [{ label: '移动', keys: ['W', 'A', 'S', 'D'] }, { label: '冲刺 / 扑救', keys: ['双击方向'] }, ...shots];
}

let keysSignature = '';
function updateKeys(): void {
  const items = keyItems();
  const signature = JSON.stringify(items);
  if (signature === keysSignature) return;
  keysSignature = signature;
  $('keys').innerHTML = items
    .map((it) => {
      const swatch = it.color === undefined ? '' : `<span class="swatch" style="background:${cssColor(it.color)}"></span>`;
      return `<span class="item">${swatch}${it.label}${it.keys.map((k) => `<kbd>${k}</kbd>`).join('')}</span>`;
    })
    .join('');
}

// ---------------------------------------------------------------- 对局事件:提示和声音

const REASONS: Record<PointReason, string> = { out: '出界', net: '下网', doubleFault: '双误', winner: '得分', ace: 'ACE' };
const who = (id: number): string => (id === 0 ? '你' : '电脑');
/** 略微随机的播放速率,避免同一个录音听起来重复 */
const vary = (spread = 0.06): number => 1 + (Math.random() * 2 - 1) * spread;
const panOf = (x: number): number => Math.max(-1, Math.min(1, x / 9));

function onEvent(e: GameEvent): void {
  switch (e.type) {
    case 'toss':
      audio.synth('whoosh', 0.35);
      break;
    case 'serve': {
      const p = state.players[e.player];
      audio.synth('whoosh', 0.7);
      audio.play('serve', { volume: e.player === 0 ? 1 : 0.6, rate: vary(0.04), pan: panOf(p.x) });
      showBanner(`发球 ${e.kmh} km/h`, 1.2);
      if (e.player === 0) {
        showGrade(e.grade);
        if (e.grade === 'perfect') audio.synth('perfect');
      }
      break;
    }
    case 'whiff':
      audio.synth('whoosh', 0.9);
      if (e.player === 0) showGrade('poor', '打空!');
      break;
    case 'dive':
      audio.synth('whoosh', 0.8);
      audio.synth('net', 0.5); // 身体落地的闷响
      break;
    case 'hit': {
      const p = state.players[e.player];
      // 切削、挑高和救球用较轻的击球录音;远端的球员声音小一些
      const soft = e.lunge || e.dive || e.shot === 'slice' || e.shot === 'lob';
      const distance = e.player === 0 ? 1 : 0.6;
      audio.synth('whoosh', 0.3 + 0.4 * e.power);
      audio.play(soft ? 'soft' : 'hit', { volume: (0.45 + 0.55 * e.power) * distance, rate: vary(), pan: panOf(p.x) });
      if (e.player === 0) {
        myHits++;
        // 时机偏了就告诉玩家是早了还是晚了
        const off = e.timing > TUNING.timingEarlyPerfect ? ' · 早了' : e.timing < -TUNING.timingLatePerfect ? ' · 晚了' : '';
        showGrade(e.grade, e.dive ? '扑救!' : e.lunge ? '救球!' : GRADE_TEXT[e.grade] + (e.auto ? '' : off));
        if (e.grade === 'perfect') audio.synth('perfect');
      }
      break;
    }
    case 'bounce':
      audio.play('bounce', { volume: e.z > 0 ? 0.75 : 0.45, rate: vary(0.08), pan: panOf(e.x) });
      break;
    case 'net':
      audio.synth('net');
      break;
    case 'fault':
      audio.synth('fault');
      showBanner('发球失误', 1.1);
      break;
    case 'point':
      if (tutorial) break; // 教学里不计分,也不需要掌声和比分提示
      lastReason = e.reason;
      // 制胜分和 ACE 是热烈的掌声;对手失误得分只有礼貌性的掌声
      if (e.reason === 'winner' || e.reason === 'ace') audio.play('applauseBig', { volume: 0.85 });
      else audio.play('applauseSmall', { volume: e.reason === 'doubleFault' ? 0.35 : 0.6 });
      showBanner(`${REASONS[e.reason]} · ${who(e.winner)}得分`);
      break;
    case 'game':
      if (lastReason !== 'winner' && lastReason !== 'ace') audio.play('applauseBig', { volume: 0.6 });
      showBanner(`${who(e.winner)}赢下这一局`, 1.8);
      break;
    case 'match':
      audio.play('applauseBig', { volume: 1 });
      break;
  }
}

/** 新的一分开始时的提示条:二发、局点、破发点、赛点 */
function announcePoint(): void {
  if (state.faults > 0) {
    showBanner('二发', 1.3);
    return;
  }
  const { status, leader } = pointStatus(state.score);
  if (status === 'match') showBanner(`赛点 · ${who(leader)}`, 1.6);
  else if (status === 'break') showBanner(`破发点 · ${who(leader)}`, 1.6);
  else if (status === 'game') showBanner(`局点 · ${who(leader)}`, 1.6);
}

function place(el: HTMLElement, x: number, y: number): void {
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function updateHud(): void {
  const [a, b] = pointLabels(state.score);
  setText('p0', a);
  setText('p1', b);
  setText('g0', String(state.score.games[0]));
  setText('g1', String(state.score.games[1]));
  $('row0').classList.toggle('serving', state.score.server === 0);
  $('row1').classList.toggle('serving', state.score.server === 1);

  // 体力条
  state.players.forEach((p, i) => {
    const bar = $(`s${i}`);
    bar.style.width = `${Math.round(p.stamina * 100)}%`;
    bar.classList.toggle('low', p.stamina < 0.3);
  });

  // 力度计:引拍时显示蓄力,抛球时显示击球时机(越接近最高点越满)
  const me = state.players[0];
  const meter = $('meter');
  const playing = mode === 'playing';
  const tossing = playing && state.tossing && state.score.server === 0;
  const charging = playing && me.stroke === 'prep';
  const cooling = playing && me.stroke === 'recover' && me.recoverT > 0.2;
  meter.classList.toggle('show', tossing || charging || cooling);
  meter.classList.toggle('cooldown', cooling);
  if (tossing || charging || cooling) {
    const value = tossing
      ? 1 - Math.min(1, Math.abs(state.ball.pos.y - TUNING.serveIdealHeight) / 0.7)
      : cooling
        ? 1 - me.strokeT / me.recoverT // 调整姿势的剩余时间
        : Math.max(TUNING.minPower, me.power);
    (meter.lastElementChild as HTMLElement).style.height = `${Math.round(value * 100)}%`;
    meter.classList.toggle('serve', tossing);
    const risky = charging && value > TUNING.powerRisky;
    const good = tossing ? value > 0.85 : charging && value >= TUNING.powerGood && !risky;
    meter.classList.toggle('in-good', good);
    meter.classList.toggle('in-risky', risky);
    // 贴在球员身旁:时机圆环在来球一侧,力度计放到另一侧,互不遮挡
    const ringSide = state.prediction && state.prediction.ix < me.x ? -1 : 1;
    const anchor = scene.toScreen(me.x - ringSide * 1.0, 1.0, me.z);
    place(meter, anchor.x, anchor.y + 36);
  }

  if (gradeTimer > 0) {
    const pos = scene.toScreen(me.x - 0.3, 2.5, me.z);
    place($('grade'), pos.x, pos.y);
  }

  if (playing && !tutorial) updateTips();
  if (tutorial) updateTutorialPanel(tutorial);
  updateKeys();
}

/** 教学任务面板:第几课、说明、进度圆点、对上一个球的反馈 */
let tutorialSignature = '';
function updateTutorialPanel(t: Tutorial): void {
  const lesson = t.lesson;
  const signature = `${t.index}|${t.count}|${t.feedback}`;
  if (signature === tutorialSignature) return;
  tutorialSignature = signature;
  setText('t-title', `第 ${t.index + 1} / ${t.lessons.length} 课 · ${lesson.title}`);
  setText('t-progress', '●'.repeat(Math.min(t.count, lesson.needed)) + '○'.repeat(Math.max(0, lesson.needed - t.count)));
  $('t-body').innerHTML = lesson.body;
  setText('t-feedback', t.feedback);
  $('t-feedback').className = t.kind;
}

// ---------------------------------------------------------------- 主循环

let last = performance.now();
let acc = 0;

function advance(elapsed: number): void {
  // 手机竖屏时暂停对局,等横过来再继续
  const blocked = touchMode && portrait.matches;

  if (mode === 'menu') {
    // 开始页面背景:电脑互打的演示,不出声、不显示提示
    acc += elapsed;
    while (acc >= DT) {
      step(state, [demoAi.update(state, DT), ai.update(state, DT)], DT, rng);
      acc -= DT;
    }
    if (state.phase === 'over') startDemo();
  } else if (mode === 'playing' && !blocked) {
    // 教学的前几课是慢动作
    acc += elapsed * (tutorial ? tutorial.speed : 1);
    // 输入每帧读一次;"刚按下"只在该帧的第一个模拟步生效
    const input = readInput();
    const events: GameEvent[] = [];
    let simulated = 0;
    while (acc >= DT) {
      // 教学里对面只负责喂球,不会回球
      const opponent = tutorial ? NO_INPUT : ai.update(state, DT);
      for (const e of step(state, [input, opponent], DT, rng)) {
        onEvent(e);
        events.push(e);
      }
      input.swing = false;
      input.dash = false;
      acc -= DT;
      simulated += DT;
    }
    if (tutorial) {
      tutorial.update(simulated, events);
      scene.setGoal(tutorial.goal);
      if (tutorial.finished) finishTutorial();
    } else {
      if (state.phase === 'serve' && prevPhase === 'between') announcePoint();
      prevPhase = state.phase;
      if (state.phase === 'over') finishMatch();
    }
  }

  if (bannerTimer > 0) {
    bannerTimer -= elapsed;
    if (bannerTimer <= 0) $('banner').classList.remove('show');
  }
  if (gradeTimer > 0) {
    gradeTimer -= elapsed;
    if (gradeTimer <= 0) $('grade').classList.remove('show');
  }
  if (helpTimer > 0) {
    helpTimer -= elapsed;
    if (helpTimer <= 0) $('help').classList.remove('show');
  }

  updateHud();
  scene.render(state, elapsed, mode === 'menu' || mode === 'result');
}

function frame(now: number): void {
  const elapsed = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!debugPaused) advance(elapsed);
  requestAnimationFrame(frame);
}

async function init(): Promise<void> {
  scene = await GameScene.create($('game') as HTMLCanvasElement);
  bindMenu();
  audio.startMusic();
  goHome();
  requestAnimationFrame(frame);

  // 调试入口(仅开发环境):查看状态、暂停实时循环并手动推进,便于自动化检查
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __game: () => state,
      __mode: () => mode,
      __scene: scene,
      __eta: () => contactEta(state, 0),
      __audio: audio,
      __pause: (on: boolean) => (debugPaused = on),
      __advance: advance,
    });
  }
}

void init();
