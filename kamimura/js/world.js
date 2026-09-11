/* ===========================================================
   world.js ― 神の地図
   ・地形は種から決定的に生成される（再読込しても同じ土地）
   ・村人は一人ずつ歩き、道具を持ち、仕事に応じた動きをする
   ・見守るための画面なので、描画にいちばん手をかけている
   =========================================================== */
'use strict';

const T = { GRASS:0, FOREST:1, WATER:2, SAND:3, ROCK:4, RUINS:5, HILL:6 };

const PAL = {
  grass:  ['#598b45','#5f9349','#52833f','#659c4e'],
  forest: ['#416533','#487038','#3b5c2f'],
  water:  '#2f6382',
  waterD: '#24506c',
  sand:   ['#8f8259','#988c63','#867a53'],
  rock:   ['#7b766f','#858079','#726d67'],
  hill:   ['#5c7a3e','#657f45','#547038'],
  ruins:  ['#5a554c','#635e54','#4f4a42']
};

const World = {
  W: 26, H: 13,

  grid: null, nodes: [], agents: [], raiders: [], animals: [], birds: [],
  trees: [], rocks: [], ruinParts: [], tufts: [], flowers: [], pebbles: [],
  particles: [], effects: [],
  vx: 13, vy: 6, slots: null,
  canvas: null,
  time: 0, ready: false, st: null, pathSig: '',
  hoverAgent: null, focus: null,

  /* =========================================================
     乱数（種つき）
     ========================================================= */
  rng(seed){
    let a = seed >>> 0;
    return function(){
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  /* =========================================================
     生成
     ========================================================= */
  generate(st){
    const rnd = World.rng(st.world.seed);
    const W = World.W, H = World.H;
    const g = new Array(W * H).fill(T.GRASS);
    const at  = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? -1 : g[y * W + x];
    const set = (x, y, v) => { if(x >= 0 && y >= 0 && x < W && y < H) g[y * W + x] = v; };

    /* --- 川（細く蛇行させ、行と行のあいだも必ずつなぐ） --- */
    const phase = rnd() * 6.28, amp = 1.6 + rnd() * 1.2;
    const rx0 = W * (0.34 + rnd() * 0.32);
    const cols = [];
    let drift = 0;
    for(let y = 0; y < H; y++){
      drift = Math.max(-1.2, Math.min(1.2, drift + (rnd() - 0.5) * 0.45));
      cols.push(Math.round(Math.max(3, Math.min(W - 4, rx0 + Math.sin(y * 0.34 + phase) * amp + drift))));
    }
    const wideRow = cols.map(() => rnd() < 0.4);
    for(let y = 0; y < H; y++){
      const a0 = cols[y], b0 = (y > 0 ? cols[y - 1] : a0);
      const lo = Math.min(a0, b0), hi = Math.max(a0, b0);
      for(let x = lo; x <= hi + (wideRow[y] ? 1 : 0); x++) set(x, y, T.WATER);
    }
    // 岸辺
    for(let y = 0; y < H; y++)
      for(let x = 0; x < W; x++){
        if(at(x, y) === T.WATER) continue;
        const touches = at(x-1,y) === T.WATER || at(x+1,y) === T.WATER ||
                        at(x,y-1) === T.WATER || at(x,y+1) === T.WATER;
        if(touches && rnd() < 0.62) set(x, y, T.SAND);
      }

    /* --- 森・岩・丘 --- */
    const blob = (cx, cy, r, type, jag) => {
      for(let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++)
        for(let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++){
          const d = Math.hypot(x - cx, (y - cy) * 1.25);
          if(d < r * (0.75 + rnd() * (jag || 0.5)) && at(x, y) !== T.WATER && at(x, y) !== T.SAND)
            set(x, y, type);
        }
    };
    for(let i = 0; i < 6; i++) blob(rnd() * W, rnd() * H, 1.7 + rnd() * 2.1, T.FOREST, 0.55);
    for(let i = 0; i < 3; i++) blob(rnd() * W, rnd() * H, 1.1 + rnd() * 1.4, T.ROCK, 0.4);
    for(let i = 0; i < 2; i++) blob(rnd() * W, rnd() * H, 1.6 + rnd() * 1.6, T.HILL, 0.5);

    /* --- 廃墟 --- */
    const ruX = Math.floor(rnd() < 0.5 ? 2 + rnd() * 3 : W - 6 + rnd() * 3);
    const ruY = Math.floor(rnd() < 0.5 ? 1 + rnd() * 3 : H - 5 + rnd() * 2);
    for(let y = ruY; y < ruY + 3; y++)
      for(let x = ruX; x < ruX + 3; x++)
        if(at(x, y) !== T.WATER && rnd() < 0.8) set(x, y, T.RUINS);

    /* --- 拠点 ---
       建物を置く範囲（横4・縦2）に水が1マスも無いことを必須にしたうえで、
       選んだ土地（川・岩・丘・廃墟）の近さで点をつける。 */
    const want = { river:T.WATER, cave:T.ROCK, hill:T.HILL, ruins:T.RUINS }[st.site] || T.GRASS;
    let best = null, bestScore = -1e9;
    for(let y = 3; y <= H - 4; y++)
      for(let x = 5; x <= W - 6; x++){
        let dry = true;
        for(let dy = -2; dy <= 2 && dry; dy++)
          for(let dx = -4; dx <= 4; dx++){
            const t2 = at(x + dx, y + dy);
            if(t2 === T.WATER || t2 === -1){ dry = false; break; }
          }
        if(!dry) continue;
        let near = 0;
        for(let dy = -4; dy <= 4; dy++)
          for(let dx = -5; dx <= 5; dx++) if(at(x + dx, y + dy) === want) near++;
        const s = near * 1.4 - Math.hypot(x - W / 2, y - H / 2) * 1.0 + rnd() * 2;
        if(s > bestScore){ bestScore = s; best = [x, y]; }
      }
    if(!best){                                   // 保険：水のない場所を素直に探す
      for(let y = 3; y <= H - 4 && !best; y++)
        for(let x = 5; x <= W - 6; x++)
          if(at(x, y) !== T.WATER && at(x, y) !== T.SAND){ best = [x, y]; break; }
    }
    World.vx = best ? best[0] : (W >> 1);
    World.vy = best ? best[1] : (H >> 1);

    // 村の敷地をならす（建物のぶんだけ広めに）
    for(let dy = -3; dy <= 3; dy++)
      for(let dx = -5; dx <= 5; dx++){
        const x = World.vx + dx, y = World.vy + dy;
        if(at(x, y) !== T.WATER && at(x, y) !== T.SAND) set(x, y, T.GRASS);
      }

    World.grid = g;

    /* --- 木・岩・草花の実体（描画用） --- */
    const trees = [], rocks = [], tufts = [], flowers = [], pebbles = [], ruinParts = [];
    const nearVillage = (x, y, r) => Math.hypot(x - World.vx, y - World.vy) < r;
    for(let y = 0; y < H; y++){
      for(let x = 0; x < W; x++){
        const t = g[y * W + x];
        if(t === T.FOREST){
          const n = 2 + Math.floor(rnd() * 2);
          for(let i = 0; i < n; i++){
            const px = x + 0.14 + rnd() * 0.72, py = y + 0.16 + rnd() * 0.68;
            if(nearVillage(px, py, 4.2)) continue;
            trees.push({ x:px, y:py, kind: rnd() < 0.42 ? 'pine' : 'round',
                         s: 0.68 + rnd() * 0.42, seed: rnd() * 9, shake: 0, tint: rnd() });
          }
          if(rnd() < 0.5) tufts.push({ x:x + rnd(), y:y + rnd(), s: 0.6 });
        }else if(t === T.GRASS || t === T.HILL){
          if(rnd() < 0.09 && !nearVillage(x, y, 4.2))
            trees.push({ x:x + 0.3 + rnd() * 0.4, y:y + 0.3 + rnd() * 0.4,
                         kind: rnd() < 0.3 ? 'pine' : 'round', s: 0.62 + rnd() * 0.36,
                         seed: rnd() * 9, shake: 0, tint: rnd() });
          const nf = 1 + Math.floor(rnd() * 2);
          for(let i = 0; i < nf; i++) tufts.push({ x:x + rnd(), y:y + rnd(), s: 0.6 + rnd() * 0.5 });
          if(rnd() < 0.13){
            const col = ['#d8c25e','#e6dcc0','#c9788f','#a892c8'][Math.floor(rnd() * 4)];
            for(let i = 0; i < 2; i++) flowers.push({ x:x + rnd(), y:y + rnd(), c: col });
          }
        }else if(t === T.ROCK){
          if(rnd() < 0.75)
            rocks.push({ x:x + 0.25 + rnd() * 0.5, y:y + 0.3 + rnd() * 0.45,
                         s: 0.55 + rnd() * 0.6, seed: rnd() * 9, round: rnd() < 0.45 });
          if(rnd() < 0.6) pebbles.push({ x:x + rnd(), y:y + rnd(), s: 0.6 + rnd() * 0.5 });
        }else if(t === T.SAND){
          if(rnd() < 0.7) pebbles.push({ x:x + rnd(), y:y + rnd(), s: 0.5 + rnd() * 0.6 });
          if(rnd() < 0.35) tufts.push({ x:x + rnd(), y:y + rnd(), s: 0.5 });
        }else if(t === T.RUINS){
          ruinParts.push({ x:x + 0.2 + rnd() * 0.6, y:y + 0.25 + rnd() * 0.5,
                           kind: rnd() < 0.45 ? 'pillar' : 'wall', s: 0.8 + rnd() * 0.5, seed: rnd() * 9 });
        }
      }
    }
    World.trees = trees; World.rocks = rocks; World.ruinParts = ruinParts;
    World.tufts = tufts; World.flowers = flowers; World.pebbles = pebbles;

    /* --- 資源 --- */
    const nodes = [];
    const far = (x, y, min) => !nodes.some(n => Math.hypot(n.x - x, n.y - y) < min);
    for(let y = 0; y < H; y++)
      for(let x = 0; x < W; x++){
        const t = g[y * W + x];
        let type = null;
        if(t === T.FOREST && rnd() < 0.16) type = 'wood';
        else if(t === T.GRASS && rnd() < 0.06 &&
                (at(x+1,y) === T.FOREST || at(x-1,y) === T.FOREST ||
                 at(x,y+1) === T.FOREST || at(x,y-1) === T.FOREST)) type = 'berry';
        else if(t === T.SAND && rnd() < 0.18) type = 'fish';
        else if(t === T.ROCK && rnd() < 0.22) type = 'stone';
        else if(t === T.RUINS && rnd() < 0.30) type = 'relic';
        else if(t === T.HILL && rnd() < 0.10) type = 'herb';
        if(type && far(x, y, 2.0) && Math.hypot(x - World.vx, y - World.vy) > 1.9)
          nodes.push({ id: nodes.length, x: x, y: y, type: type });
      }
    World.nodes = nodes;

    /* --- 最初から知っている場所 --- */
    if(!st.world.known) st.world.known = {};
    if(!Object.keys(st.world.known).length){
      nodes.forEach(n => {
        if(Math.hypot(n.x - World.vx, n.y - World.vy) < 5.4) st.world.known[n.id] = 1;
      });
      ['wood','berry','fish','stone'].forEach(kind => {
        if(nodes.some(n => n.type === kind && st.world.known[n.id])) return;
        const c = nodes.filter(n => n.type === kind)
          .sort((a, b) => Math.hypot(a.x-World.vx, a.y-World.vy) - Math.hypot(b.x-World.vx, b.y-World.vy))[0];
        if(c) st.world.known[c.id] = 1;
      });
    }
    World.recount(st);
    World.buildSlots(st);
  },

  /** 建物の位置（村の中心からの相対タイル座標） */
  buildSlots(st){
    const rnd = World.rng((st.world.seed ^ 0x51ed270b) >>> 0);
    const huts = [];
    for(let i = 0; i < 10; i++){
      // 建物のある方角（右上・右下・左下）は空けておく
      const ang = 0.95 + (i / 10) * Math.PI * 1.4;
      const r = 2.35 + (i % 3) * 0.5;
      huts.push({ x: Math.cos(ang) * r, y: Math.sin(ang) * r * 0.72,
                  face: Math.cos(ang) > 0 ? -1 : 1, seed: rnd() * 9 });
    }
    World.slots = {
      huts:  huts,
      well:  { x:-1.25, y: 0.85 },
      altar: { x: 0.10, y:-2.45 },
      tower: { x: 3.30, y:-1.55 },
      store: { x: 3.15, y: 1.35 },
      farm:  { x:-3.60, y: 1.75 },
      site:  { x: 1.90, y:-2.35 }
    };
  },

  recount(st){
    const c = { food:0, mat:0, faith:0 };
    World.nodes.forEach(n => {
      if(!st.world.known[n.id]) return;
      if(n.type === 'berry' || n.type === 'fish' || n.type === 'herb') c.food++;
      else if(n.type === 'wood' || n.type === 'stone') c.mat++;
      else if(n.type === 'relic') c.faith++;
    });
    st.world.knownCounts = c;
    return c;
  },

  /* =========================================================
     初期化
     ========================================================= */
  init(st, canvas){
    World.st = st;
    World.canvas = canvas;
    if(!st.world || !st.world.seed)
      st.world = { seed: (Math.random() * 1e9) | 0, known: {}, knownCounts:{food:0,mat:0,faith:0} };
    World.generate(st);
    World.syncAgents(st);
    World.spawnAnimals();
    Scene3D.init(canvas, st);
    World.ready = true;
  },

  reset(){
    Scene3D.dispose();
    World.agents = []; World.raiders = []; World.effects = []; World.particles = [];
    World.animals = []; World.birds = []; World.nodes = []; World.trees = [];
    World.ready = false; World.time = 0; World.pathSig = ''; World.focus = null;
    Portrait.clear();
  },

  /* =========================================================
     村人エージェント
     ========================================================= */
  syncAgents(st){
    const alive = {};
    st.villagers.forEach(v => {
      alive[v.uid] = true;
      if(World.agents.some(a => a.uid === v.uid)) return;
      const ang = Math.random() * Math.PI * 2;
      World.agents.push({
        uid: v.uid,
        x: World.vx + Math.cos(ang) * 1.4, y: World.vy + Math.sin(ang) * 1.0,
        tx: World.vx, ty: World.vy,
        state: 'idle', task: null, timer: 0, node: null,
        speed: 0.95 + Math.random() * 0.3,
        phase: Math.random() * 10, actT: 0, flip: 1,
        blinkT: 2 + Math.random() * 4,
        emote: null, bubble: null, bubbleT: 0, glow: 0, carry: null,
        look: Portrait.def(v)
      });
    });
    World.agents = World.agents.filter(a => alive[a.uid]);
  },

  agentOf(uid){ return World.agents.find(a => a.uid === uid); },

  TASKS: {
    food:   { emote:'🌾', label:'食べ物を集めている', kinds:['berry','fish','herb'], tool:'basket' },
    mat:    { emote:'🪓', label:'木や石を運んでいる', kinds:['wood','stone'],        tool:'axe' },
    build:  { emote:'🔨', label:'建てている',        kinds:[],                      tool:'hammer' },
    patrol: { emote:'🛡️', label:'見回っている',      kinds:[],                      tool:'spear' },
    pray:   { emote:'🙏', label:'祈っている',        kinds:['relic'],               tool:null },
    trade:  { emote:'🎒', label:'荷を数えている',    kinds:[],                      tool:'sack' },
    rest:   { emote:'💤', label:'休んでいる',        kinds:[],                      tool:null },
    play:   { emote:'✨', label:'駆け回っている',    kinds:[],                      tool:null },
    water:  { emote:'🪣', label:'水を汲んでいる',    kinds:[],                      tool:'bucket' },
    fire:   { emote:'🔥', label:'焚き火を囲んでいる', kinds:[],                     tool:null }
  },

  chooseTask(st, a){
    const v = State.find(st, a.uid);
    if(!v) return;
    // 夜はたいてい焚き火のまわりに集まる（込みすぎない範囲で）
    if(World.dayPhase(st).night && Math.random() < 0.72){
      let atFire = 0;
      World.agents.forEach(o => { if(o !== a && o.task === 'fire') atFire++; });
      if(atFire < 8){ World.setTask(st, a, 'fire'); return; }
    }
    if(v.cond.injuredUntil > st.timeSec || v.cond.fatigue > 78){ World.setTask(st, a, 'rest'); return; }
    if(v.apt === 'none' && v.work.production < 1){
      World.setTask(st, a, Math.random() < 0.7 ? 'play' : 'rest'); return;
    }
    if(st.building && v.work.frontier > 12 && Math.random() < 0.5){ World.setTask(st, a, 'build'); return; }
    if(Math.random() < 0.08){ World.setTask(st, a, 'water'); return; }

    const w = v.work;
    const roll = Math.random() * 100;
    let acc = 0;
    const order = [['production','food'], ['frontier','mat'], ['combat','patrol'],
                   ['faith','pray'], ['commerce','trade']];
    for(const pair of order){
      acc += w[pair[0]];
      if(roll <= acc){ World.setTask(st, a, pair[1]); return; }
    }
    World.setTask(st, a, 'trade');
  },

  setTask(st, a, task){
    a.task = task; a.state = 'moving'; a.node = null;
    const def = World.TASKS[task], S = World.slots;
    a.emote = def.emote;

    if(def.kinds.length){
      const cands = World.nodes.filter(n => def.kinds.indexOf(n.type) >= 0 && st.world.known[n.id]);
      if(cands.length){
        cands.sort((p, q) => Math.hypot(p.x-a.x, p.y-a.y) - Math.hypot(q.x-a.x, q.y-a.y));
        const pick = cands[Math.floor(Math.pow(Math.random(), 1.8) * Math.min(cands.length, 6))];
        a.tx = pick.x + (Math.random() - 0.5) * 0.5;
        a.ty = pick.y + 0.55;
        a.node = pick.id;
        return;
      }
    }
    const rel = (dx, dy, j) => {
      a.tx = World.vx + dx + (Math.random() - 0.5) * (j || 0.6);
      a.ty = World.vy + dy + (Math.random() - 0.5) * (j || 0.6) * 0.6;
    };
    if(task === 'build' && st.building) rel(S.site.x - 0.9, S.site.y + 0.8, 0.5);
    else if(task === 'patrol'){
      const ang = Math.random() * Math.PI * 2, r = 4.5 + Math.random() * 2.5;
      a.tx = Math.max(1, Math.min(World.W - 2, World.vx + Math.cos(ang) * r));
      a.ty = Math.max(1, Math.min(World.H - 2, World.vy + Math.sin(ang) * r * 0.7));
    }
    else if(task === 'fire'){
      // 焚き火を囲む輪。空いている角度に座る
      let ang = Math.random() * Math.PI * 2, tries = 0;
      while(tries++ < 12){
        const cand = Math.random() * Math.PI * 2;
        const busy = World.agents.some(o => o !== a && o.task === 'fire' && o.sitAng !== undefined &&
          Math.abs(Math.atan2(Math.sin(o.sitAng - cand), Math.cos(o.sitAng - cand))) < 0.55);
        if(!busy){ ang = cand; break; }
      }
      a.sitAng = ang;
      a.tx = World.vx + Math.cos(ang) * 1.65;
      a.ty = World.vy + Math.sin(ang) * 1.05;
    }
    else if(task === 'rest')  rel(-1.9, 1.1, 0.8);
    else if(task === 'pray')  rel(S.altar.x, S.altar.y + 0.95, 0.5);
    else if(task === 'water') rel(S.well.x + 0.55, S.well.y + 0.35, 0.3);
    else if(task === 'play')  rel(0, 0, 4.5);
    else                      rel(0.4, 0.9, 1.6);
    a.tx = Math.max(0.6, Math.min(World.W - 1.6, a.tx));
    a.ty = Math.max(0.6, Math.min(World.H - 1.6, a.ty));
  },

  /* =========================================================
     毎フレームの更新
     ========================================================= */
  tick(dt, st){
    World.time += dt;
    World.syncAgents(st);
    const night = World.dayPhase(st).night;

    World.agents.forEach(a => {
      if(a.bubbleT > 0 && (a.bubbleT -= dt) <= 0) a.bubble = null;
      if(a.glow > 0) a.glow -= dt;
      a.blinkT -= dt;
      if(a.blinkT < -0.14) a.blinkT = 2 + Math.random() * 4;

      if(a.state === 'idle'){
        a.timer -= dt;
        if(a.timer <= 0) World.chooseTask(st, a);
        return;
      }
      if(a.state === 'working' || a.state === 'resting'){
        a.timer -= dt; a.actT += dt;
        World.workParticles(a, dt);
        if(a.timer <= 0){
          if(a.task === 'food' || a.task === 'mat' || a.task === 'water'){
            a.state = 'returning';
            a.carry = a.task === 'mat' ? 'log' : (a.task === 'water' ? 'bucket' : 'basket');
            a.tx = World.vx + (Math.random() - 0.5) * 1.8;
            a.ty = World.vy + 0.5 + (Math.random() - 0.5) * 1.2;
          }else{
            a.state = 'idle'; a.timer = 0.5 + Math.random() * 2; a.emote = null;
          }
        }
        return;
      }

      // 移動
      const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
      if(d < 0.14){
        if(a.state === 'returning'){
          World.particles.push({ kind:'plus', x:a.x, z:a.y, h:0.8, vh:0.5, life:1.1, max:1.1,
                                 txt: a.carry === 'log' ? '＋🪵' : '＋🌾' });
          a.carry = null; a.state = 'idle'; a.timer = 0.4 + Math.random() * 1.6; a.emote = null;
        }else{
          a.state = (a.task === 'rest' || a.task === 'fire') ? 'resting' : 'working';
          a.actT = 0;
          if(a.task === 'fire'){
            a.timer = 14 + Math.random() * 16;
            a.flip = Math.cos(a.sitAng || 0) > 0 ? -1 : 1;   // 火のほうを向く
          }else{
            a.timer = a.task === 'rest' ? 7 + Math.random() * 7 : 4 + Math.random() * 5;
          }
        }
        return;
      }
      const sp = a.speed * (a.task === 'patrol' ? 0.8 : 1) * (night ? 0.85 : 1) * dt;
      a.x += dx / d * sp; a.y += dy / d * sp;
      a.phase += dt * 7.5;
      if(Math.abs(dx) > 0.02) a.flip = dx > 0 ? 1 : -1;
    });

    World.tickAnimals(dt);
    World.tickAmbient(dt, st);

    World.raiders.forEach(r => {
      const dx = World.vx - r.x, dy = World.vy - r.y, d = Math.hypot(dx, dy) || 1;
      if(d > 2.4){ r.x += dx / d * 0.42 * dt; r.y += dy / d * 0.42 * dt; }
      r.phase = (r.phase || 0) + dt * 7;
      r.flip = dx > 0 ? 1 : -1;
    });

    World.trees.forEach(t => { if(t.shake > 0) t.shake -= dt * 2.2; });
    /* 粒は x（東西）・z（南北）・h（高さ）を持つ。g は重力で高さを落とす */
    World.particles.forEach(p => {
      p.life -= dt;
      p.x += (p.vx || 0) * dt;
      p.z += (p.vz || 0) * dt;
      p.h  += (p.vh || 0) * dt;
      if(p.g) p.vh -= p.g * dt;
    });
    World.particles = World.particles.filter(p => p.life > 0);
    if(World.particles.length > 300) World.particles.splice(0, World.particles.length - 300);
    World.effects.forEach(e => { e.t -= dt; });
    World.effects = World.effects.filter(e => e.t > 0);
  },

  /** 作業中のエフェクト（木くず・穂・祈りの光） */
  workParticles(a, dt){
    if(Math.random() > dt * 3.2) return;
    if(a.task === 'mat'){
      const n = World.nodes.find(n2 => n2.id === a.node);
      if(n) World.trees.forEach(t => {
        if(Math.hypot(t.x - n.x - 0.5, t.y - n.y - 0.5) < 1.2) t.shake = 0.5;
      });
      World.particles.push({ kind:'chip', x:a.x + a.flip * 0.3, z:a.y, h:0.32,
        vx:a.flip * (0.4 + Math.random()), vz:(Math.random()-0.5)*0.5,
        vh:0.9 + Math.random() * 0.5, g:3.4,
        life:0.7, max:0.7, c:'#c9a86a' });
    }else if(a.task === 'food'){
      World.particles.push({ kind:'leaf', x:a.x + (Math.random()-0.5)*0.5, z:a.y, h:0.3,
        vx:(Math.random()-0.5)*0.4, vz:(Math.random()-0.5)*0.3, vh:0.35,
        life:1.2, max:1.2, c:'#9fd18a' });
    }else if(a.task === 'pray'){
      World.particles.push({ kind:'mote', x:a.x + (Math.random()-0.5)*0.6, z:a.y, h:0.28,
        vh:0.5 + Math.random()*0.3, life:1.6, max:1.6 });
    }else if(a.task === 'build'){
      World.particles.push({ kind:'chip', x:a.x + a.flip * 0.35, z:a.y, h:0.5,
        vx:a.flip * 0.6, vz:(Math.random()-0.5)*0.4, vh:1.1, g:4,
        life:0.6, max:0.6, c:'#d8c08a' });
    }else if(a.task === 'rest' && Math.random() < 0.25){
      World.particles.push({ kind:'zzz', x:a.x + 0.28, z:a.y, h:0.6,
        vx:0.12, vh:0.45, life:1.8, max:1.8 });
    }
  },

  /* --- 家畜・小動物 --- */
  spawnAnimals(){
    World.animals = [];
    for(let i = 0; i < 3; i++)
      World.animals.push({ kind:'chicken', x: World.vx + (Math.random()-0.5)*3,
        y: World.vy + (Math.random()-0.5)*2, tx:0, ty:0, timer:0, flip:1, phase:Math.random()*9 });
    World.animals.push({ kind:'dog', x: World.vx + 1, y: World.vy + 1,
      tx:0, ty:0, timer:0, flip:1, phase:0 });
  },

  tickAnimals(dt){
    World.animals.forEach(an => {
      an.timer -= dt;
      if(an.kind === 'dog' && World.agents.length){
        if(an.timer <= 0){
          an.timer = 4 + Math.random() * 5;
          an.target = World.agents[Math.floor(Math.random() * World.agents.length)].uid;
        }
        const t = World.agentOf(an.target) || World.agents[0];
        const dx = t.x + 0.55 - an.x, dy = t.y + 0.3 - an.y, d = Math.hypot(dx, dy);
        if(d > 0.7){
          an.x += dx / d * 1.15 * dt; an.y += dy / d * 1.15 * dt;
          an.phase += dt * 9; an.flip = dx > 0 ? 1 : -1; an.moving = true;
        }else an.moving = false;
      }else{
        if(an.timer <= 0){
          an.timer = 2 + Math.random() * 3;
          an.tx = World.vx + (Math.random() - 0.5) * 3.4;
          an.ty = World.vy + (Math.random() - 0.5) * 2.2;
        }
        const dx = an.tx - an.x, dy = an.ty - an.y, d = Math.hypot(dx, dy);
        if(d > 0.08){
          an.x += dx / d * 0.42 * dt; an.y += dy / d * 0.42 * dt;
          an.phase += dt * 10; an.flip = dx > 0 ? 1 : -1; an.moving = true;
        }else an.moving = false;
      }
    });
  },

  /* --- 環境の粒（煙・蛍・蝶・雨・鳥） --- */
  tickAmbient(dt, st){
    const ph = World.dayPhase(st);

    World._smoke = (World._smoke || 0) - dt;
    if(World._smoke <= 0){
      World._smoke = 0.9;
      World.particles.push({ kind:'smoke', x: World.vx + (Math.random()-0.5)*0.2, z: World.vy, h:0.4,
        vx:0.12, vz:0.05, vh:0.55, life:3.2, max:3.2, r: 0.14 + Math.random()*0.08 });
    }
    if(Math.random() < dt * 6)
      World.particles.push({ kind:'ember', x: World.vx + (Math.random()-0.5)*0.35, z: World.vy, h:0.3,
        vx:(Math.random()-0.5)*0.25, vz:(Math.random()-0.5)*0.25,
        vh:0.9 + Math.random()*0.5, life:1.3, max:1.3 });

    const kind = ph.night ? 'firefly' : 'butterfly';
    const want = ph.night ? 14 : 7;
    let cur = 0;
    World.particles.forEach(p => { if(p.kind === kind) cur++; });
    if(cur < want && Math.random() < dt * 5){
      World.particles.push({ kind: kind, x: Math.random() * World.W, z: Math.random() * World.H,
        h: 0.4 + Math.random() * 0.7,
        life: 20 + Math.random() * 14, max: 34, seed: Math.random() * 9,
        ax: Math.random() * 6, ay: Math.random() * 6 });
    }
    World.particles.forEach(p => {
      if(p.kind === 'butterfly' || p.kind === 'firefly'){
        const fast = p.kind === 'butterfly';
        p.ax += dt * (fast ? 1.5 : 0.7);
        p.ay += dt * (fast ? 1.1 : 0.5);
        p.x += Math.cos(p.ax + p.seed) * dt * (fast ? 0.5 : 0.28);
        p.z += Math.sin(p.ay * 0.8 + p.seed) * dt * (fast ? 0.35 : 0.2);
        p.h += Math.sin(p.ax * 1.7 + p.seed) * dt * 0.22;
        p.h = Math.max(0.25, Math.min(1.4, p.h));
      }
    });

    if(st.buffs.some(b => b.id === 'm_rain')){
      for(let i = 0; i < 3; i++)
        World.particles.push({ kind:'rain', x: Math.random() * World.W, z: Math.random() * World.H,
          h: 5.5, vx:-0.6, vh: -9 - Math.random() * 3, life: 1.7, max: 1.7 });
    }

    World._birdT = (World._birdT === undefined ? 10 : World._birdT) - dt;
    if(World._birdT <= 0){
      World._birdT = 25 + Math.random() * 30;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const y0 = 1 + Math.random() * (World.H - 4);
      for(let i = 0; i < 5; i++)
        World.birds.push({ x: dir > 0 ? -1 - i * 0.5 : World.W + 1 + i * 0.5,
          y: y0 + (i % 3) * 0.35, dir: dir, ph: Math.random() * 9, life: 26 });
    }
    World.birds.forEach(b => { b.x += b.dir * 1.5 * dt; b.y -= dt * 0.06; b.ph += dt * 9; b.life -= dt; });
    World.birds = World.birds.filter(b => b.life > 0 && b.x > -3 && b.x < World.W + 3);
  },

  dayPhase(st){
    const p = (st.timeSec % 900) / 900;         // 15分で1日
    return { p: p, night: p > 0.58 && p < 0.94 };
  },

  /* =========================================================
     襲撃・会話
     ========================================================= */
  spawnRaid(count){
    World.raiders = [];
    const side = Math.floor(Math.random() * 4);
    for(let i = 0; i < (count || 4); i++){
      let x, y;
      if(side === 0){ x = -1 - i * 0.7; y = World.vy + (Math.random() - 0.5) * 5; }
      else if(side === 1){ x = World.W + 1 + i * 0.7; y = World.vy + (Math.random() - 0.5) * 5; }
      else if(side === 2){ x = World.vx + (Math.random() - 0.5) * 5; y = -1 - i * 0.7; }
      else { x = World.vx + (Math.random() - 0.5) * 5; y = World.H + 1 + i * 0.7; }
      World.raiders.push({ x: x, y: y, phase: Math.random() * 9, flip: 1 });
    }
  },
  endRaid(win){
    World.effects.push({ kind: win ? 'win' : 'lose', x: World.vx, y: World.vy, t: 1.5 });
    for(let i = 0; i < 18; i++)
      World.particles.push({ kind:'spark', x: World.vx, z: World.vy, h: 0.4,
        vx:(Math.random()-0.5)*4, vz:(Math.random()-0.5)*4,
        vh:(Math.random()*0.8 + 0.4) * 3.2, g:3.5, life:0.9, max:0.9,
        c: win ? '#e8c96a' : '#d05a4a' });
    World.raiders = [];
  },

  say(uid, short){
    const a = World.agentOf(uid);
    if(!a) return;
    a.bubble = short; a.bubbleT = 4.6; a.glow = 1.3;
  },

  /* =========================================================
     入力補助
     ========================================================= */
  /** 画面上の位置から村人を拾う（3Dなのでレイキャストに任せる） */
  agentFromEvent(ev){
    return Scene3D.ready ? Scene3D.pickAgent(ev) : null;
  },
  terrainName(tx, ty){
    const x = Math.floor(tx), y = Math.floor(ty);
    if(x < 0 || y < 0 || x >= World.W || y >= World.H) return '―';
    return ['草原','森','川','岸辺','岩場','廃墟','丘'][World.grid[y * World.W + x]];
  },

  NODE_INFO: {
    wood:  { name:'木立',   icon:'🌲', gain:'資材',       tell:'あの森なら、まだ木が採れる' },
    stone: { name:'石切場', icon:'🪨', gain:'資材',       tell:'あの岩場に、使える石がある' },
    berry: { name:'実り',   icon:'🫐', gain:'食料',       tell:'あそこに、食べられる実がなっている' },
    fish:  { name:'瀬',     icon:'🐟', gain:'食料',       tell:'あの浅瀬には魚がいる' },
    relic: { name:'遺物',   icon:'🏺', gain:'信仰',       tell:'あの廃墟には、古いものが眠っている' },
    herb:  { name:'薬草',   icon:'🌿', gain:'食料・癒し', tell:'あの丘には薬草が生えている' }
  },

  /* =========================================================
     描画は3D（scene3d.js）に任せる
     ========================================================= */
  draw(st){
    if(!World.ready) return;
    Scene3D.render(st);
  }
};
