import { CRUISE_SPEED, MAX_SPEED } from './sim/config';
import type { SimEvent, SimState, WorldLike } from './sim/types';

const TEMPO_BPM = 104;
const STEP_SECONDS = 60 / TEMPO_BPM / 4;
const STEPS_PER_BAR = 16;
/** 排程器每次往前排多遠的音符，以及多久醒來一次。 */
const SCHEDULE_AHEAD = 0.12;
const SCHEDULE_INTERVAL_MS = 30;
const BASE_FREQ = 110;
/** A 小調五聲音階：繞行琶音與星塵音效都取自這組音，怎麼彈都不會不和諧。 */
const PENTATONIC = [0, 3, 5, 7, 10];
/** 繞行時每轉過這個角度彈一個音，所以繞得越快琶音越密。 */
const ARP_SECTOR = Math.PI / 3;
const MASTER_GAIN = 0.8;
/** 各聲部在「能量」達到多少時加入。能量跟著連擊數上升，斷連後慢慢消退。 */
const LAYER_KICK = 2;
const LAYER_HAT = 3;
const LAYER_SNARE = 4;
const LAYER_ARP = 6;
const LAYER_LEAD_OCTAVE = 9;
/** 斷連後能量每秒掉多少：聲部一層一層退場，而不是瞬間全部消失。 */
const ENERGY_DECAY = 0.6;
const BARS_PER_SECTION = 8;
const PHRASE_STEPS = STEPS_PER_BAR * 2;
/** 主旋律的回音間隔（附點八分音符）。 */
const ECHO_STEPS = 3;

/** 和弦以相對 A 的半音表示：根音、三音、五音。 */
type Chord = readonly [number, number, number];
const AM: Chord = [0, 3, 7];
const F: Chord = [-4, 0, 3];
const C: Chord = [3, 7, 10];
const G: Chord = [-2, 2, 5];
const DM: Chord = [5, 8, 12];
const EM: Chord = [-5, -2, 2];

/** 主旋律的一個音：[樂句內第幾步, 五聲音階的第幾個音, 持續幾步]。 */
type Note = readonly [number, number, number];
type Phrase = readonly Note[];

interface Section {
  /** 每小節一個和弦，共 BARS_PER_SECTION 個。 */
  readonly chords: readonly Chord[];
  /** 每個樂句兩小節，共四句。 */
  readonly melody: readonly Phrase[];
  /** 每步的貝斯：0 不彈、1 根音、2 高八度。 */
  readonly bass: readonly number[];
  readonly leadType: OscillatorType;
  /** 琶音每步取和弦的第幾個音。 */
  readonly arp: readonly number[];
  readonly openHat: boolean;
}

const VERSE_1: Phrase = [[0, 3, 3], [4, 4, 2], [6, 5, 6], [14, 4, 2], [16, 3, 4], [22, 2, 2], [24, 3, 6]];
const VERSE_2: Phrase = [[0, 3, 3], [4, 4, 2], [6, 5, 4], [12, 6, 2], [14, 5, 2], [16, 4, 6], [24, 3, 6]];
const VERSE_3: Phrase = [[0, 5, 3], [4, 6, 2], [6, 7, 6], [14, 6, 2], [16, 5, 4], [22, 4, 2], [24, 5, 6]];
const VERSE_END: Phrase = [[0, 4, 3], [4, 3, 2], [6, 2, 4], [12, 1, 2], [14, 2, 2], [16, 0, 10]];
const BRIDGE_1: Phrase = [[0, 6, 6], [8, 5, 4], [12, 4, 4], [16, 5, 8], [26, 4, 2], [28, 3, 4]];
const BRIDGE_2: Phrase = [[0, 4, 6], [8, 3, 4], [12, 2, 4], [16, 3, 10]];
const BRIDGE_3: Phrase = [[2, 5, 2], [4, 6, 2], [6, 7, 2], [8, 8, 6], [16, 7, 4], [20, 6, 4], [24, 5, 6]];
const BRIDGE_END: Phrase = [[0, 7, 4], [4, 6, 4], [8, 5, 4], [12, 4, 4], [16, 7, 12]];

