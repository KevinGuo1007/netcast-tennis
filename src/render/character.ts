import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { TUNING } from '../sim/constants';
import { Player } from '../sim/game';
import { toon } from './toon';

// 姿势用"关节角度"描述(角色面向 -z,右手在 +x):
// 手臂和腿自然下垂;绕 x 正向旋转 = 向前抬;绕 z 正向旋转 = 向 +x 外展。
// 髋和脊柱直立;绕 x 负向 = 前倾;绕 y 负向 = 向右转;绕 z 负向 = 上身向右倒。
// 这些角度以模型空间的坐标轴为准,应用到骨骼时再换算成骨骼自身的局部旋转。
const JOINTS = [
  'hips',
  'spine',
  'head',
  'armR',
  'elbowR',
  'wristR',
  'armL',
  'elbowL',
  'thighR',
  'kneeR',
  'footR',
  'thighL',
  'kneeL',
  'footL',
] as const;
type Joint = (typeof JOINTS)[number];
type Angles = [number, number, number];
/** hip:髋部高度偏移(米);yaw:整个身体相对"面向球网"的额外转向 */
type PoseSpec = Partial<Record<Joint, Angles>> & { hip?: number; yaw?: number };

/** 关节对应的骨骼名(见 tools/build_character.py) */
const BONE_OF: Record<Joint, string> = {
  hips: 'Hips',
  spine: 'Spine',
  head: 'Head',
  armR: 'UpperArmR',
  elbowR: 'LowerArmR',
  wristR: 'HandR',
  armL: 'UpperArmL',
  elbowL: 'LowerArmL',
  thighR: 'ThighR',
  kneeR: 'ShinR',
  footR: 'FootR',
  thighL: 'ThighL',
  kneeL: 'ShinL',
  footL: 'FootL',
};

const N = JOINTS.length * 3 + 2;
const HIP = N - 2;
const YAW = N - 1;
const at = (j: Joint): number => JOINTS.indexOf(j) * 3;
/** 手臂通道的范围:挥拍时手臂比身体晚发力,要单独取时间 */
const ARM_START = at('armR');
const ARM_END = at('elbowL') + 3;
const SPINE = at('spine');
const LEGS_START = at('thighR');
/** 踝关节:[脚的通道, 大腿的通道, 膝盖的通道] */
const FEET = [
  [at('footR'), at('thighR'), at('kneeR')],
  [at('footL'), at('thighL'), at('kneeL')],
] as const;
const TAU = Math.PI * 2;

function pose(spec: PoseSpec): Float32Array {
  const out = new Float32Array(N);
  JOINTS.forEach((j, i) => {
    const a = spec[j];
    if (a) out.set(a, i * 3);
  });
  out[HIP] = spec.hip ?? 0;
  out[YAW] = spec.yaw ?? 0;
  return out;
}

const LEGS_BENT: PoseSpec = {
  thighR: [0.45, 0, 0.16],
  kneeR: [-0.85, 0, 0],
  thighL: [0.45, 0, -0.16],
  kneeL: [-0.85, 0, 0],
  hip: -0.08,
};

