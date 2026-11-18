import { ShotType, TUNING } from './constants';
import { contactEta, GameState, PlayerInput, PlayerStats, stanceFor } from './game';
import { gaussian, Rng } from './rng';
import { PlayerId } from './score';

export interface AiConfig extends PlayerStats {
  /** 对方击球后多久才开始移动(秒) */
  reaction: number;
  /** 打向边角、用大力的倾向 0..1 */
  aggression: number;
  /** 站位的偏差(米):越大越难站到最佳击球点 */
  footwork: number;
  /** 挥拍时机的偏差(秒):越大越容易挥早挥晚,甚至打空 */
  timing: number;
  /** 够不着时会不会冲刺和扑救 0..1 */
  hustle: number;
}

export const AI_LEVELS: Record<'easy' | 'normal' | 'hard', AiConfig> = {
  easy: {
    speed: 4.2,
    shotSpeed: 20,
    serveSpeed: 26,
    errMul: 2.0,
    reaction: 0.45,
    aggression: 0.3,
    footwork: 0.7,
    timing: 0.16,
    hustle: 0.25,
  },
  normal: {
    speed: 5.2,
    shotSpeed: 24,
    serveSpeed: 32,
    errMul: 1.15,
    reaction: 0.36,
    aggression: 0.6,
    footwork: 0.45,
    timing: 0.11,
    hustle: 0.6,
  },
  hard: {
    speed: 6.2,
    shotSpeed: 30,
    serveSpeed: 42,
    errMul: 0.8,
    reaction: 0.24,
    aggression: 0.85,
    footwork: 0.25,
    timing: 0.06,
    hustle: 0.9,
  },
};

const stick = (target: number, current: number): number => Math.max(-1, Math.min(1, (target - current) * 8));

/** AI 和真人一样只产出 PlayerInput(按住蓄力、松开挥拍、推瞄准摇杆、双击冲刺),因此可以控制任意一方。 */
export class AiController {
  private seenHit = -1;
  private reaction = 0;
  private serveWait = 0;
  private serveVy = 0;
  private aimX = 0;
  private aimZ = 0;
  private power = 0.7;
  private offX = 0;
  private offZ = 0;
  private timingError = 0;
  private willHustle = false;
  private dashed = false;
  private shot: ShotType = 'top';

  constructor(
    private readonly id: PlayerId,
    private readonly cfg: AiConfig,
    private readonly rng: Rng,
  ) {}

