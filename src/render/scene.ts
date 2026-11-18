import * as THREE from 'three';
import { arenaHeight } from '../sim/ball';
import { BALL, TUNING } from '../sim/constants';
import { aimTarget, contactEta, GameState, serveTarget } from '../sim/game';
import { SHOT_COLORS } from './colors';
import { Character, loadPlayerModel, Palette } from './character';
import { buildStadium } from './stadium';
import { toon } from './toon';

const LIME = 0xb8e62e;
const BALL_SCALE = 3.4; // 球按真实尺寸在低分辨率下不到一个像素,放大显示
const TRAIL = 8;
/** 画面纵向的目标像素行数:数值越小像素感越强 */
const PIXEL_ROWS = 300;

const PALETTES: [Palette, Palette] = [
  {
    Skin: 0xe9b58c,
    Shirt: 0xffffff,
    Trim: LIME,
    Shorts: 0x35157f,
    Shoes: LIME,
    Sock: 0xffffff,
    Hair: 0x2b1a12,
    Eye: 0x1a1030,
    Band: LIME,
    Racket: LIME,
    Grip: 0x1a1030,
    Strings: 0xffffff,
  },
  {
    Skin: 0xc98f65,
    Shirt: 0xff7a59,
    Trim: 0xffffff,
    Shorts: 0x2a1260,
    Shoes: 0xffffff,
    Sock: 0xffffff,
    Hair: 0x15100c,
    Eye: 0x1a1030,
    Band: 0xffffff,
    Racket: 0xffffff,
    Grip: 0x1a1030,
    Strings: 0xffffff,
  },
];

/** 时机圆环的半径:离最佳松手时刻越远,圈越大 */
const timingRadius = (lead: number): number => 0.6 + lead * 1.5;

function flatMarker(geometry: THREE.BufferGeometry, color: number, opacity: number): THREE.Mesh {
  const m = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }),
  );
  m.rotation.x = -Math.PI / 2;
  m.visible = false;
  return m;
}