const POSES = {
  ready: pose({
    ...LEGS_BENT,
    spine: [-0.3, 0, 0],
    head: [0.22, 0, 0],
    armR: [0.55, 0, 0.1],
    elbowR: [1.25, 0, -0.5],
    wristR: [-1.0, 0, 0.3],
    armL: [0.55, 0, -0.1],
    elbowL: [1.25, 0, 0.5],
  }),
  // ---- 正手:侧身引拍 → 转髋带动转体 → 触球 → 随挥到左肩
  fhPrep: pose({
    thighR: [0.3, 0, 0.3],
    kneeR: [-0.8, 0, 0],
    thighL: [0.65, 0, -0.1],
    kneeL: [-0.9, 0, 0],
    hip: -0.12,
    yaw: -0.45,
    hips: [0, -0.35, 0],
    spine: [-0.18, -0.85, 0],
    head: [0.1, 0.9, 0],
    armR: [-0.95, 0, 0.7],
    elbowR: [0.7, 0, 0],
    wristR: [-0.7, 0, 0],
    armL: [1.2, 0, 0.55],
    elbowL: [0.3, 0, 0],
  }),
  fhContact: pose({
    thighR: [0.15, 0, 0.25],
    kneeR: [-0.35, 0, 0],
    thighL: [0.6, 0, -0.2],
    kneeL: [-0.7, 0, 0],
    hip: -0.05,
    yaw: 0.05,
    hips: [0, 0.25, 0],
    spine: [-0.24, 0.1, 0],
    head: [0.1, 0.1, 0],
    armR: [1.1, 0, 0.85],
    elbowR: [0.18, 0, 0],
    wristR: [-0.1, 0, 0],
    armL: [0.35, 0, -0.55],
    elbowL: [1.25, 0, 0],
  }),
  fhFollow: pose({
    thighR: [0.0, 0, 0.15],
    kneeR: [-0.45, 0, 0],
    thighL: [0.4, 0, -0.2],
    kneeL: [-0.45, 0, 0],
    hip: 0.0,
    yaw: 0.35,
    hips: [0, 0.45, 0],
    spine: [-0.26, 0.8, 0],
    head: [0.1, -0.9, 0],
    armR: [2.15, 0, -0.85],
    elbowR: [1.55, 0, 0],
    wristR: [0.35, 0, 0],
    armL: [0.25, 0, -0.45],
    elbowL: [1.45, 0, 0],
  }),
  // ---- 反手
  bhPrep: pose({
    thighL: [0.3, 0, -0.3],
    kneeL: [-0.8, 0, 0],
    thighR: [0.65, 0, 0.1],
    kneeR: [-0.9, 0, 0],
    hip: -0.12,
    yaw: 0.45,
    hips: [0, 0.35, 0],
    spine: [-0.18, 0.85, 0],
    head: [0.1, -0.9, 0],
    armR: [0.6, 0, -1.15],
    elbowR: [1.05, 0, 0],
    wristR: [-0.65, 0, 0],
    armL: [0.55, 0, -0.25],
    elbowL: [1.35, 0, 0.6],
  }),
  bhContact: pose({
    thighL: [0.15, 0, -0.25],
    kneeL: [-0.35, 0, 0],
    thighR: [0.6, 0, 0.2],
    kneeR: [-0.7, 0, 0],
    hip: -0.05,
    yaw: -0.05,
    hips: [0, -0.2, 0],
    spine: [-0.22, 0.05, 0],
    head: [0.1, 0, 0],
    armR: [1.0, 0, -0.3],
    elbowR: [0.15, 0, 0],
    wristR: [-0.1, 0, 0],
    armL: [-0.35, 0, -0.55],
    elbowL: [0.4, 0, 0],
  }),
  bhFollow: pose({
    thighL: [0.0, 0, -0.15],
    kneeL: [-0.45, 0, 0],
    thighR: [0.4, 0, 0.2],
    kneeR: [-0.45, 0, 0],
    hip: 0.0,
    yaw: -0.3,
    hips: [0, -0.4, 0],
    spine: [-0.16, -0.8, 0],
    head: [0.1, 0.85, 0],
    armR: [1.8, 0, 1.15],
    elbowR: [0.45, 0, 0],
    wristR: [0.35, 0, 0],
    armL: [-0.7, 0, -0.8],
    elbowL: [0.3, 0, 0],
  }),
  // ---- 伸展上步:够得勉强时大弓步伸出去
  stretchF: pose({
    thighR: [1.3, 0, 0.55],
    kneeR: [-1.35, 0, 0],
    thighL: [-0.6, 0, -0.1],
    kneeL: [-0.2, 0, 0],
    hip: -0.36,
    hips: [0, -0.2, -0.3],
    spine: [-0.6, -0.2, -0.3],
    head: [0.5, 0, 0.3],
    armR: [1.3, 0, 1.3],
    elbowR: [0.05, 0, 0],
    wristR: [0.1, 0, 0],
    armL: [-0.6, 0, -0.9],
    elbowL: [0.3, 0, 0],
  }),
  stretchB: pose({
    thighL: [1.3, 0, -0.55],
    kneeL: [-1.35, 0, 0],
    thighR: [-0.6, 0, 0.1],
    kneeR: [-0.2, 0, 0],
    hip: -0.36,
    hips: [0, 0.2, 0.3],
    spine: [-0.6, 0.3, 0.3],
    head: [0.5, 0, -0.3],
    armR: [1.25, 0, -1.2],
    elbowR: [0.05, 0, 0],
    wristR: [0.1, 0, 0],
    armL: [-0.5, 0, -0.6],
    elbowL: [0.3, 0, 0],
  }),
  // ---- 收拍调整:球拍垂下,身体回正,重心略低
  recover: pose({
    thighR: [0.35, 0, 0.2],
    kneeR: [-0.7, 0, 0],
    thighL: [0.35, 0, -0.2],
    kneeL: [-0.7, 0, 0],
    hip: -0.1,
    spine: [-0.42, 0, 0],
    head: [0.35, 0, 0],
    armR: [0.25, 0, 0.25],
    elbowR: [0.5, 0, 0],
    wristR: [-0.2, 0, 0],
    armL: [0.3, 0, -0.25],
    elbowL: [0.6, 0, 0],
  }),
  // ---- 发球:抛球臂上举,球拍收到背后(奖杯姿势)→ 蹬地向上击球 → 收拍
  trophy: pose({
    thighR: [0.35, 0, 0.1],
    kneeR: [-0.9, 0, 0],
    thighL: [0.5, 0, -0.1],
    kneeL: [-0.9, 0, 0],
    hip: -0.13,
    yaw: -0.5,
    hips: [0.1, -0.2, 0],
    spine: [0.28, -0.45, 0],
    head: [-0.55, 0.5, 0],
    armR: [0.3, 0, 1.45],
    elbowR: [2.15, 0, 0],
    wristR: [-0.4, 0, 0],
    armL: [3.0, 0, -0.1],
    elbowL: [0.05, 0, 0],
  }),
  serveContact: pose({
    thighR: [-0.15, 0, 0.05],
    kneeR: [-0.1, 0, 0],
    thighL: [0.1, 0, -0.05],
    kneeL: [-0.2, 0, 0],
    hip: 0.2,
    yaw: -0.1,
    hips: [0, 0.2, 0],
    spine: [-0.12, 0.3, 0],
    head: [-0.35, 0, 0],
    armR: [2.95, 0, 0.12],
    elbowR: [0.08, 0, 0],
    wristR: [0.1, 0, 0],
    armL: [0.6, 0, -0.3],
    elbowL: [1.3, 0, 0],
  }),
  serveFollow: pose({
    thighR: [0.85, 0, 0.1],
    kneeR: [-1.0, 0, 0],
    thighL: [0.15, 0, -0.1],
    kneeL: [-0.4, 0, 0],
    hip: -0.08,
    yaw: 0.25,
    hips: [0, 0.35, 0],
    spine: [-0.65, 0.6, 0],
    head: [0.3, -0.3, 0],
    armR: [0.8, 0, -0.75],
    elbowR: [0.35, 0, 0],
    wristR: [0.3, 0, 0],
    armL: [0.5, 0, -0.3],
    elbowL: [1.4, 0, 0],
  }),
};

