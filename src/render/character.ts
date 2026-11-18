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
  'thighL',
  'kneeL',
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
  thighL: 'ThighL',
  kneeL: 'ShinL',
};

const N = JOINTS.length * 3 + 2;
const HIP = N - 2;
const YAW = N - 1;
const at = (j: Joint): number => JOINTS.indexOf(j) * 3;
/** 手臂通道的范围:挥拍时手臂比身体晚发力,要单独取时间 */
const ARM_START = at('armR');
const ARM_END = at('elbowL') + 3;
const SPINE = at('spine');

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
const easeIn = (t: number): number => t * t * t;
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** 材质名 → 颜色。材质名来自建模脚本,每个球员用自己的一套配色。 */
export type Palette = Record<
  'Skin' | 'Shirt' | 'Shorts' | 'Shoes' | 'Sock' | 'Hair' | 'Band' | 'Racket' | 'Grip' | 'Strings',
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
  ['HandR', 0.262, 0.85, 0, 0.06],
  ['LowerArmL', -0.262, 0.85, 0, 0.06],
  // 球拍:拍头的顶端和左右两侧
  ['HandR', 0.262, 0.175, 0, 0.02],
  ['HandR', 0.39, 0.345, 0, 0.02],
  ['HandR', 0.134, 0.345, 0, 0.02],
  ['ShinR', 0.095, 0.5, 0, 0.075],
  ['ShinL', -0.095, 0.5, 0, 0.075],
  // 脚:脚尖和脚跟
  ['ShinR', 0.095, 0.03, -0.19, 0.03],
  ['ShinR', 0.095, 0.03, 0.08, 0.03],
  ['ShinL', -0.095, 0.03, -0.19, 0.03],
  ['ShinL', -0.095, 0.03, 0.08, 0.03],
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
  private runPhase = 0;
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
          return new THREE.MeshBasicMaterial({ color: palette.Strings, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
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

  /** 跑动:腿交替摆动、手臂反向摆臂、躯干前倾并反向扭转;倒退时步子反着走 */
  private locomotion(p: Player, dt: number, arms: boolean): void {
    const speed = Math.hypot(p.vx, p.vz);
    const blend = clamp(speed / 2.6, 0, 1);
    const forward = -p.vz * p.dir; // 朝球网方向的速度
    const backpedal = forward < -0.4 * speed && speed > 0.5;
    const sprint = p.sprinting ? 1 : 0;
    this.runPhase += (backpedal ? -1 : 1) * speed * dt * (2.5 - 0.3 * sprint);
    if (blend < 0.04) return;

    const s = Math.sin(this.runPhase);
    const c = Math.cos(this.runPhase);
    const stride = 0.78 + 0.3 * sprint;
    const legs = this.scratch;
    legs.set(this.target);
    legs.set([0.3 + stride * s, 0, 0.06], at('thighR'));
    legs.set([-0.45 - 1.05 * Math.max(0, -c), 0, 0], at('kneeR'));
    legs.set([0.3 - stride * s, 0, -0.06], at('thighL'));
    legs.set([-0.45 - 1.05 * Math.max(0, c), 0, 0], at('kneeL'));
    legs[HIP] = -0.05 + 0.055 * Math.abs(c);
    legs.set([0, 0.16 * s, 0.05 * s], at('hips'));
    if (arms) {
      const lean = backpedal ? 0.05 : -(0.34 + 0.22 * sprint);
      legs.set([lean, -0.3 * s, 0], at('spine'));
      legs.set([-lean * 0.7, 0, 0], at('head'));
      legs.set([0.15 - (0.75 + 0.2 * sprint) * s, 0, 0.18], at('armR'));
      legs.set([1.45, 0, 0], at('elbowR'));
      legs.set([-0.8, 0, 0], at('wristR'));
      legs.set([0.15 + (0.75 + 0.2 * sprint) * s, 0, -0.18], at('armL'));
      legs.set([1.45, 0, 0], at('elbowL'));
      mix(this.target, legs, blend, this.target);
    } else {
      // 引拍或收拍时上身保持击球姿势,只让腿跑起来
      mix(this.target, legs, blend, this.target, at('thighR'), HIP + 1);
      mix(this.target, legs, blend * 0.5, this.target, at('hips'), at('hips') + 3);
    }
  }

  update(p: Player, dt: number, ctx: CharacterContext): void {
    this.time += dt;
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
    const turn = idle ? clamp(speed / 4, 0, 1) * (forward < -0.4 ? 0.35 : 1.05) : p.stroke === 'prep' ? 0.25 : 0;
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
    this.bindings.forEach((b, i) => {
      euler.set(this.current[i * 3], this.current[i * 3 + 1], this.current[i * 3 + 2]);
      qPose.setFromEuler(euler);
      // 局部旋转 = 父节点静止朝向的逆 × 关节旋转 × 骨骼静止朝向
      b.bone.quaternion.copy(b.parentInv).multiply(qPose).multiply(b.rest);
    });
    this.hips.position.copy(this.hipsRest).addScaledVector(this.hipsUp, this.current[HIP]);
  }
}
