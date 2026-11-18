import { BALL, COURT, DT, TUNING } from './constants';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Ball {
  pos: Vec3;
  vel: Vec3;
  /** 旋转(rad/s):正为上旋,负为下旋 */
  spin: number;
}

export const BOUNCE = 1;
export const NET = 2;

function integrate(b: Ball, dt: number): void {
  const v = b.vel;
  const f = BALL.drag * Math.hypot(v.x, v.y, v.z);
  const vh = Math.hypot(v.x, v.z);
  // 马格努斯力垂直于速度方向:上旋时把球往下压
  const m = BALL.magnus * b.spin;
  const mh = vh > 1e-6 ? (m * v.y) / vh : 0;
  const ax = -f * v.x + mh * v.x;
  const ay = -BALL.gravity - f * v.y - m * vh;
  const az = -f * v.z + mh * v.z;
  v.x += ax * dt;
  v.y += ay * dt;
  v.z += az * dt;
  b.pos.x += v.x * dt;
  b.pos.y += v.y * dt;
  b.pos.z += v.z * dt;
}

/** 推进一步,处理球网和地面碰撞。返回 BOUNCE / NET 标志位。 */
export function stepBall(b: Ball, dt: number): number {
  const prevZ = b.pos.z;
  integrate(b, dt);
  let flags = 0;

  if (prevZ > 0 !== b.pos.z > 0 && b.pos.y < COURT.netHeight && Math.abs(b.pos.x) < COURT.netHalfWidth) {
    b.pos.z = prevZ > 0 ? 0.05 : -0.05;
    b.vel.z *= -0.1;
    b.vel.x *= 0.3;
    b.vel.y *= 0.3;
    b.spin *= 0.3;
    flags |= NET;
  }

  if (b.pos.y < BALL.radius && b.vel.y < 0) {
    b.pos.y = BALL.radius;
    if (b.vel.y > -0.5) {
      b.vel.y = 0;
      b.vel.x *= 0.98;
      b.vel.z *= 0.98;
    } else {
      // 上旋球落地后前冲,下旋球落地后发涩
      const keep = BALL.friction + Math.max(-0.12, Math.min(0.12, b.spin * 0.0004));
      b.vel.y *= -BALL.restitution;
      b.vel.x *= keep;
      b.vel.z *= keep;
      b.spin *= 0.6;
      flags |= BOUNCE;
    }
  }
  return flags;
}

export function cloneBall(b: Ball): Ball {
  return { pos: { ...b.pos }, vel: { ...b.vel }, spin: b.spin };
}

/** 无碰撞飞行到落地:返回水平飞行距离,以及过网(z=0)时的高度(未过网则为 null)。 */
function flight(from: Vec3, vel: Vec3, spin: number): { dist: number; netY: number | null } {
  const b: Ball = { pos: { ...from }, vel: { ...vel }, spin };
  let netY: number | null = null;
  for (let i = 0; i < 1200; i++) {
    const pz = b.pos.z;
    integrate(b, DT);
    if (netY === null && pz > 0 !== b.pos.z > 0) netY = b.pos.y;
    if (b.pos.y <= BALL.radius && b.vel.y < 0) break;
  }
  return { dist: Math.hypot(b.pos.x - from.x, b.pos.z - from.z), netY };
}

/**
 * 求从 from 出发、落在 (tx, tz) 的初速度。优先使用给定的水平速度,
 * 过网高度不够时逐步降速(弧线更高)直到能过网。
 */
export function solveShot(
  from: Vec3,
  tx: number,
  tz: number,
  speed: number,
  spin = 0,
  clearance = TUNING.netClearance,
): Vec3 {
  const dx = tx - from.x;
  const dz = tz - from.z;
  const dist = Math.max(Math.hypot(dx, dz), 0.01);
  const ux = dx / dist;
  const uz = dz / dist;
  let s = speed;
  let vel: Vec3 = { x: 0, y: 0, z: 0 };
  for (let attempt = 0; attempt < 16; attempt++) {
    let lo = -14;
    let hi = 26;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (flight(from, { x: ux * s, y: mid, z: uz * s }, spin).dist < dist) lo = mid;
      else hi = mid;
    }
    vel = { x: ux * s, y: (lo + hi) / 2, z: uz * s };
    const netY = flight(from, vel, spin).netY;
    if (netY === null || netY >= COURT.netHeight + clearance) break;
    s *= 0.92;
  }
  return vel;
}

export interface Prediction {
  /** 第一次落地的位置和所需时间 */
  x: number;
  z: number;
  t: number;
  /** 落地后最适合击球的位置:球弹起到腰部高度(或弹跳最高点)时 */
  ix: number;
  iy: number;
  iz: number;
  /** 从击球到球到达这个位置所需的时间 */
  it: number;
  /** 落点是否有效(由对局逻辑填写) */
  in: boolean;
}

export function predict(ball: Ball): Prediction {
  const b = cloneBall(ball);
  const p: Prediction = { x: b.pos.x, z: b.pos.z, t: 0, ix: b.pos.x, iy: 0, iz: b.pos.z, it: 0, in: false };
  let bounced = false;
  let after = 0;
  for (let i = 0; i < 1400; i++) {
    const flags = stepBall(b, DT);
    if (!bounced) {
      p.t += DT;
      if (flags & BOUNCE || (b.pos.y <= BALL.radius && b.vel.y === 0)) {
        bounced = true;
        p.x = b.pos.x;
        p.z = b.pos.z;
      }
    } else {
      after += DT;
      // 球升到腰部高度,或者已经到达弹跳最高点
      if (after >= 0.18 && (b.pos.y >= 0.95 || b.vel.y <= 0)) break;
      if (after >= 0.7) break;
    }
  }
  p.ix = b.pos.x;
  p.iy = b.pos.y;
  p.iz = b.pos.z;
  p.it = p.t + after;
  return p;
}