/** 鱼跃扑救的三个阶段。side:+1 往持拍手一侧扑,-1 往另一侧扑 */
function divePoses(side: number): { fly: Float32Array; ground: Float32Array; up: Float32Array } {
  const s = side;
  // 持拍手始终伸向扑出去的方向。身体是横过来的,所以手臂要举过头顶(相对躯干)才是朝前伸,
  // 而不是指向地面:往右扑时从体侧举过头顶,往左扑时从身前举过头顶
  const reach: PoseSpec = s > 0 ? { armR: [0.15, 0, 3.05], elbowR: [0.05, 0, 0] } : { armR: [2.9, 0, 0.3], elbowR: [0.05, 0, 0] };
  return {
    fly: pose({
      ...reach,
      hip: -0.38,
      hips: [-0.15, 0, -s * 1.25],
      spine: [-0.1, 0, -s * 0.25],
      head: [0.1, 0, s * 0.5],
      wristR: [0.1, 0, 0],
      armL: [0.4, 0, -0.7],
      elbowL: [0.5, 0, 0],
      thighR: [-0.25, 0, 0.2],
      kneeR: [-0.35, 0, 0],
      thighL: [0.35, 0, -0.3],
      kneeL: [-0.6, 0, 0],
    }),
    ground: pose({
      ...reach,
      hip: -0.6,
      hips: [-0.1, 0, -s * 1.5],
      spine: [-0.05, 0, -s * 0.1],
      head: [0.2, 0, s * 0.6],
      wristR: [0.3, 0, 0],
      armL: [0.9, 0, -0.5],
      elbowL: [1.0, 0, 0],
      thighR: [0.2, 0, 0.1],
      kneeR: [-0.5, 0, 0],
      thighL: [0.5, 0, -0.2],
      kneeL: [-0.9, 0, 0],
    }),
    // 爬起来:单膝跪地撑起身体,球拍横在身前(不能朝下,否则会戳进地面)
    up: pose({
      hip: -0.44,
      hips: [-0.15, 0, -s * 0.3],
      spine: [-0.55, 0, 0],
      head: [0.4, 0, 0],
      armR: [1.0, 0, 0.35],
      elbowR: [0.5, 0, 0],
      wristR: [-1.25, 0, 0],
      armL: [0.7, 0, -0.35],
      elbowL: [0.5, 0, 0],
      thighR: [1.2, 0, 0.2],
      kneeR: [-1.55, 0, 0],
      thighL: [0.45, 0, -0.2],
      kneeL: [-1.9, 0, 0],
    }),
  };
}
const DIVE = { right: divePoses(1), left: divePoses(-1) };

