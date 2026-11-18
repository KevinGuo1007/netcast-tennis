import { ShotType } from '../sim/constants';
import { PlayerInput } from '../sim/game';

const STICK_RADIUS = 52; // 摇杆推到底的像素距离

/**
 * 开局时猜一下用哪种操作方式:主要的输入设备是手指(不能悬停、指向不精确)才算触屏。
 * 不能看 navigator.maxTouchPoints:带触摸屏的笔记本和一些桌面浏览器也会报告有触摸点,
 * 那样电脑上就会出现手机的操作按钮。猜错了也没关系,之后会按实际的操作切换(见 main.ts)。
 */
export const prefersTouch = (): boolean => window.matchMedia('(hover: none) and (pointer: coarse)').matches;

/**
 * 触屏输入:左半屏是浮动摇杆(按下的位置就是摇杆中心),右下角是四个击球按钮。
 * 摇杆同时负责移动和击球瞬间的落点瞄准,和键盘方向键的作用一致。
 */
export class TouchControls {
  private x = 0;
  private y = 0;
  private stickPointer: number | null = null;
  private originX = 0;
  private originY = 0;
  private queued: ShotType | null = null;
  private held = new Set<HTMLElement>();
  private lastStickDown = -1e9;
  /** 双击摇杆后,等摇杆推出方向再触发冲刺 / 扑救 */
  private dashArmedUntil = 0;

  constructor(root: HTMLElement) {
    const zone = root.querySelector<HTMLElement>('#stick-zone')!;
    const base = root.querySelector<HTMLElement>('#stick-base')!;
    const knob = root.querySelector<HTMLElement>('#stick-knob')!;

    const place = (el: HTMLElement, px: number, py: number): void => {
      el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
    };

    const move = (e: PointerEvent): void => {
      let dx = e.clientX - this.originX;
      let dy = e.clientY - this.originY;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        dx *= STICK_RADIUS / len;
        dy *= STICK_RADIUS / len;
      }
      this.x = dx / STICK_RADIUS;
      this.y = dy / STICK_RADIUS;
      place(knob, this.originX + dx, this.originY + dy);
    };

    const release = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.x = 0;
      this.y = 0;
      base.classList.remove('active');
      knob.classList.remove('active');
    };

    zone.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== null) return;
      e.preventDefault();
      this.stickPointer = e.pointerId;
      const now = performance.now();
      if (now - this.lastStickDown < 320) this.dashArmedUntil = now + 450;
      this.lastStickDown = now;
      try {
        zone.setPointerCapture(e.pointerId);
      } catch {
        // 个别浏览器对已结束的触点会抛错,不影响摇杆使用
      }
      this.originX = e.clientX;
      this.originY = e.clientY;
      place(base, e.clientX, e.clientY);
      base.classList.add('active');
      knob.classList.add('active');
      move(e);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickPointer) move(e);
    });
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);

    root.querySelectorAll<HTMLElement>('[data-shot]').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.queued = btn.dataset.shot as ShotType;
        this.held.add(btn);
        btn.classList.add('pressed');
      });
      const up = (): void => {
        this.held.delete(btn);
        btn.classList.remove('pressed');
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    });

    // 兜底:系统手势(来电、下拉通知、长按菜单……)抢走触摸时,浏览器不一定会补发抬起事件,
    // 摇杆和按钮就会一直卡在按下的状态。屏幕上已经没有手指、或者页面被切走时,全部松开。
    const releaseAll = (): void => {
      this.stickPointer = null;
      this.x = 0;
      this.y = 0;
      base.classList.remove('active');
      knob.classList.remove('active');
      for (const btn of this.held) btn.classList.remove('pressed');
      this.held.clear();
    };
    const noFingers = (e: TouchEvent): void => {
      if (e.touches.length === 0) releaseAll();
    };
    window.addEventListener('touchend', noFingers, { passive: true });
    window.addEventListener('touchcancel', noFingers, { passive: true });
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', releaseAll);
    zone.addEventListener('lostpointercapture', release);
  }

  read(): PlayerInput {
    // 小幅度的抖动不算输入
    const dead = Math.hypot(this.x, this.y) < 0.18;
    const x = dead ? 0 : this.x;
    const y = dead ? 0 : this.y;
    const shot = this.queued;
    this.queued = null;
    let dash = false;
    if (this.dashArmedUntil > 0 && !dead) {
      dash = performance.now() < this.dashArmedUntil;
      this.dashArmedUntil = 0;
    }
    // 屏幕向上(y 为负)= 向前 = 世界 -z;瞄准时向前表示打深
    return {
      moveX: x,
      moveZ: y,
      swing: shot !== null,
      hold: this.held.size > 0,
      shot: shot ?? 'flat',
      aimX: x,
      aimZ: -y,
      dash,
    };
  }
}

/** 合并键盘和触屏输入:哪边有操作用哪边 */
export function mergeInputs(a: PlayerInput, b: PlayerInput): PlayerInput {
  const useB = Math.hypot(b.moveX, b.moveZ) > Math.hypot(a.moveX, a.moveZ);
  const m = useB ? b : a;
  const s = b.swing ? b : a;
  return {
    moveX: m.moveX,
    moveZ: m.moveZ,
    aimX: m.aimX,
    aimZ: m.aimZ,
    swing: a.swing || b.swing,
    hold: a.hold || b.hold,
    dash: a.dash || b.dash,
    shot: s.shot,
  };
}
