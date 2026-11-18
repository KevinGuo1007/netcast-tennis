import { TUNING } from './sim/constants';
import { beginServe, contactEta, feedBall, GameEvent, GameState } from './sim/game';

/** 场地上的发光目标:要跑到的位置,或者要把球打进去的区域 */
export interface Goal {
  x: number;
  z: number;
  w: number;
  d: number;
}

export type FeedbackKind = 'good' | 'bad' | '';

type LessonId = 'move' | 'timing' | 'power' | 'aim' | 'shots' | 'sprint' | 'dive' | 'serve';

interface Lesson {
  id: LessonId;
  title: string;
  /** 说明文字(HTML,可含键帽) */
  body: string;
  /** 要成功几次才算过关 */
  needed: number;
  /** 游戏速度:前几课放慢,方便看清时机 */
  speed: number;
}

/** 第一课要依次跑到的三个位置 */
const SPOTS: Goal[] = [
  { x: -3, z: 11, w: 1.4, d: 1.4 },
  { x: 3, z: 9.5, w: 1.4, d: 1.4 },
  { x: 0, z: 12.3, w: 1.4, d: 1.4 },
];

/** 瞄准课的两个目标区:对方半场的左后区和右后区 */
const ZONES: Goal[] = [
  { x: -2.7, z: -8.4, w: 2.8, d: 6.8 },
  { x: 2.7, z: -8.4, w: 2.8, d: 6.8 },
];

const SHOT_LABEL: Record<string, string> = { top: '上旋', slice: '切削', lob: '挑高球' };

/**
 * 新手教学:用"喂球"代替对手,一课只练一件事,每个球都给出即时反馈。
 * 它只读写 GameState 和对局事件,不关心画面;界面通过下面的公开字段取要显示的内容。
 */
export class Tutorial {
  readonly lessons: Lesson[];
  index = 0;
  count = 0;
  feedback = '';
  kind: FeedbackKind = '';
  goal: Goal | null = null;
  finished = false;

  private wait = 3.5; // 距离下一个球(或下一次发球)还有多久
  private live = false; // 球在场上,还没出结果
  private advanceIn = 0; // 过关后停顿一下再进下一课
  private myHit = false;
  private landed = false;
  private sprinted = 0;
  private dived = false;
  private spot = 0;
  private zone = 0;
  private diveSide = 1;
  private shotsDone = new Set<string>();
  private said = false; // 这个球已经给过反馈了

  /**
   * @param key   把按键名渲染成键帽(触屏上是按钮名)
   * @param stick 把方向键渲染成键帽(触屏上是"摇杆")
   * @param touch 是否触屏操作
   */
  constructor(
    private readonly s: GameState,
    key: (k: string) => string,
    stick: (keys: string) => string,
    touch: boolean,
    /** 是否开着击球辅助(按住不放自动挥拍):说明文字和反馈要跟着变 */
    assist = false,
  ) {
    const dash = touch ? '<b>双击摇杆</b>再推向' : '<b>双击方向键</b>并按住';
    this.lessons = [
      {
        id: 'move',
        title: '移动',
        body: `用 ${stick('WASD')} 跑到场上发光的方块里。`,
        needed: SPOTS.length,
        speed: 1,
      },
      {
        id: 'timing',
        title: '击球时机',
        body: assist
          ? `球飞过来时<b>按住</b> ${key('J')} <b>不要松</b>:球到位时球员会自动挥拍。只要别按得太晚就能打到。<br>熟练以后可以自己掌握:脚边的白圈变成<b style="color:#b8e62e">青柠色</b>时松手,时机准了是「完美」击球。<br><i>这一课是慢动作。</i>`
          : `球飞过来时<b>按住</b> ${key('J')},看脚边收缩的白圈:它变成<b style="color:#b8e62e">青柠色</b>时<b>松开</b>。松早一点没关系,球员会等球到位再挥;松晚了才会打空。<br><i>这一课是慢动作。</i>`,
        needed: 3,
        speed: 0.6,
      },
      {
        id: 'power',
        title: '力度',
        body: `按得越久力度越大。看身旁的力度计:让它升到<b style="color:#b8e62e">绿色区</b>再松手。太低球软,冲进<b style="color:#ff7a59">红色区</b>容易出界。<br><i>想打得重,就早一点按下。</i>`,
        needed: 3,
        speed: 0.8,
      },
      {
        id: 'aim',
        title: '瞄准',
        body: `按住 ${key('J')} 蓄力的时候,${stick('WASD')} 不再移动球员,而是移动对面的<b>准星</b>。把球打进发光的目标区。`,
        needed: 2,
        speed: 0.8,
      },
      {
        id: 'shots',
        title: '球种',
        body: `四个击球键是四种球:${key('J')} 平击最快;${key('K')} 上旋弹得高、不容易出界;${key('L')} 切削又低又飘;${key('I')} 挑高球越过上网的对手。<br>用 ${key('K')}、${key('L')}、${key('I')} 各打一个。`,
        needed: 3,
        speed: 0.85,
      },
      {
        id: 'sprint',
        title: '冲刺',
        body: `球离得远时,${dash}球的方向可以<b>冲刺</b>,速度快很多,但很费体力。冲刺过去把球打回来。`,
        needed: 2,
        speed: 1,
      },
      {
        id: 'dive',
        title: '鱼跃扑救',
        body: `实在跑不到的球可以扑。<b>先站着别动</b>,等球快到身边时,${touch ? '<b>双击摇杆</b>' : '朝球的方向<b>双击方向键</b>'}:球员会飞身扑出去。扑完要爬起来,所以只在救急时用。`,
        needed: 2,
        speed: 1,
      },
      {
        id: 'serve',
        title: '发球',
        body: `按 ${key('J')} 抛球,球升到<b>最高点</b>时再按 ${key('J')} 击球。力度计越接近顶端的绿色区,发球越快越准。抛球后可以用 ${stick('AD')} 选内角或外角。`,
        needed: 2,
        speed: 1,
      },
    ];

    s.practice = true;
    s.phase = 'between';
    s.timer = Infinity;
    this.resetPlayers();
  }

