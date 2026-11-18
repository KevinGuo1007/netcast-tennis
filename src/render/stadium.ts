import * as THREE from 'three';
import { COURT } from '../sim/constants';
import { toon } from './toon';

// 配色取自 Netcast Tennis 的 Logo:紫色渐变、青柠绿、白色
const C = {
  skyTop: '#5a2fc8',
  skyLow: '#d9c9ff',
  fog: 0xd0beff,
  apronA: 0x4b24ac,
  apronB: 0x44209f,
  courtA: 0x7d47dc,
  courtB: 0x7440d4,
  line: 0xffffff,
  wall: 0x2a1260,
  stand: 0xe4d9ff,
  seat: 0xb9a0f2,
  lime: 0xb8e62e,
  limeDark: 0x8fc21f,
  trunk: 0x5a3a7a,
  metal: 0xd8d0f0,
};

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** 两色棋盘格:像参考画面里的地块一样带一点明暗交替 */
function checker(a: number, b: number, repeatX: number, repeatY: number): THREE.CanvasTexture {
  const tex = canvasTexture(2, 2, (ctx) => {
    ctx.fillStyle = hex(a);
    ctx.fillRect(0, 0, 2, 2);
    ctx.fillStyle = hex(b);
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillRect(1, 1, 1, 1);
  });
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX / 2, repeatY / 2);
  return tex;
}

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(color));
  m.position.set(x, y, z);
  return m;
}

function ground(w: number, d: number, material: THREE.Material, y: number, x = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

function buildSky(scene: THREE.Scene): void {
  scene.background = canvasTexture(4, 256, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, C.skyTop);
    g.addColorStop(0.7, C.skyLow);
    g.addColorStop(1, C.skyLow);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
  });
  scene.fog = new THREE.Fog(C.fog, 70, 190);

  // 方块云
  const cloud = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  for (const [x, y, z, s] of [
    [-34, 30, -78, 1.2],
    [8, 36, -92, 1.6],
    [44, 27, -74, 1],
    [-62, 24, -52, 0.9],
    [66, 33, -58, 1.3],
  ]) {
    const g = new THREE.Group();
    for (const [dx, dy, w, h] of [
      [0, 0, 12, 3],
      [-3, 2.4, 6, 3],
      [3.5, 1.8, 5, 2.4],
    ]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 4), cloud);
      m.position.set(dx, dy, 0);
      g.add(m);
    }
    g.position.set(x, y, z);
    g.scale.setScalar(s);
    scene.add(g);
  }
}

