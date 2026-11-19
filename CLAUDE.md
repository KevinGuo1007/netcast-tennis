# Netcast Tennis

浏览器里的 3D 像素风网球对打小游戏:单人对电脑,桌面键盘和手机触屏都能玩。
线上 <https://netcast-tennis.vercel.app>,仓库 `KevinGuo1007/netcast-tennis`(公开,分支 `main`)。
玩法、操作和目录结构的说明在 [README.md](README.md),这里只写改代码时不看就会出错的事。

## 怎么跑

```bash
npm run dev      # http://localhost:5173(.claude/launch.json 里的 dev 配置)
npm test         # Vitest,只测 src/sim 和 src/tutorial.ts
npm run build    # tsc --noEmit + vite build
vercel deploy --prod --yes   # 上传本地当前文件,没有关联 Git:先提交再部署
```

Node 22.12 以上。技术栈:TypeScript + Vite + Three.js,菜单和 HUD 是 HTML/CSS,无后端、无账号。

## 约定

- **对局逻辑和画面分开**。`src/sim` 是纯 TypeScript:固定步长(1/120 秒)、可复现的随机数,
  不碰 DOM 和 Three.js。电脑对手和真人一样只输出 `PlayerInput`。以后的联机模式依赖这一点,别破坏。
- **数值集中在 `src/sim/constants.ts`**(对手强弱在 `src/sim/ai.ts`)。调手感改这里,不要把数字散到逻辑里。
- **围墙和看台的尺寸只有一份**:`ARENA` 同时给碰撞(`ball.ts`)和画面(`stadium.ts`)用,改一处两边都变。
- **坐标**:x 横向、y 向上、z 纵向,球网在 z = 0;0 号球员(玩家)在 z > 0。
- **人物模型和 Logo 是脚本生成的**,不要手改产物:
  `tools/build_character.py`(Blender 后台模式)→ `public/models/player.glb`;
  `tools/make_brand_assets.py` → `public/brand/*` 和 `public/favicon.ico`。命令见 README。
  骨骼名和 `src/render/character.ts` 里的 `BONE_OF`、`GROUND_PROBES` 对应,改骨架两边一起改。
- **动画是程序驱动的**:姿势库经过弹簧过渡;跑步、滑步的周期摆动直接叠加,不经过弹簧。
- **像素风**靠低分辨率渲染再放大(`PIXEL_ROWS`),HUD 保持清晰;不要开抗锯齿。
- **触屏还是键盘**跟着实际操作切换(`setTouchMode`)。不要用 `navigator.maxTouchPoints` 判断设备。
- **界面文字不能被选中**:对局中在 `touchstart` 里取消默认行为,否则 iPhone 长按会弹系统菜单并卡住操作。
  新加的、靠点击生效的按钮要加进 `main.ts` 里那个放行的选择器。
- **素材授权**:新增音频要写进 `public/audio/CREDITS.md` 和游戏里的致谢页,只用 CC0 / CC BY / 明确允许非商用的素材。
- 界面文案、注释和提交信息都用中文。

## 自动化检查画面

开发环境下 `window` 上有调试入口:`__game()`(对局状态)、`__scene`、`__pause(true)`、`__advance(秒)`。
浏览器面板在后台时 `requestAnimationFrame` 不触发,要先 `__pause(true)` 再用 `__advance` 手动推进。
直接改 `__scene.camera` 之后记得刷新页面,视角参数只在窗口尺寸变化时重算。

## 当前状态(2026-11-18)

- 已上线:单人模式(三档难度)、八课新手教学、击球辅助、冲刺和扑救、体力、围墙碰撞、音效和背景音乐。
- **联机模式还没做**(开始页面上是「即将推出」)。原定方案:轻量中继、击球方权威、房间码进入,只用免费额度的托管服务。
- 没有在真机上系统测试过;iPhone 长按菜单的修复只用模拟事件验证过。
- 仓库没有许可证文件,要不要加、加哪种由仓库主人决定。
