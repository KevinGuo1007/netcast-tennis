import { Ball, BOUNCE, cloneBall, NET, Prediction, predict, solveShot, stepBall, WALL } from './ball';
import { BALL, COURT, DT, HUMAN, SHOTS, ShotType, STAMINA, TUNING } from './constants';
import { gaussian, Rng } from './rng';
import { awardPoint, newScore, PlayerId, Score } from './score';

export interface PlayerInput {
  /** 世界坐标下的移动方向,长度不超过 1 */
  moveX: number;
  moveZ: number;
  /** 本步是否刚按下击球键(开始引拍 / 抛球 / 发球击球) */
  swing: boolean;
  /** 击球键是否仍然按住(蓄力);松开的那一刻挥拍 */
  hold: boolean;
  shot: ShotType;
  /** 瞄准摇杆:aimX 为世界 x 方向(-1..1),aimZ 为 +1 往深处、-1 往浅处 */
  aimX: number;
  aimZ: number;
  /** 本步是否双击了方向键:冲刺,或者在球快到又够不着时鱼跃扑救 */
  dash: boolean;
}

export const NO_INPUT: PlayerInput = {
  moveX: 0,
  moveZ: 0,
  swing: false,
  hold: false,
  shot: 'flat',
  aimX: 0,
  aimZ: 0,
  dash: false,
};

export interface PlayerStats {
  speed: number;
  shotSpeed: number;
  serveSpeed: number;
  errMul: number;
}

/**
 * none 待机;prep 引拍蓄力(按住);swing 挥拍(松开后 impactT 秒到达击球点);
 * recover 挥拍后调整姿势,期间不能再次挥拍;dive 鱼跃扑救;
 * toss 发球抛球后等待击球;serveSwing 发球挥拍。
 */
export type Stroke = 'none' | 'prep' | 'swing' | 'recover' | 'dive' | 'toss' | 'serveSwing';

/** 击球质量评级,由挥拍时机、站位、击球高度决定 */
export type Grade = 'perfect' | 'good' | 'ok' | 'poor';

export interface Player extends PlayerStats {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** +1 表示在 z > 0 一侧,-1 表示在 z < 0 一侧 */
  dir: 1 | -1;
  stroke: Stroke;
  strokeT: number;
  /** 这次挥拍(或扑救)是否已经过了击球判定 */
  impactDone: boolean;
  /** 这次挥拍提前了多少秒松手(球员等球到位后才真正挥出) */
  early: number;
  /** 击球辅助:一直按着不松手,球到位时自动挥拍 */
  assist: boolean;
  /** 这次挥拍是辅助自动出手的 */
  auto: boolean;
  /** 来不及挥拍时按下的击球键还能保留多久 */
  buffer: number;
  bufferShot: ShotType;
  /** 这次挥拍打空了 */
  whiff: boolean;
  /** 这次击球是伸展上步才够到的 */
  lunge: boolean;
  /** 当前这段调整姿势要持续多久 */
  recoverT: number;
  /** 已蓄的力度 0..1 */
  power: number;
  /** 瞄准点 -1..1:x 为左右,z 为深浅 */
  aimX: number;
  aimZ: number;
  /** +1 正手,-1 反手 */
  side: 1 | -1;
  shot: ShotType;
  stamina: number;
  sprinting: boolean;
  /** 扑救腾空时的速度 */
  diveVx: number;
  diveVz: number;
  cooldown: number;
}

export type Phase = 'serve' | 'rally' | 'between' | 'over';
export type PointReason = 'out' | 'net' | 'doubleFault' | 'winner' | 'ace';

export type GameEvent =
  | { type: 'toss'; player: PlayerId }
  | { type: 'serve'; player: PlayerId; kmh: number; grade: Grade }
  | {
      type: 'hit';
      player: PlayerId;
      shot: ShotType;
      grade: Grade;
      power: number;
      lunge: boolean;
      dive: boolean;
      /** 挥拍时机误差(秒):正数是挥早了,负数是挥晚了 */
      timing: number;
      /** 是击球辅助自动出手的 */
      auto: boolean;
    }
  | { type: 'whiff'; player: PlayerId }
  | { type: 'dive'; player: PlayerId }
  | { type: 'bounce'; x: number; z: number }
  | { type: 'net' }
  /** 球打在围墙、广告牌或看台上;speed 是撞上去的速度 */
  | { type: 'wall'; x: number; z: number; speed: number }
  | { type: 'fault' }
  | { type: 'point'; winner: PlayerId; reason: PointReason }
  | { type: 'game'; winner: PlayerId }
  | { type: 'match'; winner: PlayerId };