export class GameScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  // 近裁剪面设得远一些,深度精度才够,地面上的线条不会闪烁
  private camera = new THREE.PerspectiveCamera(38, 1, 1.5, 400);
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private landing: THREE.Mesh;
  private aim: THREE.Group;
  private timingOk: THREE.Mesh;
  private timingPerfect: THREE.Mesh;
  private timingRing: THREE.Mesh;
  private goalMarker: THREE.Mesh;
  private goal: { x: number; z: number; w: number; d: number } | null = null;
  private clock = 0;
  private trail: THREE.Mesh[] = [];
  private trailPos: THREE.Vector3[] = [];
  private characters: [Character, Character];
  private camX = 0;
  private camBack = 0;
  private cinemaT = 0;
  private projected = new THREE.Vector3();

  static async create(canvas: HTMLCanvasElement): Promise<GameScene> {
    return new GameScene(canvas, await loadPlayerModel());
  }

  private constructor(canvas: HTMLCanvasElement, model: THREE.Object3D) {
    // 像素风:关闭抗锯齿,用低分辨率渲染,再由 CSS 以最近邻方式放大
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    canvas.style.imageRendering = 'pixelated';

    const lowPower = window.matchMedia('(pointer: coarse)').matches;
    buildStadium(this.scene, lowPower ? 1024 : 2048, this.renderer.capabilities.getMaxAnisotropy());

    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL.radius * BALL_SCALE, 1), toon(LIME, { emissive: LIME, emissiveIntensity: 0.25 }));
    this.ball.castShadow = true;

    // 球的贴地阴影:比真实投影更容易判断落点
    this.ballShadow = flatMarker(new THREE.CircleGeometry(0.16, 12), 0x1a0a40, 0.45);
    this.ballShadow.visible = true;
    // 来球的预测落点
    this.landing = flatMarker(new THREE.RingGeometry(0.3, 0.46, 20), LIME, 0.9);
    // 自己的瞄准点
    this.aim = new THREE.Group();
    const ring = flatMarker(new THREE.RingGeometry(0.42, 0.6, 20), 0xffffff, 0.95);
    const dot = flatMarker(new THREE.CircleGeometry(0.16, 10), 0xffffff, 0.95);
    ring.visible = dot.visible = true;
    this.aim.add(ring, dot);
    this.aim.visible = false;

    // 挥拍时机提示:一圈白线随着球的接近向内收缩。
    // 浅色宽带是"现在松手能打到"的区间,中间的亮绿色窄带是完美区间。
    const ringAt = timingRadius;
    this.timingOk = flatMarker(new THREE.RingGeometry(ringAt(-TUNING.timingLateMax), ringAt(TUNING.timingEarlyMax), 32), 0xffffff, 0.2);
    this.timingPerfect = flatMarker(
      new THREE.RingGeometry(ringAt(-TUNING.timingLatePerfect), ringAt(TUNING.timingEarlyPerfect), 32),
      LIME,
      0.6,
    );
    this.timingRing = flatMarker(new THREE.RingGeometry(0.93, 1.0, 32), 0xffffff, 1);
    this.scene.add(this.timingOk, this.timingPerfect, this.timingRing);

    // 教学用的发光目标:要跑到的位置,或者要把球打进去的区域
    this.goalMarker = flatMarker(new THREE.PlaneGeometry(1, 1), LIME, 0.5);
    this.scene.add(this.goalMarker);

    for (let i = 0; i < TRAIL; i++) {
      const m = new THREE.Mesh(
        new THREE.IcosahedronGeometry(BALL.radius * BALL_SCALE * 0.8, 0),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }),
      );
      this.trail.push(m);
      this.trailPos.push(new THREE.Vector3());
      this.scene.add(m);
    }

    this.characters = [new Character(model, PALETTES[0], 1), new Character(model, PALETTES[1], -1)];
    this.scene.add(this.ball, this.ballShadow, this.landing, this.aim);
    this.scene.add(this.characters[0].root, this.characters[1].root);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // 每个"游戏像素"占整数个屏幕像素,放大后才整齐
    const dpr = window.devicePixelRatio || 1;
    const block = Math.max(1, Math.round((h * dpr) / PIXEL_ROWS));
    this.renderer.setPixelRatio(dpr / block);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // 窗口较窄时拉大视角,保证整个球场宽度都在画面内
    this.camera.fov = aspect >= 1.6 ? 36 : Math.min(75, 36 * (1.6 / aspect));
    this.camera.updateProjectionMatrix();
  }

  /** 设置(或清除)场地上的发光目标 */
  setGoal(goal: { x: number; z: number; w: number; d: number } | null): void {
    this.goal = goal;
  }

  /** 把世界坐标投影到屏幕(CSS 像素),用于把 HUD 元素贴在球员身上 */
  toScreen(x: number, y: number, z: number): { x: number; y: number } {
    this.projected.set(x, y, z).project(this.camera);
    return { x: (this.projected.x * 0.5 + 0.5) * window.innerWidth, y: (-this.projected.y * 0.5 + 0.5) * window.innerHeight };
  }

  /** cinematic 为真时用缓慢横移的展示机位(开始页面的背景),否则跟随 0 号球员 */
  render(state: GameState, dt: number, cinematic = false): void {
    const me = state.players[0];
    this.camX += (me.x - this.camX) * (1 - Math.exp(-5 * dt));
    // 球员退到底线后方较远时,机位跟着后撤,避免人物出画
    const back = Math.max(0, me.z - 12.5);
    this.camBack += (back - this.camBack) * (1 - Math.exp(-4 * dt));
    if (cinematic) {
      this.cinemaT += dt;
      this.camera.position.set(Math.sin(this.cinemaT * 0.12) * 11, 10.5, 29);
      this.camera.lookAt(0, 0.5, -3);
    } else {
      this.camera.position.set(this.camX * 0.4, 7.6 + this.camBack * 0.25, 24.2 + this.camBack * 1.1);
      this.camera.lookAt(this.camX * 0.22, 0.4, 0.5 + this.camBack * 0.5);
    }

    const live = state.phase === 'rally' || state.phase === 'serve';
    state.players.forEach((p, i) => {
      const incoming = state.phase === 'rally' && state.lastHitter !== null && state.lastHitter !== i;
      this.characters[i].update(p, dt, { ball: state.ball.pos, incoming, live, hitSeq: state.hitSeq });
    });

    const b = state.ball.pos;
    const r = BALL.radius * BALL_SCALE;
    this.ball.position.set(b.x, Math.max(b.y, r), b.z);
    this.ballShadow.position.set(b.x, 0.014, b.z);
    this.ballShadow.visible = arenaHeight(b.x, b.z) === 0; // 落在墙头或看台上时,地面上不该有影子
    this.ballShadow.scale.setScalar(0.85 + b.y * 0.08);

    // 拖尾:球速越快越明显
    const v = state.ball.vel;
    const speed = Math.hypot(v.x, v.y, v.z);
    for (let i = TRAIL - 1; i > 0; i--) this.trailPos[i].copy(this.trailPos[i - 1]);
    this.trailPos[0].copy(this.ball.position);
    const strength = state.phase === 'serve' ? 0 : Math.min(1, speed / 26);
    for (let i = 0; i < TRAIL; i++) {
      this.trail[i].position.copy(this.trailPos[i]);
      (this.trail[i].material as THREE.MeshBasicMaterial).opacity = strength * 0.45 * (1 - i / TRAIL);
    }

    // 来球的预测落点,颜色表示对手用的球种
    const pred = state.prediction;
    const incoming = state.phase === 'rally' && state.lastHitter === 1 && pred !== null && pred.z > 0 && state.bounces === 0;
    this.landing.visible = incoming && !cinematic;
    if (incoming && pred) {
      this.landing.position.set(pred.x, 0.016, pred.z);
      (this.landing.material as THREE.MeshBasicMaterial).color.setHex(SHOT_COLORS[state.lastShot ?? 'flat']);
    }

    // 自己的准星:引拍或抛球时显示在对方半场,颜色表示自己选的球种
    const tossing = state.tossing && state.score.server === 0;
    const aiming = tossing || me.stroke === 'prep' || (me.stroke === 'swing' && !me.impactDone);
    this.aim.visible = aiming && !cinematic;
    if (aiming) {
      const t = tossing ? serveTarget(me) : aimTarget(me);
      this.aim.position.set(t.x, 0.02, t.z);
      const color = SHOT_COLORS[tossing ? 'serve' : me.shot];
      for (const part of this.aim.children) ((part as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(color);
    }

    // 发光目标:一明一暗地闪,引导视线
    this.clock += dt;
    this.goalMarker.visible = this.goal !== null && !cinematic;
    if (this.goal) {
      this.goalMarker.position.set(this.goal.x, 0.034, this.goal.z);
      this.goalMarker.scale.set(this.goal.w, this.goal.d, 1);
      (this.goalMarker.material as THREE.MeshBasicMaterial).opacity = 0.62 + 0.22 * Math.sin(this.clock * 6);
    }

    // 挥拍时机圆环:画在自己球拍一侧的脚边。已经松手之后就不再显示
    const eta = cinematic ? null : contactEta(state, 0);
    const lead = eta === null ? 0 : eta - TUNING.impactT; // 距离最佳松手时刻还有多久
    const timing = eta !== null && lead > -0.25 && lead < 1.2 && (me.stroke === 'none' || me.stroke === 'prep') && pred !== null;
    this.timingOk.visible = this.timingPerfect.visible = this.timingRing.visible = timing;
    if (timing && pred) {
      const side = pred.ix >= me.x ? 1 : -1;
      const x = me.x + side * TUNING.sweetSide;
      const z = me.z - TUNING.sweetFront;
      this.timingOk.position.set(x, 0.028, z);
      this.timingPerfect.position.set(x, 0.03, z);
      this.timingRing.position.set(x, 0.032, z);
      this.timingRing.scale.setScalar(timingRadius(Math.max(lead, -TUNING.timingLateMax - 0.05)));
      // 白色:还早;青柠色:现在松手能打到;红色:已经晚了
      const inWindow = lead <= TUNING.timingEarlyMax && lead >= -TUNING.timingLateMax;
      const ringColor = lead < -TUNING.timingLateMax ? 0xff5a3c : inWindow ? LIME : 0xffffff;
      (this.timingRing.material as THREE.MeshBasicMaterial).color.setHex(ringColor);
      (this.timingOk.material as THREE.MeshBasicMaterial).opacity = inWindow ? 0.34 : 0.18;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
