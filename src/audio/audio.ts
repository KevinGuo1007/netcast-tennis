/**
 * 音频管理:
 * - 音效优先用真实录音(public/audio/sfx),每类有多个变体随机轮换;
 * - 录音里没有的(撞网、挥拍风声、界面提示音等)用 Web Audio 实时合成;
 * - 背景音乐是一个随机播放的曲目列表,一首播完随机换下一首。
 * 浏览器要求用户有过交互才能出声,所以第一次点击或按键时才真正启动。
 */

const SFX_GROUPS = {
  hit: ['hit_1.wav', 'hit_2.wav', 'hit_3.wav', 'hit_4.wav', 'hit_5.wav', 'hit_6.wav', 'hit_7.wav', 'hit_8.wav'],
  soft: ['soft_1.wav', 'soft_2.wav', 'soft_3.wav', 'soft_4.wav'],
  serve: ['serve_1.wav', 'serve_2.wav'],
  bounce: ['bounce_1.wav', 'bounce_2.wav', 'bounce_3.wav', 'bounce_4.wav', 'bounce_5.wav', 'bounce_6.wav'],
  applauseBig: ['applause_1.mp3', 'applause_2.mp3'],
  applauseSmall: ['applause_3.mp3'],
  ambience: ['ambience.mp3'],
} as const;

export type SfxGroup = keyof typeof SFX_GROUPS;
export type SynthSound = 'net' | 'whoosh' | 'click' | 'perfect' | 'fault' | 'win' | 'lose';

export const TRACKS = [
  { file: 'pixelland.mp3', title: 'Pixelland' },
  { file: 'itty-bitty-8-bit.mp3', title: 'Itty Bitty 8 Bit' },
  { file: 'bit-quest.mp3', title: 'Bit Quest' },
  { file: 'blip-stream.mp3', title: 'Blip Stream' },
  { file: 'pixel-peeker-polka.mp3', title: 'Pixel Peeker Polka' },
];

interface PlayOptions {
  volume?: number;
  /** 播放速率,1 为原速;略微随机能避免重复感 */
  rate?: number;
  /** 声像 -1(左)..1(右) */
  pan?: number;
}

interface Settings {
  music: boolean;
  sfx: boolean;
}

const STORAGE_KEY = 'netcast.audio';