export interface GameState {
  ball: Ball;
  players: [Player, Player];
  score: Score;
  phase: Phase;
  /** 发球方已经把球抛起 */
  tossing: boolean;
  lastHitter: PlayerId | null;
  bounces: number;
  isServe: boolean;
  /** 有效发球区的 x 符号 */
  serveSide: number;
  faults: number;
  timer: number;
  sinceHit: number;
  /** 每次击球或发球后加一,方便 AI 和渲染层察觉新的来球 */
  hitSeq: number;
  /** 最近一次击球的球种,用来给落点标记上色 */
  lastShot: ShotType | 'serve' | null;
  prediction: Prediction | null;
  /** 练习模式(新手教学):不计分,一个球结束后停在原地等下一个球,不会自动开始下一分 */
  practice: boolean;
}

function makePlayer(dir: 1 | -1, stats: PlayerStats): Player {
  return {
    ...stats,
    x: 0,
    z: dir * 12.3,
    vx: 0,
    vz: 0,
    dir,
    stroke: 'none',
    strokeT: 0,
    impactDone: false,
    early: 0,
    assist: false,
    auto: false,
    buffer: 0,
    bufferShot: 'flat',
    whiff: false,
    lunge: false,
    recoverT: 0,
    power: 0,
    aimX: 0,
    aimZ: 0,
    side: 1,
    shot: 'flat',
    stamina: 1,
    sprinting: false,
    diveVx: 0,
    diveVz: 0,
    cooldown: 0,
  };
}

export function newGame(stats0: PlayerStats = HUMAN, stats1: PlayerStats = HUMAN, server: PlayerId = 0): GameState {
  const state: GameState = {
    ball: { pos: { x: 0, y: 1, z: 0 }, vel: { x: 0, y: 0, z: 0 }, spin: 0 },
    players: [makePlayer(1, stats0), makePlayer(-1, stats1)],
    score: newScore(server),
    phase: 'serve',
    tossing: false,
    lastHitter: null,
    bounces: 0,
    isServe: false,
    serveSide: 0,
    faults: 0,
    timer: 0,
    sinceHit: 0,
    hitSeq: 0,
    lastShot: null,
    prediction: null,
    practice: false,
  };
  setupPoint(state);
  return state;
}

function setupPoint(s: GameState): void {
  const server = s.players[s.score.server];
  const receiver = s.players[1 - s.score.server];
  const deuce = (s.score.points[0] + s.score.points[1]) % 2 === 0;
  // 平分区在发球方自己的右手边
  const sx = server.dir * (deuce ? 1.2 : -1.2);
  const reset = {
    vx: 0,
    vz: 0,
    stroke: 'none' as Stroke,
    strokeT: 0,
    cooldown: 0.25,
    impactDone: false,
    whiff: false,
    lunge: false,
    sprinting: false,
    power: 0,
    aimX: 0,
    aimZ: 0,
  };
  Object.assign(server, reset, { x: sx, z: server.dir * 12.2 });
  Object.assign(receiver, reset, { x: -sx * 2.2, z: receiver.dir * 12.6 });
  s.phase = 'serve';
  s.tossing = false;
  s.lastHitter = null;
  s.bounces = 0;
  s.isServe = false;
  s.lastShot = null;
  s.prediction = null;
  holdBall(s);
}

/** 发球前球拿在非持拍手里 */
function holdBall(s: GameState): void {
  const p = s.players[s.score.server];
  s.ball.pos = { x: p.x - p.dir * 0.3, y: 1.05, z: p.z - p.dir * 0.35 };
  s.ball.vel = { x: 0, y: 0, z: 0 };
  s.ball.spin = 0;
}

