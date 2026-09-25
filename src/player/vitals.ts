// Player health, mana, defense, regeneration, i-frames, fall damage, death and
// respawn. Numbers: 100 health to start, natural regen
// that ramps up while not taking damage, defense subtracts half its value.

export interface DamageEvent { amount: number; fromX: number; fromZ: number; knockback: number }

export class PlayerVitals {
  maxHp = 100;
  hp = 100;
  maxMana = 40;
  mana = 40;
  defense = 0;
  regenBonus = 0;
  /** Multiplier on mana regeneration (Rested). */
  manaRegenMul = 1;
  invuln = 0;
  dead = false;
  respawnTimer = 0;
  private sinceHit = 10;
  /** Latest applied hit, for the caller to react to (knockback, flash, sound). */
  lastHit: DamageEvent | null = null;

  update(dt: number) {
    this.invuln = Math.max(0, this.invuln - dt);
    if (this.dead) {
      this.respawnTimer -= dt;
      return;
    }
    this.sinceHit += dt;
    // Regen ramps up the longer you avoid damage.
    const regen = (this.sinceHit > 3 ? 0.5 + Math.min(4, (this.sinceHit - 3) * 0.3) : 0.2) + this.regenBonus;
    this.hp = Math.min(this.maxHp, this.hp + regen * dt);
    this.mana = Math.min(this.maxMana, this.mana + (4 + this.maxMana * 0.06) * this.manaRegenMul * dt);
  }

  /** Returns damage actually dealt (0 if invulnerable). */
  damage(raw: number, fromX: number, fromZ: number, knockback = 6): number {
    if (this.dead || this.invuln > 0) return 0;
    const amount = Math.max(1, Math.round(raw - this.defense * 0.5));
    this.hp -= amount;
    this.invuln = 0.6;
    this.sinceHit = 0;
    this.lastHit = { amount, fromX, fromZ, knockback };
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.respawnTimer = 4;
    }
    return amount;
  }

  /** Landing impact: fall damage above ~13 m/s (about 9 m of drop). */
  land(impactSpeed: number, immune: boolean): number {
    if (immune || impactSpeed < 13.5) return 0;
    const dmg = Math.round((impactSpeed - 13.5) * 6);
    if (dmg <= 0) return 0;
    const inv = this.invuln;
    this.invuln = 0;
    const dealt = this.damage(dmg, NaN, NaN, 0);
    if (!dealt) this.invuln = inv;
    return dealt;
  }

  heal(n: number) { this.hp = Math.min(this.maxHp, this.hp + n); }

  useMana(n: number): boolean {
    if (this.mana < n) return false;
    this.mana -= n;
    return true;
  }

  respawn() {
    this.dead = false;
    this.hp = this.maxHp;
    this.mana = this.maxMana;
    this.invuln = 2;
    this.sinceHit = 10;
  }
}
