import { ShotType } from '../sim/constants';
import { PlayerInput } from '../sim/game';

const SHOT_KEYS: Record<string, ShotType> = { KeyJ: 'flat', Space: 'flat', KeyK: 'top', KeyL: 'slice', KeyI: 'lob' };
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const DOUBLE_TAP_MS = 280;
const GAME_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  ...Object.keys(SHOT_KEYS),
]);

export class Keyboard {
  private down = new Set<string>();
  private queued: ShotType | null = null;
  private dashQueued = false;
  private lastTap = new Map<string, number>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      if (e.code in SHOT_KEYS) this.queued = SHOT_KEYS[e.code];
      // 双击同一个方向键:冲刺 / 扑救
      if (MOVE_KEYS.has(e.code)) {
        const now = performance.now();
        if (now - (this.lastTap.get(e.code) ?? -1e9) < DOUBLE_TAP_MS) this.dashQueued = true;
        this.lastTap.set(e.code, now);
      }
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  private axis(neg: string[], pos: string[]): number {
    const n = neg.some((k) => this.down.has(k)) ? 1 : 0;
    const p = pos.some((k) => this.down.has(k)) ? 1 : 0;
    return p - n;
  }

  /** 读取 0 号球员(近端)的输入。击球键每次按下只触发一次 swing,按住期间 hold 为真。 */
  read(): PlayerInput {
    const x = this.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    const forward = this.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    const shot = this.queued;
    this.queued = null;
    // 向前(靠近球网)在世界坐标里是 -z;瞄准时向前表示打深
    const hold = Object.keys(SHOT_KEYS).some((k) => this.down.has(k));
    const dash = this.dashQueued;
    this.dashQueued = false;
    return {
      moveX: x,
      moveZ: -forward,
      swing: shot !== null,
      hold,
      shot: shot ?? 'flat',
      aimX: x,
      aimZ: forward,
      dash,
    };
  }
}