/** 以 lastHitter 的视角判断落点 (x, z) 是否有效 */
function isBounceIn(s: GameState, x: number, z: number): boolean {
  if (s.lastHitter === null) return false;
  const dir = s.players[s.lastHitter].dir;
  const r = BALL.radius;
  if (z * dir >= 0) return false;
  if (Math.abs(x) > COURT.halfWidth + r) return false;
  if (s.isServe) {
    return Math.abs(z) <= COURT.serviceLine + r && x * s.serveSide >= -r;
  }
  return Math.abs(z) <= COURT.halfLength + r;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const clamp01 = (v: number): number => clamp(v, 0, 1);

/** 把瞄准点 (-1..1) 换算成对方半场的落点。供渲染层画准星时复用。 */
export function aimTarget(p: Player): { x: number; z: number } {
  const depth =
    p.aimZ >= 0
      ? TUNING.depthMid + p.aimZ * (TUNING.depthFar - TUNING.depthMid)
      : TUNING.depthMid + p.aimZ * (TUNING.depthMid - TUNING.depthNear);
  return { x: p.aimX * TUNING.aimWidth, z: -p.dir * (p.shot === 'lob' ? Math.max(depth, 9.4) : depth) };
}

/** 发球的落点:左右在发球区内选内角或外角 */
export function serveTarget(p: Player): { x: number; z: number } {
  const side = -Math.sign(p.x);
  const wide = clamp(TUNING.serveWide + p.aimX * side * 1.5, 0.5, 3.6);
  return { x: side * wide, z: -p.dir * (TUNING.serveDepth + p.aimZ * 0.7) };
}

/** 球员当前的最佳击球点(球拍一侧、身体略前方) */
export function sweetPoint(p: Player): { x: number; z: number } {
  return { x: p.x + p.side * p.dir * TUNING.sweetSide, z: p.z - p.dir * TUNING.sweetFront };
}

function staminaPower(p: Player): number {
  return STAMINA.minPower + (1 - STAMINA.minPower) * p.stamina;
}

/** 这个球是不是正飞向 i 号球员的半场(不论会不会出界) */
function isIncoming(s: GameState, i: PlayerId): boolean {
  const p = s.players[i];
  return (
    s.phase === 'rally' &&
    s.lastHitter !== null &&
    s.lastHitter !== i &&
    s.prediction !== null &&
    s.bounces <= 1 &&
    s.prediction.z * p.dir > 0
  );
}

/** 这个球现在能不能被 i 号球员合法地打到 */
function canHit(s: GameState, i: PlayerId): boolean {
  const p = s.players[i];
  return (
    s.phase === 'rally' &&
    s.lastHitter !== i &&
    s.ball.pos.z * p.dir > 0 &&
    s.bounces <= 1 &&
    !(s.isServe && s.bounces === 0)
  );
}

/**
 * 接这个来球的理想站位:让球拍一侧的最佳击球点对准球。
 * 站在落点后方时等球弹起再打;已经在落点前方(网前)时对准球的飞行线路截击。
 */
export function stanceFor(s: GameState, i: PlayerId): { x: number; z: number } | null {
  if (!isIncoming(s, i)) return null;
  const p = s.players[i];
  const pred = s.prediction!;
  let bx = pred.ix;
  let z = pred.iz + p.dir * TUNING.sweetFront;
  const volley = s.bounces === 0 && p.z * p.dir < pred.z * p.dir - 0.5;
  if (volley) {
    const b = s.ball;
    const t = Math.abs(b.vel.z) > 0.1 ? (p.z - p.dir * TUNING.sweetFront - b.pos.z) / b.vel.z : 0;
    bx = b.pos.x + b.vel.x * Math.max(0, t);
    z = p.z;
  }
  // 正手或反手,选离自己近的一侧(略微偏向正手)
  const fore = bx - p.dir * TUNING.sweetSide;
  const back = bx + p.dir * TUNING.sweetSide;
  const x = Math.abs(fore - p.x) <= Math.abs(back - p.x) + 0.4 ? fore : back;
  return { x, z: clamp(z * p.dir, 0.6, 16) * p.dir };
}

/**
 * 球还要多久到达 i 号球员的击球位置(沿球路离球员最近的那一刻)。
 * 负数表示球已经过去了;球不是朝这名球员来的则返回 null。
 * 挥拍要提前 impactT 秒松开按键,所以"还剩 impactT 秒"就是最佳出手时机。
 */
export function contactEta(s: GameState, i: PlayerId): number | null {
  if (!isIncoming(s, i)) return null;
  const p = s.players[i];
  const tx = p.x;
  const tz = p.z - p.dir * TUNING.sweetFront;
  const b = cloneBall(s.ball);
  let prev = Math.hypot(b.pos.x - tx, b.pos.z - tz);
  for (let k = 1; k <= 240; k++) {
    stepBall(b, DT);
    const d = Math.hypot(b.pos.x - tx, b.pos.z - tz);
    if (d > prev) {
      if (k > 1) return (k - 1) * DT;
      // 一开始就在远离:球已经过去了,按距离和球速估算过去了多久
      const vh = Math.hypot(s.ball.vel.x, s.ball.vel.z);
      return vh > 0.5 ? -prev / vh : 0;
    }
    prev = d;
  }
  return 240 * DT;
}

interface Launch {
  tx: number;
  tz: number;
  speed: number;
  spin: number;
  clearance: number;
  /** 0 最好,1 最差:决定方向和弧线的误差 */
  quality: number;
}

function launch(s: GameState, i: PlayerId, l: Launch, rng: Rng): void {
  const p = s.players[i];
  const vel = solveShot(s.ball.pos, l.tx, l.tz, l.speed, l.spin, l.clearance);
  const q = Math.pow(l.quality, 1.5);
  const angle = gaussian(rng) * (0.025 + 0.075 * q) * p.errMul;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  s.ball.vel = {
    x: vel.x * cos - vel.z * sin,
    y: vel.y + gaussian(rng) * (0.4 + 1.25 * q) * p.errMul,
    z: vel.x * sin + vel.z * cos,
  };
  s.ball.spin = l.spin;
  s.lastHitter = i;
  s.bounces = 0;
  s.sinceHit = 0;
  s.hitSeq++;
  s.prediction = predict(s.ball);
  s.prediction.in = isBounceIn(s, s.prediction.x, s.prediction.z);
}

function toss(s: GameState, i: PlayerId, events: GameEvent[]): void {
  const p = s.players[i];
  s.ball.pos = { x: p.x - p.dir * 0.15, y: TUNING.tossHeight, z: p.z - p.dir * 0.4 };
  s.ball.vel = { x: 0, y: TUNING.tossSpeed, z: -p.dir * 0.25 };
  s.tossing = true;
  p.stroke = 'toss';
  p.strokeT = 0;
  p.aimX = 0;
  p.aimZ = 0;
  events.push({ type: 'toss', player: i });
}

function serve(s: GameState, i: PlayerId, rng: Rng, events: GameEvent[]): void {
  const p = s.players[i];
  // 击球点越接近抛球最高点,球速越快、越准
  const timing = 1 - clamp01(Math.abs(s.ball.pos.y - TUNING.serveIdealHeight) / 0.7);
  const grade: Grade = timing > 0.85 ? 'perfect' : timing > 0.6 ? 'good' : timing > 0.3 ? 'ok' : 'poor';
  const second = s.faults > 0;
  const target = serveTarget(p);
  s.serveSide = -Math.sign(p.x);
  s.isServe = true;
  s.phase = 'rally';
  s.tossing = false;
  p.stroke = 'serveSwing';
  p.strokeT = TUNING.impactT;
  p.power = 0.5;
  p.whiff = false;
  s.lastShot = 'serve';
  launch(
    s,
    i,
    {
      tx: target.x,
      tz: target.z,
      speed: p.serveSpeed * (0.72 + 0.28 * timing) * staminaPower(p) * (second ? TUNING.secondServeFactor : 1),
      spin: TUNING.serveSpin * (second ? 2 : 1),
      clearance: second ? 0.35 : 0.12,
      quality: clamp01(0.2 + (1 - timing) * 0.6 - (second ? 0.15 : 0) + (1 - p.stamina) * STAMINA.errorAtEmpty),
    },
    rng,
  );
  p.stamina = clamp01(p.stamina - STAMINA.serveCost);
  const v = s.ball.vel;
  events.push({ type: 'serve', player: i, kmh: Math.round(Math.hypot(v.x, v.y, v.z) * 3.6), grade });
}

interface Contact {
  /** 球离最佳击球点的横向距离(垂直于球路) */
  lateral: number;
  /** 时机误差(秒):正数挥早了,负数挥晚了 */
  timing: number;
  lunge: boolean;
  dive: boolean;
  /** 击球辅助自动出手 */
  auto?: boolean;
}

function hit(s: GameState, i: PlayerId, c: Contact, rng: Rng, events: GameEvent[]): void {
  const p = s.players[i];
  const shot = SHOTS[p.shot];
  let power = Math.max(TUNING.minPower, p.power) * staminaPower(p);
  if (c.lunge) power *= 0.6;
  if (c.dive) power = 0.4;

  // 击球质量(0 最好):挥拍时机、站位离最佳击球点多远、击球高度、是否还在移动
  const early = c.timing >= 0;
  const free = early ? TUNING.timingEarlyPerfect : TUNING.timingLatePerfect;
  const limit = early ? TUNING.timingEarlyMax : TUNING.timingLateMax;
  const timingQ = clamp01((Math.abs(c.timing) - free) / (limit - free));
  const posQ = clamp01((c.lateral - TUNING.sweetRadius) / (TUNING.contactRadius - TUNING.sweetRadius));
  const y = s.ball.pos.y;
  const heightQ = y < TUNING.sweetLow ? (TUNING.sweetLow - y) / 0.6 : y > TUNING.sweetHigh ? (y - TUNING.sweetHigh) / 1.0 : 0;
  const runQ = Math.hypot(p.vx, p.vz) / p.speed;
  // 松手偏早比偏晚容易补救(球员可以等球),扣分也轻一些
  let skill = 0.85 * timingQ * (early ? 0.65 : 1) + 0.6 * posQ + 0.45 * clamp01(heightQ) + 0.4 * runQ;
  // 辅助自动出手稳定但不出彩:想要「完美」得自己掌握松手时机
  if (c.auto) skill = Math.max(skill, TUNING.autoSwingSkill);
  const forced = c.lunge || c.dive;
  const grade: Grade = forced ? 'poor' : skill < 0.12 ? 'perfect' : skill < 0.4 ? 'good' : skill < 0.7 ? 'ok' : 'poor';

  // 力度在最佳区以内几乎不增加失误;进入过力区后失误陡增(平击尤其明显)。体力不足也会增加失误
  const over = Math.max(0, power - TUNING.powerRisky) / (1 - TUNING.powerRisky);
  const risk = (0.06 * power + 0.42 * over) * shot.risk + (1 - p.stamina) * STAMINA.errorAtEmpty;
  let quality = clamp01(skill * 0.9 + risk);
  let speed = p.shotSpeed * shot.speed * (p.shot === 'lob' ? 0.9 + 0.1 * power : 0.55 + 0.45 * power);
  if (grade === 'perfect') {
    quality *= 0.5;
    speed *= 1.06;
  }
  if (forced) quality = Math.max(quality, c.dive ? 0.75 : 0.8);

  // 时机偏得多才会把球带偏:挥早了往身体对侧拉,挥晚了往持拍一侧飘
  const target = aimTarget(p);
  const pull = Math.sign(c.timing) * clamp01((timingQ - 0.35) / 0.65) * TUNING.timingPull;
  s.isServe = false;
  s.lastShot = p.shot;
  launch(
    s,
    i,
    { tx: target.x - p.side * p.dir * pull, tz: target.z, speed, spin: shot.spin, clearance: shot.clearance, quality },
    rng,
  );
  p.lunge = c.lunge;
  p.stamina = clamp01(p.stamina - STAMINA.hitCost - STAMINA.powerCost * power - (c.lunge ? STAMINA.lungeCost : 0));
  events.push({
    type: 'hit',
    player: i,
    shot: p.shot,
    grade,
    power,
    lunge: c.lunge,
    dive: c.dive,
    timing: c.timing,
    auto: c.auto === true,
  });
}

function endPoint(s: GameState, winner: PlayerId, reason: PointReason, events: GameEvent[]): void {
  events.push({ type: 'point', winner, reason });
  if (s.practice) {
    // 练习模式只报告这个球的结果,不计分,也不自动进入下一分
    s.faults = 0;
    s.phase = 'between';
    s.timer = Infinity;
    return;
  }
  const result = awardPoint(s.score, winner);
  if (result !== 'point') events.push({ type: result, winner });
  const bonus = STAMINA.pointRecover + (result === 'point' ? 0 : STAMINA.gameRecover);
  for (const p of s.players) p.stamina = clamp01(p.stamina + bonus);
  s.faults = 0;
  s.phase = 'between';
  s.timer = TUNING.pointPause;
}

function onBounce(s: GameState, events: GameEvent[]): void {
  const { x, z } = s.ball.pos;
  events.push({ type: 'bounce', x, z });
  if (s.phase !== 'rally' || s.lastHitter === null) return;
  const hitter = s.lastHitter;
  if (s.bounces >= 1) {
    // 发球落地两次都没被碰到就是 ACE
    endPoint(s, hitter, s.isServe ? 'ace' : 'winner', events);
    return;
  }
  if (isBounceIn(s, x, z)) {
    s.bounces = 1;
    return;
  }
  missed(s, z * s.players[hitter].dir >= 0, events);
}

/** 球没有落在有效区:发球算失误,相持中对方得分 */
function missed(s: GameState, ownSide: boolean, events: GameEvent[]): void {
  const opponent = (1 - s.lastHitter!) as PlayerId;
  if (s.isServe) {
    if (s.practice) {
      events.push({ type: 'fault' });
      s.phase = 'between';
      s.timer = Infinity;
      return;
    }
    s.faults++;
    if (s.faults >= 2) {
      endPoint(s, opponent, 'doubleFault', events);
    } else {
      events.push({ type: 'fault' });
      s.phase = 'between';
      s.timer = TUNING.faultPause;
    }
    return;
  }
  endPoint(s, opponent, ownSide ? 'net' : 'out', events);
}

/** 球打到围墙或看台:和真实规则一样,落地前碰到算出界;已经落在界内再碰到,这一分归击球方 */
function onWall(s: GameState, speed: number, events: GameEvent[]): void {
  const { x, z } = s.ball.pos;
  events.push({ type: 'wall', x, z, speed });
  if (s.phase !== 'rally' || s.lastHitter === null) return;
  if (s.bounces >= 1) endPoint(s, s.lastHitter, s.isServe ? 'ace' : 'winner', events);
  else missed(s, false, events);
}

// ---------------------------------------------------------------- 移动、冲刺、扑救

function moveFactor(p: Player): number {
  switch (p.stroke) {
    case 'none':
      return p.sprinting ? TUNING.sprintFactor : 1;
    case 'prep':
      return TUNING.prepMoveFactor;
    case 'swing':
      // 已经松手、还在等球到位时,继续小步调整站位
      return p.strokeT < 0 ? TUNING.prepMoveFactor : 0;
    case 'recover':
      return TUNING.recoverMoveFactor;
    default:
      return 0;
  }
}

function movePlayer(s: GameState, i: PlayerId, input: PlayerInput, dt: number): void {
  const p = s.players[i];
  if (p.stroke === 'dive') {
    // 腾空阶段保持起跳速度,落地后在地上滑行减速
    if (p.strokeT < TUNING.diveTime) {
      p.vx = p.diveVx;
      p.vz = p.diveVz;
    } else {
      const k = Math.min(1, 7 * dt);
      p.vx -= p.vx * k;
      p.vz -= p.vz * k;
    }
  } else {
    let mx = input.moveX;
    let mz = input.moveZ;
    if (p.stroke === 'prep' || p.stroke === 'swing') {
      // 引拍后不再听移动输入(方向键改为瞄准),球员自己小步调整到击球位置
      const stance = stanceFor(s, i);
      mx = 0;
      mz = 0;
      if (stance) {
        const dx = stance.x - p.x;
        const dz = stance.z - p.z;
        const scale = 1 / Math.max(Math.hypot(dx, dz), 0.35);
        mx = dx * scale;
        mz = dz * scale;
      }
    }
    const mag = Math.hypot(mx, mz);
    if (mag > 1) {
      mx /= mag;
      mz /= mag;
    }
    const tired = STAMINA.minSpeed + (1 - STAMINA.minSpeed) * p.stamina;
    const speed = p.speed * moveFactor(p) * tired;
    // 起步和变向需要时间:被调动到另一侧时来不及立刻全速
    const k = Math.min(1, 6 * dt);
    p.vx += (mx * speed - p.vx) * k;
    p.vz += (mz * speed - p.vz) * k;
  }
  p.x = clamp(p.x + p.vx * dt, -8.5, 8.5);
  p.z = clamp((p.z + p.vz * dt) * p.dir, 0.6, 16.5) * p.dir;
}

function startDive(s: GameState, i: PlayerId, tx: number, tz: number, events: GameEvent[]): void {
  const p = s.players[i];
  const dx = tx - p.x;
  const dz = tz - p.z;
  const d = Math.max(Math.hypot(dx, dz), 0.01);
  const speed = Math.max(1.6, Math.min(d, TUNING.diveRange)) / TUNING.diveTime;
  p.diveVx = (dx / d) * speed;
  p.diveVz = (dz / d) * speed;
  p.stroke = 'dive';
  p.strokeT = 0;
  p.impactDone = false;
  p.whiff = false;
  p.lunge = false;
  p.sprinting = false;
  p.shot = 'slice'; // 扑救只能勉强把球垫回去
  p.stamina = clamp01(p.stamina - STAMINA.diveCost);
  events.push({ type: 'dive', player: i });
}

/** 双击方向键:球马上要到、跑又跑不到时鱼跃扑救;否则开始冲刺 */
function handleDash(s: GameState, i: PlayerId, input: PlayerInput, events: GameEvent[]): void {
  const p = s.players[i];
  if (input.dash && (p.stroke === 'none' || p.stroke === 'prep')) {
    const stance = stanceFor(s, i);
    const eta = contactEta(s, i);
    const far = stance !== null && Math.hypot(stance.x - p.x, stance.z - p.z) > TUNING.diveMinDist;
    if (stance && far && eta !== null && eta > 0.04 && eta < TUNING.diveEta && p.stamina > 0.05) {
      startDive(s, i, stance.x, stance.z, events);
    } else if (p.stroke === 'none') {
      p.sprinting = true;
    }
  }
  // 松开方向键、开始击球或体力耗尽时结束冲刺
  if (p.sprinting && (p.stroke !== 'none' || Math.hypot(input.moveX, input.moveZ) < 0.3 || p.stamina <= 0.02)) {
    p.sprinting = false;
  }
}

function updateStamina(p: Player, dt: number): void {
  const v = Math.hypot(p.vx, p.vz) / p.speed;
  if (p.sprinting) p.stamina -= STAMINA.sprintDrain * dt;
  else if (v > 0.3) p.stamina -= STAMINA.runDrain * Math.min(1, v * v) * dt;
  else if (p.stroke === 'none') p.stamina += STAMINA.recover * dt;
  p.stamina = clamp01(p.stamina);
}

// ---------------------------------------------------------------- 挥拍

function updateAim(p: Player, input: PlayerInput, dt: number): void {
  p.aimX = clamp(p.aimX + input.aimX * TUNING.aimRate * dt, -1, 1);
  p.aimZ = clamp(p.aimZ + input.aimZ * TUNING.aimRate * dt, -1, 1);
}

function startRecover(p: Player, duration: number): void {
  p.stroke = 'recover';
  p.strokeT = 0;
  p.recoverT = duration;
}

function updateStroke(s: GameState, i: PlayerId, input: PlayerInput, dt: number): void {
  const p = s.players[i];
  switch (p.stroke) {
    case 'none': {
      // 刚才来不及挥拍时按下、现在还按着的击球键,也算数
      const buffered = p.buffer > 0 && input.hold;
      if ((input.swing || buffered) && p.cooldown <= 0) {
        const shot = input.swing ? input.shot : p.bufferShot;
        p.buffer = 0;
        p.stroke = 'prep';
        p.strokeT = 0;
        p.shot = shot;
        p.power = 0;
        p.aimX = 0;
        p.aimZ = 0;
        p.impactDone = false;
        p.whiff = false;
        p.lunge = false;
        p.auto = false;
        p.sprinting = false;
      }
      break;
    }
    case 'prep':
      p.strokeT += dt;
      updateAim(p, input, dt);
      if (input.hold && p.strokeT < TUNING.prepMax) {
        p.power = Math.min(1, p.power + dt / TUNING.chargeTime);
        // 击球辅助:一直按着,球到了该出手的时刻就自动挥拍
        if (p.assist) {
          const eta = contactEta(s, i);
          if (eta !== null && eta <= TUNING.impactT) {
            p.early = 0;
            p.auto = true;
            p.stroke = 'swing';
            p.strokeT = 0;
          }
        }
      } else {
        // 松开按键:挥拍。球拍要过 impactT 秒才到击球点。
        // 如果松早了(球还没到),球员拿着拍子等到合适的时刻再挥出去;strokeT 为负表示还在等
        const eta = contactEta(s, i);
        const lead = eta === null ? 0 : eta - TUNING.impactT;
        p.early = lead > 0 && lead <= TUNING.timingEarlyMax ? lead : 0;
        p.stroke = 'swing';
        p.strokeT = -p.early;
      }
      break;
    case 'swing':
      if (p.strokeT < 0) updateAim(p, input, dt);
      p.strokeT += dt;
      if (p.strokeT >= TUNING.swingDuration) {
        // 力度越大,收拍调整的时间越长;打空了还要更久
        const power = Math.max(TUNING.minPower, p.power);
        startRecover(p, TUNING.recoverBase + TUNING.recoverPower * power + (p.whiff ? TUNING.recoverWhiff : 0));
      }
      break;
    case 'serveSwing':
      p.strokeT += dt;
      if (p.strokeT >= TUNING.swingDuration) startRecover(p, 0.15);
      break;
    case 'dive':
      p.strokeT += dt;
      if (p.strokeT >= TUNING.diveDuration) startRecover(p, 0.25);
      break;
    case 'recover':
      p.strokeT += dt;
      if (p.strokeT >= p.recoverT) p.stroke = 'none';
      break;
    case 'toss':
      p.stroke = 'none';
      break;
  }
}

function updateServer(s: GameState, i: PlayerId, input: PlayerInput, dt: number, rng: Rng, ev: GameEvent[]): void {
  const p = s.players[i];
  p.vx = 0;
  p.vz = 0;
  p.sprinting = false;
  if (!s.tossing) {
    if (p.stroke !== 'none') updateStroke(s, i, NO_INPUT, dt);
    else if (input.swing && p.cooldown <= 0) toss(s, i, ev);
    return;
  }
  p.strokeT += dt;
  updateAim(p, input, dt);
  const y = s.ball.pos.y;
  if (input.swing && p.strokeT > 0.15 && y >= TUNING.serveMinHeight && y <= TUNING.serveMaxHeight) {
    serve(s, i, rng, ev);
  }
}

/** 球拍到达击球点的那一刻:球在不在、时机差多少,决定是击中、勉强够到还是打空 */
function resolveImpact(s: GameState, i: PlayerId, rng: Rng, ev: GameEvent[]): void {
  const p = s.players[i];
  p.impactDone = true;
  const miss = (): void => {
    p.whiff = true;
    if (s.phase === 'rally') ev.push({ type: 'whiff', player: i });
  };
  if (!canHit(s, i)) return miss();

  const b = s.ball;
  p.side = (b.pos.x - p.x) * p.dir >= 0 ? 1 : -1;
  const sweet = sweetPoint(p);
  const rx = b.pos.x - sweet.x;
  const rz = b.pos.z - sweet.z;
  const vh = Math.hypot(b.vel.x, b.vel.z);
  // 沿球路方向:along > 0 表示球已经飞过击球点(挥晚了)
  const along = vh > 0.5 ? (rx * b.vel.x + rz * b.vel.z) / vh : 0;
  const lateral = vh > 0.5 ? Math.hypot(rx - (along * b.vel.x) / vh, rz - (along * b.vel.z) / vh) : Math.hypot(rx, rz);
  const timing = vh > 0.5 ? -along / vh : 0;

  const heightOk = b.pos.y >= TUNING.minHitHeight && b.pos.y <= TUNING.maxHitHeight;
  // 球还差得远(松手早得离谱)或者已经飞过去太久,都是打空
  if (!heightOk || lateral > TUNING.lungeRadius || timing > 0.2 || timing < -TUNING.timingLateMax) {
    return miss();
  }
  // 评级用的时机:提前松手的按提前量算,否则按球拍到位时球的实际位置算
  const judged = p.early > 0 ? p.early : Math.min(timing, 0);
  hit(s, i, { lateral, timing: judged, lunge: lateral > TUNING.contactRadius, dive: false, auto: p.auto }, rng, ev);
}

/** 扑救腾空期间,球进入够得到的范围就把它垫回去 */
function resolveDive(s: GameState, i: PlayerId, rng: Rng, ev: GameEvent[]): void {
  const p = s.players[i];
  if (!canHit(s, i)) return;
  const b = s.ball.pos;
  p.side = (b.x - p.x) * p.dir >= 0 ? 1 : -1;
  const sweet = sweetPoint(p);
  const dist = Math.hypot(b.x - sweet.x, b.z - sweet.z);
  if (dist > TUNING.diveReach || b.y > 2.2) return;
  p.impactDone = true;
  hit(s, i, { lateral: dist, timing: 0, lunge: false, dive: true }, rng, ev);
}

// ---------------------------------------------------------------- 练习模式(新手教学)

export interface Feed {
  /** 球的出发点和第一落点 */
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  speed: number;
  spin?: number;
  shot?: ShotType;
}

/** 练习用的喂球:从 1 号球员那一侧打出一个落点确定、没有随机误差的球 */
export function feedBall(s: GameState, feed: Feed): void {
  const spin = feed.spin ?? 60;
  s.ball.pos = { x: feed.fromX, y: 1.0, z: feed.fromZ };
  s.ball.vel = solveShot(s.ball.pos, feed.toX, feed.toZ, feed.speed, spin, 0.5);
  s.ball.spin = spin;
  s.phase = 'rally';
  s.tossing = false;
  s.lastHitter = 1;
  s.bounces = 0;
  s.isServe = false;
  s.sinceHit = 0;
  s.hitSeq++;
  s.lastShot = feed.shot ?? 'flat';
  s.prediction = predict(s.ball);
  s.prediction.in = isBounceIn(s, s.prediction.x, s.prediction.z);
  // 让喂球的人做一个挥拍动作
  const feeder = s.players[1];
  Object.assign(feeder, { stroke: 'swing' as Stroke, strokeT: TUNING.impactT, impactDone: true, whiff: false, lunge: false, side: 1, power: 0.5 });
}

/** 练习发球:让指定球员站到发球位置,准备抛球 */
export function beginServe(s: GameState, server: PlayerId): void {
  s.score.server = server;
  s.faults = 0;
  setupPoint(s);
}

/** 推进一个固定步长。只依赖输入和 rng,不涉及渲染。 */
export function step(s: GameState, inputs: [PlayerInput, PlayerInput], dt: number, rng: Rng): GameEvent[] {
  const events: GameEvent[] = [];
  if (s.phase === 'over') return events;

  for (const i of [0, 1] as PlayerId[]) {
    const p = s.players[i];
    p.cooldown = Math.max(0, p.cooldown - dt);
    if (s.phase === 'serve' && s.score.server === i) {
      updateServer(s, i, inputs[i], dt, rng, events);
    } else {
      // 还在挥拍或调整姿势时按下的击球键先记着,等能挥了再用
      p.buffer = Math.max(0, p.buffer - dt);
      if (inputs[i].swing && p.stroke !== 'none') {
        p.buffer = TUNING.swingBuffer;
        p.bufferShot = inputs[i].shot;
      }
      handleDash(s, i, inputs[i], events);
      movePlayer(s, i, inputs[i], dt);
      updateStroke(s, i, inputs[i], dt);
    }
    updateStamina(p, dt);
  }

  if (s.phase === 'serve') {
    if (s.tossing) {
      stepBall(s.ball, dt);
      // 没有击球,让球落下后重新抛
      if (s.ball.vel.y < 0 && s.ball.pos.y < 1.2) {
        const server = s.players[s.score.server];
        s.tossing = false;
        server.stroke = 'none';
        server.cooldown = 0.3;
        holdBall(s);
      }
    } else {
      holdBall(s);
    }
    return events;
  }

  const { x: vx, y: vy, z: vz } = s.ball.vel;
  const flags = stepBall(s.ball, dt);
  s.sinceHit += dt;
  if (flags & NET) events.push({ type: 'net' });
  if (flags & WALL) onWall(s, Math.hypot(vx, vy, vz), events);
  if (flags & BOUNCE) onBounce(s, events);

  // 挥拍和扑救的击球判定(一分结束后的空挥也会判定为打空)
  for (const i of [0, 1] as PlayerId[]) {
    const p = s.players[i];
    if (p.impactDone) continue;
    if (p.stroke === 'swing' && p.strokeT >= TUNING.impactT) resolveImpact(s, i, rng, events);
    else if (p.stroke === 'dive' && p.strokeT <= TUNING.diveTime + 0.12) resolveDive(s, i, rng, events);
  }

  if (s.phase === 'rally') {
    // 兜底:球停在场上迟迟没有结果时强制结算
    if (s.sinceHit > TUNING.rallyTimeout && s.lastHitter !== null) {
      const hitter = s.lastHitter;
      if (s.bounces >= 1) endPoint(s, hitter, s.isServe ? 'ace' : 'winner', events);
      else endPoint(s, (1 - hitter) as PlayerId, 'net', events);
    }
  } else if (s.phase === 'between') {
    s.timer -= dt;
    if (s.timer <= 0) {
      if (s.score.winner !== null) s.phase = 'over';
      else setupPoint(s);
    }
  }
  return events;
}
