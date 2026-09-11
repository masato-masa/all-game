/* ===========================================================
   ui.js ― 描画・会話・モーダル制御
   =========================================================== */
'use strict';

const $ = id => document.getElementById(id);

/* ===========================================================
   会話（顔つき吹き出し）
   =========================================================== */
const Speech = {
  queue: [], current: null, timer: 0, st: null,

  push(uid, text, short){
    if(Speech.queue.length > 3) Speech.queue.shift();
    Speech.queue.push({ uid, text, short });
    if(!Speech.current) Speech.next();
  },

  next(){
    const item = Speech.queue.shift();
    if(!item){ Speech.current = null; Speech.setIdle(); return; }
    const st = Speech.st;
    const v = st ? State.find(st, item.uid) : null;
    if(!v){ Speech.next(); return; }

    Speech.current = item;
    Speech.timer = Math.min(9, 3.0 + item.text.length * 0.10);

    const bar = $('speechBar');
    bar.classList.remove('idle');
    bar.classList.remove('talking');
    void bar.offsetWidth;                       // アニメーション再生
    bar.classList.add('talking');
    $('spFace').innerHTML = Portrait.get(v);
    $('spName').innerHTML = `${v.name}<span class="sp-role">${v.role}・${v.temperament}</span>`;
    $('spText').textContent = item.text;

    if(World.ready) World.say(item.uid, item.short || (item.text.length > 12 ? item.text.slice(0, 11) + '…' : item.text));
    Sound.sfx('talk');
  },

  setIdle(){
    const bar = $('speechBar');
    bar.classList.add('idle');
    $('spFace').innerHTML = '';
    $('spName').textContent = '村のようす';
    $('spText').innerHTML = '民は自分たちで考えて働き、必要なものを自分たちで建てます。あなたにできるのは、言葉を降ろすことだけ。';
  },

  tick(dt){
    if(!Speech.current) return;
    Speech.timer -= dt;
    if(Speech.timer <= 0) Speech.next();
  },

  skip(){ if(Speech.current) Speech.next(); },
  clear(){ Speech.queue.length = 0; Speech.current = null; Speech.setIdle(); }
};

/* ===========================================================
   UI
   =========================================================== */
