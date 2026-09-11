/* ===========================================================
   data.js ― 静的データ定義
   設計ドキュメント v0.2 の 2章／7章／8章／9章に対応。
   （characters.json / oracleDictionary.json / miracles.json の
     内容をゲーム実行用に展開したもの。file:// でも動くよう
     fetch せず定数として保持する）
   =========================================================== */
'use strict';

const CONFIG = {
  TICK_MS: 1000,            // 実時間1秒 = ゲーム内1秒
  SAVE_KEY: 'nameless_god_village_v2',
  OFFLINE_CAP_SEC: 8 * 3600,
  OFFLINE_BONUS: 1.10,      // 5-2「オフライン進行はオンライン以上」
  OFFLINE_STEP: 10,         // オフライン計算の刻み幅（秒）
  FAITH_PER_GP: 100,        // 8-1 信仰値100ごとに神ポイント1
  ORACLE_MAX: 3,            // 7-5 1セッション3回まで
  ORACLE_REFILL_SEC: 120,   // 1回分の回復時間
  ORACLE_BUFF_SEC: 240,     // お告げによる一時バフの持続
  LOG_MAX: 140,
  BUILD_BASE_SEC: 25
};

/* ---------- 拠点候補（3-2 チュートリアル） ---------- */
const SITES = {
  river: {
    id:'river', name:'川のほとり', icon:'🌊',
    keywords:['川','水','河','流れ','せせらぎ','魚','水辺'],
    good:['食料が豊富'], bad:['増水のリスク'],
    desc:'水と魚に恵まれるが、雨季には水が村を舐める。',
    mod:{ food:1.25, mat:1.0, faith:1.0, def:0.95, threat:1.0 }
  },
  cave: {
    id:'cave', name:'岩窟', icon:'🕳️',
    keywords:['洞窟','岩','穴','隠れ','守り','安全','安心'],
    good:['防御に強い'], bad:['拡張しにくい'],
    desc:'岩が矢と牙を防ぐ。ただし村を広げる余地は乏しい。',
    mod:{ food:0.9, mat:0.85, faith:1.05, def:1.35, threat:0.9 }
  },
  hill: {
    id:'hill', name:'小高い丘', icon:'⛰️',
    keywords:['丘','高','上','見晴','山','奇襲','遠く'],
    good:['奇襲されにくい'], bad:['水源が遠い'],
    desc:'見晴らしがよく不意を打たれない。だが水を汲みに行くのが遠い。',
    mod:{ food:0.85, mat:1.05, faith:1.0, def:1.15, threat:0.75 }
  },
  ruins: {
    id:'ruins', name:'廃墟の跡', icon:'🏚️',
    keywords:['廃墟','遺跡','跡','古い','石','資材','宝'],
    good:['資材が眠る'], bad:['何かの気配'],
    desc:'朽ちた石組みには使える資材が残る。……そして、何かの気配も。',
    mod:{ food:0.95, mat:1.35, faith:1.1, def:1.0, threat:1.3 }
  }
};

/* ---------- 気質タイプ（7-3 反応重み） ---------- */
const TEMPERAMENTS = {
  '勤勉':     { frontier:1.1, production:1.25, combat:1.0, faith:1.0, commerce:1.0, rest:0.5,  discipline:1.1, fatigue:1.15, note:'休みたがらない' },
  '怠惰':     { frontier:0.7, production:0.8,  combat:0.6, faith:0.7, commerce:1.0, rest:1.5,  discipline:0.7, fatigue:0.8,  note:'休息のお告げに強く反応' },
  '臆病':     { frontier:0.7, production:1.0,  combat:0.4, faith:1.3, commerce:1.1, rest:1.1,  discipline:1.2, fatigue:1.0,  note:'戦いのお告げを強く拒む' },
  '好戦':     { frontier:1.1, production:0.8,  combat:1.5, faith:0.7, commerce:0.8, rest:0.6,  discipline:0.9, fatigue:0.9,  note:'戦いのお告げに燃える' },
  '信心深い': { frontier:0.9, production:1.0,  combat:0.9, faith:1.8, commerce:0.9, rest:1.0,  discipline:1.1, fatigue:1.0,  note:'祈りのお告げに深く応える' },
  '飄々':     { frontier:1.0, production:1.0,  combat:0.9, faith:1.2, commerce:1.2, rest:1.2,  discipline:0.9, fatigue:0.9,  note:'何事もほどほどに受け取る' },
  '好奇心旺盛':{ frontier:1.4, production:0.9, combat:0.3, faith:1.1, commerce:1.1, rest:1.1,  discipline:0.8, fatigue:1.0,  note:'新しいことに飛びつく' }
};

