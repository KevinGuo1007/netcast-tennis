import { describe, expect, it } from 'vitest';
import { AI_LEVELS, AiController } from '../src/sim/ai';
import { arenaHeight, Ball, BOUNCE, predict, solveShot, stepBall, WALL } from '../src/sim/ball';
import { ARENA, COURT, DT, HUMAN, TUNING } from '../src/sim/constants';
import {
  aimTarget,
  contactEta,
  feedBall,
  GameEvent,
  GameState,
  newGame,
  NO_INPUT,
  PlayerInput,
  stanceFor,
  step,
} from '../src/sim/game';
import { makeRng } from '../src/sim/rng';
import { awardPoint, newScore, pointLabels } from '../src/sim/score';

describe('计分', () => {
  it('连得四分赢下一局并换发球', () => {
    const s = newScore(0);
    expect(awardPoint(s, 0)).toBe('point');
    expect(pointLabels(s)).toEqual(['15', '0']);
    awardPoint(s, 0);
    awardPoint(s, 0);
    expect(pointLabels(s)).toEqual(['40', '0']);
    expect(awardPoint(s, 0)).toBe('game');
    expect(s.games).toEqual([1, 0]);
    expect(s.server).toBe(1);
  });

  it('平分后需要连得两分', () => {
    const s = newScore(0);
    for (let i = 0; i < 3; i++) {
      awardPoint(s, 0);
      awardPoint(s, 1);
    }
    expect(pointLabels(s)).toEqual(['40', '40']);
    expect(awardPoint(s, 1)).toBe('point');
    expect(pointLabels(s)).toEqual(['', 'AD']);
    awardPoint(s, 0);
    expect(pointLabels(s)).toEqual(['40', '40']);
    awardPoint(s, 0);
    expect(awardPoint(s, 0)).toBe('game');
  });

  it('先赢三局者赢得比赛', () => {
    const s = newScore(0);
    let last = '';
    for (let i = 0; i < 12; i++) last = awardPoint(s, 1);
    expect(last).toBe('match');
    expect(s.winner).toBe(1);
  });
});

describe('球的物理', () => {
  it('solveShot 的落点准确且能过网', () => {
    const from = { x: 2, y: 0.9, z: 11 };
    for (const [tx, tz] of [
      [-3, -10.3],
      [3, -5],
      [0, -8],
    ]) {
      const spin = tx > 0 ? 320 : tx < 0 ? -160 : 0;
      const ball = { pos: { ...from }, vel: solveShot(from, tx, tz, 25, spin), spin };
      let hitNet = false;
      for (let i = 0; i < 2000; i++) {
        const flags = stepBall(ball, DT);
        if (flags & 2) hitNet = true;
        if (flags & BOUNCE) break;
      }
      expect(hitNet).toBe(false);
      expect(Math.hypot(ball.pos.x - tx, ball.pos.z - tz)).toBeLessThan(0.3);
    }
  });

  it('上旋球比平击球下坠更快', () => {
    const fly = (spin: number): number => {
      const ball = { pos: { x: 0, y: 1, z: 11 }, vel: { x: 0, y: 4, z: -22 }, spin };
      for (let i = 0; i < 2000; i++) if (stepBall(ball, DT) & BOUNCE) break;
      return 11 - ball.pos.z;
    };
    expect(fly(320)).toBeLessThan(fly(0) - 2);
    expect(fly(-160)).toBeGreaterThan(fly(0) + 1);
  });

  it('低平球会被球网拦下', () => {
    const ball = { pos: { x: 0, y: 0.5, z: 3 }, vel: { x: 0, y: 0, z: -20 }, spin: 0 };
    let hitNet = false;
    for (let i = 0; i < 240; i++) if (stepBall(ball, DT) & 2) hitNet = true;
    expect(hitNet).toBe(true);
    expect(ball.pos.z).toBeGreaterThan(0);
    expect(COURT.netHeight).toBeGreaterThan(0.5);
  });
});

