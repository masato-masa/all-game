/* ===========================================================
   state.js ― 状態の生成・保存・復元・ユーティリティ
   （6章 パラメータ設計に対応）
   =========================================================== */
'use strict';

const Util = {
  clamp(v, min, max){ return Math.max(min, Math.min(max, v)); },
  rand(a, b){ return a + Math.random() * (b - a); },
  randInt(a, b){ return Math.floor(Util.rand(a, b + 1)); },
  pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; },
  round1(v){ return Math.round(v * 10) / 10; },
  /** 労働傾向の合計を常に100に保つ（6-2 配分型） */
  normalizeWork(work){
    const keys = ['frontier','production','combat','faith','commerce'];
    let sum = 0;
    keys.forEach(k => { work[k] = Math.max(0, work[k] || 0); sum += work[k]; });
    if(sum <= 0){ return work; }
    keys.forEach(k => { work[k] = work[k] * 100 / sum; });
    return work;
  },
  fmtClock(sec){
    const d = Math.floor(sec / 86400) + 1;
    const h = Math.floor(sec % 86400 / 3600);
    const m = Math.floor(sec % 3600 / 60);
    return `${d}日目 ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  },
  fmtDuration(sec){
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    if(h > 0) return `${h}時間${m}分`;
    if(m > 0) return `${m}分${s}秒`;
    return `${s}秒`;
  }
};

const State = {
  /* ---------- 新規ゲーム ---------- */
  fresh(){
    return {
      v: 2,
      screen: 'intro',            // intro → site → play
      site: null,
      createdAt: Date.now(),
      lastSeen: Date.now(),
      timeSec: 0,
      stage: 0,
      res:    { food:30, materials:20, stones:0, cap:400 },
      meters: { faith:0, faithTotal:0, gp:0, gpCap:5, happiness:70, security:50 },
      world: null,                // 地図（種と発見済みノード）。World.init が生成する
      villagers: FOUNDERS.map(f => State.makeVillager(f)),
      buildings: { watchtower:0, farm:0, altar:0, storehouse:0 },
      building:  null,            // {id, endAt, sec}
      buffs: [],                  // {id,label,kind,mag,until}
      oracle: { uses: CONFIG.ORACLE_MAX, nextRefill: CONFIG.ORACLE_REFILL_SEC, recent: {} },
      threat: { nextAt: 240, warned:false, revealed:false, weaken:0 },
      recruit:{ nextAt: 200, guaranteedGood:false },
      shopCd: {},
      flags:  { story:{}, noahAnxious:false, noahAnxiousSince:null },
      stats:  { won:0, lost:0, oracles:0, miracles:0, joined:0, left:0 },
      log: [],
      pendingEvents: [],          // モーダルで見せる待ち行列
      digest: null
    };
  },

  makeVillager(def){
    return {
      uid: def.id || ('v' + Math.random().toString(36).slice(2, 8)),
      name: def.name, role: def.role, emoji: def.emoji, cls: def.cls || '',
      founder: !!def.founder,
      temperament: def.temperament,
      apt: def.apt,                        // high / low / none
      work: Object.assign({}, def.work),
      cond: {
        loyalty: def.cond ? def.cond.loyalty : 50,
        fatigue: def.cond ? def.cond.fatigue : 0,
        morale:  def.cond ? def.cond.morale  : 60,
        injuredUntil: 0
      },
      support: def.support || 0,           // 後方支援値（4-2）
      skills: def.skills ? def.skills.slice() : [],
      badge: def.badge || null,
      traits: def.traits || []
    };
  },

  /* ---------- 新規村人の生成 ---------- */
  makeRecruit(good){
    const base = Util.pick(RECRUIT_ROLES);
    const temp = Util.pick(Object.keys(TEMPERAMENTS).filter(t => t !== '好奇心旺盛'));
    const work = Object.assign({}, base.work);
    // 個体差
    Object.keys(work).forEach(k => { work[k] = Math.max(0, work[k] + Util.rand(-8, 8)); });
    Util.normalizeWork(work);
    const v = State.makeVillager({
      name: Util.pick(RECRUIT_NAMES), role: base.role, emoji: base.emoji,
      temperament: temp, apt: base.apt, work: work,
      cond: {
        loyalty: good ? Util.randInt(55, 70) : Util.randInt(30, 50),
        fatigue: 0,
        morale:  good ? Util.randInt(70, 85) : Util.randInt(50, 70)
      }
    });
    if(good){
      v.skills.push('素質あり');
      Object.keys(v.work).forEach(k => { if(v.work[k] > 20) v.work[k] *= 1.15; });
      Util.normalizeWork(v.work);
      v.support += 4;
    }
    return v;
  },

  /* ---------- 保存 / 復元 ---------- */
  save(st){
    try{
      st.lastSeen = Date.now();
      localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(st));
      return true;
    }catch(e){ console.warn('保存に失敗:', e); return false; }
  },

  load(){
    try{
      const raw = localStorage.getItem(CONFIG.SAVE_KEY);
      if(!raw) return null;
      const st = JSON.parse(raw);
      if(!st || st.v !== 2) return null;
      // 欠損キーの補完（バージョン差異の保険）
      const base = State.fresh();
      Object.keys(base).forEach(k => { if(st[k] === undefined) st[k] = base[k]; });
      st.villagers.forEach(v => { if(v.support === undefined) v.support = 0; });
      return st;
    }catch(e){ console.warn('読み込みに失敗:', e); return null; }
  },

  wipe(){ try{ localStorage.removeItem(CONFIG.SAVE_KEY); }catch(e){} },

  /* ---------- ログ ---------- */
  log(st, text, kind){
    st.log.push({ t: st.timeSec, text: text, kind: kind || '' });
    if(st.log.length > CONFIG.LOG_MAX) st.log.splice(0, st.log.length - CONFIG.LOG_MAX);
  },

  /* ---------- バフ ---------- */
  addBuff(st, id, label, kind, mag, sec){
    const existing = st.buffs.find(b => b.id === id);
    if(existing){
      existing.until = Math.max(existing.until, st.timeSec + sec);
      existing.mag = mag;
    }else{
      st.buffs.push({ id, label, kind, mag, until: st.timeSec + sec });
    }
  },
  /** kind に一致するバフの積を返す */
  buffMul(st, kind){
    let m = 1;
    st.buffs.forEach(b => { if(b.kind === kind) m *= b.mag; });
    return m;
  },
  cleanBuffs(st){
    st.buffs = st.buffs.filter(b => b.until > st.timeSec);
  },

  /* ---------- 参照ヘルパ ---------- */
  find(st, id){ return st.villagers.find(v => v.uid === id); },
  hasDorn(st){ return !!State.find(st, 'dorn'); },
  noah(st){ return State.find(st, 'noah'); },
  stage(st){ return STAGES[st.stage]; },
  siteMod(st){ return (st.site && SITES[st.site]) ? SITES[st.site].mod : { food:1, mat:1, faith:1, def:1, threat:1 }; }
};