/* ---------- 初期4人（2章） ---------- */
const FOUNDERS = [
  {
    id:'gain', name:'ガイン', role:'戦士', emoji:'⚔️', cls:'gain', founder:true,
    temperament:'勤勉', apt:'high',
    work:{ frontier:25, production:15, combat:50, faith:5, commerce:5 },
    cond:{ loyalty:60, fatigue:10, morale:70 },
    badge:'村の盾',
    traits:['寡黙','責任感が強い','守れなかった過去がある']
  },
  {
    id:'meia', name:'メイア', role:'採集・調理', emoji:'🌿', cls:'meia', founder:true,
    temperament:'勤勉', apt:'low',
    work:{ frontier:5, production:55, combat:5, faith:10, commerce:25 },
    cond:{ loyalty:65, fatigue:10, morale:75 },
    badge:'幸福度ハブ',
    traits:['明るい','現実的','ノアを実の子のように守っている']
  },
  {
    id:'noah', name:'ノア', role:'子供', emoji:'✨', cls:'noah', founder:true,
    temperament:'好奇心旺盛', apt:'none',
    work:{ frontier:0, production:0, combat:0, faith:0, commerce:0 },
    cond:{ loyalty:100, fatigue:0, morale:90 },
    badge:'無邪気さバフ',
    traits:['神の存在を疑わない','戦力にならないが空気を左右する']
  },
  {
    id:'dorn', name:'ドルン', role:'長老', emoji:'📜', cls:'dorn', founder:true,
    temperament:'飄々', apt:'low',
    work:{ frontier:10, production:10, combat:10, faith:40, commerce:30 },
    cond:{ loyalty:70, fatigue:5, morale:80 },
    badge:'神託の解釈者',
    traits:['知恵者','世界の成り立ちを何か知っている']
  }
];

/* ---------- 新規加入者のプール ---------- */
const RECRUIT_NAMES = ['アルド','セラ','ミナ','ヨナ','カイ','ルシェ','ボルグ','ティナ','ハルト','ネル',
  'グレイ','ソフィ','レン','マーシャ','ジオ','エリカ','タリム','ウルド','フィナ','コルト','サイ','リヴ'];
const RECRUIT_ROLES = [
  { role:'狩人',   emoji:'🏹', apt:'high', work:{frontier:20,production:20,combat:45,faith:5,commerce:10} },
  { role:'農夫',   emoji:'🌾', apt:'low',  work:{frontier:10,production:65,combat:5,faith:10,commerce:10} },
  { role:'職人',   emoji:'🔨', apt:'low',  work:{frontier:50,production:20,combat:5,faith:5,commerce:20} },
  { role:'巡礼者', emoji:'🕯️', apt:'low',  work:{frontier:5,production:15,combat:5,faith:60,commerce:15} },
  { role:'行商人', emoji:'🎒', apt:'low',  work:{frontier:10,production:10,combat:10,faith:10,commerce:60} },
  { role:'元傭兵', emoji:'🛡️', apt:'high', work:{frontier:15,production:10,combat:60,faith:5,commerce:10} },
  { role:'若者',   emoji:'🧒', apt:'low',  work:{frontier:30,production:35,combat:15,faith:10,commerce:10} }
];