function playMatch(seed: number) {
  const rng = makeRng(seed);
  const state = newGame(AI_LEVELS.normal, AI_LEVELS.normal);
  const ais = [new AiController(0, AI_LEVELS.normal, rng), new AiController(1, AI_LEVELS.normal, rng)];
  const events: GameEvent[] = [];
  let steps = 0;
  while (state.phase !== 'over' && steps < 120 * 60 * 30) {
    events.push(...step(state, [ais[0].update(state, DT), ais[1].update(state, DT)], DT, rng));
    steps++;
  }
  return { state, events, steps };
}

describe('围墙和看台', () => {
  /** 一直模拟到球停下来,检查它从头到尾都没有钻进墙或看台里 */
  const fly = (b: Ball, seconds = 6): { walls: number; bounces: number; deepest: number } => {
    let walls = 0;
    let bounces = 0;
    let deepest = 0;
    for (let i = 0; i < seconds / DT; i++) {
      const flags = stepBall(b, DT);
      if (flags & WALL) walls++;
      if (flags & BOUNCE) bounces++;
      deepest = Math.max(deepest, arenaHeight(b.pos.x, b.pos.z) - b.pos.y);
    }
    return { walls, bounces, deepest };
  };

  it('打在远端的广告牌上会弹回来,不会穿过去', () => {
    const b: Ball = { pos: { x: 0, y: 1, z: 8 }, vel: { x: 2, y: 9, z: -34 }, spin: 0 };
    const r = fly(b);
    expect(r.walls).toBeGreaterThan(0);
    expect(r.deepest).toBeLessThanOrEqual(0);
    expect(b.pos.z).toBeGreaterThan(-ARENA.backZ);
    expect(Math.abs(b.pos.z)).toBeLessThan(ARENA.backZ);
  });

  it('两侧的矮墙和近端的墙也一样', () => {
    for (const vel of [
      { x: 20, y: 2, z: -6 },
      { x: -20, y: 2, z: -6 },
      { x: 1, y: 3, z: 22 },
    ]) {
      const b: Ball = { pos: { x: 0, y: 0.6, z: 6 }, vel, spin: 0 };
      const r = fly(b);
      expect(r.walls).toBeGreaterThan(0);
      expect(r.deepest).toBeLessThanOrEqual(0);
      expect(Math.abs(b.pos.x)).toBeLessThan(ARENA.sideX);
      expect(Math.abs(b.pos.z)).toBeLessThan(ARENA.backZ);
    }
  });

  it('飞过墙头的球落进看台,留在观众席里', () => {
    const b: Ball = { pos: { x: 0, y: 1, z: 8 }, vel: { x: 0, y: 12, z: -34 }, spin: 0 };
    const r = fly(b, 8);
    expect(r.deepest).toBeLessThanOrEqual(0);
    expect(b.pos.z).toBeLessThan(-ARENA.backZ - ARENA.thickness);
    expect(b.pos.y).toBeGreaterThan(ARENA.standBase);
    expect(Math.hypot(b.vel.x, b.vel.y, b.vel.z)).toBeLessThan(0.5);
  });

  it('各种角度乱打都不会穿模', () => {
    const rng = makeRng(7);
    for (let n = 0; n < 300; n++) {
      const a = rng() * Math.PI * 2;
      const speed = 8 + rng() * 40;
      const b: Ball = {
        pos: { x: (rng() - 0.5) * 16, y: 0.3 + rng() * 2, z: (rng() - 0.5) * 30 },
        vel: { x: Math.cos(a) * speed, y: -4 + rng() * 22, z: Math.sin(a) * speed },
        spin: (rng() - 0.5) * 500,
      };
      expect(fly(b, 5).deepest).toBeLessThanOrEqual(1e-6);
    }
  });

  /** 近端球员(0 号)从底线附近把球打向远端,没有人去接 */
  const rally = (launch: (s: GameState) => void): GameEvent[] => {
    const s = newGame(HUMAN, HUMAN, 0);
    feedBall(s, { fromX: 0, fromZ: 8, toX: 0, toZ: -8, speed: 20 });
    s.lastHitter = 0;
    launch(s);
    s.prediction = predict(s.ball);
    const rng = makeRng(1);
    const events: GameEvent[] = [];
    for (let i = 0; i < 4 / DT && s.phase === 'rally'; i++) events.push(...step(s, [NO_INPUT, NO_INPUT], DT, rng));
    return events;
  };

  it('没落地就打到墙上:算出界,对方得分', () => {
    const events = rally((s) => (s.ball.vel = { x: 0, y: 6, z: -36 }));
    expect(events.map((e) => e.type)).toEqual(['wall', 'point']);
    expect(events[1]).toMatchObject({ winner: 1, reason: 'out' });
  });

  it('先落在界内再弹到墙上:这一分归击球方', () => {
    const events = rally((s) => (s.ball.vel = solveShot(s.ball.pos, 0, -11.4, 36, 0)));
    expect(events.map((e) => e.type)).toEqual(['bounce', 'wall', 'point']);
    expect(events[2]).toMatchObject({ winner: 0, reason: 'winner' });
  });

  it('会撞墙的球,落点预测判为界外', () => {
    const b: Ball = { pos: { x: 0, y: 1, z: 8 }, vel: { x: 0, y: 6, z: -36 }, spin: 0 };
    const p = predict(b);
    expect(p.z).toBeLessThan(-COURT.halfLength);
    expect(p.z).toBeGreaterThan(-ARENA.backZ);
  });
});