  update(s: GameState, dt: number): PlayerInput {
    const me = s.players[this.id];
    const input: PlayerInput = {
      moveX: 0,
      moveZ: 0,
      swing: false,
      hold: false,
      shot: this.shot,
      aimX: stick(this.aimX, me.aimX),
      aimZ: stick(this.aimZ, me.aimZ),
      dash: false,
    };

    if (s.phase === 'serve') {
      if (s.score.server !== this.id) return input;
      if (!s.tossing) {
        this.serveWait += dt;
        if (this.serveWait > 1.2) {
          input.swing = true;
          // 抛球后在球的竖直速度降到这个值时击球;偏离 0 越多,离最高点越远
          this.serveVy = (this.rng() - 0.5) * 2.2 * this.cfg.errMul;
          this.aimX = (this.rng() - 0.5) * 2;
          this.aimZ = 0;
        }
      } else if (s.ball.vel.y <= this.serveVy) {
        input.swing = true;
      }
      return input;
    }
    this.serveWait = 0;

    let tx = 0;
    let tz = me.dir * 12.3;
    const incoming = s.phase === 'rally' && s.lastHitter !== this.id && s.prediction !== null;

    if (incoming) {
      const pred = s.prediction!;
      if (this.seenHit !== s.hitSeq) {
        this.seenHit = s.hitSeq;
        // 接发球有心理准备,反应比相持中快
        this.reaction = this.cfg.reaction * (s.isServe ? 0.5 : 1);
        this.plan(s);
      }
      this.reaction -= dt;
      if (this.reaction > 0) return input;
      // 判断会出界的球就放掉
      if (!pred.in && s.bounces === 0) return input;

      // 先自己跑到击球站位附近(带一点站位偏差),引拍后球员会完成最后的就位
      const stance = stanceFor(s, this.id);
      const eta = contactEta(s, this.id);
      if (stance && eta !== null) {
        tx = stance.x + this.offX;
        tz = stance.z + this.offZ;
        const toSpot = Math.hypot(stance.x - me.x, stance.z - me.z);

        if (me.stroke === 'prep') {
          // 按住蓄力,到了该出手的时刻(带时机偏差)松开
          input.hold = eta > TUNING.impactT + this.timingError;
        } else if (me.stroke === 'none') {
          // 算好提前量再按下,这样松开时刚好蓄到想要的力度
          const lead = TUNING.impactT + this.power * TUNING.chargeTime + 0.03;
          const stepReach = me.speed * TUNING.prepMoveFactor * Math.max(0, eta - TUNING.impactT);
          const comfortable = eta <= lead && toSpot < 0.6 + stepReach;
          // 来不及站好位:最后一刻也要伸手去够
          const lastChance = eta <= TUNING.impactT + 0.18 && toSpot < TUNING.lungeRadius;
          if (eta > 0 && (comfortable || lastChance)) {
            input.swing = true;
            input.hold = true;
          } else if (this.willHustle && !this.dashed) {
            // 够不着:离得远就冲刺,球快到了就扑救
            const cannotRun = toSpot > me.speed * Math.max(0, eta - 0.1) + 0.6;
            if ((eta < TUNING.diveEta * 0.85 && toSpot > TUNING.diveMinDist + 0.3 && cannotRun) || (toSpot > 3.2 && !me.sprinting)) {
              input.dash = true;
              this.dashed = eta < TUNING.diveEta;
            }
          }
        }
      }
    }

    const dx = tx - me.x;
    const dz = tz - me.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05) {
      const scale = 1 / Math.max(d, 0.5);
      input.moveX = dx * scale;
      input.moveZ = dz * scale;
    }
    return input;
  }

  /** 对每个新的来球决定:打哪里、用什么球种、多大力、出手时机偏多少 */
  private plan(s: GameState): void {
    const me = s.players[this.id];
    const opp = s.players[1 - this.id];
    const pred = s.prediction!;
    const { aggression, footwork } = this.cfg;

    // 优先打向对手不在的一侧
    if (this.rng() < aggression) this.aimX = (opp.x > 0 ? -1 : 1) * (0.72 + 0.28 * this.rng());
    else this.aimX = (this.rng() - 0.5) * 0.9;
    this.aimZ = this.rng() < 0.5 ? 0.3 + 0.7 * this.rng() : (this.rng() - 0.5) * 0.6;

    const stretched = Math.hypot(pred.ix - me.x, pred.iz - me.z) > 4.5;
    const oppAtNet = Math.abs(opp.z) < 5;
    if (oppAtNet && this.rng() < 0.6) this.shot = 'lob';
    else if (stretched) this.shot = 'slice';
    else this.shot = this.rng() < 0.55 ? 'top' : 'flat';

    // 大多数时候把力度控制在最佳区内,偶尔(越激进越常见)冒险打进过力区;被调动时收着打
    const base =
      this.rng() < aggression * 0.3
        ? TUNING.powerRisky + 0.15 * this.rng()
        : TUNING.powerGood + (TUNING.powerRisky - TUNING.powerGood) * (0.3 + 0.7 * this.rng());
    this.power = Math.max(0.3, base * (stretched ? 0.8 : 1));

    this.offX = gaussian(this.rng) * footwork;
    this.offZ = gaussian(this.rng) * footwork;
    this.timingError = gaussian(this.rng) * this.cfg.timing;
    this.willHustle = this.rng() < this.cfg.hustle;
    this.dashed = false;
  }
}