/* ---------- お告げ辞書（7-2） ---------- */
const ORACLE_CATEGORIES = [
  {
    id:'frontier', label:'開拓・拡大', color:'#9cc2e8',
    keywords:['広げろ','広げ','開拓','新天地','土地','進め','進む','拡大','外へ','探索','探せ','切り開'],
    work:'frontier', shift:15,
    buffs:[{kind:'mat', mag:1.15}],
    delta:{ fatigue:3 },
    line:'土地を広げよ'
  },
  {
    id:'production', label:'農業・生産', color:'#9fd18a',
    keywords:['畑','耕','実り','収穫','育て','食べ','食料','農','種','蓄え','狩'],
    work:'production', shift:15,
    buffs:[{kind:'food', mag:1.20}],
    delta:{ fatigue:5 },
    line:'糧を得よ'
  },
  {
    id:'combat', label:'戦闘・防衛', color:'#e0a394',
    keywords:['戦え','戦う','戦','守れ','守る','敵','武器','備え','防','見張','警戒','討','剣'],
    work:'combat', shift:15,
    delta:{ security:10, happiness:-5 },
    line:'備えよ'
  },
  {
    id:'faith', label:'信仰・儀式', color:'#e8c96a',
    keywords:['祈','捧げ','感謝','祭','神殿','儀式','信じ','崇め','讃え'],
    work:'faith', shift:15,
    buffs:[{kind:'faith', mag:1.25}],
    delta:{ loyalty:5, materials:-3 },
    line:'祈れ'
  },
  {
    id:'commerce', label:'商業・交易', color:'#c9a227',
    keywords:['売','買','商','交易','市場','取引','旅人','物々'],
    work:'commerce', shift:15,
    buffs:[{kind:'trade', mag:1.20}],
    line:'交わせ'
  },
  {
    id:'rest', label:'休息・慈愛', color:'#a68ae0',
    keywords:['休め','休む','休','癒','労','優しく','眠','ゆっくり','無理','安らか'],
    work:null, shift:0,
    buffs:[{kind:'prod', mag:0.95}],
    delta:{ fatigue:-18, happiness:10 },
    line:'休め'
  },
  {
    id:'discipline', label:'規律・統制', color:'#b6ab8e',
    keywords:['従え','従う','厳し','罰','規律','統制','律せ','秩序'],
    work:null, shift:0,
    delta:{ security:15, happiness:-10, loyalty:4 },
    line:'律せよ'
  }
];

const ORACLE_FALLBACK = {
  id:'unknown', label:'未知・曖昧',
  messages:[
    '民たちはお告げの意味を測りかねている……。',
    '「今のは……なんだったのだろう」ざわめきが村に走った。',
    '言葉は届いた。だが、意味は誰にも掴めなかった。'
  ]
};

/* NGワード：無害化して差し替える（7-4） */
const NG_WORDS = ['殺せ','殺し','死ね','死ぬ','滅べ','滅ぼ','くたば','しね','ぶっ殺'];
const NG_REPLACEMENT = '「???」という不思議なお告げが届いた。誰も意味を解せなかった。';

/* お告げ入力のサジェスト */
const ORACLE_SUGGESTIONS = ['畑を耕せ','敵に備えよ','少し休め','祈りを捧げよ','土地を広げろ','旅人と交易せよ','規律を守れ'];

/* ---------- 解釈セリフのテンプレート（7-1 ⑤） ---------- */
const INTERPRET_LINES = {
  frontier:   ['{n}は「{o}」を、森の奥へ道を拓けという意味に受け取った。','{n}は荷をまとめ、まだ見ぬ土地へ足を向けた。'],
  production: ['{n}は「{o}」を、糧を蓄えよという意味に受け取った。','{n}は土に手を入れ、実りの支度を始めた。'],
  combat:     ['{n}は「{o}」を、見張りの強化と受け取った。','{n}は武具の手入れを始め、村に緊張が走った。'],
  faith:      ['{n}は「{o}」を、祈りの場を整えよという意味に受け取った。','{n}は小さな祭壇に火を灯した。'],
  commerce:   ['{n}は「{o}」を、蓄えを回せという意味に受け取った。','{n}は手持ちの品を並べ、算段を始めた。'],
  rest:       ['{n}は「{o}」を、肩の力を抜けという意味に受け取った。','{n}はようやく腰を下ろした。'],
  discipline: ['{n}は「{o}」を、規律を正せという意味に受け取った。','{n}は皆を集め、決まりを言い渡した。']
};