function loadSettings(): Settings {
  try {
    return { music: true, sfx: true, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
  } catch {
    return { music: true, sfx: true };
  }
}

export class AudioManager {
  readonly settings = loadSettings();
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private lastVariant = new Map<SfxGroup, number>();
  private ambience: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wantAmbience = false;
  private music = new Audio();
  private musicLevel = 0.5;
  private wantMusic = false;
  private trackIndex = -1;
  /** 曲目变化时回调(用于界面显示当前曲名) */
  onTrack: (title: string) => void = () => {};

  constructor() {
    this.music.preload = 'none';
    this.music.addEventListener('ended', () => this.nextTrack());
    // 某首歌加载失败时跳到下一首,不让音乐停住
    this.music.addEventListener('error', () => {
      if (this.wantMusic) window.setTimeout(() => this.nextTrack(), 800);
    });
    const unlock = (): void => this.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  /** 第一次用户交互后启动音频上下文并开始加载音效 */
  private unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.settings.sfx ? 1 : 0;
      this.sfxBus.connect(this.ctx.destination);
      void this.loadAll();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.wantMusic && this.settings.music && this.music.paused) this.playMusic();
  }

  private async loadAll(): Promise<void> {
    const files = Object.values(SFX_GROUPS).flat();
    await Promise.all(
      files.map(async (file) => {
        try {
          const data = await (await fetch(`/audio/sfx/${file}`)).arrayBuffer();
          this.buffers.set(file, await this.ctx!.decodeAudioData(data));
        } catch {
          // 单个文件加载失败不影响其余音效
        }
      }),
    );
    if (this.wantAmbience) this.startAmbience();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // 隐私模式下可能写不进去,忽略
    }
  }

  // ---------------------------------------------------------------- 音效

  /** 播放一类录音音效里的随机一个变体(不连续重复同一个) */
  play(group: SfxGroup, opts: PlayOptions = {}): void {
    if (!this.ctx || !this.sfxBus || !this.settings.sfx) return;
    const files = SFX_GROUPS[group];
    let index = Math.floor(Math.random() * files.length);
    if (files.length > 1 && index === this.lastVariant.get(group)) index = (index + 1) % files.length;
    this.lastVariant.set(group, index);
    const buffer = this.buffers.get(files[index]);
    if (!buffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = opts.rate ?? 1;
    const gain = this.ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    source.connect(gain);
    if (opts.pan && this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
      gain.connect(panner).connect(this.sfxBus);
    } else {
      gain.connect(this.sfxBus);
    }
    source.start();
  }

  /** 场馆环境声:循环播放,进出对局时淡入淡出 */
  setAmbience(on: boolean): void {
    this.wantAmbience = on;
    if (on) this.startAmbience();
    else if (this.ambience && this.ctx) {
      const { source, gain } = this.ambience;
      gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
      source.stop(this.ctx.currentTime + 2);
      this.ambience = null;
    }
  }

  private startAmbience(): void {
    const buffer = this.buffers.get('ambience.mp3');
    if (!this.ctx || !this.sfxBus || !buffer || this.ambience) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    // 避开 MP3 首尾的编码填充
    source.loopStart = 0.06;
    source.loopEnd = buffer.duration - 0.06;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.55, this.ctx.currentTime, 0.8);
    source.connect(gain).connect(this.sfxBus);
    source.start(0, 0.06);
    this.ambience = { source, gain };
  }

  // ---------------------------------------------------------------- 合成音效

  private tone(freq: number, start: number, duration: number, volume: number, type: OscillatorType, slideTo?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(this.sfxBus!);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  private noise(start: number, duration: number, volume: number, filter: BiquadFilterType, from: number, to: number): void {
    const ctx = this.ctx!;
    const length = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const biquad = ctx.createBiquadFilter();
    biquad.type = filter;
    biquad.frequency.setValueAtTime(from, start);
    biquad.frequency.exponentialRampToValueAtTime(to, start + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + duration * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(biquad).connect(gain).connect(this.sfxBus!);
    source.start(start);
  }

  /** 录音里没有的声音用合成 */
  synth(sound: SynthSound, volume = 1): void {
    if (!this.ctx || !this.sfxBus || !this.settings.sfx) return;
    const t = this.ctx.currentTime;
    switch (sound) {
      case 'net': // 球撞网:一声闷响加网绳的沙沙声
        this.tone(110, t, 0.18, 0.5 * volume, 'sine', 55);
        this.noise(t, 0.16, 0.35 * volume, 'lowpass', 900, 250);
        break;
      case 'whoosh': // 挥拍带起的风声
        this.noise(t, 0.2, 0.22 * volume, 'bandpass', 500, 2600);
        break;
      case 'click':
        this.tone(880, t, 0.06, 0.18 * volume, 'square', 660);
        break;
      case 'perfect':
        this.tone(1319, t, 0.14, 0.16 * volume, 'triangle');
        this.tone(1976, t + 0.07, 0.22, 0.16 * volume, 'triangle');
        break;
      case 'fault':
        this.tone(330, t, 0.12, 0.16 * volume, 'square');
        this.tone(262, t + 0.13, 0.2, 0.16 * volume, 'square');
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.12, 0.3, 0.17 * volume, 'square'));
        break;
      case 'lose':
        [523, 466, 392, 311].forEach((f, i) => this.tone(f, t + i * 0.16, 0.34, 0.15 * volume, 'square'));
        break;
    }
  }

  setSfxEnabled(on: boolean): void {
    this.settings.sfx = on;
    this.save();
    if (this.sfxBus && this.ctx) this.sfxBus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  // ---------------------------------------------------------------- 背景音乐

  /** 开始随机播放背景音乐(已经在播则不重启) */
  startMusic(): void {
    this.wantMusic = true;
    if (this.settings.music && this.music.paused) this.playMusic();
  }

  private playMusic(): void {
    if (this.trackIndex < 0) this.pickTrack();
    this.music.volume = this.musicLevel;
    // 用户还没交互时浏览器会拒绝播放;等 unlock 再试
    this.music.play().catch(() => {});
  }

  private pickTrack(): void {
    let next = Math.floor(Math.random() * TRACKS.length);
    if (TRACKS.length > 1 && next === this.trackIndex) next = (next + 1) % TRACKS.length;
    this.trackIndex = next;
    this.music.src = `/audio/music/${TRACKS[next].file}`;
    this.onTrack(TRACKS[next].title);
  }

  /** 随机切到另一首 */
  nextTrack(): void {
    this.pickTrack();
    if (this.wantMusic && this.settings.music) this.playMusic();
  }

  /** 音乐音量:菜单里大一些,对局中压低,给音效让位 */
  setMusicLevel(level: number): void {
    this.musicLevel = level;
    this.music.volume = level;
  }

  setMusicEnabled(on: boolean): void {
    this.settings.music = on;
    this.save();
    if (on && this.wantMusic) this.playMusic();
    else this.music.pause();
  }
}