  get lesson(): Lesson {
    return this.lessons[Math.min(this.index, this.lessons.length - 1)];
  }

  /** 当前这一课的游戏速度 */
  get speed(): number {
    return this.lesson.speed;
  }

  private say(text: string, kind: FeedbackKind): void {
    this.feedback = text;
    this.kind = kind;
    this.said = true;
  }

  private resetPlayers(x = 0): void {
    const [me, feeder] = this.s.players;
    Object.assign(me, { x, z: 12.2, vx: 0, vz: 0, stroke: 'none', strokeT: 0, cooldown: 0, sprinting: false, stamina: 1 });
    Object.assign(feeder, { x: 0, z: -12.3, vx: 0, vz: 0, stamina: 1 });
  }

  private success(text: string): void {
    this.count++;
    this.say(text, 'good');
    if (this.count >= this.lesson.needed) this.complete();
  }

  private complete(): void {
    this.say(this.index === this.lessons.length - 1 ? '全部学完了!' : '过关!准备下一课…', 'good');
    this.goal = null;
    this.advanceIn = 1.8;
  }

  /** 跳过当前这一课 */
  skip(): void {
    if (this.finished) return;
    this.advanceIn = 0;
    this.nextLesson();
  }

  private nextLesson(): void {
    this.index++;
    if (this.index >= this.lessons.length) {
      this.finished = true;
      return;
    }
    this.count = 0;
    this.spot = 0;
    this.zone = 0;
    this.shotsDone.clear();
    this.live = false;
    this.wait = 3.5; // 留时间读这一课的说明
    this.goal = null;
    this.say('', '');
    this.s.phase = 'between';
    this.s.timer = Infinity;
    this.resetPlayers();
  }

  /** 发出这一课的下一个球(或者准备下一次发球) */
  private startRound(): void {
    const s = this.s;
    const me = s.players[0];
    this.live = true;
    this.myHit = false;
    this.landed = false;
    this.sprinted = 0;
    this.dived = false;
    this.said = false;
    me.stamina = 1;
    const from = { fromX: 0, fromZ: -11.8 };

    switch (this.lesson.id) {
      case 'serve':
        beginServe(s, 0);
        break;
      case 'sprint':
        // 人在一侧,球喂到另一侧,而且是慢的高球:冲刺刚好赶得上
        this.resetPlayers(-3.8);
        feedBall(s, { ...from, toX: 3.0, toZ: 8.4, speed: 12.5 });
        break;
      case 'dive':
        // 又快又偏的球:跑是来不及的
        this.resetPlayers(0);
        this.diveSide = -this.diveSide;
        feedBall(s, { ...from, toX: this.diveSide * 3.5, toZ: 9.2, speed: 23 });
        break;
      default: {
        // 把球喂到球员正手一侧、身前三四米的地方,不用怎么跑,专心练这一课的内容
        const toX = Math.max(-3.2, Math.min(3.2, me.x + TUNING.sweetSide));
        const toZ = Math.max(2.5, Math.min(10.6, me.z - 3.6));
        feedBall(s, { ...from, toX, toZ, speed: 14 });
      }
    }
  }