function buildCourt(scene: THREE.Scene): void {
  const L = COURT.halfLength;
  const W = COURT.halfWidth;
  const D = COURT.doublesHalfWidth;
  const S = COURT.serviceLine;
  const t = 0.1; // 线比真实的宽一些,低分辨率下才看得清

  const apron = ground(48, 64, toon(0xffffff, { map: checker(C.apronA, C.apronB, 24, 32) }), 0);
  const court = ground(D * 2, L * 2, toon(0xffffff, { map: checker(C.courtA, C.courtB, 8, 16) }), 0.004);
  apron.receiveShadow = true;
  court.receiveShadow = true;
  scene.add(apron, court);

  // 线条比地面高出一截并加深度偏移,避免和地面抢深度导致线条断裂
  const lineMat = toon(C.line, { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const line = (x: number, z: number, w: number, d: number): void => {
    const m = ground(w, d, lineMat, 0.025, x, z);
    m.receiveShadow = true;
    scene.add(m);
  };
  for (const s of [-1, 1]) {
    line(0, s * L, D * 2 + t, t * 1.5); // 底线
    line(s * W, 0, t, L * 2); // 单打边线
    line(s * D, 0, t, L * 2); // 双打边线
    line(0, s * S, W * 2, t); // 发球线
    line(0, s * (L - 0.2), t, 0.4); // 中点标记
  }
  line(0, 0, t, S * 2); // 中线

  // 底线后的品牌字样
  const brand = canvasTexture(512, 80, (ctx) => {
    ctx.font = '900 68px "Avenir Next", "Helvetica Neue", Arial, sans-serif';
    ctx.textBaseline = 'middle';
    const width = ctx.measureText('NETCAST').width;
    const nWidth = ctx.measureText('N').width;
    ctx.fillStyle = hex(C.lime);
    ctx.fillText('N', 256 - width / 2, 42);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('ETCAST', 256 - width / 2 + nWidth, 42);
  });
  for (const s of [-1, 1]) {
    const m = ground(9, 1.4, new THREE.MeshBasicMaterial({ map: brand, transparent: true, depthWrite: false }), 0.03);
    m.position.z = s * (L + 3.4);
    scene.add(m);
  }
}

function buildNet(scene: THREE.Scene): void {
  const H = COURT.netHeight;
  const W = COURT.netHalfWidth;
  const mesh = canvasTexture(8, 8, (ctx) => {
    ctx.clearRect(0, 0, 8, 8);
    ctx.fillStyle = 'rgba(20,8,50,0.3)';
    ctx.fillRect(0, 0, 8, 8);
    ctx.fillStyle = 'rgba(20,8,50,0.95)';
    ctx.fillRect(0, 0, 8, 2);
    ctx.fillRect(0, 0, 2, 8);
  });
  mesh.magFilter = THREE.NearestFilter;
  mesh.minFilter = THREE.NearestFilter;
  mesh.generateMipmaps = false;
  mesh.wrapS = mesh.wrapT = THREE.RepeatWrapping;
  mesh.repeat.set(W * 2 * 3.5, H * 3.5);
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 2, H),
    new THREE.MeshBasicMaterial({ map: mesh, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
  );
  net.position.y = H / 2;
  const tape = box(W * 2, 0.1, 0.05, C.line, 0, H, 0);
  const strap = box(0.08, H, 0.05, C.line, 0, H / 2, 0);
  tape.castShadow = true;
  scene.add(net, tape, strap);
  for (const s of [-1, 1]) {
    const post = box(0.12, H + 0.14, 0.12, C.metal, s * W, (H + 0.14) / 2, 0);
    post.castShadow = true;
    scene.add(post);
  }
}

/** 文字标的宽高比(public/brand/wordmark*.png) */
const WORDMARK_ASPECT = 849 / 110;

function buildWallsAndBoards(scene: THREE.Scene, anisotropy: number): void {
  const loader = new THREE.TextureLoader();
  const load = (url: string): THREE.Texture => {
    const tex = loader.load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    // 广告牌多是斜着看的,开各向异性过滤才不会糊成一片
    tex.anisotropy = anisotropy;
    return tex;
  };
  const wordmark = load('/brand/wordmark.png'); // 紫色字,用在白色广告牌上
  const wordmarkLight = load('/brand/wordmark-light.png'); // 白色字,直接贴在深色墙面上
  const icon = load('/brand/icon.png');

  const logoPlane = (map: THREE.Texture, width: number, height: number): THREE.Mesh =>
    new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map, transparent: true }));

  /** 白底广告牌:文字标尽量撑满,字才够大 */
  const board = (x: number, y: number, z: number, rotY: number, width: number, height: number): void => {
    const g = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const textHeight = Math.min(height * 0.62, (width * 0.9) / WORDMARK_ASPECT);
    const logo = logoPlane(wordmark, textHeight * WORDMARK_ASPECT, textHeight);
    logo.position.z = 0.01;
    g.add(panel, logo);
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    scene.add(g);
  };

  // 远端背墙:正中一幅大的白字文字标,两侧各一个图标
  const backZ = -19;
  const back = box(34, 3.4, 0.4, C.wall, 0, 1.7, backZ - 0.2);
  back.castShadow = true;
  scene.add(back, box(34, 0.16, 0.46, C.lime, 0, 3.48, backZ - 0.2));
  const bannerHeight = 1.9;
  const banner = logoPlane(wordmarkLight, bannerHeight * WORDMARK_ASPECT, bannerHeight);
  banner.position.set(0, 1.75, backZ + 0.02);
  scene.add(banner);
  for (const s of [-1, 1]) {
    const badge = logoPlane(icon, 2.3, 2.3);
    badge.position.set(s * 11.2, 1.75, backZ + 0.02);
    scene.add(badge);
  }

  // 近端矮墙(在机位下方,不挡视线)
  scene.add(box(34, 1.0, 0.4, C.wall, 0, 0.5, 19.2));

  // 两侧矮墙:每侧四块大广告牌
  for (const s of [-1, 1]) {
    const x = s * 11;
    scene.add(box(0.4, 1.4, 38.4, C.wall, x + s * 0.2, 0.7, 0));
    scene.add(box(0.46, 0.12, 38.4, C.lime, x + s * 0.2, 1.46, 0));
    for (const z of [-13.8, -4.6, 4.6, 13.8]) board(x - s * 0.02, 0.7, z, -s * (Math.PI / 2), 8.4, 1.2);
  }
}