/* お告げを受け取った本人が地図の上で口にする言葉 */
const ORACLE_VOICE = {
  frontier:  ['……森の奥へ行けということか。','まだ見ぬ土地へ、ということね。'],
  production:['糧を蓄えよ、と。手を動かそう。','畑に行ってくる。'],
  combat:    ['備えろ、ということだな。','見張りを固める。'],
  faith:     ['祈れ、とおっしゃっている。','火を灯しましょう。'],
  commerce:  ['蓄えを回せ、か。算段してみる。','物々交換の相手を探そう。'],
  rest:      ['……休め、と？　しかし。','たまには、そうしましょうか。'],
  discipline:['気を引き締めろ、ということだ。','決まりを守らせよう。']
};

/* 気質による拒否・強反応のセリフ */
const REACTION_LINES = {
  refuse: {
    '臆病': '{n}は怯えて足がすくんでいる。「……戦うなんて、無理だ」',
    '怠惰': '{n}はあくびをして、聞かなかったふりをした。',
    '勤勉': '{n}は休むことを拒んだ。「まだ、やることがある」'
  },
  eager: {
    '好戦': '{n}は目を輝かせた。「ようやくだ」',
    '信心深い': '{n}は深く頭を垂れ、震える声で祈りを唱えた。',
    '好奇心旺盛':'{n}は跳ねるように駆け出した。'
  }
};

/* ---------- 奇跡（8-2） ---------- */
const MIRACLES = [
  { id:'blessed_rain', name:'恵みの雨', cost:1, icon:'🌧️',
    desc:'雨雲を呼び、村に雨を降らせる' },
  { id:'clear_sky', name:'晴天の加護', cost:1, icon:'☀️',
    desc:'雲を払い、晴れの日を続かせる' },
  { id:'warning_wind', name:'追い風の予兆', cost:2, icon:'🍃',
    desc:'風に囁き、近づく者の気配を村へ届ける' },
  { id:'thunder_wrath', name:'雷雲の怒り', cost:3, icon:'⚡',
    desc:'雷雲を寄せ、村に迫るものへ雷を落とす' },
  { id:'healing_light', name:'傷の癒し', cost:2, icon:'💠',
    desc:'傷ついた者の上に、癒しの光を落とす' },
  { id:'guiding_light', name:'導きの光', cost:3, icon:'🌟',
    desc:'遠くの旅人に光を見せ、村へ導く' },
  { id:'small_miracle', name:'小さな奇跡', cost:1, icon:'🕊️',
    desc:'ノアの前に、小さな不思議を起こす' }
];

/* ---------- 信仰石ショップ（10章・課金導線のデモ） ---------- */
const SHOP_ITEMS = [
  { id:'ad_stone',   name:'祈りを捧げる（広告デモ）', cost:0, icon:'📺', desc:'信仰石+1（60秒に1回）', cooldown:60 },
  { id:'buy_oracle', name:'お告げの追加', cost:1, icon:'🗣️', desc:'お告げ回数を1回分すぐ回復' },
  { id:'buy_gp',     name:'神ポイント上限+1', cost:3, icon:'🔮', desc:'貯めておける奇跡の余力が増える' },
  { id:'buy_time',   name:'時を進める（2時間）', cost:2, icon:'⏩', desc:'オフライン進行を2時間分ぶん回す' }
];

/* ---------- 建築 ---------- */
const BUILDINGS = [
  { id:'watchtower', name:'見張り台', icon:'🗼', base:30, desc:'防衛力+12%／Lv・治安の底上げ' },
  { id:'farm',       name:'畑',       icon:'🌾', base:25, desc:'食料生産+15%／Lv' },
  { id:'altar',      name:'祭壇',     icon:'⛩️', base:40, desc:'信仰生産+20%／Lv・2Lvごとに神ポイント上限+1' },
  { id:'storehouse', name:'倉庫',     icon:'📦', base:35, desc:'資源上限+150／Lv・襲撃時の被害-8%' }
];

/* ---------- 村のステージ（9章） ---------- */
const STAGES = [
  { name:'開拓期', minPop:0,  enemyBase:34,  enemyName:'飢えた獣',     threatBase:420 },
  { name:'発展期', minPop:10, enemyBase:55,  enemyName:'魔物の群れ',   threatBase:480 },
  { name:'繁栄期', minPop:30, enemyBase:120, enemyName:'盗賊団',       threatBase:540 },
  { name:'黄金期', minPop:60, enemyBase:260, enemyName:'古き者の眷属', threatBase:600 }
];

