// The alligator (plan §11.4 "Alligator", §12.4): eyes and nostrils glide toward the bank with a
// V wake and the low motif; if the player is still within 2.5 m of the water it lunges (−2 hearts
// + knockback; −1 in the boat), then sinks away. A weapon (M3) sends it under with a splash.
import * as THREE from 'three';
import { EventRunner, type EventHost } from './host.ts';
import { Alligator } from '../../actors/alligator.ts';
import { TUNABLES } from '../../data/tunables.ts';
import { gatorMotif } from '../../audio/party.ts';

const E = TUNABLES.events;

export class GatorRunner extends EventRunner {
  readonly type = 'gator' as const;
  private gator: Alligator | null = null;
  private bank = new THREE.Vector3();
  private timer = 0;
  private lunged = false;
  private scared = false;

  constructor(h: EventHost, preferred?: string) {
    super(h, preferred);
  }

  async start(): Promise<void> {
    const h = this.h;
    const v = h.world.valley;
    const p = h.player.feet;
    if (v.edgeDistance(p.x, p.z) > 14) return this.finish();
    const cx = v.riverCenterX(p.z);
    const hw = v.riverHalfWidth(p.z);
    const side = Math.sign(p.x - cx) || 1;
    // the point on the water nearest the player, and a start 18 m up- or downstream
    const near = new THREE.Vector3(cx + side * Math.max(0, hw - 1.2), 0, p.z);
    const dz = (h.rng.chance(0.5) ? 1 : -1) * 18;
    const start = new THREE.Vector3(v.riverCenterX(p.z + dz), 0, p.z + dz);
    this.bank.set(cx + side * (hw + 0.6), 0, p.z);
    this.bank.y = h.world.groundAt(this.bank.x, this.bank.z);
    this.gator = new Alligator(h.world);
    const secs = E.gatorApproachMinSeconds + h.rng.next() * (E.gatorApproachMaxSeconds - E.gatorApproachMinSeconds);
    this.gator.glide(start, near, secs);
    this.gator.onArrive = () => this.arrive();
    this.phase = 'approach';
    if (h.audio) gatorMotif(h.audio);
    h.audio?.gatorHiss();
    h.music?.duck(10);
    h.caption('*a V-shaped ripple, gliding closer*');
  }

  private arrive(): void {
    const h = this.h;
    const gator = this.gator!;
    if (this.done) return;
    const p = h.player.feet;
    const near = h.world.valley.edgeDistance(p.x, p.z) < E.gatorLungeRange;
    if (near && !this.scared) {
      this.phase = 'lunge';
      this.lunged = true;
      const target = new THREE.Vector3(p.x, p.y, p.z);
      target.lerp(this.bank, 0.35);
      gator.lunge(target);
      h.audio?.gatorSnap();
      h.audio?.bigSplash();
      const knock = new THREE.Vector3(p.x - gator.position.x, 0, p.z - gator.position.z).normalize().multiplyScalar(E.gatorKnockback);
      h.damage(E.gatorHeartsBank, knock);
      h.stats.gatorBites++;
      h.caption('CHOMP.');
      h.bus.emit('gatorBit', {});
      h.unlockChecks();
    } else {
      this.phase = 'sink';
      gator.submergeAway();
      h.audio?.bigSplash();
      h.caption(near ? '*it thinks better of it and sinks away*' : '*the ripple sinks away*');
    }
    this.timer = 0;
  }

  step(dt: number): void {
    if (this.done || !this.gator) return;
    this.gator.step(dt);
    this.timer += dt;
    if ((this.phase === 'lunge' || this.phase === 'sink') && this.gator.done) this.finish();
    if (this.timer > 20) this.finish();
  }

  /** M3: attacking toward it during the approach sends it under (achievement See You Later). */
  override onThreatened(): void {
    if (this.phase !== 'approach' || this.scared) return;
    this.scared = true;
    this.h.stats.gatorsScared++;
    this.gator?.submergeAway();
    this.h.audio?.bigSplash();
    this.h.toast('The gator sinks away with a splash. See you later.');
    this.phase = 'sink';
    this.h.unlockChecks();
  }

  protected override cleanup(): void {
    this.gator?.dispose();
    void this.lunged;
  }
}