function mix(a: Float32Array, b: Float32Array, t: number, out: Float32Array, from = 0, to = N): void {
  const k = Math.max(0, Math.min(1, t));
  for (let i = from; i < to; i++) out[i] = a[i] + (b[i] - a[i]) * k;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const frac = (v: number): number => v - Math.floor(v);

/**
 * 跑步时一条腿在一个周期里的关键帧。u 是周期进度:0 脚落地 → 0.12 支撑 → 0.28 蹬离地面 →
 * 小腿向后折叠 → 0.75 抬膝前摆 → 0.9 小腿前伸准备落地。另一条腿差半个周期。
 * foot 是踝关节相对"脚掌放平"的角度:负数是绷脚尖(蹬地),正数是勾脚。
 */
const RUN = {
  u: [0, 0.12, 0.28, 0.42, 0.58, 0.75, 0.9],
  thigh: [0.45, 0.05, -0.5, -0.25, 0.55, 1.0, 0.75],
  knee: [-0.35, -0.55, -0.25, -1.45, -1.75, -1.25, -0.45],
  foot: [0.1, 0, -0.55, -0.3, -0.2, 0, 0.15],
};
/** 步态的"平均姿势":经过弹簧过渡;周期性的摆动直接叠加在它上面,不被弹簧拖慢 */
const RUN_MEAN = { thigh: 0.25, knee: -0.7, hip: -0.03 };
const SHUFFLE_MEAN = { thigh: 0.42, knee: -0.8, hip: -0.1, spread: 0.3 };

/** 周期性的关键帧插值(Catmull-Rom):首尾相接,过渡平滑 */
function cyclic(times: number[], values: number[], u: number): number {
  const n = times.length;
  let i = n - 1;
  while (i > 0 && times[i] > u) i--;
  const key = (k: number): [number, number] => {
    const w = Math.floor(k / n);
    const j = k - w * n;
    return [times[j] + w, values[j]];
  };
  const [t0, v0] = key(i - 1);
  const [t1, v1] = key(i);
  const [t2, v2] = key(i + 1);
  const [t3, v3] = key(i + 2);
  const h = t2 - t1;
  const x = (u - t1) / h;
  const m1 = ((v2 - v0) / (t2 - t0)) * h;
  const m2 = ((v3 - v1) / (t3 - t1)) * h;
  const x2 = x * x;
  const x3 = x2 * x;
  return (2 * x3 - 3 * x2 + 1) * v1 + (x3 - 2 * x2 + x) * m1 + (-2 * x3 + 3 * x2) * v2 + (x3 - x2) * m2;
}
const easeIn = (t: number): number => t * t * t;
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** 材质名 → 颜色。材质名来自建模脚本,每个球员用自己的一套配色。 */
export type Palette = Record<
  'Skin' | 'Shirt' | 'Trim' | 'Shorts' | 'Shoes' | 'Sock' | 'Hair' | 'Eye' | 'Band' | 'Racket' | 'Grip' | 'Strings',
  number
>;

export async function loadPlayerModel(): Promise<THREE.Object3D> {
  const gltf = await new GLTFLoader().loadAsync('/models/player.glb');
  return gltf.scene;
}

/**
 * 防止穿地用的采样点:骨骼名、模型静止姿势下的位置(x 右、y 上、z 后)和半径。
 * 每帧摆好姿势后,取这些点里最低的一个,把整个人抬到刚好不陷进地面的高度。
 */
const GROUND_PROBES: [bone: string, x: number, y: number, z: number, radius: number][] = [
  ['Head', 0, 1.69, 0, 0.19],
  ['Spine', 0.13, 1.34, 0, 0.14],
  ['Spine', -0.13, 1.34, 0, 0.14],
  ['Spine', 0, 1.12, 0, 0.17],
  ['Hips', 0.09, 0.88, 0, 0.14],
  ['Hips', -0.09, 0.88, 0, 0.14],
  ['UpperArmR', 0.262, 1.4, 0, 0.085],
  ['UpperArmL', -0.262, 1.4, 0, 0.085],
  ['LowerArmR', 0.262, 1.15, 0, 0.06],
  ['LowerArmL', -0.262, 1.15, 0, 0.06],
  ['HandR', 0.262, 0.85, 0, 0.065],
  ['LowerArmL', -0.262, 0.85, 0, 0.065],
  // 球拍:拍头的顶端和左右两侧
  ['HandR', 0.262, 0.155, 0, 0.02],
  ['HandR', 0.4, 0.33, 0, 0.02],
  ['HandR', 0.124, 0.33, 0, 0.02],
  ['ShinR', 0.095, 0.5, 0, 0.08],
  ['ShinL', -0.095, 0.5, 0, 0.08],
  // 脚:脚尖和脚跟(跟着踝关节转)
  ['FootR', 0.095, 0.03, -0.195, 0.03],
  ['FootR', 0.095, 0.03, 0.085, 0.03],
  ['FootL', -0.095, 0.03, -0.195, 0.03],
  ['FootL', -0.095, 0.03, 0.085, 0.03],
];

interface BoneBinding {
  bone: THREE.Bone;
  /** 骨骼在静止姿势下、模型空间里的朝向 */
  rest: THREE.Quaternion;
  /** 父节点在静止姿势下、模型空间里朝向的逆 */
  parentInv: THREE.Quaternion;
}

const euler = new THREE.Euler();
const qPose = new THREE.Quaternion();

/** 每帧传给角色的场上信息,用来看球、垫步等 */
export interface CharacterContext {
  ball: { x: number; y: number; z: number };
  /** 球正朝这名球员飞来 */
  incoming: boolean;
  /** 对局正在进行(否则放松站着) */
  live: boolean;
  /** 击球序号:变化说明刚有人击球 */
  hitSeq: number;
}

export class Character {
  readonly root = new THREE.Group();
  private bindings: BoneBinding[] = [];
  private hips: THREE.Bone;
  private hipsRest = new THREE.Vector3();
  private hipsUp = new THREE.Vector3();
  // 每个通道是一个带阻尼的弹簧:姿势切换时自然地加速、减速、略微过冲,不会生硬地"滑"过去
  private current = new Float32Array(POSES.ready);
  private velocity = new Float32Array(N);
  private target = new Float32Array(N);
  private scratch = new Float32Array(N);
  private pose = new Float32Array(N); // 最终摆到骨骼上的角度 = 弹簧的结果 + 步态的摆动
  // 步态的周期摆动:直接叠加,不经过弹簧(否则步频一高,动作就被弹簧抹平、拖在后面)
  private gaitRaw = new Float32Array(N);
  private gaitW = 0;
  private gaitTarget = 0;
  private moving = false;
  private runPhase = 0;
  private shufflePhase = 0;
  private shuffle = 0; // 滑步的比重 0..1
  private shuffleSide = 0; // 滑步的方向:+1 往自己右手边
  private prevFwd = 0;
  private prevRight = 0;
  private accFwd = 0;
  private accRight = 0;
  private time = Math.random() * 10;
  private moveYaw = 0;
  private seenHit = -1;
  private hop = 1; // 垫步进度 0..1,1 表示没有在垫步
  private probes: { node: THREE.Object3D; radius: number }[] = [];
  private lift = 0;
  private baseYaw: number;

  constructor(template: THREE.Object3D, palette: Palette, dir: 1 | -1) {
    this.baseYaw = dir > 0 ? 0 : Math.PI;
    const model = cloneSkinned(template);
    this.root.add(model);

    // 按材质名换成卡通材质和球员配色
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false; // 蒙皮网格的包围盒不随姿势更新
      const convert = (m: THREE.Material): THREE.Material => {
        const name = m.name as keyof Palette;
        if (name === 'Strings') {
          return new THREE.MeshBasicMaterial({ color: palette.Strings, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
        }
        return toon(palette[name] ?? 0xffffff, { side: THREE.DoubleSide });
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
    });

    // 记录每根骨骼静止时在模型空间里的朝向,用来把"模型空间的关节角度"换算成骨骼的局部旋转
    this.root.updateMatrixWorld(true);
    const rootInv = this.root.getWorldQuaternion(new THREE.Quaternion()).invert();
    const modelQuat = (o: THREE.Object3D): THREE.Quaternion =>
      rootInv.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion()));
    const find = (name: string): THREE.Bone => {
      const bone = model.getObjectByName(name) as THREE.Bone | undefined;
      if (!bone) throw new Error(`模型缺少骨骼 ${name}`);
      return bone;
    };
    for (const j of JOINTS) {
      const bone = find(BONE_OF[j]);
      this.bindings.push({ bone, rest: modelQuat(bone), parentInv: modelQuat(bone.parent!).invert() });
    }
    // 把防穿地的采样点挂到对应的骨骼上(此时模型还是静止姿势)
    const probePos = new THREE.Vector3();
    for (const [name, x, y, z, radius] of GROUND_PROBES) {
      const bone = find(name);
      const node = new THREE.Object3D();
      node.position.copy(bone.worldToLocal(this.root.localToWorld(probePos.set(x, y, z))));
      bone.add(node);
      this.probes.push({ node, radius });
    }
    this.hips = find('Hips');
    this.hipsRest.copy(this.hips.position);
    // 模型空间的"向上"在髋骨父节点坐标系里的方向
    this.hipsUp.set(0, 1, 0).applyQuaternion(modelQuat(this.hips.parent!).invert());
    this.apply();
  }

  /** 挥拍:髋和躯干先转(先发力),手臂随后甩出去(晚发力),形成发力链 */
  private swingPose(p: Player): void {
    const fh = p.side > 0;
    const prep = fh ? POSES.fhPrep : POSES.bhPrep;
    const contact = fh ? POSES.fhContact : POSES.bhContact;
    let follow = fh ? POSES.fhFollow : POSES.bhFollow;
    if (p.lunge) follow = fh ? POSES.stretchF : POSES.stretchB;
    const T = TUNING.impactT;
    const sample = (time: number, from: number, to: number, lead: boolean): void => {
      if (time < T) {
        const u = clamp(time / T, 0, 1);
        mix(prep, p.lunge ? follow : contact, lead ? easeOut(u) : easeIn(u), this.target, from, to);
      } else {
        mix(contact, follow, easeOut(clamp((time - T) / 0.2, 0, 1)), this.target, from, to);
      }
    };
    sample(p.strokeT + 0.03, 0, N, true); // 身体领先
    sample(p.strokeT - 0.012, ARM_START, ARM_END, false); // 手臂滞后
    if (p.whiff && p.strokeT > T) {
      // 打空:没有球的阻力,整个人被球拍带得转过头、重心下沉
      const over = smooth(clamp((p.strokeT - T) / 0.25, 0, 1));
      const sign = fh ? 1 : -1;
      this.target[SPINE + 1] += sign * 0.45 * over;
      this.target[YAW] += sign * 0.4 * over;
      this.target[HIP] -= 0.1 * over;
    }
  }

  private divePose(p: Player): void {
    // 以球员自己的左右为准:扑向持拍手一侧还是另一侧
    const lateral = p.diveVx * p.dir;
    const set = lateral >= 0 ? DIVE.right : DIVE.left;
    if (p.strokeT < TUNING.diveTime + 0.04) this.target.set(set.fly);
    else if (p.strokeT < 0.74) this.target.set(set.ground);
    else this.target.set(set.up);
  }

  /**
   * 移动时的步态。两种步子按情况混合:
   * - 跑:一条腿依次落地、支撑、蹬地、折叠小腿、抬膝前摆;手臂反向摆动,骨盆和肩反向扭转,
   *   每一步身体腾空一次;步幅随速度变大。倒退时同一套动作倒着走。
   * - 滑步:小范围横向移动(以及引拍时的就位)面向球网,两腿一开一合。
   * arms 为 false 时(引拍、收拍)上身保持击球姿势,只有腿在动。
   */
  private locomotion(p: Player, dt: number, arms: boolean): void {
    this.moving = true;
    const speed = Math.hypot(p.vx, p.vz);
    // 换算到身体自己的前方和右手边(身体跑动时会转向移动方向)
    const cos = Math.cos(this.moveYaw);
    const sin = Math.sin(this.moveYaw);
    const toNet = -p.vz * p.dir;
    const toRight = p.vx * p.dir;
    const fwd = toNet * cos - toRight * sin;
    const right = toNet * sin + toRight * cos;
    const sprint = p.sprinting ? 1 : 0;
    const follow = (rate: number): number => 1 - Math.exp(-rate * dt);

    // 加速度:起跑时身体前压,急停时后仰,变向时向里倾
    if (dt > 0) {
      this.accFwd += ((fwd - this.prevFwd) / dt - this.accFwd) * follow(7);
      this.accRight += ((right - this.prevRight) / dt - this.accRight) * follow(7);
    }
    this.prevFwd = fwd;
    this.prevRight = right;

    const sideways = speed > 0.3 ? (right / speed) ** 2 : 0;
    const shuffleTarget = sideways * (arms ? 1 - smooth(clamp((speed - 2.5) / 2.5, 0, 1)) : 1);
    this.shuffle += (shuffleTarget - this.shuffle) * follow(10);
    this.shuffleSide += (Math.sign(right) - this.shuffleSide) * follow(12);
    const sh = this.shuffle;
    const run = 1 - sh;
    const backpedal = fwd < -0.4 * speed && speed > 0.5;

    // 步幅随速度变大(慢跑 0.9 米,全速 1.8 米,冲刺 2.3 米),步频自然跟着变,脚才不打滑
    const stepLength = Math.min(2.3, 0.6 + 0.16 * speed) * (backpedal ? 0.6 : 1);
    this.runPhase += (backpedal ? -1 : 1) * (speed / stepLength) * Math.PI * dt;
    this.shufflePhase += Math.min(3.2, speed / 0.65) * TAU * dt;
    this.gaitTarget = clamp(speed / 1.6, 0, 1);
    const blend = this.gaitTarget;

    // ---- 平均姿势(交给弹簧去过渡)
    const c = this.scratch;
    c.set(this.target);
    const thigh = RUN_MEAN.thigh * run + SHUFFLE_MEAN.thigh * sh;
    const knee = RUN_MEAN.knee * run + SHUFFLE_MEAN.knee * sh;
    const spread = 0.05 * run + SHUFFLE_MEAN.spread * sh;
    c.set([thigh, 0, spread], at('thighR'));
    c.set([knee, 0, 0], at('kneeR'));
    c.set([0, 0, 0], at('footR'));
    c.set([thigh, 0, -spread], at('thighL'));
    c.set([knee, 0, 0], at('kneeL'));
    c.set([0, 0, 0], at('footL'));
    c[HIP] = RUN_MEAN.hip * run + SHUFFLE_MEAN.hip * sh;
    const bank = clamp(-this.accRight * 0.008, -0.14, 0.14);
    if (arms) {
      const base = backpedal ? 0.06 : -(0.18 + 0.2 * clamp(speed / 7.4, 0, 1) + 0.14 * sprint);
      const lean = clamp(base - this.accFwd * 0.012, -0.75, 0.2);
      const u = run * blend; // 上身只在"跑"的时候换成跑步姿势,滑步时保持准备姿势
      mix(this.target, c, blend, this.target, LEGS_START, HIP + 1);
      const upper: [Joint, Angles][] = [
        ['hips', [0, 0, bank * 0.5]],
        ['spine', [lean, 0, bank]],
        ['head', [-lean * 0.7, 0, 0]],
        ['armR', [0.12, 0, 0.17]],
        ['elbowR', [1.45, 0, 0]],
        ['wristR', [-0.75, 0, 0]],
        ['armL', [0.12, 0, -0.17]],
        ['elbowL', [1.5, 0, 0]],
      ];
      for (const [joint, angles] of upper) {
        const i = at(joint);
        for (let k = 0; k < 3; k++) this.target[i + k] += (angles[k] - this.target[i + k]) * u;
      }
    } else {
      mix(this.target, c, blend, this.target, LEGS_START, HIP + 1);
      this.target[at('spine') + 2] += bank * 0.6 * blend;
    }

    // ---- 周期摆动(不经过弹簧)
    const g = this.gaitRaw;
    g.fill(0);
    const amount = (clamp(0.4 + (0.6 * speed) / 7.4, 0.4, 1) + 0.12 * sprint) * (backpedal ? 0.6 : 1) * (arms ? 1 : 0.75);
    const uR = frac(this.runPhase / TAU);
    const uL = frac(uR + 0.5);
    const stand = { thigh: 0.2, knee: -0.4 };
    const legs: [number, 'R' | 'L'][] = [
      [uR, 'R'],
      [uL, 'L'],
    ];
    for (const [u, side] of legs) {
      g[at(`thigh${side}`)] = run * (stand.thigh + amount * (cyclic(RUN.u, RUN.thigh, u) - stand.thigh) - RUN_MEAN.thigh);
      g[at(`knee${side}`)] = run * (stand.knee + amount * (cyclic(RUN.u, RUN.knee, u) - stand.knee) - RUN_MEAN.knee);
      g[at(`foot${side}`)] = run * amount * cyclic(RUN.u, RUN.foot, u);
    }
    // 两脚都离地的时候身体最高,单脚支撑时最低
    g[HIP] = run * 0.05 * amount * Math.cos(2 * TAU * (uR - 0.39));
    // 骨盆跟着前摆的腿转,肩反着转(摆臂);引拍时肩保持不动
    const twist = 0.17 * amount * Math.cos(TAU * (uR - 0.8));
    const counter = arms ? -2.1 * twist : -twist;
    g[at('hips') + 1] = run * twist;
    g[at('spine') + 1] = run * counter;
    g[at('head') + 1] = -run * (twist + counter); // 头不跟着晃
    if (arms) {
      const swingR = Math.cos(TAU * (uR - 0.3)); // 右臂和左腿一起向前
      const swingL = -swingR;
      g[at('armR')] = run * 0.72 * amount * swingR; // 持拍手摆得小一点
      g[at('elbowR')] = run * 0.22 * amount * swingR;
      g[at('armL')] = run * 0.9 * amount * swingL;
      g[at('elbowL')] = run * 0.3 * amount * swingL;
      g[at('spine')] = run * 0.03 * amount * Math.cos(2 * TAU * (uR - 0.05));
    }

    // 滑步:两腿一开一合,正在挪动的那条腿抬起来一点;并拢和分到最开时各蹬一下地
    const psi = this.shufflePhase;
    const open = 0.23 * -Math.cos(psi);
    const lift = Math.sin(psi);
    const leadR = 0.5 + 0.5 * this.shuffleSide;
    const liftR = leadR * Math.max(0, lift) + (1 - leadR) * Math.max(0, -lift);
    const liftL = (1 - leadR) * Math.max(0, lift) + leadR * Math.max(0, -lift);
    g[at('thighR') + 2] += sh * open;
    g[at('thighL') + 2] -= sh * open;
    g[at('thighR')] += sh * 0.22 * liftR;
    g[at('thighL')] += sh * 0.22 * liftL;
    g[at('kneeR')] -= sh * 0.5 * liftR;
    g[at('kneeL')] -= sh * 0.5 * liftL;
    g[HIP] += sh * 0.03 * Math.cos(2 * psi);
  }

  update(p: Player, dt: number, ctx: CharacterContext): void {
    this.time += dt;
    this.moving = false;
    let stiffness = 13; // 弹簧的角频率:越大跟得越紧
    let damping = 0.8;
    let lookAtBall = true;
    let idle = false;

    switch (p.stroke) {
      case 'prep': {
        // 蓄力越满,转体引拍越充分;蓄力时身体随呼吸微微起伏
        const prep = p.side > 0 ? POSES.fhPrep : POSES.bhPrep;
        mix(POSES.ready, prep, 0.5 + 0.5 * p.power, this.target);
        this.target[HIP] -= 0.035 * p.power + 0.012 * Math.sin(this.time * 9);
        this.locomotion(p, dt, false);
        stiffness = 15;
        break;
      }
      case 'swing':
        this.swingPose(p);
        stiffness = 46;
        damping = 0.72;
        break;
      case 'recover':
        // 先垂下球拍喘口气,快结束时回到准备姿势
        mix(POSES.recover, POSES.ready, smooth(clamp((p.strokeT / Math.max(p.recoverT, 0.05) - 0.35) / 0.65, 0, 1)), this.target);
        this.locomotion(p, dt, false);
        stiffness = 9;
        damping = 0.9;
        break;
      case 'dive':
        this.divePose(p);
        stiffness = p.strokeT < TUNING.diveTime ? 30 : 16;
        damping = 0.85;
        lookAtBall = p.strokeT < TUNING.diveTime;
        break;
      case 'toss':
        this.target.set(POSES.trophy);
        stiffness = 8;
        damping = 0.9;
        break;
      case 'serveSwing': {
        const t = p.strokeT - TUNING.impactT;
        if (t < 0.05) this.target.set(POSES.serveContact);
        else mix(POSES.serveContact, POSES.serveFollow, easeOut(clamp((t - 0.05) / 0.2, 0, 1)), this.target);
        stiffness = 40;
        damping = 0.75;
        break;
      }
      default: {
        idle = true;
        this.target.set(POSES.ready);
        // 待机不是一动不动:重心随呼吸起伏;球在场上时前脚掌不停小幅弹跳,保持随时能启动
        const lively = ctx.live ? 1 : 0.3;
        this.target[HIP] += lively * (0.018 * Math.sin(this.time * 7.5) - 0.01);
        this.target[at('spine')] += 0.03 * Math.sin(this.time * 2.1);
        this.target[at('armR') + 2] += 0.04 * Math.sin(this.time * 2.1 + 1);
        this.target[at('armL') + 2] -= 0.04 * Math.sin(this.time * 2.1 + 1);
        this.locomotion(p, dt, true);
        break;
      }
    }

    // 垫步:对手击球的瞬间轻轻跳一下再落地,这是真实球员启动前的动作
    if (ctx.hitSeq !== this.seenHit) {
      this.seenHit = ctx.hitSeq;
      if (ctx.incoming && idle) this.hop = 0;
    }
    if (this.hop < 1) {
      this.hop = Math.min(1, this.hop + dt / 0.3);
      const lift = Math.sin(this.hop * Math.PI);
      this.target[HIP] += 0.1 * lift - 0.05 * (1 - lift) * (this.hop > 0.5 ? 1 : 0);
      this.target[at('kneeR')] += 0.3 * lift;
      this.target[at('kneeL')] += 0.3 * lift;
    }

    // 眼睛跟着球:头转向球的方向,抵消掉躯干已经转过的角度
    if (lookAtBall && ctx.live) {
      const bodyYaw = this.baseYaw + this.moveYaw + this.current[YAW];
      const dx = ctx.ball.x - p.x;
      const dz = ctx.ball.z - p.z;
      const cos = Math.cos(-bodyYaw);
      const sin = Math.sin(-bodyYaw);
      const lx = dx * cos + dz * sin;
      const lz = -dx * sin + dz * cos;
      const torso = this.target[at('spine') + 1] + this.target[at('hips') + 1];
      const yaw = Math.atan2(-lx, -lz) - torso;
      const pitch = Math.atan2(ctx.ball.y - 1.6, Math.max(Math.hypot(lx, lz), 1.5));
      this.target[at('head') + 1] = clamp(yaw, -1.15, 1.15);
      this.target[at('head')] = clamp(-this.target[at('spine')] * 0.8 + pitch * 0.8, -0.5, 0.75);
    }

    // 步态摆动的强弱:起步时渐入,停下或开始挥拍时很快收掉
    this.gaitW += ((this.moving ? this.gaitTarget : 0) - this.gaitW) * (1 - Math.exp(-(this.moving ? 10 : 18) * dt));

    // 弹簧积分(步长过大时拆成几小步,避免不稳定)
    const steps = Math.max(1, Math.ceil(dt / (1 / 90)));
    const h = dt / steps;
    const k = stiffness * stiffness;
    const c = 2 * damping * stiffness;
    for (let n = 0; n < steps; n++) {
      for (let i = 0; i < N; i++) {
        this.velocity[i] += (k * (this.target[i] - this.current[i]) - c * this.velocity[i]) * h;
        this.current[i] += this.velocity[i] * h;
      }
    }

    // 跑动时身体转向移动方向:横向跑转得多,倒退时基本保持面向球网
    const speed = Math.hypot(p.vx, p.vz);
    const lateral = (p.vx * p.dir) / Math.max(speed, 1);
    const forward = (-p.vz * p.dir) / Math.max(speed, 1);
    // 小范围移动面向球网滑步;跑起来才把身体转向移动方向(倒退时基本保持面向球网)
    const turn = idle ? smooth(clamp((speed - 2.2) / 3, 0, 1)) * (forward < -0.4 ? 0.35 : 1.3) : p.stroke === 'prep' ? 0.15 : 0;
    this.moveYaw += (-lateral * turn - this.moveYaw) * (1 - Math.exp(-9 * dt));

    this.root.position.set(p.x, 0, p.z);
    this.root.rotation.y = this.baseYaw + this.moveYaw + this.current[YAW];
    this.apply();
    this.keepAboveGround(dt);
  }

  /** 扑救、大弓步这类贴地的姿势里,身体任何部位都不能陷进地面:找出最低点,把整个人抬上来 */
  private keepAboveGround(dt: number): void {
    this.root.updateMatrixWorld(true);
    let lowest = Infinity;
    for (const { node, radius } of this.probes) {
      const e = node.matrixWorld.elements;
      lowest = Math.min(lowest, e[13] - radius);
    }
    const needed = Math.max(0, -lowest);
    // 需要抬高时立刻抬(不能穿地),放下来时慢一点,避免上下抖动
    this.lift = needed > this.lift ? needed : this.lift + (needed - this.lift) * (1 - Math.exp(-12 * dt));
    this.root.position.y = this.lift;
  }

  private apply(): void {
    const v = this.pose;
    for (let i = 0; i < N; i++) v[i] = this.current[i] + this.gaitW * this.gaitRaw[i];
    // 踝关节:抵消掉小腿的倾斜,让脚掌尽量放平;超出脚踝的活动范围时自然变成踮脚
    const hipsPitch = v[at('hips')];
    for (const [foot, thigh, knee] of FEET) v[foot] = clamp(v[foot] - (hipsPitch + v[thigh] + v[knee]), -0.9, 0.5);
    this.bindings.forEach((b, i) => {
      euler.set(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
      qPose.setFromEuler(euler);
      // 局部旋转 = 父节点静止朝向的逆 × 关节旋转 × 骨骼静止朝向
      b.bone.quaternion.copy(b.parentInv).multiply(qPose).multiply(b.rest);
    });
    this.hips.position.copy(this.hipsRest).addScaledVector(this.hipsUp, v[HIP]);
  }
}
