/* ===========================================================
   oracle.js ― 疑似AI：お告げの解釈（7章）
   LLMを使わず、キーワードマッチング＋重み付けテーブルだけで
   「解釈されている感」を作る。解釈のズレは仕様であり演出。
   =========================================================== */
'use strict';

const Oracle = {

  /* ---------- ① NGワードチェック ---------- */
  isNG(text){
    return NG_WORDS.some(w => text.includes(w));
  },

  /* ---------- ②③ キーワード抽出 → カテゴリ按分 ---------- */
  match(text){
    const hits = [];
    ORACLE_CATEGORIES.forEach(cat => {
      let n = 0;
      cat.keywords.forEach(k => { if(text.includes(k)) n++; });
      if(n > 0) hits.push({ cat: cat, raw: n });
    });
    if(hits.length === 0) return [];
    // 複数カテゴリが混在した場合は按分して正規化（7-4）
    const total = hits.reduce((s, h) => s + h.raw, 0);
    hits.forEach(h => { h.weight = h.raw / total; });
    return hits;
  },

  /** 解釈ズレの発生確率。ドルンが居ると大きく下がる（2-4の特殊効果） */
  misreadChance(st){
    return State.hasDorn(st) ? 0.10 : 0.28;
  },

  /** 信仰値が高いほどお告げは強く効く（6-1） */
  faithScale(st){
    return Util.clamp(1 + st.meters.faith / 1200, 1, 1.6);
  },

  /** 同じ傾向を連投すると効果が逓減（7-5） */
  fatigueMul(st, catId){
    const n = st.oracle.recent[catId] || 0;
    return 1 / (1 + 0.55 * n);
  },

  /* ---------- メイン処理 ---------- */
  send(st, rawText){
    const text = (rawText || '').trim();
    const out = { ok:false, lines:[], kind:'oracle', catIds:[] };

    if(!text){ out.lines.push('言葉が形にならなかった。'); return out; }

    // ① NGワード → 無害化（7-4）
    if(Oracle.isNG(text)){
      out.ok = true; out.kind = 'bad';
      out.lines.push(NG_REPLACEMENT);
      st.oracle.uses--;
      st.stats.oracles++;
      State.log(st, NG_REPLACEMENT, 'bad');
      return out;
    }

    let hits = Oracle.match(text);

    // 解釈ズレ判定
    let misread = false;
    if(hits.length > 0 && Math.random() < Oracle.misreadChance(st)){
      misread = true;
      const others = ORACLE_CATEGORIES.filter(c => !hits.some(h => h.cat.id === c.id));
      if(others.length){
        const swapped = Util.pick(others);
        hits = [{ cat: swapped, weight: 1, raw: 1 }];
      }
    }

    // ④ 効果の適用
    if(hits.length === 0){
      // 未知・曖昧カテゴリ
      out.kind = 'bad';
      const msg = Util.pick(ORACLE_FALLBACK.messages);
      out.lines.push(msg);
      State.log(st, msg, 'bad');
      if(State.hasDorn(st)){
        out.lines.push('ドルンだけが顎に手をやった。「……まあ、悪い意味ではあるまいよ」');
      }
      // ランダム小イベント発生率+20% → ここでは即時に1つ引く
      if(Math.random() < 0.5) Engine.ambientEvent(st, out);
    }else{
      if(misread){
        out.lines.push('お告げは、少しだけ歪んで届いた。');
      }
      hits.forEach(h => {
        out.catIds.push(h.cat.id);
        Oracle.applyCategory(st, h.cat, h.weight, text, out);
      });
    }

    // 逓減カウンタ
    hits.forEach(h => {
      st.oracle.recent[h.cat.id] = (st.oracle.recent[h.cat.id] || 0) + 1;
    });

    st.oracle.uses--;
    st.stats.oracles++;
    out.ok = true;
    return out;
  },

  /* ---------- カテゴリ効果の適用 ---------- */
  applyCategory(st, cat, weight, text, out){
    const scale = weight * Oracle.faithScale(st) * Oracle.fatigueMul(st, cat.id);
    const noahAura = Engine.noahAura(st);   // 2-3 無邪気さバフ

    // --- 労働傾向のシフト（配分型なので加算後に正規化） ---
    let sample = null, sampleLine = null;
    st.villagers.forEach(v => {
      const temp = TEMPERAMENTS[v.temperament] || {};
      const mult = temp[cat.id] !== undefined ? temp[cat.id] : 1;

      if(cat.id === 'combat' && v.apt === 'none'){
        // 戦えない者には戦闘傾向を与えず、後方支援値に変換（4-2 / 7-2注記）
        v.support += 10 * scale;
        return;
      }
      if(cat.work){
        const before = v.work[cat.work];
        v.work[cat.work] += cat.shift * scale * mult;
        Util.normalizeWork(v.work);
        if(v.work[cat.work] - before > 2 && !sample){ sample = v; }
      }
      // 気質による特徴的な反応
      if(cat.id === 'combat' && v.temperament === '臆病'){
        v.cond.morale -= 6 * weight;
        if(!sampleLine) sampleLine = REACTION_LINES.refuse['臆病'].replace('{n}', v.name);
      }
      if(cat.id === 'rest' && v.temperament === '勤勉' && Math.random() < 0.6){
        v.cond.fatigue += 4 * weight;   // 休まない
        if(!sampleLine) sampleLine = REACTION_LINES.refuse['勤勉'].replace('{n}', v.name);
      }
      if(cat.id === 'combat' && v.temperament === '好戦' && !sampleLine){
        sampleLine = REACTION_LINES.eager['好戦'].replace('{n}', v.name);
      }
      if(cat.id === 'faith' && v.temperament === '信心深い' && !sampleLine){
        sampleLine = REACTION_LINES.eager['信心深い'].replace('{n}', v.name);
        v.cond.loyalty += 4 * weight;
      }
    });

    // --- 一時バフ ---
    (cat.buffs || []).forEach(b => {
      const mag = 1 + (b.mag - 1) * scale;
      State.addBuff(st, 'oracle_' + cat.id + '_' + b.kind, cat.label, b.kind, mag, CONFIG.ORACLE_BUFF_SEC);
    });

    // --- 即時デルタ ---
    const d = cat.delta || {};
    if(d.security)  st.meters.security  = Util.clamp(st.meters.security  + d.security  * scale, 0, 100);
    if(d.happiness) st.meters.happiness = Util.clamp(st.meters.happiness + d.happiness * scale * (1 + noahAura * 0.1), 0, 100);
    if(d.materials) st.res.materials    = Math.max(0, st.res.materials + d.materials * scale);
    if(d.fatigue || d.loyalty){
      st.villagers.forEach(v => {
        if(d.fatigue) v.cond.fatigue = Util.clamp(v.cond.fatigue + d.fatigue * scale, 0, 100);
        if(d.loyalty) v.cond.loyalty = Util.clamp(v.cond.loyalty + d.loyalty * scale, 0, 100);
      });
    }

    // --- ⑤ 解釈結果を村人のセリフで返す ---
    const speaker = sample || Util.pick(st.villagers.filter(v => v.apt !== 'none') || st.villagers) || st.villagers[0];
    const tmpl = Util.pick(INTERPRET_LINES[cat.id] || ['{n}はお告げを受け取った。']);
    const short = text.length > 14 ? text.slice(0, 14) + '…' : text;
    const line = tmpl.replace('{n}', speaker ? speaker.name : '民').replace('{o}', short);
    out.lines.push(line);
    State.log(st, line, 'oracle');
    if(speaker){
      // 地図の上では、受け取った本人の言葉としてしゃべらせる
      Engine.speak(st, speaker.uid, ORACLE_VOICE[cat.id] ? Util.pick(ORACLE_VOICE[cat.id]) : 'お告げだ……。', cat.line);
    }
    if(sampleLine){
      out.lines.push(sampleLine);
      State.log(st, sampleLine, 'oracle');
    }
  },

  /* ---------- チュートリアル：拠点選択（3-2） ---------- */
  matchSite(text){
    const t = (text || '').trim();
    let best = null, bestScore = 0;
    Object.keys(SITES).forEach(id => {
      const s = SITES[id];
      let score = 0;
      s.keywords.forEach(k => { if(t.includes(k)) score++; });
      if(score > bestScore){ bestScore = score; best = id; }
    });
    if(best) return { site: best, matched: true };
    // 曖昧な言葉の場合：ランダムに選ばれる＝「解釈のズレ」の初体験
    return { site: Util.pick(Object.keys(SITES)), matched: false };
  }
};