const UI = {
  charEls: {},
  logIndex: 0,
  modalQueue: [],
  modalOpen: null,

  init(st){
    UI.charEls = {}; UI.logIndex = 0;
    $('charGrid').innerHTML = '';
    $('logList').innerHTML = '';
    UI.buildMiracles(st);
    UI.buildChips();
    UI.renderSite(st);
    Speech.st = st;
    Speech.clear();
  },

  buildChips(){
    const box = $('oracleChips');
    box.innerHTML = '';
    ORACLE_SUGGESTIONS.forEach(s => {
      const b = document.createElement('button');
      b.className = 'chip'; b.type = 'button'; b.textContent = s;
      b.addEventListener('click', () => { const ta = $('oracleInput'); ta.value = s; ta.focus(); });
      box.appendChild(b);
    });
  },

  buildMiracles(st){
    const list = $('miracleList');
    list.innerHTML = '';
    MIRACLES.forEach(m => {
      const row = document.createElement('div');
      row.className = 'miracle';
      row.innerHTML =
        `<div class="minfo"><div class="mname">${m.icon} ${m.name}</div>` +
        `<div class="mdesc">${m.desc}</div></div>` +
        `<span class="mcost">${m.cost}pt</span><button class="mbtn">行使</button>`;
      row.querySelector('button').addEventListener('click', () => UI.handlers.miracle(m.id));
      row.dataset.cost = m.cost;
      list.appendChild(row);
    });
  },

  renderSite(st){
    const s = st.site ? SITES[st.site] : null;
    $('siteName').textContent = s ? `${s.icon} ${s.name}` : '―';
  },

  /* =========================================================
     毎秒の更新
     ========================================================= */
  update(st){
    const r = Engine.rates(st);
    const p = Engine.power(st);

    $('clock').textContent = Util.fmtClock(st.timeSec);
    UI.setText('mGod', `${st.meters.gp}/${st.meters.gpCap}`);
    UI.setText('mGodSub', st.meters.gp >= st.meters.gpCap ? '上限に達している' : `次まで ${Math.ceil(CONFIG.FAITH_PER_GP - st.meters.faith)}`);

    /* --- 村が今なにをしているか（数値なしの雰囲気だけ） --- */
    const bs = $('buildStatus');
    bs.textContent = st.building
      ? `村人たちが、何かを建てているようだ。`
      : `村人たちは、いつも通り働いている。`;

    UI.syncChars(st);

    /* --- 脅威 --- */
    const remain = Math.max(0, st.threat.nextAt - st.timeSec);
    const panel = $('threatPanel');
    if(remain < 30){
      panel.classList.add('alert');
      $('threatText').textContent = '不穏な気配――何かが、すぐそこまで来ている。';
    }else{
      panel.classList.remove('alert');
      $('threatText').textContent = st.threat.revealed
        ? '風が知らせている。じきに、何かが近づいてくる。'
        : (remain < 90 ? '森の奥が、やけに静かだ。' : '今のところ、村は穏やかだ。');
    }

    /* --- お告げ --- */
    const canSend = st.oracle.uses > 0;
    $('sendOracle').disabled = !canSend;
    $('oracleCooldown').textContent = canSend
      ? `残り ${st.oracle.uses} / ${CONFIG.ORACLE_MAX}（次の回復まで ${Util.fmtDuration(st.oracle.nextRefill)}）`
      : `声が枯れている（回復まで ${Util.fmtDuration(st.oracle.nextRefill)}）`;

    document.querySelectorAll('#miracleList .miracle').forEach(row => {
      const cost = +row.dataset.cost;
      const ok = st.meters.gp >= cost;
      row.classList.toggle('affordable', ok);
      row.querySelector('button').disabled = !ok;
    });

    UI.renderLog(st);
  },

  setText(id, txt){
    const el = $(id);
    if(el && el.textContent !== String(txt)) el.textContent = txt;
  },

  /* =========================================================
     村人カード
     ========================================================= */
  syncChars(st){
    const grid = $('charGrid');
    const alive = {};
    st.villagers.forEach(v => { alive[v.uid] = true; });
    Object.keys(UI.charEls).forEach(uid => {
      if(!alive[uid]){ UI.charEls[uid].el.remove(); delete UI.charEls[uid]; }
    });

    st.villagers.forEach(v => {
      let ent = UI.charEls[v.uid];
      if(!ent){
        const el = document.createElement('div');
        el.className = 'charcard' + (v.founder ? ' founder' : '') + (v._new ? ' pop-in' : '');
        el.innerHTML =
          `<div class="chead">` +
            `<div class="face-mini">${Portrait.get(v)}</div>` +
            `<div><div class="cname">${v.name}</div><div class="crole" data-role></div></div>` +
          `</div>` +
          `<div><span class="ctask" data-task>―</span></div>`;
        grid.appendChild(el);
        ent = UI.charEls[v.uid] = {
          el, role: el.querySelector('[data-role]'), task: el.querySelector('[data-task]')
        };
        delete v._new;
      }
      ent.role.textContent = `${v.role}・${v.temperament}`;

      // いま地図で何をしているか
      const a = World.ready ? World.agentOf(v.uid) : null;
      const td = a && a.task ? World.TASKS[a.task] : null;
      ent.task.textContent = td
        ? `${td.emote} ${a.state === 'moving' ? 'そちらへ向かっている' : (a.state === 'returning' ? '運んで帰っている' : td.label)}`
        : '…';

      ent.el.classList.toggle('injured', v.cond.injuredUntil > st.timeSec);
      ent.el.classList.toggle('anxious', v.uid === 'noah' && st.flags.noahAnxious);
    });
  },

  /* =========================================================
     ログ・トースト
     ========================================================= */
  renderLog(st){
    const box = $('logList');
    if(UI.logIndex > st.log.length) UI.logIndex = 0;
    for(let i = UI.logIndex; i < st.log.length; i++){
      const e = st.log[i];
      const div = document.createElement('div');
      div.className = 'log-entry ' + (e.kind || '');
      div.innerHTML = `<span class="log-time">${Util.fmtClock(e.t).replace('日目 ', 'd ')}</span>`;
      div.appendChild(document.createTextNode(e.text));
      box.insertBefore(div, box.firstChild);
    }
    UI.logIndex = st.log.length;
    while(box.children.length > 60) box.removeChild(box.lastChild);
  },

  toast(text, kind){
    const area = $('toastArea');
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = text;
    area.appendChild(el);
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3700);
    while(area.children.length > 4) area.removeChild(area.firstChild);
  },

  /* =========================================================
     モーダル
     ========================================================= */
  openModal(id){
    UI.closeModalEl();
    $('overlay').classList.remove('hidden');
    $(id).classList.remove('hidden');
    UI.modalOpen = id;
  },
  closeModalEl(){
    document.querySelectorAll('.overlay .modal').forEach(m => m.classList.add('hidden'));
    UI.modalOpen = null;
  },
  closeModal(){
    UI.closeModalEl();
    $('overlay').classList.add('hidden');
    UI.next();
  },
  queue(fn){ UI.modalQueue.push(fn); if(!UI.modalOpen) UI.next(); },
  next(){
    if(UI.modalOpen) return;
    const fn = UI.modalQueue.shift();
    if(fn) fn();
  },

  /** ストーリーに登場する顔 */
  STORY_FACES: {
    found:      ['gain','meia','noah','dorn'],
    first_win:  ['gain'],
    pop5:       ['gain'],
    faith_talk: ['dorn','noah'],
    noah_bond:  ['meia','noah'],
    golden:     ['dorn']
  },

  showStory(id, st){
    const ev = STORY_EVENTS.find(e => e.id === id);
    if(!ev) return;
    UI.queue(() => {
      const faces = (UI.STORY_FACES[id] || []).map(uid => {
        const v = State.find(st, uid);
        return v ? `<div class="face-mini">${Portrait.get(v)}</div>` : '';
      }).join('');
      $('eventFaces').innerHTML = faces || `<div style="font-size:26px;color:var(--gold-soft)">${ev.icon || '✦'}</div>`;
      $('eventTitle').textContent = ev.title;
      $('eventBody').textContent = ev.body + (ev.rewardText ? '\n\n― ' + ev.rewardText : '');
      UI.openModal('mdEvent');
      Sound.sfx('discover');
    });
  },

  showBattle(res){
    UI.queue(() => {
      $('battleTitle').textContent = res.win ? '襲撃を退けた' : '村が襲われた';
      $('battleUs').textContent = res.us;
      $('battleThem').textContent = res.them;
      $('battleEnemyName').textContent = res.enemyName;
      let body = res.lines.join('\n');
      if(res.weakened) body = '雷雲が敵の力を削いだ。\n' + body;
      $('battleBody').textContent = body;
      UI.openModal('mdBattle');
    });
  },

  showDigest(dg){
    UI.queue(() => {
      $('digestTime').textContent = `留守のあいだ、${Util.fmtDuration(dg.seconds)}が流れました。`;
      const list = $('digestList');
      list.innerHTML = '';
      const add = (ico, text, kind) => {
        const d = document.createElement('div');
        d.className = 'digest-item ' + (kind || '');
        d.innerHTML = `<span class="di-ico">${ico}</span><span>${text}</span>`;
        list.appendChild(d);
      };
      if(dg.gp > 0) add('🔮', `神ポイントを ${dg.gp} 得ました。`, 'good');
      dg.built.forEach(b => add('🏗️', `村人たちが${b}を建てました。`, 'good'));
      if(dg.joined.length) add('👣', dg.joined.length <= 3
        ? `${dg.joined.join('・')}が村に加わりました。`
        : `${dg.joined.slice(0,3).join('・')}ほか、新しい顔が村に加わりました。`, 'good');
      if(dg.left.length) add('💨', `${dg.left.join('・')}が村を去りました。`, 'bad');

      if(dg.battles.length){
        const win  = dg.battles.filter(b => b.win).length;
        const lose = dg.battles.length - win;
        const name = dg.battles[dg.battles.length - 1].enemyName;
        if(dg.battles.length === 1){
          const b = dg.battles[0];
          add(b.win ? '⚔️' : '🩸', b.win
            ? `${b.enemyName}の襲撃を退けました。`
            : `${b.enemyName}の襲撃を受け、被害が出ました。`, b.win ? 'good' : 'bad');
        }else{
          add(lose === 0 ? '⚔️' : '🩸',
            `${name}などの襲撃が幾度かありました。` + (lose ? '被害を受けた夜もあったようです。' : 'すべて退けています。'),
            lose > win ? 'bad' : 'good');
        }
        const injured = dg.battles.filter(b => b.injured).map(b => b.injured);
        if(injured.length) add('🩹', `${[...new Set(injured)].join('・')}が傷を負いました。`, 'bad');
      }
      if(dg.starve) add('🍂', '食料が尽きた時間がありました。', 'bad');
      if(dg.noah)   add('😟', 'ノアが不安がっています。', 'bad');
      if(dg.stage)  add('🌅', `村は${dg.stage}を迎えました。`, 'good');
      dg.events.slice(0, 3).forEach(t => add('✦', t));
      if(!list.children.length) add('🌙', '大きな出来事はありませんでした。');
      UI.openModal('mdDigest');
    });
  },

  showHelp(){
    $('helpBody').innerHTML = `
      <p>あなたは村人に<b>命令できません</b>。畑を作るのも櫓を建てるのも、地形を見つけるのも、彼らが自分で決めます。
      あなたにできるのは、言葉を降ろすこと（お告げ）と、信仰を奇跡に変えることだけです。</p>
      <h4>① 神の地図</h4>
      <ul>
        <li>村人は労働傾向に従って、地図の上を歩いて暮らしています。ただ、見守ってください。</li>
        <li>村人にカーソルを合わせる・クリックすると、声をかけられます。</li>
        <li>土地や資源は、村人たちが暮らすうちに自分たちで見つけていきます。</li>
      </ul>
      <h4>② お告げ（間接介入・無料）</h4>
      <ul>
        <li>自由に文章を打てます。辞書のキーワードに反応して<b>労働傾向</b>が動きます。</li>
        <li>「畑を守りながら祈れ」のように混ぜると効果は<b>按分</b>されます。</li>
        <li>一定確率で<b>解釈がズレます</b>。ドルンが村にいるとズレは大きく減ります。</li>
        <li>同じ傾向の連投は効果が<b>逓減</b>します。言葉を変えてください。</li>
      </ul>
      <h4>③ 奇跡（直接介入・確定効果）</h4>
      <ul>
        <li>信仰が積み重なると神ポイントが貯まります。効果はすべて<b>確定</b>で、ガチャ性はありません。</li>
        <li>襲撃の気配を感じたら、いくつかの奇跡が助けになります。</li>
      </ul>
      <h4>④ 脅威と放置</h4>
      <ul>
        <li>襲撃の前には<b>予兆</b>が出ます。全滅やゲームオーバーはありません。</li>
        <li>閉じている間も進行し、しばらくして戻るとその間の出来事が語られます。</li>
      </ul>
      <h4>⑤ 音</h4>
      <ul>
        <li>右上の <b>♪</b> で環境音楽が流れます（すべてブラウザ内で合成。音源ファイルはありません）。</li>
      </ul>`;
    UI.openModal('mdHelp');
  },

  handlers: {}
};