/* ---------- ランダム小イベント（未知・曖昧／平時） ---------- */
const AMBIENT_EVENTS = [
  { text:'旅の民が立ち寄り、わずかな資材を分けてくれた。', kind:'good', eff:{ materials:12 } },
  { text:'森で実の生る木を見つけた。', kind:'good', eff:{ food:15 } },
  { text:'夜半、遠くで何かの遠吠えが聞こえた。民は寝つけずにいる。', kind:'bad', eff:{ happiness:-3 } },
  { text:'ノアが変わった形の石を拾ってきた。村に小さな笑いが起きた。', kind:'good', eff:{ happiness:4 } },
  { text:'ドルンの昔話に、皆が聞き入っていた。', kind:'good', eff:{ faith:12 } },
  { text:'雨漏りの修繕に資材を使った。', kind:'bad', eff:{ materials:-8 } },
  { text:'誰かが備蓄の食料に手をつけたらしい。犯人は分からない。', kind:'bad', eff:{ food:-10, security:-4 } },
  { text:'メイアが新しい調理の仕方を思いついた。', kind:'good', eff:{ food:18, happiness:3 } }
];

/* ---------- トリガー式ストーリー（3-3） ---------- */
const STORY_EVENTS = [
  {
    id:'found', icon:'🔥', title:'焚き火のそばで',
    cond:()=>true, auto:true,
    body:
'　拠点が決まった夜、四人は小さな焚き火を囲んだ。\n\n' +
'ガイン「……ここなら、しばらくは持つ。俺が見張る。眠れ」\n' +
'メイア「あなたが倒れたら元も子もないでしょう。交代よ」\n' +
'ドルン「はは、若いのは元気でいい。……ときに、妙な感じがせんか。\n　　　　誰かに、見られているような」\n' +
'ノア「かみさまだよ。ぼく、わかるもん」\n\n' +
'　大人たちは笑った。笑って、少しだけ黙った。'
  },
  {
    id:'first_win', icon:'⚔️', title:'ガインの背中',
    body:
'　襲撃を退けた朝、ガインは一人で武具を磨いていた。\n\n' +
'ガイン「……前の村でもな、俺は見張りに立っていた。\n　　　あの日も、こうやって剣を磨いていた」\n' +
'ガイン「気づいた時には、何もかも燃えていた。誰も守れなかった」\n' +
'ガイン「だから今度は、寝ない。倒れるまでやる」\n\n' +
'　――彼に「休め」と告げるのは、たぶん、あなたにしかできない。',
    reward:{ faith:60 }, rewardText:'ガインの忠誠が深まった（信仰+60）'
  },
  {
    id:'pop5', icon:'👣', title:'よそ者の目',
    body:
'　新しくやってきた者が、村の入口で足を止めた。\n\n' +
'「妙な村だ。誰も彼も、空を見上げて話しかける」\n' +
'「……気味が悪いか？」\n' +
'「いや。……羨ましい、のかもしれん」\n\n' +
'　神を信じる村。その噂は、少しずつ森の外へ流れ始めている。',
    reward:{ faith:40, happiness:5 }, rewardText:'村の噂が広がった（信仰+40／幸福+5）'
  },
  {
    id:'faith_talk', icon:'📜', title:'ドルンの語り',
    body:
'ドルン「なあ、坊主。神さまってのはな、昔から居たわけじゃない」\n' +
'ノア「じゃあ、どこから来たの？」\n' +
'ドルン「……昔、この森の向こうに、途方もなく栄えた国があった。\n　　　そこの連中は、自分たちで神を作ろうとしたらしい」\n' +
'ドルン「うまくいったかは、知らん。残っとるのは廃墟だけだ」\n\n' +
'　老人は火を見つめたまま、それ以上は語らなかった。',
    reward:{ stones:1 }, rewardText:'ドルンが古い信仰石をくれた（信仰石+1）'
  },
  {
    id:'noah_bond', icon:'🕊️', title:'メイアとノア',
    body:
'　ノアが膝を抱えて座っている。メイアが隣に腰を下ろした。\n\n' +
'メイア「……こわい？」\n' +
'ノア「うん。みんな、いなくなっちゃうかもって」\n' +
'メイア「そうね。わたしも、こわい」\n' +
'メイア「でもね、こわいって言える相手がいるうちは、まだ大丈夫」\n\n' +
'　ノアは、ようやく少しだけ笑った。',
    reward:{ happiness:18 }, rewardText:'村の空気がやわらいだ（幸福+18）'
  },
  {
    id:'golden', icon:'🌌', title:'古き者の眷属',
    body:
'　村が「伝説」と呼ばれ始めた頃、森の奥から使者が来た。\n\n' +
'「お前たちの神は、どこから来た」\n' +
'ドルン「……やはり、お前さんたちか」\n' +
'「かつて我らも神を作った。そして、作った神に喰われた」\n' +
'「その村も、いずれ同じ道を辿る」\n\n' +
'　――あなたは、彼らにとって何なのだろう。\n　　問いは、まだ誰にも答えられない。',
    reward:{ stones:3, faith:300 }, rewardText:'黄金期の到達報酬（信仰石+3／信仰+300）'
  }
];

