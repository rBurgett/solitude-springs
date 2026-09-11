// UFO abduction (plan §11.4 "UFO abduction", §1 #11): omen (hum, silence, flicker, HUD glitch) →
// the saucer descends with a spotlight, the rod auto-reels → beam-up with the player flailing →
// the interview with Zib, Xorp and Commander Blorvo → beamed down to the exact spot and facing in
// a new outfit, 1–3 hours later, with glowing perch in the water for a day.
import * as THREE from 'three';
import { EventRunner, type EventHost } from './host.ts';
import { Ufo } from '../../actors/ufo.ts';
import { TUNABLES } from '../../data/tunables.ts';
import { UfoHum } from '../../audio/party.ts';
import { ALIEN_INTERVIEW } from '../../data/dialogue.ts';
import { rollAbductionOutfit, applyAbductionOutfit, rollMissingHours } from '../../sim/ufo.ts';
import { itemDef } from '../../data/items.ts';
import { cycleFraction } from '../../sim/clock.ts';

const E = TUNABLES.events;

export class UfoRunner extends EventRunner {
  readonly type = 'ufo' as const;
  private ufo: Ufo | null = null;
  private hum: UfoHum | null = null;
  private timer = 0;
  private origin = new THREE.Vector3();
  private originYaw = 0;
  private midConversation = false;
  private interior: HTMLElement | null = null;
  private returned = false;

  constructor(h: EventHost, preferred?: string) {
    super(h, preferred);
  }

  async start(): Promise<void> {
    const h = this.h;
    this.phase = 'omen';
    this.timer = 0;
    this.midConversation = h.isDialogueOpen();
    if (h.audio) {
      this.hum = new UfoHum(h.audio);
      this.hum.start();
    }
    h.setAmbienceMuted(true);
    if (!h.settings().accessibility.reduceFlashing) h.hud.setGlitch(true);
    h.caption('*an electrical hum. The frogs stop.*');
    this.ufo = new Ufo(h.world);
  }

  step(dt: number): void {
    const h = this.h;
    if (this.done) return;
    this.timer += dt;
    const p = h.player.feet;
    if (this.phase === 'omen') {
      h.setLightFlicker(Math.min(1, this.timer / E.ufoOmenSeconds) * 0.8);
      if (this.timer > 1.5 && Math.floor(this.timer * 4) !== Math.floor((this.timer - dt) * 4) && h.rng.chance(0.3)) h.audio?.glitch();
      if (this.timer >= E.ufoOmenSeconds && this.ufo) {
        this.phase = 'descent';
        this.timer = 0;
        h.hud.setGlitch(false);
        h.setLightFlicker(0.25);
        this.ufo.place(new THREE.Vector3(p.x, p.y + 60, p.z));
        this.ufo.moveTo(new THREE.Vector3(p.x, p.y + 15, p.z), E.ufoDescentSeconds);
        this.ufo.setSpot(true);
        h.forceReel();
        h.caption('*a light from above*');
        h.music?.duck(60);
      }
      return;
    }
    this.ufo?.step(dt);
    if (this.phase === 'descent') {
      if (this.timer >= E.ufoDescentSeconds) {
        this.phase = 'beam';
        this.timer = 0;
        this.origin.copy(p);
        this.originYaw = h.player.yaw;
        h.lockPlayer(true);
        h.player.character.animator.play('swim_idle', { fade: 0.3 });
        this.ufo?.setBeam(true, p.y);
        this.hum?.beam();
        h.caption('*you are lifted*');
      }
      return;
    }
    if (this.phase === 'beam') {
      const u = Math.min(1, this.timer / E.ufoBeamSeconds);
      const e = u * u;
      const lift = new THREE.Vector3(this.origin.x, this.origin.y + e * 13, this.origin.z);
      h.teleportPlayer(lift, this.originYaw + Math.sin(this.timer * 5) * 0.6);
      this.ufo?.setBeam(true, this.origin.y);
      if (u >= 1) {
        this.phase = 'interior';
        this.timer = 0;
        void this.interview();
      }
      return;
    }
    if (this.phase === 'return') {
      const u = Math.min(1, this.timer / E.ufoReturnSeconds);
      const e = 1 - (1 - u) * (1 - u);
      const drop = new THREE.Vector3(this.origin.x, this.origin.y + (1 - e) * 13, this.origin.z);
      h.teleportPlayer(drop, this.originYaw);
      this.ufo?.setBeam(true, this.origin.y);
      if (u >= 1 && !this.returned) {
        this.returned = true;
        h.teleportPlayer(this.origin.clone(), this.originYaw);
        h.lockPlayer(false);
        h.player.character.animator.play('idle', { fade: 0.3 });
        this.ufo?.setBeam(false);
        this.ufo?.setSpot(false);
        this.ufo?.moveTo(new THREE.Vector3(this.origin.x + 40, this.origin.y + 90, this.origin.z - 60), 3);
        this.phase = 'ascend';
        this.timer = 0;
        this.hum?.stop();
        h.setAmbienceMuted(false);
        h.setLightFlicker(0);
        h.toast('You are back. Exactly where you were. Dressed differently. Hours later.', 'warn');
      }
      return;
    }
    if (this.phase === 'ascend') {
      if (this.timer >= 3.2) this.finish();
    }
  }

  private async interview(): Promise<void> {
    const h = this.h;
    h.player.character.root.visible = false;
    this.interior = document.createElement('div');
    this.interior.className = 'ufo-interior';
    h.hud.root.parentElement?.append(this.interior);
    const skippable = h.stats.abductions >= 1;
    await h.talk(null, ALIEN_INTERVIEW, { name: 'Zib, Xorp & Commander Blorvo', skippable });
    if (this.done) return;
    this.interior.remove();
    this.interior = null;
    h.player.character.root.visible = true;
    // the outfit swap, the missing time, the glowing-perch window
    const outfit = rollAbductionOutfit(() => h.rng.next());
    const kept = applyAbductionOutfit(h.inventory, outfit);
    h.applyWornOutfit();
    const hours = rollMissingHours(() => h.rng.next());
    h.advanceClockHours(hours);
    h.director.ufoRecentUntil = h.clock.day + cycleFraction(h.clock) + E.ufoGlowDays;
    h.stats.abductions++;
    if (this.midConversation) h.stats.abductedMidConversation++;
    h.toast(`The aliens kept: ${kept.map((k) => itemDef(k.id).name).join(', ') || 'nothing'}. You are wearing: ${outfit.map((o) => itemDef(o.id).name).join(', ')}.`, 'warn');
    h.bus.emit('abducted', { hours, outfit: outfit.map((o) => o.id) });
    h.unlockChecks();
    this.phase = 'return';
    this.timer = 0;
    void h.save('abduction');
  }

  override render(): void {}

  protected override cleanup(): void {
    const h = this.h;
    this.hum?.stop();
    h.hud.setGlitch(false);
    h.setAmbienceMuted(false);
    h.setLightFlicker(0);
    this.interior?.remove();
    h.player.character.root.visible = true;
    if (this.phase === 'beam' || this.phase === 'interior' || this.phase === 'return') {
      h.teleportPlayer(this.origin.clone(), this.originYaw);
      h.lockPlayer(false);
      h.player.character.animator.play('idle', { fade: 0.2 });
    }
    this.ufo?.dispose();
  }
}