describe('对局', () => {
  it('AI 对 AI 能打完一整场,并且有来回', () => {
    const { state, events } = playMatch(7);
    expect(state.phase).toBe('over');
    expect(state.score.winner).not.toBeNull();
    const hits = events.filter((e) => e.type === 'hit').length;
    expect(events.some((e) => e.type === 'toss')).toBe(true);
    expect(events.some((e) => e.type === 'serve')).toBe(true);
    const points = events.filter((e) => e.type === 'point').length;
    expect(points).toBeGreaterThanOrEqual(12);
    // 平均每分至少有一次回球,说明 AI 确实接得到球
    expect(hits / points).toBeGreaterThan(1);
  });

  it('相同种子的结果完全一致', () => {
    const a = playMatch(42);
    const b = playMatch(42);
    expect(a.steps).toBe(b.steps);
    expect(a.state.score).toEqual(b.state.score);
  });
});

/** 搭一个来球的局面:球从对面飞过来,0 号球员站在离理想站位 offset 米的地方 */
function incoming(offset: number): GameState {
  const s = newGame(HUMAN, HUMAN, 1);
  s.phase = 'rally';
  s.lastHitter = 1;
  s.isServe = false;
  s.bounces = 0;
  s.ball = { pos: { x: 0.75, y: 1.2, z: -6 }, vel: { x: 0, y: 3.2, z: 17 }, spin: 0 };
  s.prediction = { ...predict(s.ball), in: true };
  const p = s.players[0];
  p.cooldown = 0;
  p.x = 0;
  p.z = 12;
  const stance = stanceFor(s, 0)!;
  p.x = stance.x - offset;
  p.z = stance.z;
  return s;
}

interface Plan {
  /** 按住多久再松开(秒) */
  hold?: number;
  /** 球还差多少秒到位时松开;默认刚好是球拍挥到击球点所需的时间 */
  release?: number;
  /** 球还差多少秒到位时双击方向键 */
  dashAt?: number;
  /** 球还差多少秒到位时才按下击球键;默认按 release + hold 提前按 */
  pressAt?: number;
  input?: Partial<PlayerInput>;
}

