/* ===========================================================
   engine.js ― シミュレーション本体
   4章（戦闘・脅威）／5章（コアループ）／6章（パラメータ）／
   8章（神ポイント）／9章（進行曲線）に対応。
   simulate(st, dt) は実時間駆動とオフライン一括計算の両方で使う。
   =========================================================== */
'use strict';

const Engine = {

  /** 村人がしゃべるときのフック（main.js が Speech に繋ぐ） */
  onSpeak: null,
  speak(st, uid, text, short){
    if(st._offline) return;                 // オフライン計算中は黙らせる
    if(Engine.onSpeak) Engine.onSpeak(uid, text, short);
  },
  /** 条件に合う村人を1人選ぶ（しゃべらせる相手を決めるのに使う） */
  pickSpeaker(st, key){
    const list = st.villagers.filter(v => v.apt !== 'none' || key === 'any');
    if(!list.length) return st.villagers[0];
    if(!key || key === 'any') return Util.pick(st.villagers);
    return list.slice().sort((a, b) => (b.work[key] || 0) - (a.work[key] || 0))[0];
  },

  /* =========================================================
     基礎計算
     ========================================================= */

  /** 個人の作業効率（疲労・士気・負傷） */
  efficiency(st, v){
    const injured = v.cond.injuredUntil > st.timeSec;
    return Util.clamp(
      (1 - v.cond.fatigue / 170) * (0.65 + v.cond.morale / 300) * (injured ? 0.45 : 1),
      0.1, 1.6);
  },

  /** ノアの「無邪気さバフ」：-1（不安）〜+1（元気） 2-3 */
  noahAura(st){
    const noah = State.noah(st);
    if(!noah) return 0;
    if(st.flags.noahAnxious) return -1;
    return Util.clamp(noah.cond.morale / 100, 0, 1);
  },

  /** 村全体の生産レート（毎秒）。UI表示にも使う */
  rates(st){
    const site = State.siteMod(st);
    const b = st.buildings;
    let lFood = 0, lMat = 0, lFaith = 0, lTrade = 0, support = 0;

    st.villagers.forEach(v => {
      const eff = Engine.efficiency(st, v);
      lFood  += v.work.production / 100 * eff;
      lMat   += v.work.frontier   / 100 * eff;
      lFaith += v.work.faith      / 100 * eff * (0.6 + v.cond.loyalty / 150);
      lTrade += v.work.commerce   / 100 * eff;
      if(v.apt === 'none' || v.apt === 'low'){
        support += 3 + v.work.production * 0.04 + v.support * 0.35
                 + (v.skills.includes('応急手当') ? 8 : 0);
      }
    });

    const prodBuff  = State.buffMul(st, 'prod');
    const tradeBuff = State.buffMul(st, 'trade');
    const happyMul  = Util.clamp(0.55 + st.meters.happiness / 110, 0.55, 1.4);
    const aura      = Engine.noahAura(st);

    // 神が教えた地形（発見済みの資源）ぶんの上乗せ
    const kc = (st.world && st.world.knownCounts) || { food:0, mat:0, faith:0 };
    const disc = k => 1 + Math.min(0.5, (kc[k] || 0) * 0.035);

    const food = (lFood * 0.50 + lTrade * 0.20 * tradeBuff)
               * site.food * (1 + b.farm * 0.15) * State.buffMul(st, 'food') * prodBuff
               * (1 + aura * 0.05) * disc('food');
    const mat  = (lMat * 0.45 + lTrade * 0.15 * tradeBuff)
               * site.mat * State.buffMul(st, 'mat') * prodBuff * disc('mat');
    const faith= lFaith * 0.75 * site.faith * (1 + b.altar * 0.20)
               * State.buffMul(st, 'faith') * happyMul * (1 + aura * 0.08) * disc('faith');
    const eat  = st.villagers.length * 0.085;

    return { food: food - eat, mat: mat, faith: faith, eat: eat, support: support,
             foodGross: food };
  },

  /** 村の戦闘力と後方支援値（4-2） */
  power(st){
    const site = State.siteMod(st);
    const aptW = { high:1.0, low:0.3, none:0 };
    let p = 0;
    st.villagers.forEach(v => {
      const w = aptW[v.apt] !== undefined ? aptW[v.apt] : 0.3;
      if(w <= 0) return;
      const injured = v.cond.injuredUntil > st.timeSec;
      p += w * (8 + v.work.combat * 0.38)
             * Engine.efficiency(st, v) * (injured ? 0.4 : 1)
             * (v.skills.includes('戦の心得') ? 1.2 : 1);
    });
    // 人口そのものが持つ最低限の抵抗力（放置中も守りが痩せ細らないように）
    p += st.villagers.length * 0.8;
    p *= (1 + st.buildings.watchtower * 0.12) * site.def * (1 + st.meters.security / 320);
    return { power: p, support: Engine.rates(st).support };
  },

  /* =========================================================
     メインループ（dt秒ぶんの進行）
     ========================================================= */
  simulate(st, dt, opts){
    opts = opts || {};
    const dg = opts.digest || null;
    st.timeSec += dt;
    State.cleanBuffs(st);

    const gain = opts.gain || 1;      // オフラインボーナス
    const r = Engine.rates(st);

    /* --- 資源 --- */
    const cap = 400 + st.buildings.storehouse * 150;
    st.res.cap = cap;
    const beforeFood  = st.res.food;
    const beforeFaith = st.meters.faith + st.meters.gp * CONFIG.FAITH_PER_GP;
    st.res.food      = Util.clamp(st.res.food      + r.food  * dt * gain, 0, cap);
    st.res.materials = Util.clamp(st.res.materials + r.mat   * dt * gain, 0, cap);
    const faithGain  = r.faith * dt * gain;
    st.meters.faith      += faithGain;
    st.meters.faithTotal += faithGain;
    if(dg) dg.food += st.res.food - beforeFood;

    /* --- 飢餓 --- */
    if(st.res.food <= 0 && r.food < 0){
      st.meters.happiness -= 0.9 * dt;
      st.villagers.forEach(v => { v.cond.morale -= 0.6 * dt; });
      if(!st._starveWarned || st.timeSec - st._starveWarned > 120){
        st._starveWarned = st.timeSec;
        State.log(st, '食料が尽きた。民の顔に不安が浮かんでいる。', 'bad');
        if(dg) dg.starve = true;
      }
    }

    /* --- 信仰値 → 神ポイント（8-1） --- */
    while(st.meters.faith >= CONFIG.FAITH_PER_GP && st.meters.gp < st.meters.gpCap){
      st.meters.faith -= CONFIG.FAITH_PER_GP;
      st.meters.gp++;
      State.log(st, '信仰が実を結び、神ポイントを1得た。', 'good');
      if(dg) dg.gp++;
    }
    if(st.meters.gp >= st.meters.gpCap) st.meters.faith = Math.min(st.meters.faith, CONFIG.FAITH_PER_GP);
    // 上限で溢れたぶんはダイジェストに数えない
    if(dg) dg.faith += (st.meters.faith + st.meters.gp * CONFIG.FAITH_PER_GP) - beforeFaith;

    /* --- 個人の状態 --- */
    const aura = Engine.noahAura(st);
    st.villagers.forEach(v => {
      const temp = TEMPERAMENTS[v.temperament] || {};
      const load = (v.work.production + v.work.frontier + v.work.combat) / 100;
      const restBuff = State.buffMul(st, 'prod') < 1 ? 1.8 : 1;   // 休息のお告げ中は回復寄り
      v.cond.fatigue = Util.clamp(
        v.cond.fatigue + (0.030 * load * (temp.fatigue || 1) - 0.024 * restBuff) * dt, 0, 100);
      // 士気は村の幸福度へ寄っていく（ノアの補正込み）
      const mTarget = Util.clamp(st.meters.happiness + aura * 6, 0, 100);
      v.cond.morale = Util.clamp(v.cond.morale + (mTarget - v.cond.morale) * 0.012 * dt, 0, 100);
      // 忠誠は信仰の蓄積へ寄る
      const lTarget = Util.clamp(35 + st.meters.faithTotal / 45 + aura * 5, 0, 98);
      v.cond.loyalty = Util.clamp(v.cond.loyalty + (lTarget - v.cond.loyalty) * 0.006 * dt, 0, 100);
      if(v.cond.injuredUntil && v.cond.injuredUntil <= st.timeSec){
        v.cond.injuredUntil = 0;
        State.log(st, `${v.name}の傷が癒えた。`, 'good');
      }
      v.support = Math.max(0, v.support - 0.02 * dt);   // 支援値はゆっくり戻る
    });

    /* --- 村の幸福度・治安 --- */
    const meia = State.find(st, 'meia');
    const pop = st.villagers.length;
    let hTarget = 45
      + (st.res.food > pop * 4 ? 14 : -22)
      + (st.meters.security - 50) * 0.16
      + aura * 7
      + (meia && meia.cond.fatigue > 70 ? -12 : 0)   // 2-2 幸福度ハブ
      + st.buildings.altar * 1.5;
    hTarget = Util.clamp(hTarget, 0, 100);
    st.meters.happiness = Util.clamp(st.meters.happiness + (hTarget - st.meters.happiness) * 0.02 * dt, 0, 100);

    let combatShare = 0;
    st.villagers.forEach(v => { combatShare += v.work.combat; });
    combatShare = pop ? combatShare / pop / 100 : 0;
    const sTarget = Util.clamp(28 + combatShare * 50 + st.buildings.watchtower * 6, 0, 100);
    st.meters.security = Util.clamp(st.meters.security + (sTarget - st.meters.security) * 0.015 * dt, 0, 100);

    /* --- ノアの不安（2-3 / 3-3トリガー） --- */
    Engine.updateNoah(st, dt, dg);

    /* --- お告げ回数の回復・逓減の解除 --- */
    if(st.oracle.uses < CONFIG.ORACLE_MAX){
      st.oracle.nextRefill -= dt;
      if(st.oracle.nextRefill <= 0){
        st.oracle.uses++;
        st.oracle.nextRefill = CONFIG.ORACLE_REFILL_SEC;
      }
    }else{
      st.oracle.nextRefill = CONFIG.ORACLE_REFILL_SEC;
    }
    st._recentDecay = (st._recentDecay || 0) + dt;
    if(st._recentDecay > 150){
      st._recentDecay = 0;
      Object.keys(st.oracle.recent).forEach(k => {
        st.oracle.recent[k] = Math.max(0, st.oracle.recent[k] - 1);
        if(!st.oracle.recent[k]) delete st.oracle.recent[k];
      });
    }

    /* --- 建築の進行 --- */
    if(st.building){
      st.building.progress += dt * State.buffMul(st, 'build');
      if(st.building.progress >= st.building.sec){
        const def = BUILDINGS.find(b => b.id === st.building.id);
        st.buildings[st.building.id]++;
        State.log(st, `${def.name}が完成した（Lv.${st.buildings[st.building.id]}）。`, 'good');
        if(dg) dg.built.push(def.name);
        if(st.building.id === 'altar' && st.buildings.altar % 2 === 0){
          st.meters.gpCap++;
          State.log(st, '祭壇の力で、神ポイントの上限が広がった。', 'good');
        }
        const who = st.building.by;
        st.building = null;
        if(who) Engine.speak(st, who, `${def.name}が出来たぞ。`, '完成！');
      }
    }
    Engine.autoBuild(st, dt);
    Engine.autoDiscover(st, dt);

    /* --- 脅威（4-2） --- */
    Engine.updateThreat(st, dt, opts);

    /* --- 加入・離反 --- */
    Engine.updatePopulation(st, dt, dg);

    /* --- 平時のランダムイベント（5-3 単調さの回避） --- */
    st._ambient = (st._ambient || 0) + dt;
    if(st._ambient > 90){
      st._ambient = 0;
      if(Math.random() < 0.35){
        const ev = Engine.ambientEvent(st);
        if(dg && ev) dg.events.push(ev.text);
      }
    }

    /* --- 何気ない会話 --- */
    st._chat = (st._chat || 0) + dt;
    if(st._chat > 26 && !st._offline){
      st._chat = 0;
      if(Math.random() < 0.75) Engine.chatter(st);
    }

    /* --- ステージ判定・ストーリー --- */
    Engine.updateStage(st, dg);
    Engine.checkStory(st, opts);
  },

  /* =========================================================
     ノアの不安
     ========================================================= */
  updateNoah(st, dt, dg){
    const noah = State.noah(st);
    if(!noah) return;
    if(!st.flags.noahAnxious){
      if(st.meters.happiness < 38 && Math.random() < 0.004 * dt){
        st.flags.noahAnxious = true;
        st.flags.noahAnxiousSince = st.timeSec;
        noah.cond.morale = Math.min(noah.cond.morale, 45);
        State.log(st, 'ノアが不安げに、大人たちの顔色をうかがっている……。', 'bad');
        Engine.speak(st, 'noah', 'ねえ……みんな、だいじょうぶ？', '…');
        if(dg) dg.noah = true;
      }
    }else{
      noah.cond.morale = Math.min(noah.cond.morale, 55);
      if(st.meters.happiness > 62 && Math.random() < 0.006 * dt){
        st.flags.noahAnxious = false;
        st.flags.noahAnxiousSince = null;
        State.log(st, 'ノアがまた、村の中を駆け回りはじめた。', 'good');
      }
    }
  },

  /* =========================================================
     脅威と戦闘（4章）
     ========================================================= */
  updateThreat(st, dt, opts){
    const t = st.threat;
    if(t.nextAt <= 0) Engine.scheduleThreat(st);

    // 予兆演出：フェアネス重視（4-2）
    if(!t.warned && st.timeSec > t.nextAt - 30){
      t.warned = true;
      State.log(st, '……不穏な気配。何かが村へ近づいている。', 'bad');
      if(opts && opts.onWarn) opts.onWarn();
    }
    if(st.timeSec >= t.nextAt){
      const res = Engine.resolveBattle(st);
      Engine.scheduleThreat(st);
      if(opts && opts.digest){
        opts.digest.battles.push(res);
      }
      if(opts && opts.onBattle) opts.onBattle(res);
    }
  },

  scheduleThreat(st){
    const stage = State.stage(st);
    const site  = State.siteMod(st);
    const sec = stage.threatBase
      * (0.65 + st.meters.security / 100 * 0.85)   // 治安が高いほど間隔が延びる
      / site.threat
      * State.buffMul(st, 'threatDelay')
      * Util.rand(0.85, 1.2);
    st.threat.nextAt = st.timeSec + sec;
    st.threat.warned = false;
    st.threat.revealed = State.buffMul(st, 'threatDelay') > 1;
  },

  /**
   * 敵の戦闘力。ステージ・経過時間による「絶対値」と、村の戦力に連動する
   * 「相対値」を混ぜる。備えた村はきちんと勝てるが、油断すると足元をすくわれる。
   */
  enemyEstimate(st, power){
    const stage = State.stage(st);
    const abs = stage.enemyBase
      * (1 + st.timeSec / 3600 * 0.15)
      * (1 + Math.max(0, st.villagers.length - 4) * 0.07);
    // 大半は「村の規模と時間」で決まる（＝備えを怠れば負ける）。
    // わずかに村の戦力へ連動させ、強くなりすぎた村が無風にならないようにする。
    return abs * 0.85 + power * 0.15;
  },

  resolveBattle(st){
    const stage = State.stage(st);
    const p = Engine.power(st);
    let enemy = Engine.enemyEstimate(st, p.power) * Util.rand(0.85, 1.15);

    let weakened = false;
    if(st.threat.weaken > 0){
      enemy *= (1 - st.threat.weaken);
      st.threat.weaken = 0;
      weakened = true;
    }

    const mitig = Util.clamp(p.support / 70, 0, 0.6) + st.buildings.storehouse * 0.08;
    const res = {
      win: p.power >= enemy,
      us: Math.round(p.power), them: Math.round(enemy),
      enemyName: stage.enemyName, weakened: weakened,
      lines: [], injured: null, lostFood: 0, lostMat: 0, faith: 0
    };

    if(res.win){
      st.stats.won++;
      const faith = 18 + st.stage * 14;
      st.meters.faith += faith; st.meters.faithTotal += faith;
      st.meters.happiness = Util.clamp(st.meters.happiness + 5, 0, 100);
      st.meters.security  = Util.clamp(st.meters.security + 6, 0, 100);
      const loot = Math.round(Util.rand(6, 14) * (1 + st.stage * 0.6));
      st.res.materials = Math.min(st.res.cap, st.res.materials + loot);
      res.faith = faith; res.loot = loot;
      const guard = st.villagers.filter(v => v.apt === 'high')[0];
      res.lines.push(guard
        ? `${guard.name}を中心に、村は${stage.enemyName}を退けた。`
        : `村はどうにか${stage.enemyName}を追い払った。`);
      res.lines.push(`民は安堵の息をつき、空を見上げた。（信仰+${faith}／資材+${loot}）`);
      st.villagers.forEach(v => { v.cond.fatigue = Util.clamp(v.cond.fatigue + 8, 0, 100); });
      State.log(st, `${stage.enemyName}の襲撃を退けた。（村 ${res.us} vs 敵 ${res.them}）`, 'good');
      if(guard) Engine.speak(st, guard.uid, Util.pick(['退けたぞ。……次はもっと来る。','怪我人はいないな？　よし。','守り切った。皆、よくやった。']), '！');
    }else{
      st.stats.lost++;
      const severity = Util.clamp(enemy / Math.max(1, p.power), 1, 2.2) * (1 - mitig);
      res.lostFood = Math.round(Math.min(st.res.food, 12 * severity));
      res.lostMat  = Math.round(Math.min(st.res.materials, 10 * severity));
      st.res.food      -= res.lostFood;
      st.res.materials -= res.lostMat;
      st.meters.happiness = Util.clamp(st.meters.happiness - 8 * (1 - mitig), 0, 100);
      st.meters.security  = Util.clamp(st.meters.security - 10, 0, 100);
      // 負傷（全滅・ゲームオーバーは無し 4-2）
      const cands = st.villagers.filter(v => v.apt !== 'none' && v.cond.injuredUntil <= st.timeSec);
      if(cands.length && Math.random() < 0.75){
        const target = cands.sort((a, b) => (b.work.combat - a.work.combat))[0];
        target.cond.injuredUntil = st.timeSec + 180;
        res.injured = target.name;
        res.lines.push(`${target.name}は傷を負いながらも、皆を逃がした。`);
      }
      res.lines.push(`村は${stage.enemyName}に踏み荒らされた。（食料-${res.lostFood}／資材-${res.lostMat}）`);
      if(mitig > 0.25) res.lines.push('前に出られない者たちが避難を導き、被害は最小限に抑えられた。');
      State.log(st, `${stage.enemyName}の襲撃を受けた。（村 ${res.us} vs 敵 ${res.them}）`, 'bad');
      const voice = State.find(st, 'meia') || st.villagers[0];
      if(voice) Engine.speak(st, voice.uid, Util.pick(['まだやれる。片付けましょう。','……こんなの、慣れたくない。','怪我を診るわ。手を貸して。']), '…');
    }
    return res;
  },

  /* =========================================================
     人口（加入・離反）
     ========================================================= */
  updatePopulation(st, dt, dg){
    st.recruit.nextAt -= dt;
    if(st.recruit.nextAt <= 0){
      const ok = st.res.food > 50 && st.meters.happiness > 45 && st.villagers.length < 80;
      if(ok){
        const good = st.recruit.guaranteedGood;
        st.recruit.guaranteedGood = false;
        const v = State.makeRecruit(good);
        v._new = true;
        st.villagers.push(v);
        st.stats.joined++;
        State.log(st, `${v.name}（${v.role}）が村に加わった。${good ? '……ただ者ではなさそうだ。' : ''}`, 'good');
        Engine.speak(st, v.uid, Util.pick(CHATTER.join), '…');
        if(dg) dg.joined.push(v.name);
        st.recruit.nextAt = Util.rand(300, 480) * (1 + st.villagers.length * 0.25);
      }else{
        st.recruit.nextAt = 60;   // 条件が整うまで再試行
      }
    }

    // 離反（初期4人は決して去らない＝愛着オブジェクトの固定化 2-5）
    if(st.meters.happiness < 25){
      st.villagers.forEach(v => {
        if(v.founder) return;
        if(v.cond.loyalty < 18 && Math.random() < 0.0012 * dt){
          v._leaving = true;
        }
      });
      const leaving = st.villagers.filter(v => v._leaving);
      if(leaving.length){
        st.villagers = st.villagers.filter(v => !v._leaving);
        leaving.forEach(v => {
          st.stats.left++;
          State.log(st, `${v.name}は黙って村を去った。`, 'bad');
          if(dg) dg.left.push(v.name);
        });
      }
    }
  },

  /* =========================================================
     ステージ進行（9章）
     ========================================================= */
  updateStage(st, dg){
    const pop = st.villagers.length;
    let idx = 0;
    STAGES.forEach((s, i) => { if(pop >= s.minPop) idx = i; });
    if(idx > st.stage){
      st.stage = idx;
      State.log(st, `村は${STAGES[idx].name}を迎えた。`, 'story');
      if(dg) dg.stage = STAGES[idx].name;
      // 発展期以降：非戦闘キャラの特殊スキル解放（4-3）
      if(idx >= 1) Engine.unlockSkills(st);
    }
  },

  unlockSkills(st){
    const meia = State.find(st, 'meia');
    if(meia && !meia.skills.includes('応急手当')){
      meia.skills.push('応急手当');
      State.log(st, 'メイアが応急手当を覚えた。戦いのあとの傷が、早く癒えるようになる。', 'story');
    }
    const dorn = State.find(st, 'dorn');
    if(dorn && !dorn.skills.includes('避難誘導')){
      dorn.skills.push('避難誘導');
      dorn.support += 10;
      State.log(st, 'ドルンが避難の段取りを整えた。襲撃時の被害が減る。', 'story');
    }
  },

  /* =========================================================
     ランダム小イベント
     ========================================================= */
  /** 平時のひとりごと。地図の上に吹き出しで出る */
  chatter(st){
    const v = Util.pick(st.villagers);
    if(!v) return;
    let line;
    if(st.res.food < st.villagers.length * 5 && Math.random() < 0.7){
      line = Util.pick(CHATTER.hungry);
    }else if(CHATTER[v.uid] && Math.random() < 0.75){
      line = Util.pick(CHATTER[v.uid]);
    }else if(st.meters.happiness > 76 && Math.random() < 0.4){
      line = Util.pick(CHATTER.happy);
    }else{
      const pool = CHATTER.temperament[v.temperament] || CHATTER.temperament['飄々'];
      line = Util.pick(pool);
    }
    Engine.speak(st, v.uid, line);
  },

  ambientEvent(st, out){
    const ev = Util.pick(AMBIENT_EVENTS);
    const e = ev.eff || {};
    if(e.food)      st.res.food      = Util.clamp(st.res.food + e.food, 0, st.res.cap);
    if(e.materials) st.res.materials = Util.clamp(st.res.materials + e.materials, 0, st.res.cap);
    if(e.happiness) st.meters.happiness = Util.clamp(st.meters.happiness + e.happiness, 0, 100);
    if(e.security)  st.meters.security  = Util.clamp(st.meters.security + e.security, 0, 100);
    if(e.faith){ st.meters.faith += e.faith; st.meters.faithTotal += e.faith; }
    State.log(st, ev.text, ev.kind);
    if(out) out.lines.push(ev.text);
    return ev;
  },

  /* =========================================================
     ストーリートリガー（3-3）
     ========================================================= */
  checkStory(st, opts){
    const fired = st.flags.story;
    const pop = st.villagers.length;
    const conds = {
      first_win:  st.stats.won >= 1,
      pop5:       pop >= 5,
      faith_talk: st.meters.faithTotal >= 300,
      noah_bond:  st.flags.noahAnxious && st.flags.noahAnxiousSince !== null
                  && (st.timeSec - st.flags.noahAnxiousSince) > 120,
      golden:     st.stage >= 3
    };
    Object.keys(conds).forEach(id => {
      if(fired[id] || !conds[id]) return;
      fired[id] = true;
      Engine.fireStory(st, id);
    });
  },

  fireStory(st, id){
    const ev = STORY_EVENTS.find(e => e.id === id);
    if(!ev) return;
    if(ev.reward){
      const r = ev.reward;
      if(r.faith){ st.meters.faith += r.faith; st.meters.faithTotal += r.faith; }
      if(r.happiness) st.meters.happiness = Util.clamp(st.meters.happiness + r.happiness, 0, 100);
      if(r.stones) st.res.stones += r.stones;
    }
    if(id === 'noah_bond'){
      st.flags.noahAnxious = false;
      st.flags.noahAnxiousSince = null;
    }
    State.log(st, `【${ev.title}】`, 'story');
    st.pendingEvents.push(id);
  },

  /* =========================================================
     奇跡（8-2）
     ========================================================= */
  useMiracle(st, id){
    const def = MIRACLES.find(m => m.id === id);
    if(!def) return { ok:false };
    if(st.meters.gp < def.cost) return { ok:false, msg:'神ポイントが足りない。' };
    st.meters.gp -= def.cost;
    st.stats.miracles++;
    let msg = '';

    switch(id){
      case 'blessed_rain':
        State.addBuff(st, 'm_rain', '恵みの雨', 'food', 1.5, 600);
        msg = '天から恵みの雨が降り、乾いた大地が息を吹き返した。';
        break;
      case 'clear_sky':
        State.addBuff(st, 'm_sky', '晴天の加護', 'build', 1.3, 600);
        State.addBuff(st, 'm_sky2', '晴天の加護', 'mat', 1.3, 600);
        msg = '雲が割れ、光が差した。手が驚くほど速く動く。';
        break;
      case 'warning_wind': {
        State.addBuff(st, 'm_wind', '追い風の予兆', 'threatDelay', 1.8, 900);
        const remain = Math.max(0, st.threat.nextAt - st.timeSec);
        st.threat.nextAt = st.timeSec + remain * 1.8;
        st.threat.revealed = true;
        msg = '風が知らせた。近づいていたものの気配は、いったん遠のいた。';
        break;
      }
      case 'thunder_wrath':
        st.threat.weaken = 0.35;
        msg = '遠雷が轟いた。次に村を襲う者は、その身に神の怒りを受けるだろう。';
        break;
      case 'healing_light': {
        let healed = 0;
        st.villagers.forEach(v => {
          if(v.cond.injuredUntil > st.timeSec){ v.cond.injuredUntil = 0; healed++; }
          v.cond.fatigue = Util.clamp(v.cond.fatigue - 25, 0, 100);
        });
        msg = healed ? `光が${healed}人の傷を塞いだ。` : '癒すべき傷はなかったが、光は静かに村を照らした。';
        break;
      }
      case 'guiding_light':
        st.recruit.guaranteedGood = true;
        if(st.recruit.nextAt > 90) st.recruit.nextAt = 90;
        msg = '森の奥へ一条の光が伸びた。誰かが、それを辿って来るだろう。';
        break;
      case 'small_miracle': {
        const noah = State.noah(st);
        st.flags.noahAnxious = false;
        st.flags.noahAnxiousSince = null;
        if(noah) noah.cond.morale = Util.clamp(noah.cond.morale + 30, 0, 100);
        st.meters.happiness = Util.clamp(st.meters.happiness + 12, 0, 100);
        State.addBuff(st, 'm_noah', '無邪気さ', 'faith', 1.15, 300);
        msg = 'ノアの瞳に、また好奇心の光が灯った。「やっぱり、かみさまはいるよ」';
        break;
      }
    }
    State.log(st, msg, 'miracle');
    return { ok:true, msg: msg, name: def.name };
  },

  /* =========================================================
     建築
     ========================================================= */
  buildCost(st, id){
    const def = BUILDINGS.find(b => b.id === id);
    const lv = st.buildings[id];
    return Math.round(def.base * Math.pow(1.65, lv));
  },

  startBuild(st, id, by){
    if(st.building) return { ok:false, msg:'すでに別の建築が進んでいる。' };
    const cost = Engine.buildCost(st, id);
    if(st.res.materials < cost) return { ok:false, msg:'資材が足りない。' };
    st.res.materials -= cost;
    const def = BUILDINGS.find(b => b.id === id);
    const sec = CONFIG.BUILD_BASE_SEC * (1 + st.buildings[id] * 0.6);
    st.building = { id: id, sec: sec, progress: 0, by: by || null };
    State.log(st, `村人たちは${def.name}を建て始めた。（資材-${cost}）`, '');
    return { ok:true, msg:`${def.name}の建築が始まった。`, def: def };
  },

  /**
   * 建てるものは村人が自分で決める（プレイヤーは指示できない）。
   * ただし直近のお告げの傾向がわずかに判断へ影響する＝間接介入。
   */
  autoBuild(st, dt){
    st._buildCd = (st._buildCd || 0) - dt;
    if(st.building || st._buildCd > 0) return;
    st._buildCd = 20;

    const pop  = st.villagers.length;
    const r    = Engine.rates(st);
    const rec  = st.oracle.recent || {};
    const bias = k => Math.min(1.2, (rec[k] || 0) * 0.35);

    const score = {
      watchtower: (55 - st.meters.security) / 40
                  + Math.max(0, st.stats.lost - st.stats.won) * 0.5
                  + bias('combat') - st.buildings.watchtower * 0.30,
      farm:       (1 - st.res.food / Math.max(40, pop * 30)) * 1.6
                  + (r.food < 0 ? 1.4 : 0) + bias('production') - st.buildings.farm * 0.25,
      storehouse: (st.res.materials > st.res.cap * 0.8 || st.res.food > st.res.cap * 0.8 ? 1.3 : -0.2)
                  + bias('frontier') - st.buildings.storehouse * 0.30,
      altar:      (st.meters.gp >= st.meters.gpCap ? 0.9 : 0)
                  + bias('faith') + (st.res.materials > st.res.cap * 0.5 ? 0.5 : 0)
                  - st.buildings.altar * 0.28
    };

    let bestId = null, best = 0.35;           // これ未満なら資材を貯めておく
    Object.keys(score).forEach(id => {
      if(score[id] > best && st.res.materials >= Engine.buildCost(st, id)){
        best = score[id]; bestId = id;
      }
    });
    if(!bestId) return;

    const speakerKey = { watchtower:'combat', farm:'production', altar:'faith', storehouse:'commerce' }[bestId];
    const who = Engine.pickSpeaker(st, speakerKey);
    const res = Engine.startBuild(st, bestId, who ? who.uid : null);
    if(res.ok && who){
      Engine.speak(st, who.uid, Util.pick(BUILD_REASONS[bestId]), '🔨');
    }
    st._buildCd = 45;
  },

  /* =========================================================
     地形を自ら見つける（プレイヤー操作なしで、時とともに少しずつ明らかになる）
     ========================================================= */
  autoDiscover(st, dt){
    st._discoverAcc = (st._discoverAcc || 0) + dt;
    const pop = st.villagers.length;
    const interval = Math.max(40, 200 - pop * 8);   // 人が増えるほど、村の周りをよく知るようになる
    if(st._discoverAcc < interval) return;
    st._discoverAcc = 0;

    const unknown = World.nodes.filter(n => !st.world.known[n.id]);
    if(!unknown.length) return;
    unknown.sort((a, b) =>
      Math.hypot(a.x - World.vx, a.y - World.vy) - Math.hypot(b.x - World.vx, b.y - World.vy));
    const pick = unknown[Math.floor(Math.pow(Math.random(), 1.6) * Math.min(unknown.length, 10))];
    st.world.known[pick.id] = 1;
    World.recount(st);

    const info = World.NODE_INFO[pick.type];
    const who = Engine.pickSpeaker(st, pick.type === 'relic' ? 'faith'
                : (pick.type === 'wood' || pick.type === 'stone') ? 'frontier' : 'production');
    if(who) Engine.speak(st, who.uid, `${info.tell}。`, info.icon);
    State.log(st, `民が${info.name}を見つけた。`, 'good');
  },

  /* =========================================================
     オフライン進行（5-2）
     ========================================================= */
  offline(st, elapsedSec){
    const capped = Math.min(elapsedSec, CONFIG.OFFLINE_CAP_SEC);
    if(capped < 30) return null;
    const dg = { seconds: capped, capped: elapsedSec > CONFIG.OFFLINE_CAP_SEC,
                 food:0, faith:0, gp:0, battles:[], joined:[], left:[], built:[],
                 events:[], stage:null, noah:false, starve:false };
    const before = { mat: st.res.materials };
    const steps = Math.ceil(capped / CONFIG.OFFLINE_STEP);
    st._offline = true;
    for(let i = 0; i < steps; i++){
      Engine.simulate(st, CONFIG.OFFLINE_STEP, {
        gain: CONFIG.OFFLINE_BONUS, digest: dg
      });
    }
    st._offline = false;
    dg.mat = st.res.materials - before.mat;
    return dg;
  }
};