function buildStands(scene: THREE.Scene): void {
  const rows = 8;
  const rise = 0.7;
  const run = 1.0;
  const people: { x: number; y: number; z: number; rot: number }[] = [];
  const standMat = toon(C.stand);
  const seatMat = toon(C.seat);

  const tier = (length: number, place: (m: THREE.Object3D, offset: number, y: number) => void, rot: number): void => {
    for (let r = 0; r < rows; r++) {
      const y = 1.3 + r * rise;
      const step = new THREE.Mesh(new THREE.BoxGeometry(length, y, run), standMat);
      place(step, 0.6 + r * run, y / 2);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(length, 0.1, run * 0.5), seatMat);
      place(bench, 0.6 + r * run + 0.1, y + 0.05);
      scene.add(step, bench);
      for (let u = -length / 2 + 0.6; u < length / 2 - 0.4; u += 0.8) {
        if (Math.random() < 0.16) continue; // 留一些空座
        const probe = new THREE.Object3D();
        probe.position.x = u + (Math.random() - 0.5) * 0.2;
        place(probe, 0.6 + r * run + 0.05, y + 0.1);
        people.push({ x: probe.position.x, y: probe.position.y, z: probe.position.z, rot });
      }
    }
  };

  // 远端看台
  tier(34, (m, off, y) => m.position.set(m.position.x, y, -19.6 - off), 0);
  // 两侧看台
  for (const s of [-1, 1]) {
    tier(
      38,
      (m, off, y) => {
        const u = m.position.x;
        m.position.set(s * (11.6 + off), y, u);
        m.rotation.y = Math.PI / 2;
      },
      -s * (Math.PI / 2),
    );
  }

  // 观众:方块身体和方块头,用实例化网格
  const shirts = [0xffffff, 0xb8e62e, 0xff7a59, 0x8f6bff, 0x39c6ff, 0xffd166, 0xff5fa2, 0x4a2a90, 0x2a1260];
  const skins = [0xf2c9a5, 0xd9a47a, 0xa8714b, 0x7a4f33, 0xffdbc0];
  const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.6, 0.34), toon(0xffffff), people.length);
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), toon(0xffffff), people.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  people.forEach((p, i) => {
    const scale = 0.9 + Math.random() * 0.25;
    dummy.position.set(p.x, p.y + 0.3 * scale, p.z);
    dummy.rotation.set(0, p.rot, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    bodies.setMatrixAt(i, dummy.matrix);
    bodies.setColorAt(i, color.setHex(shirts[Math.floor(Math.random() * shirts.length)]));
    dummy.position.y = p.y + 0.76 * scale;
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
    heads.setColorAt(i, color.setHex(skins[Math.floor(Math.random() * skins.length)]));
  });
  scene.add(bodies, heads);

  // 看台顶部的护栏
  const topY = 1.3 + rows * rise;
  scene.add(box(36, 0.7, 0.3, C.wall, 0, topY + 0.2, -19.6 - 0.7 - rows * run));
  for (const s of [-1, 1]) scene.add(box(0.3, 0.7, 39, C.wall, s * (11.6 + 0.7 + rows * run), topY + 0.2, 0));
}

