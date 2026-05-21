import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, signal, ViewChild } from '@angular/core';

type GameScreen = 'start' | 'playing' | 'paused' | 'game-over';
type PigType = 'normal' | 'fast' | 'gold' | 'bomb';
type WeaponId = 'blaster' | 'shotgun' | 'rifle';
type PausePanel = 'main' | 'options' | 'imprint' | 'privacy' | 'leaderboard';
type PerkType = 'time' | 'double-shot' | 'fast-reload' | 'screen-bomb';

interface Pig {
  x: number;
  y: number;
  size: number;
  direction: 1 | -1;
  speed: number;
  type: PigType;
  points: number;
  health: number;
  wobble: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
  maxLife: number;
  color: string;
}

interface FloatingText {
  text: string;
  x: number;
  y: number;
  color: string;
  life: number;
  maxLife: number;
}

interface Perk {
  x: number;
  y: number;
  size: number;
  type: PerkType;
  label: string;
  color: string;
  outlineColor: string;
  life: number;
  maxLife: number;
  wobble: number;
}

interface CanvasPosition {
  x: number;
  y: number;
}

interface Weapon {
  id: WeaponId;
  name: string;
  maxAmmo: number;
  reloadTime: number;
  pellets: number;
  spread: number;
  hitPadding: number;
  positiveScoreMultiplier: number;
  shotColor: string;
}

interface HighscoreEntry {
  name: string;
  score: number;
  hits: number;
  createdAt: string;
}

interface SupabaseScoreRow {
  player_name?: string;
  score?: number;
  hits?: number;
  created_at?: string;
}

type AudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements AfterViewInit, OnDestroy {
  @ViewChild('gameCanvas', { static: true }) private readonly gameCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('gameWrapper', { static: true }) private readonly gameWrapperRef!: ElementRef<HTMLDivElement>;
  @ViewChild('crosshair', { static: true }) private readonly crosshairRef!: ElementRef<HTMLDivElement>;
  @ViewChild('bgMusic', { static: true }) private readonly bgMusicRef!: ElementRef<HTMLAudioElement>;

  protected readonly score = signal(0);
  protected readonly hits = signal(0);
  protected readonly ammo = signal(8);
  protected readonly maxAmmo = signal(8);
  protected readonly weaponName = signal('Blaster');
  protected readonly timeLeft = signal(60);
  protected readonly bestScore = signal(0);
  protected readonly playerName = signal('Spieler');
  protected readonly soundEnabled = signal(true);
  protected readonly musicEnabled = signal(true);
  protected readonly volume = signal(0.35);
  protected readonly highscores = signal<HighscoreEntry[]>([]);
  protected readonly highscoreMessage = signal('Noch keine Einträge.');
  protected readonly screen = signal<GameScreen>('start');
  protected readonly pausePanel = signal<PausePanel>('main');
  protected readonly finalScoreText = signal('Du hast 0 Punkte erreicht.');
  protected readonly reloadActive = signal(false);
  protected readonly specialActive = signal(false);
  protected readonly specialCooldown = signal(0);
  protected readonly perkStatus = signal('Keine');
  protected readonly doubleShotTime = signal(0);
  protected readonly fastReloadTime = signal(0);
  protected readonly scoreSaved = signal(false);
  protected readonly scoreSaving = signal(false);

  private readonly supabaseUrl = 'https://lhxnyuqgfurvkpmafdwz.supabase.co';
  private readonly supabaseAnonKey = 'sb_publishable_vUHF2075R7Nh_ticwQSs2w_Bvv2lbO4';
  private readonly supabaseTable = 'scores';
  private readonly localScoresKey = 'schweine_alarm_scores';
  private readonly weapons: Weapon[] = [
    {
      id: 'blaster',
      name: 'Blaster',
      maxAmmo: 8,
      reloadTime: 0.65,
      pellets: 1,
      spread: 0,
      hitPadding: 0,
      positiveScoreMultiplier: 1,
      shotColor: '#fef3c7',
    },
    {
      id: 'shotgun',
      name: 'Schrotflinte',
      maxAmmo: 5,
      reloadTime: 0.9,
      pellets: 5,
      spread: 42,
      hitPadding: 6,
      positiveScoreMultiplier: 1,
      shotColor: '#fed7aa',
    },
    {
      id: 'rifle',
      name: 'Gewehr',
      maxAmmo: 3,
      reloadTime: 1.05,
      pellets: 1,
      spread: 0,
      hitPadding: 28,
      positiveScoreMultiplier: 2,
      shotColor: '#bfdbfe',
    },
  ];
  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D;
  private audioContext?: AudioContext;
  private currentWeaponIndex = 0;
  private weaponAmmo = this.weapons.map((weapon) => weapon.maxAmmo);
  private pigs: Pig[] = [];
  private perks: Perk[] = [];
  private particles: Particle[] = [];
  private floatingTexts: FloatingText[] = [];
  private lastTime = 0;
  private spawnTimer = 0;
  private perkSpawnTimer = 0;
  private nextPerkDelay = 4;
  private running = false;
  private paused = false;
  private animationId = 0;
  private specialCooldownValue = 0;
  private doubleShotTimer = 0;
  private fastReloadTimer = 0;
  private reloadTimer = 0;
  private specialActiveTimer?: number;

  ngAfterViewInit(): void {
    this.canvas = this.gameCanvasRef.nativeElement;
    this.ctx = this.canvas.getContext('2d') ?? undefined;
    this.bgMusicRef.nativeElement.volume = this.volume();
    this.draw();
    void this.loadHighscores();
  }

  ngOnDestroy(): void {
    this.stopAnimation();
    this.stopMusic();

    if (this.specialActiveTimer !== undefined) {
      window.clearTimeout(this.specialActiveTimer);
    }

    void this.audioContext?.close();
  }

  protected startGame(): void {
    this.initAudio();
    this.resetGame();
    this.startMusic();
    this.stopAnimation();
    this.animationId = window.requestAnimationFrame(this.gameLoop);
  }

  protected resumeGame(): void {
    if (!this.running || !this.paused) {
      return;
    }

    this.paused = false;
    this.screen.set('playing');
    this.startMusic();
    this.lastTime = performance.now();
    this.animationId = window.requestAnimationFrame(this.gameLoop);
  }

  protected togglePause(): void {
    if (!this.running) {
      return;
    }

    if (this.paused) {
      this.resumeGame();
      return;
    }

    this.pauseGame();
  }

  protected openPausePanel(panel: PausePanel): void {
    this.pausePanel.set(panel);

    if (panel === 'leaderboard') {
      void this.loadHighscores();
    }
  }

  protected backToPauseMenu(): void {
    this.pausePanel.set('main');
  }

  protected quitToMenu(): void {
    this.running = false;
    this.paused = false;
    this.reloadActive.set(false);
    this.pausePanel.set('main');
    this.stopMusic();
    this.stopAnimation();
    this.screen.set('start');
    this.draw();
  }

  protected restartGame(): void {
    this.pausePanel.set('main');
    this.startGame();
  }

  protected reload(): void {
    this.initAudio();

    if (!this.running || this.paused || this.reloadTimer > 0 || this.ammo() === this.maxAmmo()) {
      return;
    }

    this.reloadTimer = this.currentWeapon().reloadTime * this.reloadSpeedMultiplier();
    this.reloadActive.set(true);
    this.playReloadSound();
  }

  protected specialAttack(): void {
    this.initAudio();

    if (!this.running || this.paused || this.specialCooldownValue > 0 || !this.canvas) {
      return;
    }

    this.specialCooldownValue = 8;
    this.specialCooldown.set(this.specialCooldownValue);
    this.playSpecialSound();

    let bonus = 0;
    let count = 0;

    for (let i = this.pigs.length - 1; i >= 0; i--) {
      const pig = this.pigs[i];

      if (pig.type === 'bomb') {
        continue;
      }

      bonus += pig.points;
      count++;
      this.createExplosion(pig.x, pig.y, pig.type === 'gold' ? '#facc15' : '#fb7185', 18);
      this.addFloatingText(`+${pig.points}`, pig.x, pig.y, '#ffffff');
      this.pigs.splice(i, 1);
    }

    if (count > 0) {
      this.score.update((value) => value + bonus);
      this.hits.update((value) => value + count);
      this.updateBestScore();
    } else {
      this.addFloatingText('Kein Ziel', this.canvas.width / 2, this.canvas.height / 2, '#e5e7eb');
    }

    this.specialActive.set(true);

    if (this.specialActiveTimer !== undefined) {
      window.clearTimeout(this.specialActiveTimer);
    }

    this.specialActiveTimer = window.setTimeout(() => {
      this.specialActive.set(false);
    }, 150);
  }

  protected toggleMusic(): void {
    this.initAudio();
    this.musicEnabled.update((enabled) => !enabled);

    if (this.soundEnabled() && this.musicEnabled() && this.running && !this.paused) {
      this.startMusic();
      return;
    }

    this.stopMusic();
  }

  protected toggleSound(): void {
    this.soundEnabled.update((enabled) => !enabled);

    if (!this.soundEnabled()) {
      this.stopMusic();
      return;
    }

    this.initAudio();

    if (this.musicEnabled() && this.running && !this.paused) {
      this.startMusic();
    }
  }

  protected updateVolume(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const nextVolume = Number(input?.value ?? this.volume());
    this.volume.set(nextVolume);
    this.bgMusicRef.nativeElement.volume = nextVolume;
  }

  protected updatePlayerName(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.playerName.set(input?.value ?? 'Spieler');
  }

  protected async saveHighscore(): Promise<void> {
    if (this.saveScoreDisabled() || this.scoreSaving()) {
      return;
    }

    this.scoreSaving.set(true);

    const entry: HighscoreEntry = {
      name: this.normalizedPlayerName(),
      score: this.score(),
      hits: this.hits(),
      createdAt: new Date().toISOString(),
    };

    const savedOnline = await this.saveScoreOnline(entry);

    if (!savedOnline) {
      this.saveLocalScore(entry);
    }

    this.scoreSaved.set(true);
    this.scoreSaving.set(false);
    await this.loadHighscores();
  }

  protected shootFromPointer(event: PointerEvent): void {
    event.preventDefault();

    if (event.button === 2) {
      this.reload();
      return;
    }

    if (event.button !== 0) {
      return;
    }

    this.shootAt(event.clientX, event.clientY);
  }

  protected switchWeaponFromWheel(event: WheelEvent): void {
    event.preventDefault();

    if (event.deltaY === 0) {
      return;
    }

    this.initAudio();
    this.switchWeapon(event.deltaY > 0 ? 1 : -1);
  }

  protected blockContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  protected moveCrosshairFromPointer(event: PointerEvent): void {
    if (!this.running || this.paused) {
      return;
    }

    this.moveCrosshair(event.clientX, event.clientY);
  }

  protected showCrosshair(): boolean {
    return this.screen() === 'playing';
  }

  protected timeLeftDisplay(): number {
    return Math.ceil(this.timeLeft());
  }

  protected reloadLabel(): string {
    return this.reloadActive() ? 'Lädt...' : 'Nachladen';
  }

  protected specialLabel(): string {
    const cooldown = this.specialCooldown();
    return cooldown > 0 ? `Extra ${Math.ceil(cooldown)}` : 'Extra';
  }

  protected soundLabel(): string {
    return this.soundEnabled() ? 'Sound an' : 'Sound aus';
  }

  protected musicLabel(): string {
    return this.musicEnabled() ? 'Musik an' : 'Musik aus';
  }

  protected saveScoreLabel(): string {
    if (this.scoreSaving()) {
      return 'Speichert...';
    }

    return this.scoreSaved() ? 'Gespeichert' : 'Highscore speichern';
  }

  protected saveScoreDisabled(): boolean {
    return this.scoreSaved() || this.scoreSaving() || this.score() <= 0;
  }

  @HostListener('window:keydown', ['$event'])
  protected handleKeydown(event: KeyboardEvent): void {
    this.initAudio();

    if (event.key === 'Escape') {
      event.preventDefault();

      if (this.paused && this.pausePanel() !== 'main') {
        this.backToPauseMenu();
        return;
      }

      this.togglePause();
      return;
    }

    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      this.reload();
      return;
    }

    if (event.key === 'e' || event.key === 'E' || event.key === ' ') {
      event.preventDefault();
      this.specialAttack();
    }
  }

  private readonly gameLoop = (currentTime: number): void => {
    if (!this.running || this.paused) {
      return;
    }

    const deltaTime = Math.min((currentTime - this.lastTime) / 1000, 0.033);
    this.lastTime = currentTime;

    this.update(deltaTime);
    this.draw();

    this.animationId = window.requestAnimationFrame(this.gameLoop);
  };

  private resetGame(): void {
    this.pigs = [];
    this.perks = [];
    this.particles = [];
    this.floatingTexts = [];
    this.score.set(0);
    this.hits.set(0);
    this.currentWeaponIndex = 0;
    this.weaponAmmo = this.weapons.map((weapon) => weapon.maxAmmo);
    this.syncWeaponHud();
    this.timeLeft.set(60);
    this.lastTime = performance.now();
    this.spawnTimer = 0;
    this.perkSpawnTimer = 0;
    this.nextPerkDelay = 3.5;
    this.specialCooldownValue = 0;
    this.specialCooldown.set(0);
    this.doubleShotTimer = 0;
    this.fastReloadTimer = 0;
    this.doubleShotTime.set(0);
    this.fastReloadTime.set(0);
    this.updatePerkStatus();
    this.reloadTimer = 0;
    this.reloadActive.set(false);
    this.specialActive.set(false);
    this.scoreSaved.set(false);
    this.scoreSaving.set(false);
    this.pausePanel.set('main');
    this.running = true;
    this.paused = false;
    this.screen.set('playing');
  }

  private update(deltaTime: number): void {
    const nextTimeLeft = Math.max(0, this.timeLeft() - deltaTime);
    this.timeLeft.set(nextTimeLeft);

    if (nextTimeLeft <= 0) {
      this.endGame();
      return;
    }

    if (this.specialCooldownValue > 0) {
      this.specialCooldownValue = Math.max(0, this.specialCooldownValue - deltaTime);
      this.specialCooldown.set(this.specialCooldownValue);
    }

    this.updatePerkEffects(deltaTime);

    if (this.reloadTimer > 0) {
      this.reloadTimer = Math.max(0, this.reloadTimer - deltaTime);

      if (this.reloadTimer === 0) {
        this.weaponAmmo[this.currentWeaponIndex] = this.currentWeapon().maxAmmo;
        this.syncWeaponHud();
        this.reloadActive.set(false);
      }
    }

    this.spawnTimer += deltaTime;

    const difficulty = 1 + (60 - nextTimeLeft) / 60;
    const spawnDelay = Math.max(0.35, 1.15 - difficulty * 0.28);

    if (this.spawnTimer >= spawnDelay) {
      this.spawnPig();
      this.spawnTimer = 0;
    }

    this.perkSpawnTimer += deltaTime;

    if (this.perkSpawnTimer >= this.nextPerkDelay) {
      this.spawnPerk();
      this.perkSpawnTimer = 0;
      this.nextPerkDelay = 4.5 + Math.random() * 4.5;
    }

    this.updatePigs(deltaTime);
    this.updatePerks(deltaTime);
    this.updateParticles(deltaTime);
    this.updateFloatingTexts(deltaTime);
  }

  private spawnPig(): void {
    if (!this.canvas) {
      return;
    }

    const random = Math.random();
    let type: PigType = 'normal';

    if (random > 0.9) {
      type = 'gold';
    } else if (random > 0.78) {
      type = 'bomb';
    } else if (random > 0.58) {
      type = 'fast';
    }

    const direction: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const size = type === 'gold' ? 38 : type === 'fast' ? 30 : 34;
    const x = direction === 1 ? -size - 20 : this.canvas.width + size + 20;
    const y = 130 + Math.random() * 330;

    let speed = 90 + Math.random() * 70;
    let points = 10;
    const health = 1;

    if (type === 'fast') {
      speed = 180 + Math.random() * 90;
      points = 25;
    }

    if (type === 'gold') {
      speed = 160 + Math.random() * 100;
      points = 100;
    }

    if (type === 'bomb') {
      speed = 115 + Math.random() * 60;
      points = -50;
    }

    this.pigs.push({
      x,
      y,
      size,
      direction,
      speed,
      type,
      points,
      health,
      wobble: Math.random() * Math.PI * 2,
    });
  }

  private updatePigs(deltaTime: number): void {
    if (!this.canvas) {
      return;
    }

    for (let i = this.pigs.length - 1; i >= 0; i--) {
      const pig = this.pigs[i];
      pig.x += pig.direction * pig.speed * deltaTime;
      pig.wobble += deltaTime * 6;

      if (pig.x < -100 || pig.x > this.canvas.width + 100) {
        this.pigs.splice(i, 1);
      }
    }
  }

  private spawnPerk(): void {
    if (!this.canvas) {
      return;
    }

    const random = Math.random();
    let type: PerkType = 'time';

    if (random > 0.82) {
      type = 'screen-bomb';
    } else if (random > 0.58) {
      type = 'fast-reload';
    } else if (random > 0.32) {
      type = 'double-shot';
    }

    const perk = this.createPerk(type);
    perk.x = 90 + Math.random() * (this.canvas.width - 180);
    perk.y = 120 + Math.random() * (this.canvas.height - 250);
    this.perks.push(perk);
  }

  private createPerk(type: PerkType): Perk {
    const base = {
      x: 0,
      y: 0,
      size: 28,
      type,
      life: 8,
      maxLife: 8,
      wobble: Math.random() * Math.PI * 2,
    };

    if (type === 'double-shot') {
      return { ...base, label: '2x', color: '#a78bfa', outlineColor: '#5b21b6' };
    }

    if (type === 'fast-reload') {
      return { ...base, label: 'R', color: '#38bdf8', outlineColor: '#075985' };
    }

    if (type === 'screen-bomb') {
      return { ...base, label: 'B', color: '#f97316', outlineColor: '#7c2d12' };
    }

    return { ...base, label: '+8', color: '#22c55e', outlineColor: '#14532d' };
  }

  private updatePerks(deltaTime: number): void {
    for (let i = this.perks.length - 1; i >= 0; i--) {
      const perk = this.perks[i];
      perk.life -= deltaTime;
      perk.wobble += deltaTime * 4;

      if (perk.life <= 0) {
        this.perks.splice(i, 1);
      }
    }
  }

  private updatePerkEffects(deltaTime: number): void {
    if (this.doubleShotTimer > 0) {
      this.doubleShotTimer = Math.max(0, this.doubleShotTimer - deltaTime);
      this.doubleShotTime.set(this.doubleShotTimer);
    }

    if (this.fastReloadTimer > 0) {
      this.fastReloadTimer = Math.max(0, this.fastReloadTimer - deltaTime);
      this.fastReloadTime.set(this.fastReloadTimer);
    }

    this.updatePerkStatus();
  }

  private shootAt(clientX: number, clientY: number): void {
    this.initAudio();

    if (!this.running || this.paused || this.reloadTimer > 0) {
      return;
    }

    const pos = this.getCanvasPosition(clientX, clientY);

    if (!pos) {
      return;
    }

    this.moveCrosshair(clientX, clientY);

    if (this.ammo() <= 0) {
      this.playEmptySound();
      this.addFloatingText('Leer!', pos.x, pos.y, '#f87171');
      return;
    }

    const weapon = this.currentWeapon();

    this.weaponAmmo[this.currentWeaponIndex] = Math.max(0, this.weaponAmmo[this.currentWeaponIndex] - 1);
    this.syncWeaponHud();
    this.playShootSound(weapon);
    this.createWeaponShotParticles(pos, weapon);

    const hitPerkIndex = this.getHitPerkIndex(pos, weapon);

    if (hitPerkIndex !== -1) {
      const perk = this.perks[hitPerkIndex];
      this.perks.splice(hitPerkIndex, 1);
      this.collectPerk(perk);
      return;
    }

    const hitPigIndexes = this.getWeaponHitIndexes(pos, weapon);

    if (hitPigIndexes.length === 0) {
      this.addFloatingText('Daneben', pos.x, pos.y, '#e5e7eb');
      return;
    }

    for (const hitPigIndex of hitPigIndexes) {
      const pig = this.pigs[hitPigIndex];
      this.pigs.splice(hitPigIndex, 1);
      this.applyPigHit(pig, weapon);
    }
  }

  private switchWeapon(direction: 1 | -1): void {
    if (!this.running || this.paused) {
      return;
    }

    this.currentWeaponIndex = (this.currentWeaponIndex + direction + this.weapons.length) % this.weapons.length;
    this.reloadTimer = 0;
    this.reloadActive.set(false);
    this.syncWeaponHud();
    this.playTone(360 + this.currentWeaponIndex * 120, 0.05, 'triangle', 0.04);

    if (this.canvas) {
      this.addFloatingText(this.currentWeapon().name, this.canvas.width / 2, 92, '#ffffff');
    }
  }

  private currentWeapon(): Weapon {
    return this.weapons[this.currentWeaponIndex] ?? this.weapons[0];
  }

  private syncWeaponHud(): void {
    const weapon = this.currentWeapon();
    this.weaponName.set(weapon.name);
    this.maxAmmo.set(weapon.maxAmmo);
    this.ammo.set(this.weaponAmmo[this.currentWeaponIndex] ?? weapon.maxAmmo);
  }

  private getWeaponHitIndexes(pos: CanvasPosition, weapon: Weapon): number[] {
    const hitIndexes = new Set<number>();

    for (const offset of this.getEffectiveShotOffsets(weapon)) {
      const hitPigIndex = this.getHitPigIndex(pos.x + offset.x, pos.y + offset.y, weapon.hitPadding, hitIndexes);

      if (hitPigIndex !== -1) {
        hitIndexes.add(hitPigIndex);
      }
    }

    return [...hitIndexes].sort((a, b) => b - a);
  }

  private getHitPerkIndex(pos: CanvasPosition, weapon: Weapon): number {
    for (const offset of this.getEffectiveShotOffsets(weapon)) {
      const x = pos.x + offset.x;
      const y = pos.y + offset.y;

      for (let i = this.perks.length - 1; i >= 0; i--) {
        const perk = this.perks[i];
        const hitSize = perk.size + weapon.hitPadding;

        if (x >= perk.x - hitSize && x <= perk.x + hitSize && y >= perk.y - hitSize && y <= perk.y + hitSize) {
          return i;
        }
      }
    }

    return -1;
  }

  private collectPerk(perk: Perk): void {
    if (perk.type === 'time') {
      this.timeLeft.update((value) => Math.min(95, value + 8));
      this.addFloatingText('+8s Zeit', perk.x, perk.y, '#bbf7d0');
      this.playPerkSound();
      return;
    }

    if (perk.type === 'double-shot') {
      this.doubleShotTimer = Math.max(this.doubleShotTimer, 12);
      this.doubleShotTime.set(this.doubleShotTimer);
      this.updatePerkStatus();
      this.addFloatingText('Doppelschuss', perk.x, perk.y, '#ddd6fe');
      this.playPerkSound();
      return;
    }

    if (perk.type === 'fast-reload') {
      this.fastReloadTimer = Math.max(this.fastReloadTimer, 12);
      this.fastReloadTime.set(this.fastReloadTimer);

      if (this.reloadTimer > 0) {
        this.reloadTimer = Math.min(this.reloadTimer, this.currentWeapon().reloadTime * this.reloadSpeedMultiplier());
      }

      this.updatePerkStatus();
      this.addFloatingText('Schnell laden', perk.x, perk.y, '#bae6fd');
      this.playPerkSound();
      return;
    }

    this.detonateScreenBomb(perk.x, perk.y);
  }

  private detonateScreenBomb(x: number, y: number): void {
    let bonus = 0;
    let count = 0;

    for (let i = this.pigs.length - 1; i >= 0; i--) {
      const pig = this.pigs[i];
      this.createExplosion(pig.x, pig.y, pig.type === 'gold' ? '#facc15' : '#fb7185', 12);

      if (pig.type !== 'bomb') {
        bonus += pig.points;
        count++;
      }

      this.pigs.splice(i, 1);
    }

    if (count > 0) {
      this.score.update((value) => value + bonus);
      this.hits.update((value) => value + count);
      this.updateBestScore();
    }

    this.createExplosion(x, y, '#f97316', 34);
    this.addFloatingText(count > 0 ? `Bombe +${bonus}` : 'Bombe!', x, y, '#fed7aa');
    this.playBombPerkSound();
  }

  private getEffectiveShotOffsets(weapon: Weapon): CanvasPosition[] {
    const offsets = this.getShotOffsets(weapon);

    if (this.doubleShotTimer <= 0) {
      return offsets;
    }

    return [
      ...offsets.map((offset) => ({ x: offset.x - 24, y: offset.y })),
      ...offsets.map((offset) => ({ x: offset.x + 24, y: offset.y })),
    ];
  }

  private getShotOffsets(weapon: Weapon): CanvasPosition[] {
    if (weapon.pellets <= 1) {
      return [{ x: 0, y: 0 }];
    }

    const offsets: CanvasPosition[] = [{ x: 0, y: 0 }];

    for (let i = 1; i < weapon.pellets; i++) {
      const angle = ((i - 1) / (weapon.pellets - 1)) * Math.PI * 2;
      offsets.push({
        x: Math.cos(angle) * weapon.spread,
        y: Math.sin(angle) * weapon.spread * 0.68,
      });
    }

    return offsets;
  }

  private applyPigHit(pig: Pig, weapon: Weapon): void {
    this.hits.update((value) => value + 1);

    if (pig.type === 'bomb') {
      this.score.update((value) => Math.max(0, value + pig.points));
      this.updateBestScore();
      this.playBadHitSound();
      this.addFloatingText(String(pig.points), pig.x, pig.y, '#ef4444');
      this.createExplosion(pig.x, pig.y, '#111827', 22);
      return;
    }

    const points = Math.round(pig.points * weapon.positiveScoreMultiplier);
    this.score.update((value) => value + points);
    this.updateBestScore();
    this.playPigHitSound();
    this.addFloatingText(`+${points}`, pig.x, pig.y, pig.type === 'gold' ? '#facc15' : '#ffffff');
    this.createExplosion(pig.x, pig.y, pig.type === 'gold' ? '#facc15' : '#fb7185', 16);
  }

  private getHitPigIndex(x: number, y: number, hitPadding = 0, ignoredIndexes = new Set<number>()): number {
    for (let i = this.pigs.length - 1; i >= 0; i--) {
      if (ignoredIndexes.has(i)) {
        continue;
      }

      const pig = this.pigs[i];
      const hitWidth = pig.size * 1.55 + hitPadding;
      const hitHeight = pig.size * 1.05 + hitPadding;

      if (x >= pig.x - hitWidth && x <= pig.x + hitWidth && y >= pig.y - hitHeight && y <= pig.y + hitHeight) {
        return i;
      }
    }

    return -1;
  }

  private draw(): void {
    if (!this.ctx || !this.canvas) {
      return;
    }

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawBackground(this.ctx, this.canvas);

    for (const pig of this.pigs) {
      this.drawPig(this.ctx, pig);
    }

    for (const perk of this.perks) {
      this.drawPerk(this.ctx, perk);
    }

    for (const particle of this.particles) {
      this.ctx.globalAlpha = Math.max(particle.life / particle.maxLife, 0);
      this.ctx.fillStyle = particle.color;
      this.ctx.beginPath();
      this.ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.globalAlpha = 1;
    }

    for (const text of this.floatingTexts) {
      this.ctx.globalAlpha = Math.max(text.life / text.maxLife, 0);
      this.ctx.fillStyle = text.color;
      this.ctx.font = 'bold 24px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(text.text, text.x, text.y);
      this.ctx.globalAlpha = 1;
    }
  }

  private drawBackground(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const skyGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    skyGradient.addColorStop(0, '#7dd3fc');
    skyGradient.addColorStop(0.58, '#bae6fd');
    skyGradient.addColorStop(0.59, '#65a30d');
    skyGradient.addColorStop(1, '#365314');
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#fef3c7';
    ctx.beginPath();
    ctx.arc(90, 80, 42, 0, Math.PI * 2);
    ctx.fill();

    this.drawCloud(ctx, 220, 80, 1);
    this.drawCloud(ctx, 590, 105, 0.8);
    this.drawCloud(ctx, 760, 65, 0.7);

    ctx.fillStyle = '#92400e';
    ctx.fillRect(60, 320, 180, 150);
    ctx.fillStyle = '#7f1d1d';
    ctx.beginPath();
    ctx.moveTo(45, 320);
    ctx.lineTo(150, 230);
    ctx.lineTo(255, 320);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#fef3c7';
    ctx.fillRect(130, 370, 42, 100);
    ctx.fillStyle = '#451a03';
    ctx.fillRect(145, 405, 14, 65);

    ctx.strokeStyle = 'rgb(255 255 255 / 18%)';
    ctx.lineWidth = 2;

    for (let x = 0; x < canvas.width; x += 70) {
      ctx.beginPath();
      ctx.moveTo(x, 470);
      ctx.lineTo(x + 25, canvas.height);
      ctx.stroke();
    }
  }

  private drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
    ctx.fillStyle = 'rgb(255 255 255 / 88%)';
    ctx.beginPath();
    ctx.arc(x, y, 24 * scale, 0, Math.PI * 2);
    ctx.arc(x + 28 * scale, y - 8 * scale, 30 * scale, 0, Math.PI * 2);
    ctx.arc(x + 62 * scale, y, 24 * scale, 0, Math.PI * 2);
    ctx.arc(x + 30 * scale, y + 12 * scale, 26 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawPig(ctx: CanvasRenderingContext2D, pig: Pig): void {
    ctx.save();
    ctx.translate(pig.x, pig.y + Math.sin(pig.wobble) * 6);
    ctx.scale(pig.direction, 1);

    let bodyColor = '#fb7185';
    let outlineColor = '#be123c';

    if (pig.type === 'gold') {
      bodyColor = '#facc15';
      outlineColor = '#ca8a04';
    }

    if (pig.type === 'bomb') {
      bodyColor = '#111827';
      outlineColor = '#ef4444';
    }

    ctx.fillStyle = bodyColor;
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.ellipse(0, 0, pig.size * 1.2, pig.size * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(pig.size * 0.92, -pig.size * 0.18, pig.size * 0.58, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pig.size * 0.6, -pig.size * 0.55);
    ctx.lineTo(pig.size * 0.75, -pig.size);
    ctx.lineTo(pig.size * 0.95, -pig.size * 0.52);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = pig.type === 'bomb' ? '#ef4444' : '#fecdd3';
    ctx.beginPath();
    ctx.ellipse(pig.size * 1.25, -pig.size * 0.12, pig.size * 0.26, pig.size * 0.19, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(pig.size * 1.18, -pig.size * 0.14, 2.4, 0, Math.PI * 2);
    ctx.arc(pig.size * 1.33, -pig.size * 0.14, 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(pig.size * 0.98, -pig.size * 0.34, 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = pig.type === 'bomb' ? '#ef4444' : outlineColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(-pig.size * 1.18, -pig.size * 0.08, pig.size * 0.22, 0, Math.PI * 1.6);
    ctx.stroke();
    ctx.restore();
  }

  private drawPerk(ctx: CanvasRenderingContext2D, perk: Perk): void {
    const pulse = 1 + Math.sin(perk.wobble) * 0.08;
    const alpha = Math.min(1, perk.life / 1.5);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(perk.x, perk.y + Math.sin(perk.wobble) * 5);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = perk.color;
    ctx.strokeStyle = perk.outlineColor;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(-perk.size, -perk.size, perk.size * 2, perk.size * 2, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(perk.label, 0, 1);
    ctx.restore();
  }

  private createWeaponShotParticles(pos: CanvasPosition, weapon: Weapon): void {
    const amount = weapon.id === 'shotgun' ? 3 : 8;

    for (const offset of this.getEffectiveShotOffsets(weapon)) {
      this.createShotParticles(pos.x + offset.x * 0.35, pos.y + offset.y * 0.35, weapon.shotColor, amount);
    }
  }

  private createShotParticles(x: number, y: number, color = '#fef3c7', amount = 8): void {
    for (let i = 0; i < amount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 90;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 2 + Math.random() * 2,
        life: 0.16,
        maxLife: 0.16,
        color,
      });
    }
  }

  private createExplosion(x: number, y: number, color: string, amount: number): void {
    for (let i = 0; i < amount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 160;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 3 + Math.random() * 5,
        life: 0.42,
        maxLife: 0.42,
        color,
      });
    }
  }

  private updateParticles(deltaTime: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.x += particle.vx * deltaTime;
      particle.y += particle.vy * deltaTime;
      particle.vy += 90 * deltaTime;
      particle.life -= deltaTime;

      if (particle.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  private addFloatingText(text: string, x: number, y: number, color: string): void {
    this.floatingTexts.push({
      text,
      x,
      y,
      color,
      life: 0.8,
      maxLife: 0.8,
    });
  }

  private updateFloatingTexts(deltaTime: number): void {
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const text = this.floatingTexts[i];
      text.y -= 48 * deltaTime;
      text.life -= deltaTime;

      if (text.life <= 0) {
        this.floatingTexts.splice(i, 1);
      }
    }
  }

  private pauseGame(): void {
    if (!this.running || this.paused) {
      return;
    }

    this.paused = true;
    this.stopMusic();
    this.stopAnimation();
    this.pausePanel.set('main');
    this.screen.set('paused');
  }

  private endGame(): void {
    if (!this.running) {
      return;
    }

    this.playGameOverSound();
    this.running = false;
    this.paused = false;
    this.reloadActive.set(false);
    this.stopMusic();
    this.stopAnimation();
    this.finalScoreText.set(`Du hast ${this.score()} Punkte erreicht und ${this.hits()} Schweine getroffen.`);
    this.screen.set('game-over');
    void this.loadHighscores();
  }

  private getCanvasPosition(clientX: number, clientY: number): CanvasPosition | undefined {
    if (!this.canvas) {
      return undefined;
    }

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  private moveCrosshair(clientX: number, clientY: number): void {
    const rect = this.gameWrapperRef.nativeElement.getBoundingClientRect();
    const crosshair = this.crosshairRef.nativeElement;
    crosshair.style.left = `${clientX - rect.left}px`;
    crosshair.style.top = `${clientY - rect.top}px`;
  }

  private startMusic(): void {
    if (!this.soundEnabled() || !this.musicEnabled()) {
      return;
    }

    const music = this.bgMusicRef.nativeElement;
    music.volume = this.volume();
    void music.play().catch(() => undefined);
  }

  private stopMusic(): void {
    this.bgMusicRef.nativeElement.pause();
  }

  private async loadHighscores(): Promise<void> {
    this.highscoreMessage.set('Lade Highscore...');

    const onlineScores = await this.loadOnlineScores();
    const scores = onlineScores ?? this.getLocalScores();

    this.highscores.set(scores.slice(0, 10));

    if (scores.length === 0) {
      this.highscoreMessage.set('Noch keine Einträge.');
      this.bestScore.set(Math.max(this.bestScore(), this.score()));
      return;
    }

    this.highscoreMessage.set('');
    this.bestScore.set(Math.max(this.bestScore(), this.score(), scores[0].score));
  }

  private async loadOnlineScores(): Promise<HighscoreEntry[] | undefined> {
    const url = `${this.supabaseUrl}/rest/v1/${this.supabaseTable}?select=player_name,score,hits,created_at&order=score.desc&limit=10`;

    try {
      const response = await fetch(url, {
        headers: this.supabaseHeaders(),
      });

      if (!response.ok) {
        return undefined;
      }

      const rows = (await response.json()) as SupabaseScoreRow[];
      return rows.map((row) => ({
        name: row.player_name?.trim() || 'Spieler',
        score: Number(row.score ?? 0),
        hits: Number(row.hits ?? 0),
        createdAt: row.created_at ?? '',
      }));
    } catch {
      return undefined;
    }
  }

  private async saveScoreOnline(entry: HighscoreEntry): Promise<boolean> {
    try {
      const response = await fetch(`${this.supabaseUrl}/rest/v1/${this.supabaseTable}`, {
        method: 'POST',
        headers: {
          ...this.supabaseHeaders(),
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          player_name: entry.name,
          score: entry.score,
          hits: entry.hits,
        }),
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  private supabaseHeaders(): Record<string, string> {
    return {
      apikey: this.supabaseAnonKey,
      Authorization: `Bearer ${this.supabaseAnonKey}`,
    };
  }

  private getLocalScores(): HighscoreEntry[] {
    try {
      const value = window.localStorage.getItem(this.localScoresKey) ?? '[]';
      const scores = JSON.parse(value) as Partial<HighscoreEntry>[];
      return scores
        .filter((score): score is HighscoreEntry => this.isHighscoreEntry(score))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
    } catch {
      return [];
    }
  }

  private saveLocalScore(entry: HighscoreEntry): void {
    const scores = [...this.getLocalScores(), entry].sort((a, b) => b.score - a.score).slice(0, 10);
    window.localStorage.setItem(this.localScoresKey, JSON.stringify(scores));
    this.highscores.set(scores);
    this.bestScore.set(Math.max(this.bestScore(), scores[0]?.score ?? 0));
  }

  private isHighscoreEntry(value: Partial<HighscoreEntry>): value is HighscoreEntry {
    return (
      typeof value.name === 'string' &&
      typeof value.score === 'number' &&
      typeof value.hits === 'number' &&
      typeof value.createdAt === 'string'
    );
  }

  private normalizedPlayerName(): string {
    const name = this.playerName().trim();
    return name.length > 0 ? name : 'Spieler';
  }

  private updateBestScore(): void {
    this.bestScore.set(Math.max(this.bestScore(), this.score()));
  }

  private reloadSpeedMultiplier(): number {
    return this.fastReloadTimer > 0 ? 0.45 : 1;
  }

  private updatePerkStatus(): void {
    const active: string[] = [];

    if (this.doubleShotTimer > 0) {
      active.push(`Doppelschuss ${Math.ceil(this.doubleShotTimer)}s`);
    }

    if (this.fastReloadTimer > 0) {
      active.push(`Schnell laden ${Math.ceil(this.fastReloadTimer)}s`);
    }

    this.perkStatus.set(active.length > 0 ? active.join(' | ') : 'Keine');
  }

  private initAudio(): void {
    if (!this.soundEnabled()) {
      return;
    }

    if (!this.audioContext) {
      const audioWindow = window as AudioWindow;
      const AudioContextConstructor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;

      if (!AudioContextConstructor) {
        return;
      }

      this.audioContext = new AudioContextConstructor();
    }

    if (this.audioContext.state === 'suspended') {
      void this.audioContext.resume();
    }
  }

  private playTone(frequency: number, duration: number, type: OscillatorType = 'square', volume = 0.08): void {
    if (!this.soundEnabled() || !this.audioContext) {
      return;
    }

    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
    gain.gain.setValueAtTime(volume, this.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);

    oscillator.connect(gain);
    gain.connect(this.audioContext.destination);

    oscillator.start();
    oscillator.stop(this.audioContext.currentTime + duration);
  }

  private playSweep(
    startFrequency: number,
    endFrequency: number,
    duration: number,
    type: OscillatorType = 'sawtooth',
    volume = 0.08,
  ): void {
    if (!this.soundEnabled() || !this.audioContext) {
      return;
    }

    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, this.audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, this.audioContext.currentTime + duration);
    gain.gain.setValueAtTime(volume, this.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);

    oscillator.connect(gain);
    gain.connect(this.audioContext.destination);

    oscillator.start();
    oscillator.stop(this.audioContext.currentTime + duration);
  }

  private playShootSound(weapon = this.currentWeapon()): void {
    if (weapon.id === 'shotgun') {
      this.playSweep(190, 55, 0.12, 'sawtooth', 0.09);
      return;
    }

    if (weapon.id === 'rifle') {
      this.playSweep(420, 120, 0.1, 'square', 0.08);
      return;
    }

    this.playSweep(260, 90, 0.08, 'square', 0.07);
  }

  private playReloadSound(): void {
    this.playTone(220, 0.06, 'triangle', 0.06);
    window.setTimeout(() => this.playTone(340, 0.06, 'triangle', 0.05), 80);
  }

  private playPigHitSound(): void {
    this.playTone(520, 0.06, 'triangle', 0.08);
    window.setTimeout(() => this.playTone(720, 0.05, 'triangle', 0.05), 55);
  }

  private playBadHitSound(): void {
    this.playSweep(160, 50, 0.22, 'sawtooth', 0.12);
  }

  private playEmptySound(): void {
    this.playTone(90, 0.08, 'square', 0.05);
  }

  private playSpecialSound(): void {
    this.playSweep(220, 980, 0.22, 'triangle', 0.1);
    window.setTimeout(() => this.playSweep(800, 180, 0.18, 'square', 0.07), 90);
  }

  private playPerkSound(): void {
    this.playTone(620, 0.07, 'triangle', 0.08);
    window.setTimeout(() => this.playTone(840, 0.08, 'triangle', 0.06), 70);
  }

  private playBombPerkSound(): void {
    this.playSweep(160, 520, 0.18, 'sawtooth', 0.1);
    window.setTimeout(() => this.playSweep(520, 90, 0.22, 'square', 0.08), 80);
  }

  private playGameOverSound(): void {
    this.playSweep(260, 70, 0.5, 'sawtooth', 0.12);
  }

  private stopAnimation(): void {
    if (this.animationId !== 0) {
      window.cancelAnimationFrame(this.animationId);
      this.animationId = 0;
    }
  }
}
