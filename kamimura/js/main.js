/* ===========================================================
   main.js ― 起動・コアループ・入力ハンドリング（5章）
   =========================================================== */
'use strict';

(function(){

let st = null;
let speed = 1;
let loopTimer = null;
let saveAcc = 0;
let introPage = 0;
let lastFrame = 0;
let musicPref = true;

/* =========================================================
   起動
   ========================================================= */
function boot(){
  const loaded = State.load();
  st = loaded || State.fresh();
  UI.init(st);
  bindUI();
  loadAudioPrefs();
  Engine.onSpeak = (uid, text, short) => Speech.push(uid, text, short);

  if(st.screen === 'intro'){
    startIntro();
  }else if(st.screen === 'site'){
    openSiteSelect();
  }else{
    startWorld();
    resumeFromOffline(loaded);
  }
  UI.update(st);
  startLoop();
  requestAnimationFrame(frame);
}

function startWorld(){
  World.init(st, $('mapCanvas'));
  UI.renderSite(st);
}

function resumeFromOffline(loaded){
  if(!loaded) return;
  const elapsed = Math.max(0, (Date.now() - st.lastSeen) / 1000);
  const dg = Engine.offline(st, elapsed);
  flushPending();
  if(dg) UI.showDigest(dg);
  State.save(st);
}

/* =========================================================
   オープニング（3-1）
   ========================================================= */
function startIntro(){
  introPage = 0;
  UI.openModal('mdIntro');
  renderIntro();
}
function renderIntro(){
  $('introText').textContent = INTRO_PAGES[introPage];
  $('introNext').textContent = (introPage >= INTRO_PAGES.length - 1) ? '目を開く' : 'つづき';
}
function nextIntro(){
  introPage++;
  if(introPage >= INTRO_PAGES.length){
    st.screen = 'site';
    State.save(st);
    openSiteSelect();
  }else{
    renderIntro();
  }
}

/* =========================================================
   チュートリアル：拠点探し（3-2）
   ========================================================= */
function openSiteSelect(){
  const box = $('siteChoices');
  box.innerHTML = '';
  Object.keys(SITES).forEach(id => {
    const s = SITES[id];
    const card = document.createElement('div');
    card.className = 'sitecard';
    card.innerHTML =
      `<div class="sname">${s.icon} ${s.name}</div>` +
      `<div class="stags">` +
        s.good.map(g => `<span class="tag-good">${g}</span>`).join('') +
        s.bad.map(b => `<span class="tag-bad">${b}</span>`).join('') +
      `</div><div class="sdesc">${s.desc}</div>`;
    box.appendChild(card);
  });
  UI.openModal('mdSite');
  setTimeout(() => $('siteInput').focus(), 200);
}

function sendSiteOracle(){
  const text = $('siteInput').value.trim();
  if(!text){ UI.toast('言葉を降ろしてください。'); return; }
  const r = Oracle.matchSite(text);
  const site = SITES[r.site];
  st.site = r.site;
  st.screen = 'play';

  State.log(st, `【最初のお告げ】「${text}」`, 'oracle');
  State.log(st, r.matched
    ? `民はお告げを受け取り、${site.name}へ向かった。`
    : `お告げの意味は掴めなかったが、民は歩き出し――${site.name}へたどり着いた。`, 'story');

  startWorld();
  UI.closeModal();

  UI.queue(() => {
    $('eventFaces').innerHTML = `<div style="font-size:30px">${site.icon}</div>`;
    $('eventTitle').textContent = r.matched ? `${site.name}に決まった` : `${site.name}にたどり着いた`;
    $('eventBody').textContent = r.matched
      ? `　あなたの言葉は、確かに届いた。\n　四人は${site.name}に荷を下ろす。\n\n　${site.desc}\n\n　――ここから、あなたの見守りが始まる。`
      : `　言葉は、正しくは伝わらなかった。\n　それでも彼らは歩き、${site.name}にたどり着いた。\n\n　${site.desc}\n\n　神託は、いつも完全ではない。\n　それでも彼らは、あなたを信じている。`;
    UI.openModal('mdEvent');
  });

  Engine.fireStory(st, 'found');
  st.flags.story.found = true;
  flushPending();
  State.save(st);
}

/* =========================================================
   コアループ（1秒＝ゲーム内1秒）
   ========================================================= */
function startLoop(){
  if(loopTimer) clearInterval(loopTimer);
  loopTimer = setInterval(tick, CONFIG.TICK_MS);
}

function tick(){
  if(st.screen !== 'play') return;
  Engine.simulate(st, speed, {
    onBattle: res => {
      World.endRaid(res.win);
      Sound.sfx(res.win ? 'win' : 'lose');
      UI.showBattle(res);
    },
    onWarn: () => {
      World.spawnRaid(3 + Math.floor(Math.random() * 3));
      Sound.sfx('warn');
      UI.toast('不穏な気配……襲撃が近い。', 'bad');
    }
  });
  flushPending();
  UI.update(st);

  saveAcc += speed;
  if(saveAcc >= 10){ saveAcc = 0; State.save(st); }
}

/* 地図とアニメーション（実時間） */
function frame(ts){
  const dt = Math.min(0.1, (ts - lastFrame) / 1000 || 0);
  lastFrame = ts;
  if(st && st.screen === 'play' && World.ready){
    World.tick(dt * Math.min(speed, 3), st);
    World.draw(st);
  }
  Speech.tick(dt);
  requestAnimationFrame(frame);
}

function flushPending(){
  while(st.pendingEvents.length){
    UI.showStory(st.pendingEvents.shift(), st);
  }
}

/* =========================================================
   入力
   ========================================================= */
function sendOracle(){
  const ta = $('oracleInput');
  const text = ta.value.trim();
  if(!text){ UI.toast('言葉を降ろしてください。'); return; }
  if(st.oracle.uses <= 0){ UI.toast('声が枯れている。時を待つか、信仰石を使おう。', 'bad'); return; }

  const res = Oracle.send(st, text);
  ta.value = '';
  Sound.sfx('oracle');
  res.lines.forEach((l, i) => setTimeout(() => UI.toast(l, res.kind), i * 400));
  UI.update(st);
  State.save(st);
}

UI.handlers.miracle = function(id){
  const r = Engine.useMiracle(st, id);
  if(r.ok) Sound.sfx('miracle');
  UI.toast(r.msg || '', r.ok ? 'miracle' : 'bad');
  UI.update(st);
  State.save(st);
};

/* ---------- 地図の操作 ---------- */
function mapClick(ev){
  if(!World.ready || st.screen !== 'play') return;
  if(Scene3D.dragged) return;              // 視点を回しただけのときは反応しない

  // 村人をクリック → 声をかける
  const ag = World.agentFromEvent(ev);
  if(!ag) return;
  const v = State.find(st, ag.uid);
  if(v){
    const pool = CHATTER[v.uid] || CHATTER.temperament[v.temperament] || CHATTER.temperament['飄々'];
    const td = ag.task ? World.TASKS[ag.task] : null;
    Speech.push(ag.uid, Util.pick(pool) + (td ? `（いまは${td.label}）` : ''));
    World.focus = ag.uid;
    Sound.sfx('talk');
  }
}

function mapMove(ev){
  if(!World.ready) return;
  const tip = $('mapTip');
  const rect = World.canvas.getBoundingClientRect();
  const ag = World.agentFromEvent(ev);
  World.hoverAgent = ag;

  if(!ag){ tip.classList.add('hidden'); return; }
  const v = State.find(st, ag.uid);
  const td = ag.task ? World.TASKS[ag.task] : null;
  let html = `<b>${v ? v.name : '―'}</b>`;
  if(v) html += `<br>${v.role}・${v.temperament}`;
  if(td) html += `<br>${td.emote} ${td.label}`;
  html += `<span class="tip-hint">クリックで声をかける</span>`;

  tip.innerHTML = html;
  tip.classList.remove('hidden');
  const x = ev.clientX - rect.left + 14, y = ev.clientY - rect.top + 14;
  tip.style.left = Math.min(x, rect.width - 180) + 'px';
  tip.style.top  = Math.min(y, rect.height - 50) + 'px';
}

/* ---------- 音 ---------- */
function loadAudioPrefs(){
  const v = Sound.loadPrefs();
  $('volSlider').value = v;
  try{ musicPref = localStorage.getItem('nameless_music') !== '0'; }catch(e){}
  $('musicBtn').classList.toggle('on', false);
}
function firstGestureAudio(){
  if(!musicPref || Sound.on) return;
  if(Sound.start()) $('musicBtn').classList.add('on');
}

/* =========================================================
   バインド
   ========================================================= */
function bindUI(){
  $('sendOracle').addEventListener('click', sendOracle);
  $('oracleInput').addEventListener('keydown', e => {
    if(e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); sendOracle(); }
  });

  $('introNext').addEventListener('click', nextIntro);
  $('introSkip').addEventListener('click', () => { introPage = INTRO_PAGES.length - 1; nextIntro(); });

  $('siteSend').addEventListener('click', sendSiteOracle);
  $('siteInput').addEventListener('keydown', e => {
    if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendSiteOracle(); }
  });

  $('eventOk').addEventListener('click', UI.closeModal);
  $('digestOk').addEventListener('click', UI.closeModal);
  $('battleOk').addEventListener('click', UI.closeModal);
  $('helpOk').addEventListener('click', UI.closeModal);
  $('menuClose').addEventListener('click', UI.closeModal);

  $('menuBtn').addEventListener('click', () => UI.openModal('mdMenu'));
  $('menuHelp').addEventListener('click', () => { UI.closeModalEl(); UI.showHelp(); });
  $('menuSave').addEventListener('click', () => {
    UI.toast(State.save(st) ? '村の記録を保存した。' : '保存に失敗した。', 'good');
  });
  $('menuReset').addEventListener('click', () => {
    if(!confirm('すべての記録を消して最初からやり直しますか？')) return;
    State.wipe();
    st = State.fresh();
    World.reset();
    UI.modalQueue.length = 0;
    UI.closeModalEl();
    $('overlay').classList.add('hidden');
    UI.init(st);
    UI.update(st);
    startIntro();
  });

  $('speedBox').addEventListener('click', e => {
    const b = e.target.closest('button');
    if(!b) return;
    speed = +b.dataset.speed;
    document.querySelectorAll('#speedBox button').forEach(x => x.classList.toggle('on', x === b));
  });

  // 地図
  const cv = $('mapCanvas');
  cv.addEventListener('click', mapClick);
  cv.addEventListener('mousemove', mapMove);
  cv.addEventListener('mouseleave', () => {
    $('mapTip').classList.add('hidden');
    World.hoverAgent = null;
  });

  // 会話バーをクリックで送り
  $('speechBar').addEventListener('click', () => Speech.skip());

  // 音
  $('musicBtn').addEventListener('click', () => {
    const on = Sound.toggle();
    musicPref = on;
    $('musicBtn').classList.toggle('on', on);
    try{ localStorage.setItem('nameless_music', on ? '1' : '0'); }catch(e){}
  });
  $('volSlider').addEventListener('input', e => Sound.setVolume(parseFloat(e.target.value)));
  document.addEventListener('pointerdown', firstGestureAudio, { once: false });

  document.addEventListener('visibilitychange', () => {
    if(document.hidden){
      State.save(st);
    }else if(st.screen === 'play'){
      const elapsed = Math.max(0, (Date.now() - st.lastSeen) / 1000);
      if(elapsed > 60){
        const dg = Engine.offline(st, elapsed);
        flushPending();
        if(dg) UI.showDigest(dg);
      }
      lastFrame = performance.now();
      UI.update(st);
    }
  });
  window.addEventListener('beforeunload', () => State.save(st));
}

/* デバッグ・バランス調整用 */
window.NAMELESS = {
  get state(){ return st; },
  setSpeed(v){ speed = v; },
  skip(sec){
    const dg = Engine.offline(st, sec);
    flushPending();
    if(dg) UI.showDigest(dg);
    UI.update(st);
    return dg;
  },
  world: () => World
};

document.addEventListener('DOMContentLoaded', boot);

})();