function buildTrees(scene: THREE.Scene): void {
  // 看台后面一圈低多边形的树,颜色用青柠绿
  const foliageA = toon(C.lime);
  const foliageB = toon(C.limeDark);
  const trunkMat = toon(C.trunk);
  const tree = (x: number, z: number, s: number): void => {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.7, 5, 0.7), trunkMat);
    trunk.position.y = 2.5;
    const low = new THREE.Mesh(new THREE.IcosahedronGeometry(3.2, 0), foliageB);
    low.position.y = 6.2;
    const top = new THREE.Mesh(new THREE.IcosahedronGeometry(2.3, 0), foliageA);
    top.position.set(0.5, 8.6, 0.3);
    g.add(trunk, low, top);
    g.position.set(x, 0, z);
    g.scale.setScalar(s);
    g.rotation.y = Math.random() * Math.PI;
    scene.add(g);
  };
  for (let x = -40; x <= 40; x += 10) tree(x + (Math.random() - 0.5) * 4, -40 - Math.random() * 8, 0.8 + Math.random() * 0.35);
  for (const s of [-1, 1]) {
    for (let z = -30; z <= 14; z += 11) tree(s * (33 + Math.random() * 6), z + (Math.random() - 0.5) * 4, 0.8 + Math.random() * 0.35);
  }
}

function buildProps(scene: THREE.Scene): void {
  // 裁判椅(球网左侧)
  const chair = new THREE.Group();
  for (const [x, z] of [
    [-0.35, -0.35],
    [0.35, -0.35],
    [-0.35, 0.35],
    [0.35, 0.35],
  ]) {
    chair.add(box(0.08, 1.9, 0.08, C.metal, x, 0.95, z));
  }
  chair.add(box(0.9, 0.1, 0.9, 0xffffff, 0, 1.9, 0));
  chair.add(box(0.1, 0.75, 0.9, C.lime, -0.42, 2.3, 0));
  chair.add(box(0.42, 0.6, 0.5, 0xffffff, -0.05, 2.25, 0)); // 裁判
  chair.add(box(0.3, 0.3, 0.3, 0xd9a47a, -0.05, 2.72, 0));
  chair.position.set(-(COURT.netHalfWidth + 1.3), 0, 0);
  chair.traverse((o) => (o.castShadow = true));
  scene.add(chair);

  // 球员席
  for (const z of [-3.5, 3.5]) {
    const bench = new THREE.Group();
    bench.add(box(0.55, 0.1, 1.9, 0xffffff, 0, 0.45, 0));
    bench.add(box(0.1, 0.45, 0.1, C.metal, 0, 0.225, -0.75), box(0.1, 0.45, 0.1, C.metal, 0, 0.225, 0.75));
    bench.add(box(0.36, 0.34, 0.66, C.lime, 0, 0.17, 1.4)); // 球包
    bench.position.set(-(COURT.netHalfWidth + 2.6), 0, z);
    bench.traverse((o) => (o.castShadow = true));
    scene.add(bench);
  }
}

function buildLights(scene: THREE.Scene, shadowSize: number): void {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9a7be8, 1.5));
  const sun = new THREE.DirectionalLight(0xfff6e6, 2.4);
  sun.position.set(-11, 22, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const cam = sun.shadow.camera;
  cam.left = -14;
  cam.right = 14;
  cam.top = 22;
  cam.bottom = -22;
  cam.near = 1;
  cam.far = 70;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
}

export function buildStadium(scene: THREE.Scene, shadowSize = 2048, anisotropy = 8): void {
  buildSky(scene);
  buildLights(scene, shadowSize);
  buildCourt(scene);
  buildNet(scene);
  buildWallsAndBoards(scene, anisotropy);
  buildStands(scene);
  buildTrees(scene);
  buildProps(scene);
}
