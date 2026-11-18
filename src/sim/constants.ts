// 坐标系:x 为球场横向,y 向上,z 为球场纵向;球网在 z = 0。
// 0 号球员在 z > 0 一侧(近端),1 号球员在 z < 0 一侧(远端)。单位:米、秒。

export const COURT = {
  halfLength: 11.885,
  halfWidth: 4.115, // 单打边线
  doublesHalfWidth: 5.485,
  serviceLine: 6.4,
  netHeight: 0.914,
  netHalfWidth: 5.03,
};

export const BALL = {
  radius: 0.033,
  gravity: 9.81,
  drag: 0.0197, // 加速度 = -drag * |v| * v
  magnus: 0.0006, // 旋转升力系数:上旋(spin > 0)让球下坠,下旋让球飘
  restitution: 0.74,
  friction: 0.72, // 落地后水平速度保留比例(无旋转时)
};

/**
 * 球场四周的围挡:两端的背墙、两侧的矮墙,以及墙后面的看台。球碰到会反弹。
 * 尺寸和 render/stadium.ts 里画出来的墙、看台一一对应(画面直接引用这里的数值)。
 */
export const ARENA = {
  backZ: 19, // 两端背墙朝球场一面的位置
  sideX: 11, // 两侧矮墙朝球场一面的位置
  thickness: 0.4,
  halfWidth: 17, // 背墙和远端看台的半宽
  halfLength: 19.2, // 侧墙的半长
  farWallHeight: 3.56, // 远端背墙(挂着大广告牌,含顶上的饰条)
  nearWallHeight: 1.0,
  sideWallHeight: 1.52,
  // 看台:离墙面越远越高,高度取到观众的肩膀附近
  standBase: 1.3,
  standSlope: 0.7,
  standDepth: 9,
  pad: 0.11, // 球在画面上是放大显示的,按看得见的大小判定,才不会陷进墙里
  wallRestitution: 0.55,
  wallFriction: 0.8,
  standRestitution: 0.25, // 打进观众席基本就停住了
  standFriction: 0.45,
};

export const DT = 1 / 120;

export type ShotType = 'flat' | 'top' | 'slice' | 'lob';

/**
 * speed 为相对球员击球速度的比例;spin 单位 rad/s;clearance 为过网的最小余量(米);
 * risk 为大力击球时的额外失误倾向(平击最冒险)。
 */
export const SHOTS: Record<ShotType, { speed: number; spin: number; clearance: number; risk: number }> = {
  flat: { speed: 1, spin: 90, clearance: 0.2, risk: 1 },
  top: { speed: 0.88, spin: 320, clearance: 0.55, risk: 0.6 },
  slice: { speed: 0.72, spin: -160, clearance: 0.15, risk: 0.45 },
  lob: { speed: 0.42, spin: 120, clearance: 0.2, risk: 0.35 },
};

export const TUNING = {
  // 击球力度:按住击球键蓄力,松开挥拍
  chargeTime: 0.7, // 按住多久蓄满
  minPower: 0.25, // 轻点一下的力度
  prepMax: 2.2, // 引拍最多保持多久,到时间会强制挥出
  prepMoveFactor: 0.65, // 引拍时自动就位的速度比例
  swingBuffer: 0.35, // 来不及挥拍(还在调整姿势)时按下的击球键,会保留这么久
  powerGood: 0.6, // 力度条的最佳区下限
  powerRisky: 0.85, // 超过这个力度进入过力区,失误明显增多

  // 挥拍时机:松开后 impactT 秒球拍到达击球点。
  // 松手早了没关系:球员会拿着拍子等球到位再挥出去(提前越多评级越低,蓄的力也越少);
  // 只有早得离谱或者晚了太多才会打空。
  impactT: 0.1,
  swingDuration: 0.45,
  timingEarlyPerfect: 0.1, // 提前这么多秒以内松手仍算完美
  timingEarlyMax: 0.4, // 提前超过这个时间松手就打空
  timingLatePerfect: 0.06, // 晚这么多秒以内仍算完美
  timingLateMax: 0.22, // 晚超过这个时间就打空
  autoSwingSkill: 0.25, // 辅助自动出手的击球质量下限:够得上「不错」,但到不了「完美」
  timingPull: 1.1, // 时机偏得多时会把球带偏(米)

  // 挥拍后的调整时间:力度越大越久,打空了更久
  recoverBase: 0.1,
  recoverPower: 0.3,
  recoverWhiff: 0.2,
  recoverMoveFactor: 0.6,

  // 击球方向:引拍期间方向键只负责移动瞄准点
  aimRate: 2.2, // 瞄准点每秒移动量(-1..1 的范围)
  aimWidth: 3.3, // 瞄准点推到最边时离中线的距离
  depthNear: 4.8,
  depthMid: 8.0,
  depthFar: 10.6,

  // 最佳击球点:球拍一侧、身体略前方、腰部高度
  sweetSide: 0.75,
  sweetFront: 0.3,
  sweetRadius: 0.35, // 球离最佳击球点这么近就是完美位置
  contactRadius: 1.6, // 正常挥拍能够到的范围
  lungeRadius: 2.3, // 伸展上步才能够到的范围
  sweetLow: 0.6,
  sweetHigh: 1.3,
  minHitHeight: 0.15,
  maxHitHeight: 2.6,

  // 冲刺和鱼跃扑救(双击方向键)
  sprintFactor: 1.45,
  diveEta: 0.6, // 球在这么多秒内到达、跑又跑不到时,双击方向键会直接扑出去
  diveMinDist: 0.9,
  diveRange: 3.2, // 一次扑救最远能飞多远
  diveTime: 0.36, // 腾空时间
  diveDuration: 1.05, // 从起跳到爬起来
  diveReach: 1.3,

  // 发球
  tossSpeed: 5.6,
  tossHeight: 1.4,
  serveIdealHeight: 2.9,
  serveMinHeight: 2.0,
  serveMaxHeight: 3.4,
  serveDepth: 5.2,
  serveWide: 2.0,
  serveSpin: 110,
  secondServeFactor: 0.85,
  netClearance: 0.2,

  pointPause: 1.8,
  faultPause: 1.2,
  rallyTimeout: 6,
};

/** 体力:0..1。跑动和击球消耗,站定和分与分之间恢复;体力低时跑得慢、打不出全力、失误变多。 */
export const STAMINA = {
  runDrain: 0.04, // 全速跑动每秒消耗
  sprintDrain: 0.13, // 冲刺每秒消耗
  hitCost: 0.02,
  powerCost: 0.06, // 满力击球的额外消耗
  lungeCost: 0.08,
  diveCost: 0.14,
  serveCost: 0.03,
  recover: 0.06, // 站定时每秒恢复
  pointRecover: 0.1,
  gameRecover: 0.25,
  minSpeed: 0.68, // 体力耗尽时的移动速度比例
  minPower: 0.82, // 体力耗尽时的力度上限
  errorAtEmpty: 0.45,
};

export const HUMAN = { speed: 7.4, shotSpeed: 29, serveSpeed: 40, errMul: 1 };