/** 按计划操作 0 号球员,一直模拟到球被打回或这一分结束 */
function play(s: GameState, plan: Plan = {}) {
  const rng = makeRng(3);
  const events: GameEvent[] = [];
  const release = plan.release ?? TUNING.impactT;
  const hold = plan.hold ?? 0.5;
  let pressed = false;
  let dashed = false;
  for (let i = 0; i < 600 && s.lastHitter === 1 && s.phase === 'rally'; i++) {
    const eta = contactEta(s, 0) ?? -1;
    const press = !pressed && plan.dashAt === undefined && eta <= (plan.pressAt ?? release + hold);
    if (press) pressed = true;
    const dash = !dashed && plan.dashAt !== undefined && eta <= plan.dashAt;
    if (dash) dashed = true;
    const mine: PlayerInput = { ...NO_INPUT, ...plan.input, swing: press, hold: pressed && eta > release, dash };
    events.push(...step(s, [mine, NO_INPUT], DT, rng));
    if (events.some((e) => e.type === 'whiff')) break; // 打空之后的事不用再模拟
  }
  const hit = events.find((e) => e.type === 'hit');
  return {
    events,
    hit: hit && hit.type === 'hit' ? hit : undefined,
    whiff: events.some((e) => e.type === 'whiff'),
    speed: Math.hypot(s.ball.vel.x, s.ball.vel.z),
  };
}

/** 继续空转,直到 0 号球员回到待机状态,返回花了多少秒 */
function timeToReady(s: GameState): number {
  const rng = makeRng(5);
  let t = 0;
  while (s.players[0].stroke !== 'none' && t < 5) {
    step(s, [NO_INPUT, NO_INPUT], DT, rng);
    t += DT;
  }
  return t;
}