/* ---------- 何気ない会話（地図の上でしゃべる） ---------- */
const CHATTER = {
  gain: ['この辺りなら、まだ持ちこたえられる。','……見張りを増やしたほうがいいな。','剣の手入れは、欠かさん。',
         'メイア、無理をするな。俺がやる。','子供の前では、疲れた顔をするな。'],
  meia: ['今日の分は、なんとかなりそうよ。','ノア、そんなに走ったら転ぶわよ！','たまには笑いなさいよ、ガイン。',
         'この実、火を通せば食べられるわ。','誰かが見てる気がするの。悪い気はしないけど。'],
  noah: ['ねえねえ、あそこに何かある！','かみさま、みてる？','ぼく、大きくなったら見張りをやるんだ。',
         'ドルンじいちゃん、またお話して！','きょうの空、きれいだね。'],
  dorn: ['ふむ。風の匂いが変わったな。','昔はな、この森ももっと静かだった。','神さまってのは、案外そばにいるもんさ。',
         '若いのは元気でいい。……羨ましいわい。','この石、ずいぶん古い時代のものだぞ。'],
  temperament: {
    '勤勉':     ['手が空いてる暇はないな。','もうひと働きしてくる。'],
    '怠惰':     ['……ちょっとだけ、休んでもいいよな？','急いだって、腹は膨れないさ。'],
    '臆病':     ['夜になると、どうも落ち着かない。','無事に朝が来るといいんだが。'],
    '好戦':     ['来るなら来い。相手をしてやる。','腕が鈍っていかん。'],
    '信心深い': ['今日も、見守られている気がします。','祈りが届いているといいのですが。'],
    '飄々':     ['まあ、なんとかなるだろうよ。','世の中、そんなもんさ。'],
    '好奇心旺盛':['あっちには何があるんだろう？','ねえ、行ってみようよ！']
  },
  join: ['……ここに、置いてもらえるだろうか。','噂を聞いて来た。神がいる村だと。','しばらく世話になる。働くよ。'],
  hungry: ['腹が減った……。','食べるものが、そろそろ心もとない。'],
  happy:  ['この村、悪くないな。','ここでなら、やっていけそうだ。']
};

/* ---------- 村が自分で建てる理由（プレイヤーは決めない） ---------- */
const BUILD_REASONS = {
  watchtower: ['夜が不安だ。見張り台を建てよう。','守りが薄い。櫓を組む。'],
  farm:       ['食べる物が心もとない。畑を広げましょう。','種を蒔ける土がある。畑にするわ。'],
  altar:      ['祈る場所が要る。祭壇を築こう。','神さまに、ちゃんとした場所を。'],
  storehouse: ['置き場が足りん。倉を建てるぞ。','蓄えが溢れそうだ。倉庫がいる。']
};

/* ---------- オープニング（3-1） ---------- */
const INTRO_PAGES = [
  '　彼らは、故郷を失った。',
  '　頼れるものは、互いの温もりだけ。',
  '　……いや、ひとつだけ違う。\n\n　彼らは知らないが、\n　ひとりの神が、彼らを見ている。',
  '　あなたは、名もなき神。\n\n　命令はできない。手を貸すこともできない。\n　できるのは、言葉を降ろすことだけ。\n\n　――さあ、最初のお告げを。'
];
