import { ARENA, BALL, COURT, DT, TUNING } from './constants';

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
export const WALL = 4;

/** 围挡表面的种类:0 是地面,1 是墙,2 是看台 */
let surfaceKind = 0;

/**
 * (x, z) 处围挡的高度:球场和缓冲区是 0,墙和看台是它们的顶面高度。
 * 同时把表面的种类记在 surfaceKind 里(墙硬、看台软,反弹不一样)。
 */
export function arenaHeight(x: number, z: number): number {
  const A = ARENA;
  const ax = Math.abs(x);
  const az = Math.abs(z);
  surfaceKind = 0;
  if (ax < A.sideX && az < A.backZ) return 0;
  let h = 0;
  const set = (height: number, kind: number): void => {
    if (height > h) {
      h = height;
      surfaceKind = kind;
    }
  };
  // 两端:背墙,远端墙后还有看台
  const dz = az - A.backZ;
  if (dz >= 0 && ax <= A.halfWidth) {
    if (dz <= A.thickness) set(z < 0 ? A.farWallHeight : A.nearWallHeight, 1);
    if (z < 0 && dz <= A.standDepth) set(A.standBase + A.standSlope * dz, 2);
  }
  // 两侧:矮墙和看台
  const dx = ax - A.sideX;
  if (dx >= 0 && az <= A.halfLength) {
    if (dx <= A.thickness) set(A.sideWallHeight, 1);
    if (dx <= A.standDepth && az <= A.backZ) set(A.standBase + A.standSlope * dx, 2);
  }
  return h;
}

/**
 * 在球心沿运动方向探出 lead 的位置检查一次碰撞:迎面撞上就水平弹回,从上面落下就像落地一样弹起。
 * 返回撞击速度;没有碰到返回 -1。
 */
function resolveArena(b: Ball, px: number, py: number, pz: number, lead: number): number {
  const A = ARENA;
  const p = b.pos;
  const v = b.vel;
  const ox = Math.sign(v.x) * lead;
  const oz = Math.sign(v.z) * lead;
  const h = arenaHeight(p.x + ox, p.z + oz);
  if (h <= 0 || p.y - A.pad >= h) return -1;
  const soft = surfaceKind === 2;
  const e = soft ? A.standRestitution : A.wallRestitution;
  const keep = soft ? A.standFriction : A.wallFriction;
  let impact = 0;

  if (py - A.pad >= h - 1e-9) {
    // 从上方落到墙顶或看台上
    impact = -v.y;
    p.y = h + A.pad;
    v.y = impact > 0.8 ? impact * e : 0;
    const roll = impact > 0.8 ? keep : 0.9;
    v.x *= roll;
    v.z *= roll;
  } else {
    // 迎面撞上:看是哪个方向的移动造成的,就把哪个方向弹回去
    const hitZ = arenaHeight(px + ox, p.z + oz) > p.y - A.pad;
    const hitX = arenaHeight(p.x + ox, pz + oz) > p.y - A.pad;
    if (hitZ || !hitX) {
      impact = Math.max(impact, Math.abs(v.z));
      p.z = pz;
      v.z *= -e;
      v.x *= keep;
    }
    if (hitX || !hitZ) {
      impact = Math.max(impact, Math.abs(v.x));
      p.x = px;
      v.x *= -e;
      v.z *= keep;
    }
    v.y *= keep;
    // 在看台的斜坡上被挡回来时,球可能已经低于脚下的台面:托回台面上
    const floor = arenaHeight(p.x, p.z) + A.pad;
    if (p.y < floor) {
      p.y = floor;
      v.y = v.y < -0.8 ? -v.y * e : Math.max(v.y, 0);
    }
  }
  b.spin *= 0.4;
  return impact;
}

/** 墙和看台的碰撞。球在画面上有大小,所以球心和朝运动方向的球面各查一次。 */
function collideArena(b: Ball, px: number, py: number, pz: number): number {
  const A = ARENA;
  if (Math.abs(b.pos.x) < A.sideX - A.pad && Math.abs(b.pos.z) < A.backZ - A.pad) return 0;
  let impact = resolveArena(b, px, py, pz, A.pad);
  if (impact < 0) impact = resolveArena(b, px, py, pz, 0);
  return impact > 1 ? WALL : 0;
}

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

/** 推进一步,处理球网、地面和围挡的碰撞。返回 BOUNCE / NET / WALL 标志位。 */
export function stepBall(b: Ball, dt: number): number {
  const prevX = b.pos.x;
  const prevY = b.pos.y;
  const prevZ = b.pos.z;
  integrate(b, dt);
  let flags = collideArena(b, prevX, prevY, prevZ);

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
      // 没落地就先撞上了围挡:当作落在那里(肯定是界外)
      if (flags & (BOUNCE | WALL) || (b.pos.y <= BALL.radius && b.vel.y === 0)) {
        bounced = true;
        p.x = b.pos.x;
        p.z = b.pos.z;
      }
    } else {
      after += DT;
      if (flags & WALL) break;
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