describe('挥拍时机', () => {
  it('在球到位的那一刻挥到击球点:完美击球', () => {
    const r = play(incoming(0));
    expect(r.hit).toMatchObject({ grade: 'perfect', lunge: false, dive: false });
    expect(Math.abs(r.hit!.timing)).toBeLessThan(TUNING.timingLatePerfect);
  });

  it('按住越久力度越大,球速越快', () => {
    const soft = play(incoming(0), { hold: 0.05 });
    const hard = play(incoming(0), { hold: 0.9 });
    expect(soft.hit && hard.hit).toBeTruthy();
    expect(hard.speed).toBeGreaterThan(soft.speed * 1.3);
    expect(hard.hit!.power).toBeGreaterThan(TUNING.powerRisky);
  });

  it('松手稍早:球员会等球到位再挥,照样是完美击球', () => {
    const r = play(incoming(0), { release: TUNING.impactT + 0.08 });
    expect(r.whiff).toBe(false);
    expect(r.hit).toMatchObject({ grade: 'perfect' });
  });

  it('松手早得多:仍然能打到,但评级下降、球被带偏', () => {
    // 关掉随机误差,只比较时机造成的偏移
    const onTime = incoming(0);
    onTime.players[0].errMul = 0;
    play(onTime);
    const s = incoming(0);
    s.players[0].errMul = 0;
    const r = play(s, { release: TUNING.impactT + 0.36 });
    expect(r.whiff).toBe(false);
    expect(r.hit).toBeDefined();
    expect(r.hit!.timing).toBeGreaterThan(0.3);
    expect(['ok', 'poor']).toContain(r.hit!.grade);
    // 正手挥早了,球比准时挥拍时更偏向身体左侧
    expect(s.prediction!.x).toBeLessThan(onTime.prediction!.x - 0.4);
  });

  it('松手稍晚也能打到,只是评级下降', () => {
    const r = play(incoming(0), { release: TUNING.impactT - 0.12 });
    expect(r.whiff).toBe(false);
    expect(r.hit).toBeDefined();
    expect(r.hit!.timing).toBeLessThan(-0.08);
    expect(r.hit!.grade).not.toBe('perfect');
  });

  it('早得离谱或者晚了太多才会打空', () => {
    const early = play(incoming(0), { release: TUNING.impactT + TUNING.timingEarlyMax + 0.15 });
    expect(early.hit).toBeUndefined();
    expect(early.whiff).toBe(true);
    const late = play(incoming(0), { release: TUNING.impactT - TUNING.timingLateMax - 0.1 });
    expect(late.hit).toBeUndefined();
    expect(late.whiff).toBe(true);
  });

  it('一直按着不松手就不会挥拍,球会飞过去', () => {
    const r = play(incoming(0), { pressAt: 0.6, release: -10 });
    expect(r.hit).toBeUndefined();
  });

  it('挥拍后要调整姿势才能再次挥拍:力度越大越久,打空了更久', () => {
    const light = incoming(0);
    play(light, { hold: 0.05 });
    const heavy = incoming(0);
    play(heavy, { hold: 0.9 });
    const missed = incoming(0);
    play(missed, { hold: 0.9, release: TUNING.impactT + TUNING.timingEarlyMax + 0.15 });
    const tLight = timeToReady(light);
    const tHeavy = timeToReady(heavy);
    const tMissed = timeToReady(missed);
    expect(tHeavy).toBeGreaterThan(tLight + 0.2);
    expect(tMissed).toBeGreaterThan(tHeavy + 0.15);
  });

  it('调整姿势期间按击球键没有反应', () => {
    const s = incoming(0);
    play(s);
    const rng = makeRng(9);
    while (s.players[0].stroke !== 'recover') step(s, [NO_INPUT, NO_INPUT], DT, rng);
    step(s, [{ ...NO_INPUT, swing: true, hold: true }, NO_INPUT], DT, rng);
    expect(s.players[0].stroke).toBe('recover');
  });

  it('引拍后球员自动就位,移动输入只移动瞄准点', () => {
    const s = incoming(1.2);
    const x0 = s.players[0].x;
    const r = play(s, { hold: 1.15, input: { moveX: -1, aimX: 1, aimZ: 1 } });
    expect(r.hit).toMatchObject({ lunge: false });
    expect(s.players[0].x).toBeGreaterThan(x0 + 0.8); // 朝站位走,而不是按输入往左跑
    const t = aimTarget(s.players[0]);
    expect(t.x).toBeCloseTo(TUNING.aimWidth, 1);
    expect(t.z).toBeCloseTo(-TUNING.depthFar, 1);
  });
});

describe('击球辅助', () => {
  it('开着辅助时一直按住不松手:球到位自动挥拍,评级是「不错」而不是「完美」', () => {
    const s = incoming(0);
    s.players[0].assist = true;
    const r = play(s, { pressAt: 0.6, release: -10 });
    expect(r.whiff).toBe(false);
    expect(r.hit).toMatchObject({ auto: true, grade: 'good' });
  });

  it('开着辅助也可以自己掌握时机松手,拿到「完美」', () => {
    const s = incoming(0);
    s.players[0].assist = true;
    const r = play(s, { hold: 0.5, release: TUNING.impactT + 0.05 });
    expect(r.hit).toMatchObject({ auto: false, grade: 'perfect' });
  });

  it('辅助不是万能的:球都过去了才按,还是会打空', () => {
    const s = incoming(0);
    s.players[0].assist = true;
    const r = play(s, { release: -10, pressAt: TUNING.impactT - TUNING.timingLateMax - 0.12 });
    expect(r.hit).toBeUndefined();
    expect(r.whiff).toBe(true);
  });

  it('关着辅助时一直按住不会自动挥拍', () => {
    const r = play(incoming(0), { pressAt: 0.6, release: -10 });
    expect(r.hit).toBeUndefined();
  });

  it('调整姿势时提前按住击球键,调整一结束就开始引拍', () => {
    const s = incoming(0);
    play(s);
    const rng = makeRng(9);
    const p = s.players[0];
    while (p.stroke !== 'recover') step(s, [NO_INPUT, NO_INPUT], DT, rng);
    // 调整期间按下并一直按着
    step(s, [{ ...NO_INPUT, swing: true, hold: true }, NO_INPUT], DT, rng);
    expect(p.stroke).toBe('recover');
    for (let i = 0; i < 120 && p.stroke === 'recover'; i++) step(s, [{ ...NO_INPUT, hold: true }, NO_INPUT], DT, rng);
    step(s, [{ ...NO_INPUT, hold: true }, NO_INPUT], DT, rng);
    expect(p.stroke).toBe('prep');
  });
});

