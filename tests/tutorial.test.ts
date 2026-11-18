import { describe, expect, it } from 'vitest';
import { DT, HUMAN, ShotType, TUNING } from '../src/sim/constants';
import { contactEta, GameEvent, newGame, NO_INPUT, PlayerInput, stanceFor, step } from '../src/sim/game';
import { makeRng } from '../src/sim/rng';
import { Tutorial } from '../src/tutorial';

/**
 * 一个按教学说明操作的"学员":每一课照着要求做。
 * 用它把整个教学从头跑到尾,确认每一课都能过关、过关条件判定正确。
 */
function runTutorial(maxSeconds: number) {
  const rng = makeRng(11);
  const s = newGame(HUMAN, HUMAN, 0);
  const t = new Tutorial(s, (k) => k, (k) => k, false);
  const me = s.players[0];
  const visited: string[] = [];
  let pressed = false;
  let dashed = false;
  let lastHitSeq = -1;
  let shotIndex = 0;
  const shots: ShotType[] = ['top', 'slice', 'lob'];

  for (let n = 0; n < maxSeconds / DT && !t.finished; n++) {
    const id = t.lesson.id;
    if (visited[visited.length - 1] !== id) visited.push(id);
    const input: PlayerInput = { ...NO_INPUT };
    const eta = contactEta(s, 0);
    if (s.hitSeq !== lastHitSeq) {
      lastHitSeq = s.hitSeq;
      pressed = false;
      dashed = false;
    }

    if (id === 'move' && t.goal) {
      input.moveX = Math.sign(t.goal.x - me.x);
      input.moveZ = Math.sign(t.goal.z - me.z);
    } else if (id === 'serve') {
      if (s.phase === 'serve' && me.cooldown <= 0) {
        if (!s.tossing) input.swing = me.stroke === 'none';
        else input.swing = s.ball.vel.y <= 0.3;
      }
    } else if (eta !== null && s.lastHitter === 1) {
      const stance = stanceFor(s, 0)!;
      const toward = Math.sign(stance.x - me.x);
      if (id === 'dive') {
        // 站着不动,球快到时朝球的方向双击
        if (!dashed && eta < 0.45 && me.stroke === 'none') {
          input.dash = true;
          input.moveX = toward;
          dashed = true;
        }
      } else {
        if (id === 'sprint' && me.stroke === 'none' && Math.abs(stance.x - me.x) > 1.5) {
          input.moveX = toward;
          input.dash = !dashed;
          dashed = true;
        }
        // 按住约半秒,在最佳时刻松手
        const hold = 0.5;
        if (!pressed && me.stroke === 'none' && eta <= TUNING.impactT + hold && eta > 0 && Math.abs(stance.x - me.x) < 1.5) {
          pressed = true;
          input.swing = true;
          input.shot = id === 'shots' ? shots[shotIndex++ % shots.length] : 'flat';
          input.moveX = 0;
          input.dash = false;
        }
        input.hold = pressed && eta > TUNING.impactT;
        if (id === 'aim' && t.goal) {
          input.aimX = Math.sign(t.goal.x);
        }
      }
    }

    const events: GameEvent[] = step(s, [input, NO_INPUT], DT, rng);
    t.update(DT, events);
  }
  return { t, visited };
}

describe('新手教学', () => {
  it('照着说明操作可以把八课全部学完', () => {
    const { t, visited } = runTutorial(600);
    expect(visited).toEqual(['move', 'timing', 'power', 'aim', 'shots', 'sprint', 'dive', 'serve']);
    expect(t.finished).toBe(true);
  });

  it('什么都不做不会过关,并且会给出提示', () => {
    const rng = makeRng(2);
    const s = newGame(HUMAN, HUMAN, 0);
    const t = new Tutorial(s, (k) => k, (k) => k, false);
    t.skip(); // 跳过移动课,进入击球时机课
    for (let n = 0; n < 20 / DT; n++) t.update(DT, step(s, [NO_INPUT, NO_INPUT], DT, rng));
    expect(t.lesson.id).toBe('timing');
    expect(t.count).toBe(0);
    expect(t.kind).toBe('bad');
    expect(t.feedback).toContain('球过去了');
    // 教学不计分
    expect(s.score.points).toEqual([0, 0]);
    expect(s.score.games).toEqual([0, 0]);
  });

  it('每一课都可以跳过,跳完最后一课教学结束', () => {
    const s = newGame(HUMAN, HUMAN, 0);
    const t = new Tutorial(s, (k) => k, (k) => k, false);
    for (let i = 0; i < t.lessons.length; i++) t.skip();
    expect(t.finished).toBe(true);
  });
});
