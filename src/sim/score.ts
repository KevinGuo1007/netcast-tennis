export type PlayerId = 0 | 1;

export const GAMES_TO_WIN = 3;

export interface Score {
  points: [number, number];
  games: [number, number];
  server: PlayerId;
  winner: PlayerId | null;
}

export function newScore(server: PlayerId = 0): Score {
  return { points: [0, 0], games: [0, 0], server, winner: null };
}

export type PointResult = 'point' | 'game' | 'match';

export function awardPoint(s: Score, w: PlayerId): PointResult {
  const l = (1 - w) as PlayerId;
  s.points[w]++;
  if (s.points[w] >= 4 && s.points[w] - s.points[l] >= 2) {
    s.points = [0, 0];
    s.games[w]++;
    s.server = (1 - s.server) as PlayerId;
    if (s.games[w] >= GAMES_TO_WIN) {
      s.winner = w;
      return 'match';
    }
    return 'game';
  }
  return 'point';
}

const LABELS = ['0', '15', '30', '40'];

export function pointLabels(s: Score): [string, string] {
  const [a, b] = s.points;
  if (a >= 3 && b >= 3) {
    if (a === b) return ['40', '40'];
    return a > b ? ['AD', ''] : ['', 'AD'];
  }
  return [LABELS[a], LABELS[b]];
}

export type PointStatus = 'match' | 'game' | 'break' | null;

/** 下一分的分量:赛点、局点、破发点(都是针对 leader 而言) */
export function pointStatus(s: Score): { status: PointStatus; leader: PlayerId } {
  for (const w of [0, 1] as PlayerId[]) {
    const l = (1 - w) as PlayerId;
    if (s.points[w] >= 3 && s.points[w] > s.points[l]) {
      if (s.games[w] === GAMES_TO_WIN - 1) return { status: 'match', leader: w };
      return { status: s.server === w ? 'game' : 'break', leader: w };
    }
  }
  return { status: null, leader: 0 };
}