describe('冲刺和扑救', () => {
  it('双击方向键后冲刺:比普通跑动快,体力消耗也更大', () => {
    const run = (dash: boolean) => {
      const s = newGame(HUMAN, HUMAN, 1);
      s.phase = 'between';
      s.timer = 1e9;
      const rng = makeRng(1);
      const p = s.players[0];
      p.x = -6;
      for (let i = 0; i < 120; i++) step(s, [{ ...NO_INPUT, moveX: 1, dash: dash && i === 0 }, NO_INPUT], DT, rng);
      return { x: p.x, stamina: p.stamina, sprinting: p.sprinting };
    };
    const normal = run(false);
    const sprint = run(true);
    expect(sprint.sprinting).toBe(true);
    expect(sprint.x).toBeGreaterThan(normal.x + 2);
    expect(sprint.stamina).toBeLessThan(normal.stamina - 0.05);
  });

  it('松开方向键后冲刺结束', () => {
    const s = newGame(HUMAN, HUMAN, 1);
    s.phase = 'between';
    s.timer = 1e9;
    const rng = makeRng(1);
    step(s, [{ ...NO_INPUT, moveX: 1, dash: true }, NO_INPUT], DT, rng);
    expect(s.players[0].sprinting).toBe(true);
    step(s, [NO_INPUT, NO_INPUT], DT, rng);
    expect(s.players[0].sprinting).toBe(false);
  });

  it('球快到了又够不着时,双击方向键会鱼跃扑救把球垫回去', () => {
    const s = incoming(2.6);
    const before = s.players[0].stamina;
    const r = play(s, { dashAt: 0.4 });
    expect(r.events.some((e) => e.type === 'dive')).toBe(true);
    expect(r.hit).toMatchObject({ dive: true, grade: 'poor' });
    expect(s.players[0].stamina).toBeLessThan(before - 0.1);
    expect(s.players[0].stroke).toBe('dive');
  });

  it('离得太远扑救也够不到', () => {
    const r = play(incoming(7), { dashAt: 0.4 });
    expect(r.hit).toBeUndefined();
  });
});

describe('体力', () => {
  it('跑动消耗体力,站定恢复,体力低时跑得慢', () => {
    const s = newGame(HUMAN, HUMAN, 1);
    s.phase = 'between';
    s.timer = 1e9;
    const rng = makeRng(1);
    const run: PlayerInput = { ...NO_INPUT, moveX: 1 };
    const p = s.players[0];
    for (let i = 0; i < 120 * 6; i++) {
      p.x = 0;
      step(s, [run, NO_INPUT], DT, rng);
    }
    const tired = p.stamina;
    expect(tired).toBeLessThan(0.85);
    const fastSpeed = Math.abs(p.vx);
    for (let i = 0; i < 120; i++) {
      p.x = 0;
      p.stamina = 0;
      step(s, [run, NO_INPUT], DT, rng);
    }
    expect(Math.abs(p.vx)).toBeLessThan(fastSpeed * 0.85);
    p.stamina = tired;
    for (let i = 0; i < 120 * 4; i++) step(s, [NO_INPUT, NO_INPUT], DT, rng);
    expect(p.stamina).toBeGreaterThan(tired + 0.1);
  });
});
