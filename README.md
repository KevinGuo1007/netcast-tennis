# Netcast Tennis

一个跑在浏览器里的 3D 像素风网球对打小游戏,支持桌面键盘和手机触屏。

在线试玩:<https://netcast-tennis.vercel.app>

## 玩法

- **单人模式**:和电脑对打,简单 / 普通 / 困难三档;真实网球计分,先赢 3 局获胜。
- **新手教学**:八课依次练移动、击球时机、力度、瞄准、球种、冲刺、鱼跃扑救和发球,可以随时重玩。
- **联机模式**:尚未实现。

### 操作

| 动作 | 键盘 | 触屏 |
| --- | --- | --- |
| 移动 | WASD / 方向键 | 左半屏摇杆 |
| 冲刺 / 鱼跃扑救 | 双击方向键 | 双击摇杆 |
| 平击 / 上旋 / 切削 / 挑高球 | J / K / L / I | 右下角四个按钮 |
| 发球 | J 抛球,球到最高点再按 J | 点「平击」两次 |
| 暂停 | Esc | 右上角按钮 |

击球是「按住蓄力」:跑到落点附近后按住击球键,蓄力期间方向键改为瞄准,对面的准星就是落点。

- 开着**击球辅助**(默认)时,一直按住不放,球到位会自动挥拍。
- 关掉辅助后要自己松手:脚边的白圈缩进色带、变成青柠色时松开。松得太晚会打空。
- 挥拍之后有一小段调整姿势的时间,力度越大越久,期间不能再次挥拍。
- 跑动、大力击球和扑救消耗体力;体力低时跑得慢、失误多。

## 开发

需要 Node.js 20 以上。

```bash
npm install
npm run dev      # 本地开发,默认 http://localhost:5173
npm test         # 单元测试(Vitest)
npm run build    # 类型检查 + 生产构建,产物在 dist/
```

部署在 Vercel 上,是纯静态站点:

```bash
vercel deploy --prod
```

## 代码结构

游戏逻辑和画面是分开的:`src/sim` 里是不依赖浏览器的纯 TypeScript,用固定步长和可复现的随机数推进,所以能直接做单元测试,也为以后的联网对战留了位置。

```
src/
  sim/            对局逻辑(与渲染无关)
    constants.ts    所有可调的数值:场地、球、击球时机、体力、冲刺……
    ball.ts         球的物理(重力、空气阻力、旋转、弹跳、撞网)和落点求解
    game.ts         对局状态机:移动、蓄力、挥拍判定、扑救、发球、得分
    score.ts        网球计分
    ai.ts           电脑对手(和真人一样只输出按键)
    rng.ts          可复现的随机数
  render/         Three.js 渲染
    scene.ts        像素化渲染管线、机位、场上的各种标记
    stadium.ts      球场、看台、广告牌等场景
    character.ts    人物骨骼动画(姿势库 + 弹簧过渡)
  input/          键盘和触屏输入
  audio/          音效和背景音乐
  tutorial.ts     新手教学的课程和过关判定
  main.ts         菜单、流程、HUD 和主循环
tests/            对局逻辑和新手教学的测试
tools/            生成美术资源的脚本(见下)
brand-src/        Logo 源图
public/           模型、Logo、音频等静态资源
```

想调手感,大部分数值集中在 [src/sim/constants.ts](src/sim/constants.ts);对手的强弱在 [src/sim/ai.ts](src/sim/ai.ts)。

## 美术和音频资源

**人物模型**由脚本生成:用 Blender 的后台模式建低多边形网格、骨架和蒙皮权重,导出为 `public/models/player.glb`。

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --python tools/build_character.py -- public/models/player.glb
```

**Logo**:`brand-src/` 里是带白底的源图,下面的脚本把它们处理成透明背景的 PNG(需要 Python 的 Pillow 和 NumPy)。

```bash
python3 tools/make_brand_assets.py
```

**音频**:击球、弹跳、掌声和场馆环境声来自 Freesound 上的 CC0 录音;背景音乐是 Kevin MacLeod 的作品(CC BY 4.0);撞网、挥拍风声和界面提示音由程序实时合成。完整的来源和授权见 [public/audio/CREDITS.md](public/audio/CREDITS.md)。
