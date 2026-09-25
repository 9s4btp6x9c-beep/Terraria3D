// World events: the Sporefall (a random night when glowing spores rain down
// and the fungal horrors walk) and the Hollow March (an army that marches on
// the town once the Deepwyrm is dead).
// Pure state machine — the game feeds it the time of day, town and player
// position, and reacts to the transitions it reports.

export type EventKind = 'sporefall' | 'raid';

export interface EventInfo { name: string; color: string; subtitle: string }

export const EVENT_INFO: Record<EventKind, EventInfo> = {
  sporefall: { name: 'Sporefall', color: '#7af0c8', subtitle: 'Survive until dawn' },
  raid: { name: 'The Hollow March', color: '#e6dcc0', subtitle: 'Defend the town' },
};

export interface EventWorld {
  /** 0 at night .. 1 at full day. */
  daylight: number;
  px: number; pz: number;
  /** Centre of the town (average of houses), or null without houses. */
  town: { x: number; z: number; npcs: number } | null;
  bossDefeated: boolean;
}

export type EventSignal =
  | { type: 'start'; kind: EventKind }
  | { type: 'end'; kind: EventKind; won: boolean }
  | { type: 'progress'; kind: EventKind; progress: number; goal: number };

/** Sporefall odds per night (not on the first night). */
export const SPOREFALL_CHANCE = 1 / 6;
/** Raid odds per dawn once the boss is dead and at least two NPCs live in town. */
export const RAID_CHANCE = 1 / 4;
/** How far from the town the raid still counts as defended. */
export const RAID_LEASH = 140;

export class WorldEvents {
  kind: EventKind | null = null;
  progress = 0;
  goal = 0;
  /** Where the raid marches to. */
  target: { x: number; z: number } | null = null;
  /** Nights seen since the world was created (the first is always calm). */
  nights = 0;
  private wasNight: boolean | null = null;
  private away = 0;
  /** Random source (tests pass a deterministic one). */
  constructor(private rand: () => number = Math.random) {}

  get active() { return this.kind !== null; }
  get info() { return this.kind ? EVENT_INFO[this.kind] : null; }

  start(kind: EventKind, world: Pick<EventWorld, 'town' | 'px' | 'pz'>): EventSignal[] {
    if (this.kind) return [];
    this.kind = kind;
    this.progress = 0;
    this.away = 0;
    if (kind === 'raid') {
      const t = world.town ?? { x: world.px, z: world.pz, npcs: 0 };
      this.target = { x: t.x, z: t.z };
      this.goal = 30 + 8 * Math.min(4, t.npcs);
    } else {
      this.target = null;
      this.goal = 0;
    }
    return [{ type: 'start', kind }];
  }

  private end(won: boolean): EventSignal[] {
    const kind = this.kind!;
    this.kind = null;
    this.target = null;
    return [{ type: 'end', kind, won }];
  }

  /** A creature belonging to the running event died. */
  kill(): EventSignal[] {
    if (this.kind !== 'raid') return [];
    this.progress++;
    if (this.progress >= this.goal) return this.end(true);
    return [{ type: 'progress', kind: 'raid', progress: this.progress, goal: this.goal }];
  }

  update(dt: number, w: EventWorld): EventSignal[] {
    const out: EventSignal[] = [];
    const night = w.daylight < 0.3;
    const dusk = this.wasNight === false && night;
    // A Sporefall loaded from a save made at night ends if it is now day.
    const dawn = (this.wasNight === true || (this.wasNight === null && this.kind === 'sporefall')) && !night;
    this.wasNight = night;

    if (dusk) {
      this.nights++;
      if (!this.kind && this.nights > 1 && this.rand() < SPOREFALL_CHANCE) out.push(...this.start('sporefall', w));
    }
    if (dawn) {
      if (this.kind === 'sporefall') out.push(...this.end(true));
      const t = w.town;
      if (!this.kind && w.bossDefeated && t && t.npcs >= 2 && Math.hypot(w.px - t.x, w.pz - t.z) < 80 && this.rand() < RAID_CHANCE) {
        out.push(...this.start('raid', w));
      }
    }
    if (this.kind === 'raid' && this.target) {
      // Abandoning the town for a while lets the raiders win (they leave).
      this.away = Math.hypot(w.px - this.target.x, w.pz - this.target.z) > RAID_LEASH ? this.away + dt : 0;
      if (this.away > 20) out.push(...this.end(false));
    }
    return out;
  }

  serialize() {
    return { kind: this.kind, progress: this.progress, goal: this.goal, target: this.target, nights: this.nights };
  }

  load(d: ReturnType<WorldEvents['serialize']> | undefined) {
    if (!d) return;
    // Saves from before the retheme called the Sporefall the 'blood_moon'.
    this.kind = (d.kind as string) === 'blood_moon' ? 'sporefall' : d.kind;
    this.progress = d.progress;
    this.goal = d.goal;
    this.target = d.target;
    this.nights = d.nights;
  }
}
