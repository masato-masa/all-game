/* ===========================================================
   portraits.js ― キャラクターの顔（手描きSVG生成）
   外部画像を一切使わず、パラメータから半写実タッチの顔を組み立てる。
   会話時の吹き出しの左側と、村人カードのサムネイルで使用。
   =========================================================== */
'use strict';

/* ---------- 色ユーティリティ ---------- */
function _hex(c){
  c = c.replace('#','');
  if(c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
  return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)];
}
function shade(col, amt){
  const [r,g,b] = _hex(col);
  const f = v => Math.max(0, Math.min(255, Math.round(v + amt)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function rgba(col, a){
  const [r,g,b] = _hex(col);
  return `rgba(${r},${g},${b},${a})`;
}

/* ===========================================================
   顔の生成
   o = { id, skin, hair, cloth, style, beard, age, eye, brow, scar, child, mood }
   =========================================================== */
function buildFace(o){
  const id    = o.id;
  const skin  = o.skin  || '#e6b98f';
  const hair  = o.hair  || '#3b2a22';
  const cloth = o.cloth || '#4a5568';
  const eye   = o.eye   || '#5b4632';
  const age   = o.age   || 0;
  const child = !!o.child;
  const mood  = o.mood  || 'calm';

  const cy    = child ? 58 : 55;          // 顔の中心
  const rx    = child ? 25 : 25.5;
  const ry    = child ? 27 : 30;
  const eyeY  = child ? 62 : 57;
  const eyeDX = child ? 11 : 12;
  const eRx   = child ? 7.4 : 7.2;
  const eRy   = child ? 5.4 : 4.4;
  const irisR = child ? 4.0 : 3.5;
  const browY = eyeY - (child ? 10 : 9.5);
  const mouthY= child ? 82 : 79;
  const noseY = child ? 72 : 70;

  const skinD  = shade(skin, -30);
  const skinDD = shade(skin, -58);
  const skinL  = shade(skin, 20);
  const hairL  = shade(hair, 34);
  const hairD  = shade(hair, -28);
  const clothD = shade(cloth, -30);
  const clothL = shade(cloth, 22);

  /* --- 眉の角度（表情） --- */
  const browTilt = mood === 'stern' ? 4 : (mood === 'sad' ? -3.5 : (mood === 'bright' ? -1 : 0.8));
  const browThick= child ? 2.0 : (mood === 'stern' ? 3.4 : 2.8);

  /* --- 口 --- */
  const lip  = o.lip || shade(skin, -62);
  const lipD = shade(skin, -100);
  let mouth;
  if(mood === 'bright'){
    // 口をあけた笑顔
    mouth = `
      <path d="M${60-8.5},${mouthY-1} q8.5,-2 17,0 q-2,9 -8.5,9 q-6.5,0 -8.5,-9Z" fill="${lipD}"/>
      <path d="M${60-7},${mouthY-0.6} q7,-1 14,0 q-1.5,2.4 -7,2.4 q-5.5,0 -7,-2.4Z" fill="#f4ece2" opacity=".92"/>
      <path d="M${60-8.5},${mouthY-1} q8.5,-2 17,0" fill="none" stroke="${lipD}" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M${60-9},${mouthY+7.5} q9,2.6 18,0" fill="none" stroke="${shade(skin,-45)}" stroke-width="1" opacity=".5"/>`;
  }else if(mood === 'stern'){
    mouth = `
      <path d="M${60-8},${mouthY} q8,-3.2 16,0 q-8,2.6 -16,0Z" fill="${lip}"/>
      <path d="M${60-8.5},${mouthY} q8.5,-3.4 17,0" fill="none" stroke="${lipD}" stroke-width="1.7" stroke-linecap="round"/>`;
  }else if(mood === 'sad'){
    mouth = `
      <path d="M${60-7},${mouthY+1.5} q7,-4 14,0 q-7,2.2 -14,0Z" fill="${lip}"/>
      <path d="M${60-7.5},${mouthY+1.5} q7.5,-4.2 15,0" fill="none" stroke="${lipD}" stroke-width="1.5" stroke-linecap="round"/>`;
  }else{
    mouth = `
      <path d="M${60-7.5},${mouthY} q7.5,3.4 15,0 q-7.5,2.2 -15,0Z" fill="${lip}"/>
      <path d="M${60-7.5},${mouthY} q7.5,3.2 15,0" fill="none" stroke="${lipD}" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M${60-5},${mouthY+3.4} q5,1.6 10,0" fill="none" stroke="${shade(skin,20)}" stroke-width="1.1" opacity=".5"/>`;
  }

  /* --- 髪 --- */
  let hairBack = '', hairFront = '';
  const S = o.style || 'short';
  if(S === 'long' || S === 'tied'){
    hairBack = `<path d="M${60-rx-4},${cy-6} q-2,34 6,50 l${(rx+4)*2-12},0 q8,-16 6,-50 q-6,-30 -${rx+2},-30 q-${rx-4},0 -${rx+2},30Z"
                  fill="url(#${id}hairG)"/>`;
    if(S === 'tied'){
      hairBack += `<ellipse cx="60" cy="${cy-30}" rx="12" ry="9" fill="url(#${id}hairG)"/>
                   <path d="M48,${cy-27} q12,-9 24,0" fill="none" stroke="${hairD}" stroke-width="1.2" opacity=".6"/>`;
    }
  }
  if(S === 'bald'){
    hairFront = `<path d="M${60-rx-1},${cy-2} q1,-14 7,-19 q-3,12 -2,19Z" fill="url(#${id}hairG)"/>
                 <path d="M${60+rx+1},${cy-2} q-1,-14 -7,-19 q3,12 2,19Z" fill="url(#${id}hairG)"/>
                 <path d="M${60-rx-1},${cy-1} q-1,10 2,17 q-5,-8 -4,-17Z" fill="url(#${id}hairG)"/>
                 <path d="M${60+rx+1},${cy-1} q1,10 -2,17 q5,-8 4,-17Z" fill="url(#${id}hairG)"/>`;
  }else if(S === 'hood'){
    hairFront = `<path d="M${60-rx-6},${cy+8} q-3,-32 ${rx+6},-32 q${rx+6},0 ${rx+6},32 q-6,-20 -${rx+6},-20 q-${rx+6},0 -${rx+6},20Z" fill="url(#${id}hairG)"/>`;
  }else if(S === 'messy'){
    hairFront = `
      <path d="M${60-rx-3},${cy+2} q-2,-32 ${rx+3},-33 q${rx+3},1 ${rx+3},33
               q-2,-13 -6,-19 l-2,7 l-5,-10 l-3,7 l-6,-9 l-3,8 l-6,-7 l-2,9 l-5,-6 q-4,4 -6,20Z"
            fill="url(#${id}hairG)"/>
      <path d="M${60-rx+2},${cy-14} q10,-9 22,-3" fill="none" stroke="${hairL}" stroke-width="1.4" opacity=".45"/>`;
  }else{ // short / long の前髪（横分け）
    hairFront = `
      <path d="M${60-rx-2},${cy-1} q-1,-31 ${rx+2},-31 q${rx+2},0 ${rx+2},31
               q-3,-17 -12,-21 q-7,7 -19,6 q-8,3 -10,15Z" fill="url(#${id}hairG)"/>
      <path d="M${60-13},${cy-24} q13,-5 25,3 q-12,-2 -25,-3Z" fill="${hairL}" opacity=".5"/>`;
  }

  /* --- ひげ --- */
  let beard = '';
  if(o.beard === 'full'){
    beard = `<path d="M${60-19},${cy+8} q2,30 19,32 q17,-2 19,-32 q-6,20 -19,20 q-13,0 -19,-20Z" fill="url(#${id}hairG)" opacity=".95"/>
             <path d="M${60-9},${mouthY-7} q9,-4 18,0 q-9,3 -18,0Z" fill="${hairD}" opacity=".9"/>`;
  }else if(o.beard === 'stubble'){
    beard = `<path d="M${60-17},${cy+13} q3,22 17,23 q14,-1 17,-23 q-6,15 -17,15 q-11,0 -17,-15Z" fill="${shade(hair,10)}" opacity=".25"/>`;
  }

  /* --- しわ --- */
  let wrinkle = '';
  if(age > 0.5){
    wrinkle = `
      <g stroke="${skinDD}" fill="none" stroke-linecap="round" opacity=".35">
        <path d="M${60-13},${browY-7} q13,-3 26,0" stroke-width="1"/>
        <path d="M${60-11},${browY-11} q11,-2.5 22,0" stroke-width=".8"/>
        <path d="M${60-eyeDX-8},${eyeY+4} q3,3 6,4" stroke-width=".9"/>
        <path d="M${60+eyeDX+8},${eyeY+4} q-3,3 -6,4" stroke-width=".9"/>
        <path d="M${60-9},${noseY+2} q-4,7 -3,11" stroke-width="1.1"/>
        <path d="M${60+9},${noseY+2} q4,7 3,11" stroke-width="1.1"/>
      </g>`;
  }

  /* --- 傷跡 --- */
  const scar = o.scar
    ? `<path d="M${60+eyeDX+2},${browY-6} l4,17" stroke="${shade(skin,-45)}" stroke-width="1.8" stroke-linecap="round" opacity=".75"/>
       <path d="M${60+eyeDX+1},${browY-1} l6,-2" stroke="${shade(skin,-45)}" stroke-width="1.2" stroke-linecap="round" opacity=".55"/>`
    : '';

  /* --- 目 --- */
  const eyeSet = (dir) => {
    const cxE = 60 + dir * eyeDX;
    return `
      <ellipse cx="${cxE}" cy="${eyeY}" rx="${eRx}" ry="${eRy}" fill="#f6f1ea"/>
      <ellipse cx="${cxE}" cy="${eyeY}" rx="${eRx}" ry="${eRy}" fill="url(#${id}eyeShade)"/>
      <circle cx="${cxE + dir*0.4}" cy="${eyeY+0.4}" r="${irisR}" fill="url(#${id}irisG)"/>
      <circle cx="${cxE + dir*0.4}" cy="${eyeY+0.4}" r="${irisR*0.45}" fill="#17110c"/>
      <circle cx="${cxE + dir*0.4 - 1.3}" cy="${eyeY-1.3}" r="${irisR*0.32}" fill="#fff" opacity=".9"/>
      <path d="M${cxE-eRx},${eyeY-1} q${eRx},${-eRy-1.6} ${eRx*2},0"
            fill="none" stroke="${shade(hair,-10)}" stroke-width="${child?1.5:1.8}" stroke-linecap="round"/>
      ${o.lashes ? `<path d="M${cxE-eRx-1},${eyeY-2.2} q${eRx},${-eRy-2.4} ${eRx*2+2},0" fill="none" stroke="${shade(hair,-20)}" stroke-width="1" opacity=".8"/>` : ''}
      <path d="M${cxE-eRx+1},${eyeY+eRy-0.4} q${eRx-1},1.8 ${eRx*2-2},0" fill="none" stroke="${skinDD}" stroke-width=".7" opacity=".45"/>`;
  };

  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" class="portrait-svg">
  <defs>
    <radialGradient id="${id}bg" cx="50%" cy="35%" r="75%">
      <stop offset="0%" stop-color="${rgba(o.bg || '#2a2438', 1)}"/>
      <stop offset="100%" stop-color="#14101d"/>
    </radialGradient>
    <radialGradient id="${id}skinG" cx="38%" cy="30%" r="78%">
      <stop offset="0%" stop-color="${skinL}"/>
      <stop offset="62%" stop-color="${skin}"/>
      <stop offset="100%" stop-color="${skinD}"/>
    </radialGradient>
    <linearGradient id="${id}hairG" x1="20%" y1="0%" x2="85%" y2="100%">
      <stop offset="0%" stop-color="${hairL}"/>
      <stop offset="55%" stop-color="${hair}"/>
      <stop offset="100%" stop-color="${hairD}"/>
    </linearGradient>
    <linearGradient id="${id}clothG" x1="10%" y1="0%" x2="90%" y2="100%">
      <stop offset="0%" stop-color="${clothL}"/>
      <stop offset="60%" stop-color="${cloth}"/>
      <stop offset="100%" stop-color="${clothD}"/>
    </linearGradient>
    <radialGradient id="${id}irisG" cx="35%" cy="30%" r="75%">
      <stop offset="0%" stop-color="${shade(eye, 55)}"/>
      <stop offset="60%" stop-color="${eye}"/>
      <stop offset="100%" stop-color="${shade(eye,-45)}"/>
    </radialGradient>
    <linearGradient id="${id}eyeShade" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="rgba(0,0,0,.30)"/>
      <stop offset="45%" stop-color="rgba(0,0,0,0)"/>
    </linearGradient>
    <clipPath id="${id}clip"><rect x="0" y="0" width="120" height="120" rx="16"/></clipPath>
  </defs>

  <g clip-path="url(#${id}clip)">
    <rect width="120" height="120" fill="url(#${id}bg)"/>
    <ellipse cx="60" cy="128" rx="66" ry="46" fill="${rgba(o.bg || '#2a2438', .55)}"/>

    ${hairBack}

    <!-- 首と肩 -->
    <path d="M${60-9},${cy+ry-6} l18,0 l2,14 l-22,0Z" fill="${skinD}"/>
    <path d="M${60-9},${cy+ry-6} l18,0 l1,7 q-10,4 -20,0Z" fill="${skinDD}" opacity=".5"/>
    <path d="M60,${cy+ry+4} q-32,3 -38,26 l0,10 l76,0 l0,-10 q-6,-23 -38,-26Z" fill="url(#${id}clothG)"/>
    <path d="M60,${cy+ry+4} q-9,10 -9,20 l18,0 q0,-10 -9,-20Z" fill="${clothD}" opacity=".7"/>
    <path d="M${60-38},${cy+ry+30} q38,-8 76,0" fill="none" stroke="${clothL}" stroke-width="1.2" opacity=".45"/>

    <!-- 耳 -->
    <ellipse cx="${60-rx+1}" cy="${eyeY+5}" rx="4.2" ry="6.2" fill="${skinD}"/>
    <ellipse cx="${60+rx-1}" cy="${eyeY+5}" rx="4.2" ry="6.2" fill="${skinD}"/>

    <!-- 顔 -->
    <path d="M${60-rx},${cy-4} q0,-${ry} ${rx},-${ry} q${rx},0 ${rx},${ry}
             q0,${ry*0.62} -${rx*0.42},${ry*0.86} q-${rx*0.58},${ry*0.30} -${rx*1.16},0
             q-${rx*0.42},-${ry*0.24} -${rx*0.42},-${ry*0.86}Z" fill="url(#${id}skinG)"/>

    <!-- 頬・輪郭の陰 -->
    <path d="M${60+rx-3},${cy-8} q4,26 -8,38 q10,-16 8,-38Z" fill="${skinDD}" opacity=".28"/>
    <ellipse cx="${60-13}" cy="${eyeY+11}" rx="7" ry="4.5" fill="${o.blush || shade(skin,-4)}" opacity="${child ? .5 : .32}"/>
    <ellipse cx="${60+13}" cy="${eyeY+11}" rx="7" ry="4.5" fill="${o.blush || shade(skin,-4)}" opacity="${child ? .5 : .32}"/>
    <!-- 髪が落とす額の影 -->
    <path d="M${60-rx},${cy-4} q${rx},-16 ${rx*2},0 q-${rx},10 -${rx*2},0Z" fill="${skinDD}" opacity=".22"/>

    ${wrinkle}

    <!-- 眉 -->
    <path d="M${60-eyeDX-7},${browY+browTilt} q7,-4 14,${-browTilt*0.4}" fill="none"
          stroke="${shade(hair,-6)}" stroke-width="${browThick}" stroke-linecap="round"/>
    <path d="M${60+eyeDX+7},${browY+browTilt} q-7,-4 -14,${-browTilt*0.4}" fill="none"
          stroke="${shade(hair,-6)}" stroke-width="${browThick}" stroke-linecap="round"/>

    <!-- 目 -->
    ${eyeSet(-1)}
    ${eyeSet(1)}

    <!-- 鼻 -->
    <path d="M${60-1},${eyeY+5} q-2,${noseY-eyeY-4} -3.5,${noseY-eyeY-1} q3,2.4 7,0"
          fill="none" stroke="${skinDD}" stroke-width="1.2" stroke-linecap="round" opacity=".55"/>
    <ellipse cx="${60-3.4}" cy="${noseY}" rx="1.1" ry=".8" fill="${skinDD}" opacity=".5"/>
    <ellipse cx="${60+3.4}" cy="${noseY}" rx="1.1" ry=".8" fill="${skinDD}" opacity=".5"/>

    ${mouth}
    ${beard}
    ${scar}
    ${hairFront}

    <!-- 全体の陰影 -->
    <path d="M120,0 L120,120 L58,120 q22,-40 18,-120Z" fill="#000" opacity=".13"/>
    <rect width="120" height="120" rx="16" fill="none" stroke="rgba(236,226,198,.22)" stroke-width="1.5"/>
  </g>
</svg>`;
}

/* ===========================================================
   初期4人の顔
   =========================================================== */
const FACE_DEFS = {
  gain: { id:'fg', skin:'#d09a6c', hair:'#3a2718', cloth:'#6b4a3a', eye:'#4a6b7a',
          style:'messy', beard:'stubble', scar:true, mood:'stern', age:.3, bg:'#3a2620' },
  meia: { id:'fm', skin:'#f0c8a4', hair:'#7a4527', cloth:'#8a6a4a', eye:'#6b8a4a',
          style:'tied', mood:'bright', lashes:true, age:.1, bg:'#3e2c22', blush:'#e39a80' },
  noah: { id:'fn', skin:'#f6d5b4', hair:'#d0a85a', cloth:'#5a7a52', eye:'#7aa8c8',
          style:'messy', mood:'bright', child:true, age:0, bg:'#223a28', blush:'#e8a088' },
  dorn: { id:'fd', skin:'#d2ab86', hair:'#cfc9bc', cloth:'#5a5040', eye:'#8a7a5a',
          style:'bald', beard:'full', mood:'calm', age:.95, bg:'#2c2820' }
};

/* 加入者用：役割ごとの見た目バリエーション */
const RECRUIT_FACES = {
  '狩人':   { skin:'#d9a97c', hair:'#33251c', cloth:'#4d5f43', eye:'#5a4630', style:'short',  beard:'stubble', mood:'stern' },
  '農夫':   { skin:'#e3b489', hair:'#4a3524', cloth:'#7a6a44', eye:'#5b4632', style:'short',  mood:'calm' },
  '職人':   { skin:'#d6a679', hair:'#2e2119', cloth:'#6a5344', eye:'#4b3a2a', style:'short',  beard:'full', mood:'calm' },
  '巡礼者': { skin:'#e8c3a2', hair:'#8a7a6a', cloth:'#5b5470', eye:'#7a6a8a', style:'hood',   mood:'calm' },
  '行商人': { skin:'#dfae83', hair:'#5a3a24', cloth:'#8a5a3a', eye:'#6a5230', style:'long',   mood:'bright' },
  '元傭兵': { skin:'#c99a70', hair:'#3a2c22', cloth:'#4a4a52', eye:'#5a5a5a', style:'messy',  beard:'full', scar:true, mood:'stern' },
  '若者':   { skin:'#eec9a6', hair:'#6a4a2e', cloth:'#5f6f52', eye:'#6a8a5a', style:'messy',  mood:'bright' }
};

const HAIR_VARIANTS  = ['#2e2119','#43301f','#5a3a24','#7a4a2a','#8a7a6a','#c8a05a','#3a3a3a'];
const SKIN_VARIANTS  = ['#e6b98f','#d8a678','#eec4a0','#c99a70','#f0d2b2','#b98a63'];
const STYLE_VARIANTS = ['short','long','messy','tied','hood'];

/* 初期4人だけは実写ポートレートを使う（地図上のドット絵は引き続き FACE_DEFS の配色を使用） */
const REAL_PORTRAITS = {
  gain: 'assets/portraits/gain.png',
  meia: 'assets/portraits/meia.png',
  noah: 'assets/portraits/noah.png',
  dorn: 'assets/portraits/dorn.png'
};

const Portrait = {
  cache: {},

  defCache: {},

  /** 村人の見た目定義（肌・髪・服・髪型）。地図上のドット絵もこれを使う */
  def(v){
    if(Portrait.defCache[v.uid]) return Portrait.defCache[v.uid];
    let def;
    if(FACE_DEFS[v.uid]){
      def = Object.assign({}, FACE_DEFS[v.uid]);
    }else{
      const base = RECRUIT_FACES[v.role] || RECRUIT_FACES['若者'];
      // uid から決定的にバリエーションを選ぶ（再読込しても同じ顔）
      let h = 0;
      for(let i = 0; i < v.uid.length; i++) h = (h * 31 + v.uid.charCodeAt(i)) & 0xffff;
      def = Object.assign({}, base, {
        id: 'f' + v.uid.replace(/[^a-z0-9]/gi, ''),
        skin: SKIN_VARIANTS[h % SKIN_VARIANTS.length],
        hair: HAIR_VARIANTS[(h >> 3) % HAIR_VARIANTS.length],
        style: (h >> 6) % 5 === 0 ? STYLE_VARIANTS[(h >> 7) % STYLE_VARIANTS.length] : base.style,
        bg: '#2a2438',
        age: ((h >> 9) % 100) / 300,
        lashes: (h >> 11) % 2 === 0
      });
      if(v.temperament === '臆病')     def.mood = 'sad';
      if(v.temperament === '好戦')     def.mood = 'stern';
      if(v.temperament === '信心深い') def.mood = 'calm';
    }
    if(!def.id) def.id = 'f' + v.uid;
    Portrait.defCache[v.uid] = def;
    return def;
  },

  /** 村人オブジェクトから顔を得る（初期4人は実写、それ以外はSVG生成。結果はキャッシュ） */
  get(v){
    if(Portrait.cache[v.uid]) return Portrait.cache[v.uid];
    const out = REAL_PORTRAITS[v.uid]
      ? `<img class="portrait-img" src="${REAL_PORTRAITS[v.uid]}" alt="${v.name}" draggable="false">`
      : buildFace(Portrait.def(v));
    Portrait.cache[v.uid] = out;
    return out;
  },

  /** 表情差分が要る場面用（怒り・悲しみなど）。実写勢は表情差分を持たないためそのまま返す */
  withMood(v, mood){
    if(REAL_PORTRAITS[v.uid]) return Portrait.get(v);
    const base = FACE_DEFS[v.uid] ? Object.assign({}, FACE_DEFS[v.uid]) : null;
    if(!base) return Portrait.get(v);
    base.mood = mood;
    base.id = base.id + mood;
    return buildFace(base);
  },

  clear(){ Portrait.cache = {}; Portrait.defCache = {}; }
};