  /** 每帧调用:dt 是这一帧模拟推进的时间,events 是这一帧产生的对局事件 */
  update(dt: number, events: GameEvent[]): void {
    if (this.finished) return;
    if (this.advanceIn > 0) {
      this.advanceIn -= dt;
      if (this.advanceIn <= 0) this.nextLesson();
      return;
    }
    const s = this.s;
    const me = s.players[0];
    const id = this.lesson.id;

    if (id === 'move') {
      this.goal = SPOTS[this.spot];
      if (Math.hypot(me.x - this.goal.x, me.z - this.goal.z) < 0.8) {
        this.spot = Math.min(this.spot + 1, SPOTS.length - 1);
        this.success(this.count + 1 < SPOTS.length ? '到了!去下一个。' : '');
      }
      return;
    }

    this.goal = id === 'aim' ? ZONES[this.zone] : null;
    if (me.sprinting) this.sprinted += dt;
    for (const e of events) this.onEvent(e);

    if (!this.live) {
      this.wait -= dt;
      if (this.wait <= 0) this.startRound();
    }
  }

  private onEvent(e: GameEvent): void {
    const id = this.lesson.id;
    const s = this.s;
    switch (e.type) {
      case 'hit':
        if (e.player !== 0) return;
        this.myHit = true;
        if (id === 'timing') {
          if (e.auto) this.success('打到了!这是自动出手。想打出「完美」,试试在白圈变色时自己松手。');
          else if (e.timing > TUNING.timingEarlyPerfect) this.success('打到了!不过松手偏早,可以再多按一会儿。');
          else if (e.timing < -TUNING.timingLatePerfect) this.success('打到了!松手稍微晚了一点。');
          else this.success('完美的时机!');
        } else if (id === 'power') {
          if (e.power < TUNING.powerGood) this.say('力度偏小:多按一会儿,等力度计升到绿色区。', 'bad');
          else if (e.power > TUNING.powerRisky) this.say('过力了:力度计一到绿色区就松手。', 'bad');
          else this.success('力度刚好!');
        } else if (id === 'shots') {
          if (e.shot === 'flat') {
            this.say('这是平击。试试其他三个键。', 'bad');
          } else if (!this.shotsDone.has(e.shot)) {
            this.shotsDone.add(e.shot);
            const left = ['top', 'slice', 'lob'].filter((k) => !this.shotsDone.has(k)).map((k) => SHOT_LABEL[k]);
            this.success(left.length ? `${SHOT_LABEL[e.shot]}!还差:${left.join('、')}` : '');
          }
        } else if (id === 'sprint') {
          if (this.sprinted > 0.25) this.success('冲刺到位!');
          else this.say('打到了,但没有冲刺。这次试试双击方向键并按住。', 'bad');
        } else if (id === 'dive' && e.dive) {
          this.success('扑到了!');
        }
        break;
      case 'whiff': {
        if (e.player !== 0) return;
        // 球还没到就挥了是太早,否则是太晚
        const eta = contactEta(s, 0);
        this.say(eta !== null && eta > 0.15 ? '打空了:松手太早。等白圈变成青柠色再松。' : '打空了:出手太晚。球飞过来的时候就要按住。', 'bad');
        break;
      }
      case 'dive':
        if (e.player !== 0) return;
        this.dived = true;
        break;
      case 'bounce':
        // 自己打出去的球第一次落地:瞄准课在这里判定是否打进目标区
        if (!this.myHit || this.landed || s.lastHitter !== 0) return;
        this.landed = true;
        if (id === 'aim') {
          const z = ZONES[this.zone];
          const inZone = Math.abs(e.x - z.x) <= z.w / 2 + 0.1 && Math.abs(e.z - z.z) <= z.d / 2 + 0.1;
          if (inZone) {
            this.zone = Math.min(this.zone + 1, ZONES.length - 1);
            this.success(this.count + 1 < ZONES.length ? '打进了!换另一边。' : '');
          } else {
            this.say('没打进目标区:蓄力时按住方向键,把准星移到发光的区域里。', 'bad');
          }
        }
        break;
      case 'fault':
        if (id === 'serve') {
          this.say('发球没有落进发球区。在球升到最高点时击球会更准。', 'bad');
          this.endRound();
        }
        break;
      case 'point':
        if (id === 'serve') {
          if (e.winner === 0) this.success('好球!');
        } else if (id === 'dive') {
          if (this.dived && !this.myHit) this.success('扑出去了!时机再准一点就能碰到球。');
          else if (!this.dived) {
            this.say(this.myHit ? '这球你跑到了。这次先站着别动,等球快到时再双击。' : '球过去了:等它快到身边时,朝球的方向双击方向键。', 'bad');
          }
        } else if (!this.myHit && !this.said) {
          this.say('球过去了:按住击球键蓄力,白圈变色时松开。', 'bad');
        }
        this.endRound();
        break;
    }
  }

  private endRound(): void {
    this.live = false;
    this.wait = 1.7;
  }
}
