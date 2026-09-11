/* ===========================================================
   audio.js ― 環境音楽と効果音（Web Audio APIで合成／音源ファイル不要）
   ゆるやかなパッド＋まばらな旋律＋風の音。放置ゲームなので
   「鳴っていることを忘れられる」音量・密度に寄せている。
   =========================================================== */
'use strict';

const Sound = {
  ctx: null,
  master: null,
  musicGain: null,
  sfxGain: null,
  wet: null,
  on: false,
  volume: 0.55,
  timer: null,
  chordIndex: 0,
  started: false,

  /* A エオリアン系の穏やかな進行（Am7 - Fmaj7 - Cmaj7 - Gsus） */
  CHORDS: [
    [220.00, 261.63, 329.63, 392.00],   // Am7
    [174.61, 220.00, 261.63, 349.23],   // Fmaj7
    [130.81, 196.00, 261.63, 329.63],   // Cmaj7
    [196.00, 261.63, 293.66, 392.00]    // Gsus
  ],
  /* Aマイナー・ペンタトニック（旋律用） */
  SCALE: [440.00, 523.25, 587.33, 659.25, 783.99, 880.00, 1046.50],

  /* ---------- 初期化（ユーザー操作の中でだけ呼べる） ---------- */
  init(){
    if(Sound.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return false;
    Sound.ctx = new AC();

    Sound.master = Sound.ctx.createGain();
    Sound.master.gain.value = Sound.volume;
    Sound.master.connect(Sound.ctx.destination);

    // 簡易リバーブ（ノイズの減衰からインパルス応答を作る）
    const conv = Sound.ctx.createConvolver();
    const len = Sound.ctx.sampleRate * 2.6;
    const buf = Sound.ctx.createBuffer(2, len, Sound.ctx.sampleRate);
    for(let ch = 0; ch < 2; ch++){
      const d = buf.getChannelData(ch);
      for(let i = 0; i < len; i++){
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
      }
    }
    conv.buffer = buf;
    Sound.wet = Sound.ctx.createGain();
    Sound.wet.gain.value = 0.32;
    conv.connect(Sound.wet);
    Sound.wet.connect(Sound.master);
    Sound.reverb = conv;

    Sound.musicGain = Sound.ctx.createGain();
    Sound.musicGain.gain.value = 0.0;
    Sound.musicGain.connect(Sound.master);
    Sound.musicGain.connect(conv);

    Sound.sfxGain = Sound.ctx.createGain();
    Sound.sfxGain.gain.value = 0.55;
    Sound.sfxGain.connect(Sound.master);
    Sound.sfxGain.connect(conv);

    Sound.makeWind();
    return true;
  },

  /* ---------- 風（フィルタしたノイズをゆっくり揺らす） ---------- */
  makeWind(){
    const ctx = Sound.ctx;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for(let i = 0; i < len; i++){
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;      // ブラウンノイズ寄り
      d[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.7;

    const g = ctx.createGain();
    g.gain.value = 0.05;

    // ゆっくりした揺らぎ
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.035;
    lfo.connect(lfoG); lfoG.connect(g.gain);

    src.connect(bp); bp.connect(g); g.connect(Sound.musicGain);
    src.start(); lfo.start();
    Sound.windGain = g;
  },

  /* ---------- 和音パッド ---------- */
  playChord(){
    if(!Sound.ctx || !Sound.on) return;
    const ctx = Sound.ctx;
    const t = ctx.currentTime;
    const chord = Sound.CHORDS[Sound.chordIndex % Sound.CHORDS.length];
    Sound.chordIndex++;

    const dur = 9.5;
    chord.forEach((f, i) => {
      [0, 1].forEach(k => {                       // 少しデチューンして重ねる
        const o = ctx.createOscillator();
        o.type = k ? 'triangle' : 'sine';
        o.frequency.value = f * (k ? 1.004 : 0.998);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.055 / (i * 0.5 + 1), t + 3.2);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(600, t);
        lp.frequency.linearRampToValueAtTime(1100, t + 4);
        lp.frequency.linearRampToValueAtTime(500, t + dur);
        o.connect(lp); lp.connect(g); g.connect(Sound.musicGain);
        o.start(t); o.stop(t + dur + 0.2);
      });
    });
  },

  /* ---------- まばらな旋律 ---------- */
  playNote(){
    if(!Sound.ctx || !Sound.on) return;
    if(Math.random() > 0.55) return;              // 鳴らさない間を大切にする
    const ctx = Sound.ctx;
    const t = ctx.currentTime + Math.random() * 0.4;
    const f = Sound.SCALE[Math.floor(Math.random() * Sound.SCALE.length)];

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.075, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);

    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if(pan) pan.pan.value = Math.random() * 1.2 - 0.6;

    o.connect(g);
    if(pan){ g.connect(pan); pan.connect(Sound.musicGain); }
    else g.connect(Sound.musicGain);
    o.start(t); o.stop(t + 2.6);
  },

  /* ---------- 効果音 ---------- */
  blip(freqs, type, vol, dur, gap){
    if(!Sound.ctx || !Sound.on) return;
    const ctx = Sound.ctx;
    freqs.forEach((f, i) => {
      const t = ctx.currentTime + i * (gap || 0.11);
      const o = ctx.createOscillator();
      o.type = type || 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.7));
      o.connect(g); g.connect(Sound.sfxGain);
      o.start(t); o.stop(t + (dur || 0.7) + 0.05);
    });
  },

  sfx(kind){
    switch(kind){
      case 'oracle':   Sound.blip([659.25, 987.77], 'sine', 0.10, 1.1, 0.13); break;
      case 'miracle':  Sound.blip([523.25, 659.25, 783.99, 1046.5], 'sine', 0.11, 1.5, 0.10); break;
      case 'warn':     Sound.blip([146.83, 138.59], 'triangle', 0.13, 1.0, 0.34); break;
      case 'win':      Sound.blip([392, 523.25, 659.25], 'triangle', 0.10, 0.9, 0.12); break;
      case 'lose':     Sound.blip([196, 155.56], 'triangle', 0.12, 1.3, 0.20); break;
      case 'discover': Sound.blip([880, 1174.66], 'sine', 0.09, 0.8, 0.09); break;
      case 'build':    Sound.blip([261.63, 329.63], 'triangle', 0.08, 0.6, 0.10); break;
      case 'join':     Sound.blip([440, 587.33, 880], 'sine', 0.08, 1.0, 0.11); break;
      case 'talk':     Sound.blip([523.25], 'sine', 0.035, 0.16, 0); break;
    }
  },

  /* ---------- 再生制御 ---------- */
  start(){
    if(!Sound.init()) return false;
    if(Sound.ctx.state === 'suspended') Sound.ctx.resume();
    Sound.on = true;
    Sound.musicGain.gain.cancelScheduledValues(Sound.ctx.currentTime);
    Sound.musicGain.gain.setTargetAtTime(1, Sound.ctx.currentTime, 1.6);
    if(!Sound.started){
      Sound.started = true;
      Sound.playChord();
      Sound.timer = setInterval(() => {
        if(!Sound.on) return;
        Sound.playChord();
      }, 9000);
      Sound.melodyTimer = setInterval(() => {
        if(!Sound.on) return;
        Sound.playNote();
      }, 2600);
    }
    return true;
  },

  stop(){
    Sound.on = false;
    if(Sound.ctx && Sound.musicGain){
      Sound.musicGain.gain.cancelScheduledValues(Sound.ctx.currentTime);
      Sound.musicGain.gain.setTargetAtTime(0, Sound.ctx.currentTime, 0.6);
    }
  },

  toggle(){
    if(Sound.on){ Sound.stop(); return false; }
    return Sound.start();
  },

  setVolume(v){
    Sound.volume = v;
    if(Sound.master) Sound.master.gain.setTargetAtTime(v, Sound.ctx.currentTime, 0.1);
    try{ localStorage.setItem('nameless_vol', String(v)); }catch(e){}
  },

  loadPrefs(){
    try{
      const v = localStorage.getItem('nameless_vol');
      if(v !== null) Sound.volume = parseFloat(v);
    }catch(e){}
    return Sound.volume;
  }
};