const VERSE: Section = {
  chords: [AM, F, C, G, AM, F, C, G],
  melody: [VERSE_1, VERSE_2, VERSE_3, VERSE_END],
  bass: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0],
  leadType: 'triangle',
  arp: [0, 1, 2],
  openHat: false,
};
const BRIDGE: Section = {
  chords: [F, G, EM, AM, DM, F, G, G],
  melody: [BRIDGE_1, BRIDGE_2, BRIDGE_3, BRIDGE_END],
  bass: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 2, 0, 0, 1, 0],
  leadType: 'triangle',
  arp: [0, 1, 2, 1],
  openHat: true,
};
const VERSE_VARIATION: Section = {
  ...VERSE,
  melody: [VERSE_3, VERSE_2, VERSE_1, VERSE_END],
  bass: [1, 0, 0, 0, 2, 0, 1, 0, 1, 0, 2, 0, 0, 0, 1, 2],
  leadType: 'square',
  arp: [0, 2, 1, 2],
};
/** 整首曲子的段落順序，32 小節（約 74 秒）循環一次。 */
const FORM: readonly Section[] = [VERSE, BRIDGE, VERSE_VARIATION, BRIDGE];
/** 勾住黑洞時琶音從低八度開始，聽起來更沉。 */
const HOLE_ARP_START = -5;

const freq = (semitones: number): number => BASE_FREQ * 2 ** (semitones / 12);
const scaleNote = (index: number): number => {
  const octave = Math.floor(index / PENTATONIC.length);
  return PENTATONIC[((index % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length]! + octave * 12;
};

interface Engine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly music: GainNode;
  readonly sfx: GainNode;
  /** 主旋律專用：帶回音。 */
  readonly lead: GainNode;
  readonly padFilter: BiquadFilterNode;
  readonly wind: { gain: GainNode; filter: BiquadFilterNode };
  readonly sizzle: GainNode;
  readonly analyser: AnalyserNode;
  readonly noise: AudioBuffer;
}

function noiseBuffer(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const buffer = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (decay > 0 ? Math.exp((-i / data.length) * decay) : 1);
    }
  }
  return buffer;
}

function loopedNoise(ctx: AudioContext, buffer: AudioBuffer, type: BiquadFilterType, hz: number, out: AudioNode) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = hz;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(filter).connect(gain).connect(out);
  source.start();
  return { gain, filter };
}

function buildEngine(): Engine {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.ratio.value = 8;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  master.connect(limiter).connect(analyser).connect(ctx.destination);

  // 用衰減雜訊當脈衝響應，做出空曠的殘響。
  const reverb = ctx.createConvolver();
  reverb.buffer = noiseBuffer(ctx, 2.6, 5);
  const wet = ctx.createGain();
  wet.gain.value = 0.32;
  reverb.connect(wet).connect(master);

  const bus = (level: number): GainNode => {
    const gain = ctx.createGain();
    gain.gain.value = level;
    gain.connect(master);
    gain.connect(reverb);
    return gain;
  };
  const music = bus(0);
  const sfx = bus(0.9);
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = 500;
  padFilter.connect(music);

  const lead = ctx.createGain();
  const echo = ctx.createDelay(1);
  echo.delayTime.value = STEP_SECONDS * ECHO_STEPS;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.35;
  const echoLevel = ctx.createGain();
  echoLevel.gain.value = 0.4;
  lead.connect(music);
  lead.connect(echo);
  echo.connect(feedback).connect(echo);
  echo.connect(echoLevel).connect(music);

  const noise = noiseBuffer(ctx, 2, 0);
  const wind = loopedNoise(ctx, noise, 'bandpass', 500, sfx);
  const sizzle = loopedNoise(ctx, noise, 'highpass', 5000, sfx).gain;
  return { ctx, master, music, sfx, lead, padFilter, wind, sizzle, analyser, noise };
}

