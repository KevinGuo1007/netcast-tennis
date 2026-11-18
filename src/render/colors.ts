import { ShotType } from '../sim/constants';

/** 球种对应的标记颜色:落点圆环、准星、按键提示都用同一套 */
export const SHOT_COLORS: Record<ShotType | 'serve', number> = {
  flat: 0xffffff,
  top: 0xff7a59,
  slice: 0xffd166,
  lob: 0x39c6ff,
  serve: 0xffffff,
};

export const cssColor = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