interface ToneOptions {
  readonly type: OscillatorType;
  readonly hz: number;
  readonly at: number;
  readonly duration: number;
  readonly peak: number;
  readonly out: AudioNode;
  /** 若指定，音高在 duration 內滑到這個頻率。 */
  readonly glideTo?: number;
  readonly attack?: number;
}

function tone(ctx: AudioContext, o: ToneOptions): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.hz, o.at);
  if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(o.glideTo, o.at + o.duration);
  gain.gain.setValueAtTime(0.0001, o.at);
  gain.gain.exponentialRampToValueAtTime(o.peak, o.at + (o.attack ?? 0.006));
  gain.gain.exponentialRampToValueAtTime(0.0001, o.at + o.duration);
  osc.connect(gain).connect(o.out);
  osc.start(o.at);
  osc.stop(o.at + o.duration + 0.05);
}

function noiseHit(e: Engine, at: number, duration: number, peak: number, type: BiquadFilterType, from: number, to: number, out: AudioNode): void {
  const source = e.ctx.createBufferSource();
  source.buffer = e.noise;
  const filter = e.ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(from, at);
  filter.frequency.exponentialRampToValueAtTime(to, at + duration);
  const gain = e.ctx.createGain();
  gain.gain.setValueAtTime(peak, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  source.connect(filter).connect(gain).connect(out);
  source.start(at, Math.random());
  source.stop(at + duration + 0.05);
}

function snare(e: Engine, at: number, peak: number): void {
  noiseHit(e, at, 0.16, peak, 'bandpass', 2200, 1400, e.music);
  tone(e.ctx, { type: 'triangle', hz: 200, glideTo: 140, at, duration: 0.1, peak: peak * 0.8, out: e.music });
}

function scheduleMelody(e: Engine, section: Section, sectionStep: number, at: number, energy: number): void {
  const phrase = section.melody[Math.floor(sectionStep / PHRASE_STEPS)];
  const local = sectionStep % PHRASE_STEPS;
  for (const [start, index, length] of phrase ?? []) {
    if (start !== local) continue;
    const semitone = scaleNote(index) + 24;
    const duration = STEP_SECONDS * length * 0.95;
    const peak = section.leadType === 'square' ? 0.05 : 0.11;
    tone(e.ctx, { type: section.leadType, hz: freq(semitone), at, duration, peak, out: e.lead, attack: 0.012 });
    if (energy >= LAYER_LEAD_OCTAVE) {
      tone(e.ctx, { type: 'sine', hz: freq(semitone + 12), at, duration, peak: 0.04, out: e.lead, attack: 0.012 });
    }
  }
}

function scheduleDrums(e: Engine, section: Section, bar: number, step: number, at: number, energy: number): void {
  const lastBar = bar % BARS_PER_SECTION === BARS_PER_SECTION - 1;
  if (energy >= LAYER_KICK && step % 4 === 0) {
    tone(e.ctx, { type: 'sine', hz: 150, glideTo: 42, at, duration: 0.2, peak: 0.6, out: e.music });
  }
  if (energy >= LAYER_HAT && step % 2 === 1) {
    noiseHit(e, at, 0.05, step % 4 === 3 ? 0.11 : 0.06, 'highpass', 8000, 8000, e.music);
  }
  if (energy >= LAYER_HAT && section.openHat && step === 10) {
    noiseHit(e, at, 0.2, 0.07, 'highpass', 7000, 7000, e.music);
  }
  if (energy < LAYER_SNARE) return;
  // 每段最後一小節的最後一拍改成漸強的過門，其餘小節在第二、四拍打小鼓。
  if (lastBar && step >= 12) snare(e, at, 0.1 + (step - 12) * 0.05);
  else if (step === 4 || step === 12) snare(e, at, 0.2);
  if (step === 0 && bar % BARS_PER_SECTION === 0) noiseHit(e, at, 1.2, 0.1, 'highpass', 6000, 3000, e.music);
}

function scheduleStep(e: Engine, stepIndex: number, at: number, energy: number): void {
  const bar = Math.floor(stepIndex / STEPS_PER_BAR);
  const step = stepIndex % STEPS_PER_BAR;
  const section = FORM[Math.floor(bar / BARS_PER_SECTION) % FORM.length]!;
  const chord = section.chords[bar % BARS_PER_SECTION]!;

  if (step === 0) {
    const duration = STEP_SECONDS * STEPS_PER_BAR * 1.05;
    for (const semitone of chord) {
      tone(e.ctx, { type: 'sawtooth', hz: freq(semitone + 12), at, duration, peak: 0.07, out: e.padFilter, attack: 0.4 });
      tone(e.ctx, { type: 'sawtooth', hz: freq(semitone + 12) * 1.006, at, duration, peak: 0.05, out: e.padFilter, attack: 0.4 });
    }
  }
  const bass = section.bass[step]!;
  if (bass > 0) {
    tone(e.ctx, { type: 'triangle', hz: freq(chord[0] + (bass === 2 ? 0 : -12)), at, duration: STEP_SECONDS * 2.4, peak: bass === 2 ? 0.24 : 0.34, out: e.music });
  }
  scheduleMelody(e, section, stepIndex % (BARS_PER_SECTION * STEPS_PER_BAR), at, energy);
  scheduleDrums(e, section, bar, step, at, energy);
  if (energy >= LAYER_ARP) {
    const semitone = chord[section.arp[step % section.arp.length]!]! + 24 + (step % 8 >= 4 ? 12 : 0);
    tone(e.ctx, { type: 'square', hz: freq(semitone), at, duration: STEP_SECONDS * 0.9, peak: 0.035, out: e.padFilter });
  }
}

export interface GameAudio {
  /** 必須在使用者手勢的同一個同步呼叫中執行（Safari 不接受 await 之後才建立的 AudioContext）。 */
  unlock(): void;
  handleEvents(events: readonly SimEvent[], state: SimState, world: WorldLike): void;
  update(state: SimState, playing: boolean): void;
  setMuted(muted: boolean): void;
  /** 目前輸出的 RMS 音量，供 e2e 當作「真的有聲音」的判準。 */
  level(): number;
}

export function createAudio(): GameAudio {
  let engine: Engine | null = null;
  let nextStep = 0;
  let nextStepAt = 0;
  let energy = 0;
  let lastUpdateAt = 0;
  let lastSector: number | null = null;
  let arpIndex = 0;
  let dustStreak = 0;
  let lastDustAt = 0;
  let muted = false;

  function runScheduler(): void {
    const e = engine;
    if (!e || e.ctx.state !== 'running') return;
    if (nextStepAt < e.ctx.currentTime) nextStepAt = e.ctx.currentTime + 0.05;
    while (nextStepAt < e.ctx.currentTime + SCHEDULE_AHEAD) {
      scheduleStep(e, nextStep, nextStepAt, energy);
      nextStep += 1;
      nextStepAt += STEP_SECONDS;
    }
  }

  function unlock(): void {
    if (!engine) {
      try {
        engine = buildEngine();
      } catch {
        return; // 沒有 Web Audio 的環境：遊戲照常進行，只是沒有聲音。
      }
      engine.master.gain.value = muted ? 0 : MASTER_GAIN;
      window.setInterval(runScheduler, SCHEDULE_INTERVAL_MS);
    }
    if (engine.ctx.state !== 'running') void engine.ctx.resume();
  }

  function handleEvents(events: readonly SimEvent[], state: SimState, world: WorldLike): void {
    const e = engine;
    if (!e) return;
    const now = e.ctx.currentTime;
    for (const event of events) {
      switch (event.type) {
        case 'latch': {
          const star = event.kind === 'star' ? world.star(event.bodyId, state.tick) : undefined;
          arpIndex = star ? Math.floor(star.hue * 10) : HOLE_ARP_START;
          lastSector = null;
          tone(e.ctx, { type: 'triangle', hz: freq(scaleNote(arpIndex) + 12), at: now, duration: 0.5, peak: 0.3, out: e.sfx });
          if (event.fresh) tone(e.ctx, { type: 'sine', hz: freq(scaleNote(arpIndex + 2) + 24), at: now + 0.05, duration: 0.6, peak: 0.16, out: e.sfx });
          break;
        }
        case 'release': {
          const power = Math.min(1, event.speed / MAX_SPEED);
          noiseHit(e, now, 0.35 + power * 0.3, 0.12 + power * 0.3, 'bandpass', 500 + power * 900, 3500 + power * 4000, e.sfx);
          tone(e.ctx, { type: 'sine', hz: 180 + power * 200, glideTo: 520 + power * 900, at: now, duration: 0.28, peak: 0.12 + power * 0.14, out: e.sfx });
          break;
        }
        case 'dust': {
          dustStreak = now - lastDustAt < 0.6 ? dustStreak + 1 : 0;
          lastDustAt = now;
          tone(e.ctx, { type: 'sine', hz: freq(scaleNote(dustStreak % 10) + 36), at: now, duration: 0.3, peak: 0.13, out: e.sfx });
          break;
        }
        case 'bounce':
          tone(e.ctx, { type: 'sine', hz: 140, glideTo: 50, at: now, duration: 0.3, peak: 0.5, out: e.sfx });
          noiseHit(e, now, 0.18, 0.2, 'lowpass', 1800, 300, e.sfx);
          break;
        case 'death':
          tone(e.ctx, { type: 'sawtooth', hz: 420, glideTo: 36, at: now, duration: 1.2, peak: 0.3, out: e.sfx });
          noiseHit(e, now, 1.4, 0.5, 'lowpass', 6000, 120, e.sfx);
          break;
      }
    }
  }

  function update(state: SimState, playing: boolean): void {
    const e = engine;
    if (!e) return;
    const now = e.ctx.currentTime;
    const alive = playing && state.alive;
    const speed = Math.hypot(state.vel.x, state.vel.y);
    const boost = Math.min(1, Math.max(0, (speed - CRUISE_SPEED) / (MAX_SPEED - CRUISE_SPEED)));
    energy = alive ? Math.max(state.combo, energy - (now - lastUpdateAt) * ENERGY_DECAY) : 0;
    lastUpdateAt = now;

    e.music.gain.setTargetAtTime(alive ? 0.75 : 0.28, now, 0.4);
    e.padFilter.frequency.setTargetAtTime(alive ? 500 + boost * 2600 + Math.min(energy, 12) * 90 : 320, now, 0.25);
    e.wind.gain.gain.setTargetAtTime(alive ? 0.03 + boost * 0.22 : 0, now, 0.1);
    e.wind.filter.frequency.setTargetAtTime(400 + boost * 2200, now, 0.1);
    e.sizzle.gain.setTargetAtTime(alive && state.grazing ? 0.16 : 0, now, 0.04);

    if (!alive || !state.latch) {
      lastSector = null;
      return;
    }
    const sector = Math.floor(state.latch.theta / ARP_SECTOR);
    if (lastSector !== null && sector !== lastSector) {
      arpIndex += 1;
      tone(e.ctx, { type: 'triangle', hz: freq(scaleNote(arpIndex) + 24), at: now, duration: 0.32, peak: 0.16 + boost * 0.1, out: e.sfx });
    }
    lastSector = sector;
  }

  function level(): number {
    if (!engine) return 0;
    const data = new Float32Array(engine.analyser.fftSize);
    engine.analyser.getFloatTimeDomainData(data);
    return Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
  }

  function setMuted(next: boolean): void {
    muted = next;
    engine?.master.gain.setTargetAtTime(next ? 0 : MASTER_GAIN, engine.ctx.currentTime, 0.03);
  }

  return { unlock, handleEvents, update, setMuted, level };
}
