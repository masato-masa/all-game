/* ===========================================================
   scene3d.js ― 神の地図（3Dジオラマ描画）
   ・world.js が持つ盤面データを、three.js のシーンに毎フレーム映す
   ・地形はタイルごとに高さを持つブロックの塊。段差には土の断面が出る
   ・見守るための画面なので、光と影にいちばん手をかけている
   =========================================================== */
'use strict';

/* タイル種別： GRASS FOREST WATER SAND ROCK RUINS HILL */
const TILE_H    = [0, 0, -0.55, -0.06, 0.9, 0.06, 0.5];
const TILE_TOP  = ['#78a955','#6f9f4e','#9d8a62','#c6b489','#8f8b85','#97897a','#80ae57'];
const TILE_SIDE = ['#9c7450','#946c48','#8d7d5a','#b5a37b','#847f79','#8f8474','#9c7450'];
const WATER_Y   = -0.18;
const GROUND_BOTTOM = -1.8;

const Scene3D = {
  ready:false,
  canvas:null, renderer:null, scene:null, camera:null, raycaster:null, pointer:null,
  sun:null, hemi:null, fireLight:null, towerLight:null,
  natureGroup:null, villageGroup:null, actorGroup:null, fxGroup:null,
  water:null, waterBase:null,
  leafSets:[],                       // 風で揺れる葉 {mesh, list, kind}
  agentObjs:{}, animalObjs:[], raiderObjs:[], birdObjs:[],
  pickTargets:[],
  pool:[], poolIdx:0,
  textCache:{}, textSprites:[],
  rings:[],
  fireMesh:null, windowMats:[], lanternMats:[],
  cam:{ az:-0.62, el:0.93, dist:11.6 },
  drag:null, dragged:false,
  _sig:'', _lastT:0, _w:0,

  /* =========================================================
     初期化
     ========================================================= */
  init(canvas, st){
    if(Scene3D.renderer) Scene3D.dispose();
    Scene3D.canvas = canvas;

    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias:true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    Scene3D.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#9fc7e8');
    scene.fog = new THREE.Fog('#9fc7e8', 15, 34);
    Scene3D.scene = scene;

    Scene3D.camera = new THREE.PerspectiveCamera(38, 2, 0.5, 90);

    /* --- 光 --- */
    const sun = new THREE.DirectionalLight('#fff2d8', 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -17; sun.shadow.camera.right = 17;
    sun.shadow.camera.top = 11;   sun.shadow.camera.bottom = -11;
    sun.shadow.camera.near = 1;   sun.shadow.camera.far = 60;
    sun.shadow.bias = -0.0016;
    sun.shadow.normalBias = 0.02;
    scene.add(sun); scene.add(sun.target);
    Scene3D.sun = sun;

    const hemi = new THREE.HemisphereLight('#a8cdea', '#6b7a52', 0.75);
    scene.add(hemi);
    Scene3D.hemi = hemi;

    const fire = new THREE.PointLight('#ff9a3c', 0, 7, 1.6);
    scene.add(fire);
    Scene3D.fireLight = fire;

    const tower = new THREE.PointLight('#ffc266', 0, 5, 1.8);
    scene.add(tower);
    Scene3D.towerLight = tower;

    /* --- グループ --- */
    Scene3D.natureGroup  = new THREE.Group();
    Scene3D.villageGroup = new THREE.Group();
    Scene3D.actorGroup   = new THREE.Group();
    Scene3D.fxGroup      = new THREE.Group();
    scene.add(Scene3D.natureGroup, Scene3D.villageGroup, Scene3D.actorGroup, Scene3D.fxGroup);

    Scene3D.raycaster = new THREE.Raycaster();
    Scene3D.pointer = new THREE.Vector2();

    Scene3D.buildHeights();
    Scene3D.buildTerrain();
    Scene3D.buildWater();
    Scene3D.buildPaths(st);
    Scene3D.buildNature();
    Scene3D.buildPool();
    Scene3D.bindCamera();

    Scene3D._sig = ''; Scene3D._lastT = World.time;
    Scene3D.ready = true;
    Scene3D.resize();
  },

  dispose(){
    if(!Scene3D.renderer) return;
    Scene3D.unbindCamera();
    Scene3D.scene.traverse(o => {
      if(o.geometry) o.geometry.dispose();
      if(o.material){
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
          if(m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
    Scene3D.renderer.dispose();
    Scene3D.renderer = null; Scene3D.scene = null; Scene3D.ready = false;
    Scene3D.agentObjs = {}; Scene3D.animalObjs = []; Scene3D.raiderObjs = [];
    Scene3D.birdObjs = []; Scene3D.pickTargets = []; Scene3D.pool = [];
    Scene3D.textCache = {}; Scene3D.textSprites = []; Scene3D.rings = [];
    Scene3D.leafSets = []; Scene3D.windowMats = []; Scene3D.lanternMats = [];
  },

  /* タイル座標 → ワールド座標 */
  wx(tx){ return tx - World.W / 2; },
  wz(ty){ return ty - World.H / 2; },
  hAt(tx, ty){
    const x = Math.floor(tx), y = Math.floor(ty);
    if(x < 0 || y < 0 || x >= World.W || y >= World.H) return -0.03;   // 地図の外の大地
    return Scene3D.heights[y * World.W + x];
  },

  /* =========================================================
     高さマップ
     地形の種別が持つ基本の高さに、ゆるやかな隆起を段（テラス）として重ねる。
     村の敷地だけは平らにならしておく（建物が斜面に浮かないように）
     ========================================================= */
  buildHeights(){
    const W = World.W, H = World.H, g = World.grid;
    const rnd = World.rng((World.st.world.seed ^ 0x2f6a1b) >>> 0);
    const STEP = 0.34;

    const blobs = [];
    for(let i = 0; i < 6; i++)
      blobs.push({ x: rnd() * W, y: rnd() * H, r: 2.4 + rnd() * 3.6, a: 0.45 + rnd() * 0.55 });

    const hs = new Float32Array(W * H);
    for(let y = 0; y < H; y++)
      for(let x = 0; x < W; x++){
        const i = y * W + x, t = g[i];
        const base = TILE_H[t];
        if(t === T.WATER || t === T.SAND){ hs[i] = base; continue; }

        let v = 0;
        blobs.forEach(b => {
          const d = Math.hypot(x - b.x, (y - b.y) * 1.3);
          if(d < b.r) v += b.a * (1 - d / b.r);
        });
        // 村のまわりは平坦に落とす
        const dv = Math.hypot(x - World.vx, (y - World.vy) * 1.25);
        if(dv < 6.2) v *= Math.max(0, (dv - 3.6) / 2.6);
        hs[i] = base + Math.round(v / STEP) * STEP;
      }
    Scene3D.heights = hs;
  },

  /* =========================================================
     地形（上面＝草や岩、側面＝土の断面）
     ========================================================= */
  buildTerrain(){
    const W = World.W, H = World.H, g = World.grid;
    const rnd = World.rng((World.st.world.seed ^ 0x5f3a17) >>> 0);
    const pos = [], col = [], idx = [];
    let vi = 0;
    const quad = (a, b, c, d, cl) => {
      pos.push(a[0],a[1],a[2], b[0],b[1],b[2], c[0],c[1],c[2], d[0],d[1],d[2]);
      for(let i = 0; i < 4; i++) col.push(cl.r, cl.g, cl.b);
      idx.push(vi, vi+1, vi+2, vi, vi+2, vi+3);
      vi += 4;
    };
    const hOut = (x, y) => (x < 0 || y < 0 || x >= W || y >= H)
      ? GROUND_BOTTOM : Scene3D.heights[y * W + x];

    const cTop = TILE_TOP.map(c => new THREE.Color(c));
    const cSide = TILE_SIDE.map(c => new THREE.Color(c));

    for(let y = 0; y < H; y++)
      for(let x = 0; x < W; x++){
        const t = g[y * W + x], h = Scene3D.heights[y * W + x];
        const X = x - W / 2, Z = y - H / 2;
        const j = 0.965 + rnd() * 0.07;
        const top = cTop[t].clone().multiplyScalar(j);
        const side = cSide[t].clone().multiplyScalar(0.94 + rnd() * 0.12);

        quad([X,h,Z], [X,h,Z+1], [X+1,h,Z+1], [X+1,h,Z], top);

        let hn;
        hn = hOut(x+1, y);
        if(h > hn) quad([X+1,h,Z], [X+1,h,Z+1], [X+1,hn,Z+1], [X+1,hn,Z], side);
        hn = hOut(x-1, y);
        if(h > hn) quad([X,h,Z+1], [X,h,Z], [X,hn,Z], [X,hn,Z+1], side);
        hn = hOut(x, y+1);
        if(h > hn) quad([X+1,h,Z+1], [X,h,Z+1], [X,hn,Z+1], [X+1,hn,Z+1], side);
        hn = hOut(x, y-1);
        if(h > hn) quad([X,h,Z], [X+1,h,Z], [X+1,hn,Z], [X,hn,Z], side);
      }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors:true }));
    mesh.receiveShadow = true; mesh.castShadow = true;
    Scene3D.natureGroup.add(mesh);
  },

  /* =========================================================
     水
     ========================================================= */
  buildWater(){
    const W = World.W, H = World.H, g = World.grid;
    const pos = [], idx = [];
    let vi = 0;
    for(let y = 0; y < H; y++)
      for(let x = 0; x < W; x++){
        if(g[y * W + x] !== T.WATER) continue;
        const X = x - W / 2, Z = y - H / 2;
        pos.push(X,WATER_Y,Z, X,WATER_Y,Z+1, X+1,WATER_Y,Z+1, X+1,WATER_Y,Z);
        idx.push(vi, vi+1, vi+2, vi, vi+2, vi+3);
        vi += 4;
      }
    if(!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshPhongMaterial({
      color:'#3f8fbe', transparent:true, opacity:0.86,
      shininess:90, specular:'#bfe4ff' });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    Scene3D.natureGroup.add(mesh);
    Scene3D.water = mesh;
    Scene3D.waterBase = Float32Array.from(geo.attributes.position.array);
  },

  /* =========================================================
     踏み分け道（村と、民が知っている土地とを結ぶ）
     ========================================================= */
  buildPaths(st){
    if(Scene3D.pathMesh){
      Scene3D.natureGroup.remove(Scene3D.pathMesh);
      Scene3D.pathMesh.geometry.dispose();
      Scene3D.pathMesh.material.dispose();
      Scene3D.pathMesh = null;
    }
    const W = World.W, H = World.H, g = World.grid;
    const mark = new Uint8Array(W * H);
    const stamp = (x, y) => {
      const xi = Math.round(x), yi = Math.round(y);
      if(xi < 0 || yi < 0 || xi >= W || yi >= H) return;
      if(g[yi * W + xi] === T.WATER) return;
      mark[yi * W + xi] = 1;
    };
    // 村の広場
    for(let dy = -1; dy <= 1; dy++)
      for(let dx = -1; dx <= 1; dx++) stamp(World.vx + dx, World.vy + dy);

    // よく通う場所（近い順に数か所）だけ、踏み分けられて道になる
    World.nodes
      .filter(n => st.world.known[n.id])
      .sort((a, b) => Math.hypot(a.x - World.vx, a.y - World.vy)
                    - Math.hypot(b.x - World.vx, b.y - World.vy))
      .slice(0, 5)
      .forEach(n => {
        const steps = Math.ceil(Math.hypot(n.x - World.vx, n.y - World.vy) * 3);
        for(let i = 0; i <= steps; i++){
          const t = i / steps;
          const bend = Math.sin(t * Math.PI) * ((n.id % 5) - 2) * 0.24;
          stamp(World.vx + (n.x - World.vx) * t - bend * 0.3,
                World.vy + (n.y - World.vy) * t + bend);
        }
      });

    const pos = [], idx = [];
    let vi = 0;
    for(let y = 0; y < H; y++)
      for(let x = 0; x < W; x++){
        if(!mark[y * W + x]) continue;
        const h = Scene3D.heights[y * W + x] + 0.012;
        const X = x - W / 2, Z = y - H / 2;
        pos.push(X,h,Z, X,h,Z+1, X+1,h,Z+1, X+1,h,Z);
        idx.push(vi, vi+1, vi+2, vi, vi+2, vi+3);
        vi += 4;
      }
    if(!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      color:'#bda87c', transparent:true, opacity:0.92 }));
    mesh.receiveShadow = true;
    Scene3D.natureGroup.add(mesh);
    Scene3D.pathMesh = mesh;
  },

  /* =========================================================
     木・岩・廃墟・草花
     ========================================================= */
  buildNature(){
    const G = Scene3D.natureGroup;
    const inst = (geo, mat, n, shadow) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.castShadow = !!shadow; m.receiveShadow = !!shadow;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      G.add(m);
      return m;
    };
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(),
          P = new THREE.Vector3(), S = new THREE.Vector3();

    /* --- 地図の外にも大地と森を続けて、世界の果てを見せない --- */
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(90, 90),
      new THREE.MeshLambertMaterial({ color:'#6e9a4c' }));
    skirt.rotation.x = -Math.PI / 2;
    skirt.position.set(0, -0.03, 0);
    skirt.receiveShadow = true;
    G.add(skirt);

    const orn = World.rng((World.st.world.seed ^ 0x77c1a3) >>> 0);
    const outer = [];
    for(let i = 0; i < 520; i++){
      const x = -14 + orn() * (World.W + 28);
      const y = -11 + orn() * (World.H + 22);
      if(x > -1.2 && x < World.W + 1.2 && y > -1.2 && y < World.H + 1.2) continue;
      outer.push({ x:x, y:y, kind: orn() < 0.5 ? 'pine' : 'round',
                   s: 0.72 + orn() * 0.55, seed: orn() * 9, tint: orn() });
    }

    /* --- 木 --- */
    const trees = World.trees.concat(outer);
    const pine = trees.filter(t => t.kind === 'pine');
    const round = trees.filter(t => t.kind !== 'pine');

    if(trees.length){
      const trunk = inst(new THREE.CylinderGeometry(0.07, 0.11, 0.52, 6),
        new THREE.MeshLambertMaterial({ color:'#6b4a30' }), trees.length, true);
      trees.forEach((t, i) => {
        const h = Scene3D.hAt(t.x, t.y);
        P.set(Scene3D.wx(t.x), h + 0.26 * t.s, Scene3D.wz(t.y));
        S.set(t.s, t.s, t.s);
        M.compose(P, Q.identity(), S);
        trunk.setMatrixAt(i, M);
      });
      trunk.instanceMatrix.needsUpdate = true;
    }

    const leafMat = k => new THREE.MeshLambertMaterial({ color: k });
    if(pine.length){
      const gm = new THREE.ConeGeometry(0.44, 1.15, 7);
      const m = inst(gm, leafMat('#3f7038'), pine.length, true);
      Scene3D.leafSets.push({ mesh:m, list:pine, yOff:1.05, tint:true });
    }
    if(round.length){
      const gm = new THREE.SphereGeometry(0.46, 7, 5);
      gm.scale(1, 0.88, 1);
      const m = inst(gm, leafMat('#4d8340'), round.length, true);
      Scene3D.leafSets.push({ mesh:m, list:round, yOff:0.86, tint:true });
    }
    /* 葉の色を一本ずつ散らす */
    Scene3D.leafSets.forEach(set => {
      const base = new THREE.Color(set.mesh.material.color.getHex());
      set.list.forEach((t, i) => {
        const c = base.clone();
        c.offsetHSL((t.tint - 0.45) * 0.11, (t.tint - 0.5) * 0.22, (t.tint - 0.42) * 0.20);
        set.mesh.setColorAt(i, c);
      });
      if(set.mesh.instanceColor) set.mesh.instanceColor.needsUpdate = true;
    });

    /* --- 岩 --- */
    if(World.rocks.length){
      const m = inst(new THREE.DodecahedronGeometry(0.24, 0),
        new THREE.MeshLambertMaterial({ color:'#8d8880', flatShading:true }), World.rocks.length, true);
      World.rocks.forEach((r, i) => {
        const h = Scene3D.hAt(r.x, r.y);
        P.set(Scene3D.wx(r.x), h + 0.11 * r.s, Scene3D.wz(r.y));
        Q.setFromEuler(new THREE.Euler(r.seed * 0.3, r.seed, r.seed * 0.2));
        S.set(r.s * (r.round ? 1 : 1.25), r.s * 0.78, r.s);
        M.compose(P, Q, S);
        m.setMatrixAt(i, M);
      });
      m.instanceMatrix.needsUpdate = true;
    }

    /* --- 廃墟 --- */
    const pillars = World.ruinParts.filter(r => r.kind === 'pillar');
    const walls   = World.ruinParts.filter(r => r.kind !== 'pillar');
    const stoneMat = new THREE.MeshLambertMaterial({ color:'#9c9488' });
    if(pillars.length){
      const m = inst(new THREE.CylinderGeometry(0.12, 0.15, 0.8, 7), stoneMat, pillars.length, true);
      pillars.forEach((r, i) => {
        const h = Scene3D.hAt(r.x, r.y);
        P.set(Scene3D.wx(r.x), h + 0.4 * r.s, Scene3D.wz(r.y));
        Q.setFromEuler(new THREE.Euler((r.seed % 1) * 0.12, r.seed, 0));
        S.set(r.s, r.s, r.s);
        M.compose(P, Q, S);
        m.setMatrixAt(i, M);
      });
      m.instanceMatrix.needsUpdate = true;
    }
    if(walls.length){
      const m = inst(new THREE.BoxGeometry(0.52, 0.38, 0.2), stoneMat, walls.length, true);
      walls.forEach((r, i) => {
        const h = Scene3D.hAt(r.x, r.y);
        P.set(Scene3D.wx(r.x), h + 0.19 * r.s, Scene3D.wz(r.y));
        Q.setFromEuler(new THREE.Euler(0, r.seed, (r.seed % 1) * 0.08));
        S.set(r.s, r.s, r.s);
        M.compose(P, Q, S);
        m.setMatrixAt(i, M);
      });
      m.instanceMatrix.needsUpdate = true;
    }

    /* --- 草むら・花・小石（影を落とさない軽い飾り） --- */
    if(World.tufts.length){
      const gm = new THREE.ConeGeometry(0.075, 0.17, 4);
      const m = inst(gm, new THREE.MeshLambertMaterial({ color:'#6f9e4e' }), World.tufts.length, false);
      World.tufts.forEach((o, i) => {
        const h = Scene3D.hAt(o.x, o.y);
        P.set(Scene3D.wx(o.x), h + 0.085 * o.s, Scene3D.wz(o.y));
        Q.setFromEuler(new THREE.Euler(0, o.x * 3.1 + o.y, 0));
        S.set(o.s, o.s * 1.15, o.s);
        M.compose(P, Q, S);
        m.setMatrixAt(i, M);
      });
      m.instanceMatrix.needsUpdate = true;
    }
    if(World.flowers.length){
      const m = inst(new THREE.SphereGeometry(0.045, 5, 4),
        new THREE.MeshLambertMaterial({ color:'#ffffff' }), World.flowers.length, false);
      World.flowers.forEach((o, i) => {
        const h = Scene3D.hAt(o.x, o.y);
        P.set(Scene3D.wx(o.x), h + 0.12, Scene3D.wz(o.y));
        M.compose(P, Q.identity(), S.set(1,1,1));
        m.setMatrixAt(i, M);
        m.setColorAt(i, new THREE.Color(o.c));
      });
      m.instanceMatrix.needsUpdate = true;
      if(m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    if(World.pebbles.length){
      const m = inst(new THREE.BoxGeometry(0.09, 0.05, 0.08),
        new THREE.MeshLambertMaterial({ color:'#9a948b' }), World.pebbles.length, false);
      World.pebbles.forEach((o, i) => {
        const h = Scene3D.hAt(o.x, o.y);
        P.set(Scene3D.wx(o.x), h + 0.025, Scene3D.wz(o.y));
        Q.setFromEuler(new THREE.Euler(0, o.x * 2.3, 0));
        M.compose(P, Q, S.set(o.s, o.s, o.s));
        m.setMatrixAt(i, M);
      });
      m.instanceMatrix.needsUpdate = true;
    }
  },

  /* =========================================================
     建物の部品
     ========================================================= */
  mat(c, opt){ return new THREE.MeshLambertMaterial(Object.assign({ color:c }, opt || {})); },

  box(w, h, d, c, x, y, z, ry){
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), Scene3D.mat(c));
    m.position.set(x, y, z);
    if(ry) m.rotation.y = ry;
    m.castShadow = true; m.receiveShadow = true;
    return m;
  },

  /** 切妻屋根（三角柱） */
  roof(w, h, d, c){
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth:d, bevelEnabled:false });
    g.translate(0, 0, -d / 2);
    const m = new THREE.Mesh(g, Scene3D.mat(c));
    m.castShadow = true; m.receiveShadow = true;
    return m;
  },

  /** 夜に光る窓 */
  window(w, h, x, y, z, ry){
    const mat = new THREE.MeshLambertMaterial({ color:'#5a4a36', emissive:'#000000' });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), mat);
    m.position.set(x, y, z);
    if(ry) m.rotation.y = ry;
    Scene3D.windowMats.push(mat);
    return m;
  },

  hut(seed, lv){
    const g = new THREE.Group();
    const roofCols = ['#a8503c','#8c5738','#7a6a52','#96543f'];
    const wallCols = ['#d6c2a0','#cbb492','#c9bb9c'];
    const rc = roofCols[Math.floor(seed) % roofCols.length];
    const wc = wallCols[Math.floor(seed * 3) % wallCols.length];

    g.add(Scene3D.box(0.82, 0.44, 0.68, wc, 0, 0.22, 0));
    // 土台の石
    g.add(Scene3D.box(0.9, 0.07, 0.76, '#9a9186', 0, 0.035, 0));
    const r = Scene3D.roof(1.0, 0.36, 0.82, rc);
    r.position.y = 0.44;
    g.add(r);
    // 棟木
    g.add(Scene3D.box(0.06, 0.05, 0.84, '#6b5540', 0, 0.80, 0));
    // 煙突
    g.add(Scene3D.box(0.11, 0.26, 0.11, '#8a7f72', 0.26, 0.72, 0.14));
    // 扉
    g.add(Scene3D.box(0.19, 0.28, 0.05, '#5c4028', 0, 0.16, 0.35));
    // 窓
    g.add(Scene3D.window(0.13, 0.12, -0.26, 0.28, 0.345));
    g.add(Scene3D.window(0.12, 0.11, 0.42, 0.28, 0.1, Math.PI / 2));
    return g;
  },

  storehouse(lv){
    const g = new THREE.Group();
    g.add(Scene3D.box(1.05, 0.5, 0.85, '#b99a70', 0, 0.25, 0));
    g.add(Scene3D.box(1.12, 0.07, 0.92, '#9a9186', 0, 0.035, 0));
    const r = Scene3D.roof(1.24, 0.34, 1.0, '#7a6146');
    r.position.y = 0.5; g.add(r);
    g.add(Scene3D.box(0.26, 0.34, 0.05, '#5c4028', 0, 0.19, 0.44));
    g.add(Scene3D.window(0.14, 0.12, -0.32, 0.34, 0.435));
    // 樽と木箱
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.22, 9),
      Scene3D.mat('#8a6a44'));
    barrel.castShadow = true; barrel.position.set(0.66, 0.11, 0.3);
    g.add(barrel);
    const b2 = barrel.clone(); b2.position.set(0.66, 0.11, 0.0); g.add(b2);
    g.add(Scene3D.box(0.24, 0.2, 0.24, '#a8905e', -0.68, 0.1, 0.22, 0.3));
    return g;
  },

  watchtower(lv){
    const g = new THREE.Group();
    const legMat = '#7a5f45';
    [[-0.22,-0.22],[0.22,-0.22],[-0.22,0.22],[0.22,0.22]].forEach(p => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 1.15, 6), Scene3D.mat(legMat));
      leg.position.set(p[0], 0.575, p[1]);
      leg.castShadow = true;
      g.add(leg);
    });
    g.add(Scene3D.box(0.5, 0.06, 0.5, '#8a6a44', 0, 0.06, 0));
    g.add(Scene3D.box(0.62, 0.07, 0.62, '#96754c', 0, 1.16, 0));
    // 手すり
    [[0,-0.29],[0,0.29]].forEach(p => g.add(Scene3D.box(0.62, 0.14, 0.05, '#7a5f45', p[0], 1.27, p[1])));
    [[-0.29,0],[0.29,0]].forEach(p => g.add(Scene3D.box(0.05, 0.14, 0.62, '#7a5f45', p[0], 1.27, p[1])));
    // 屋根
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.52, 0.34, 4), Scene3D.mat('#8c5738'));
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 1.62; roof.castShadow = true;
    g.add(roof);
    // ランタン
    const lm = new THREE.MeshLambertMaterial({ color:'#6a5330', emissive:'#000000' });
    const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.1), lm);
    lantern.position.set(0.2, 1.36, 0.2);
    Scene3D.lanternMats.push(lm);
    g.add(lantern);
    // 梯子
    const lad = Scene3D.box(0.16, 1.1, 0.04, '#6b5540', 0, 0.58, -0.34);
    lad.rotation.x = -0.12;
    g.add(lad);
    return g;
  },

  altar(lv){
    const g = new THREE.Group();
    g.add(Scene3D.box(0.86, 0.1, 0.86, '#a9a396', 0, 0.05, 0));
    g.add(Scene3D.box(0.7, 0.1, 0.7, '#b5ae9f', 0, 0.15, 0));
    g.add(Scene3D.box(0.34, 0.26, 0.34, '#c2bbaa', 0, 0.33, 0));
    // 鳥居のような門
    const pole = c => new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.78, 7), Scene3D.mat(c));
    const p1 = pole('#9c6a4a'); p1.position.set(-0.34, 0.39, -0.3); p1.castShadow = true;
    const p2 = pole('#9c6a4a'); p2.position.set(0.34, 0.39, -0.3); p2.castShadow = true;
    g.add(p1, p2);
    g.add(Scene3D.box(0.86, 0.06, 0.08, '#a8724e', 0, 0.79, -0.3));
    g.add(Scene3D.box(0.7, 0.05, 0.07, '#8f6242', 0, 0.66, -0.3));
    // 供物と灯明
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.06, 8), Scene3D.mat('#c9a227'));
    bowl.position.set(0, 0.49, 0.02);
    g.add(bowl);
    if(lv >= 2){
      const lm = new THREE.MeshLambertMaterial({ color:'#d8c07a', emissive:'#3a2a00' });
      [-0.3, 0.3].forEach(x => {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.16, 7), lm);
        c.position.set(x, 0.28, 0.3);
        g.add(c);
      });
      Scene3D.lanternMats.push(lm);
    }
    return g;
  },

  well(){
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.26, 12), Scene3D.mat('#9a938a'));
    ring.position.y = 0.13; ring.castShadow = true; ring.receiveShadow = true;
    g.add(ring);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 12),
      new THREE.MeshPhongMaterial({ color:'#3f7fa8', shininess:80 }));
    water.position.y = 0.24;
    g.add(water);
    [-0.26, 0.26].forEach(x => g.add(Scene3D.box(0.05, 0.42, 0.05, '#7a5f45', x, 0.47, 0)));
    const r = Scene3D.roof(0.72, 0.22, 0.5, '#8c5738');
    r.position.y = 0.68; g.add(r);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.5, 6), Scene3D.mat('#6b5540'));
    bar.rotation.z = Math.PI / 2; bar.position.y = 0.6;
    g.add(bar);
    g.add(Scene3D.box(0.11, 0.11, 0.11, '#8a6a44', 0, 0.42, 0));
    return g;
  },

  farm(lv){
    const g = new THREE.Group();
    const rows = 5, w = 1.5, d = 1.15;
    g.add(Scene3D.box(w + 0.1, 0.05, d + 0.1, '#7d6144', 0, 0.025, 0));
    for(let i = 0; i < rows; i++){
      const z = -d / 2 + 0.14 + i * (d - 0.2) / (rows - 1);
      g.add(Scene3D.box(w - 0.1, 0.07, 0.11, '#5f4126', 0, 0.075, z));
      const n = 5 + Math.min(3, lv);
      for(let j = 0; j < n; j++){
        const x = -w / 2 + 0.16 + j * (w - 0.32) / (n - 1);
        const tall = 0.1 + (lv > 1 ? 0.06 : 0);
        const c = lv >= 3 ? '#d8c368' : '#7ba84e';
        const crop = Scene3D.box(0.06, tall, 0.06, c, x, 0.11 + tall / 2, z);
        g.add(crop);
      }
    }
    // 柵
    const fw = w + 0.26, fd = d + 0.26;
    for(let i = 0; i < 7; i++){
      const x = -fw / 2 + i * fw / 6;
      g.add(Scene3D.box(0.035, 0.24, 0.035, '#8a6a44', x, 0.12, -fd / 2));
      g.add(Scene3D.box(0.035, 0.24, 0.035, '#8a6a44', x, 0.12, fd / 2));
    }
    for(let i = 0; i < 5; i++){
      const z = -fd / 2 + i * fd / 4;
      g.add(Scene3D.box(0.035, 0.24, 0.035, '#8a6a44', -fw / 2, 0.12, z));
      g.add(Scene3D.box(0.035, 0.24, 0.035, '#8a6a44', fw / 2, 0.12, z));
    }
    g.add(Scene3D.box(fw, 0.03, 0.03, '#96754c', 0, 0.2, -fd / 2));
    g.add(Scene3D.box(fw, 0.03, 0.03, '#96754c', 0, 0.2, fd / 2));
    g.add(Scene3D.box(0.03, 0.03, fd, '#96754c', -fw / 2, 0.2, 0));
    g.add(Scene3D.box(0.03, 0.03, fd, '#96754c', fw / 2, 0.2, 0));

    // かかし
    const s = new THREE.Group();
    s.add(Scene3D.box(0.04, 0.5, 0.04, '#7a5f45', 0, 0.25, 0));
    s.add(Scene3D.box(0.42, 0.04, 0.04, '#7a5f45', 0, 0.4, 0));
    s.add(Scene3D.box(0.13, 0.13, 0.13, '#d8c08a', 0, 0.54, 0));
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.1, 7), Scene3D.mat('#b08a4a'));
    hat.position.y = 0.64; s.add(hat);
    s.position.set(w / 2 - 0.1, 0, -d / 2 - 0.05);
    g.add(s);
    return g;
  },

  buildSite(){
    const g = new THREE.Group();
    g.add(Scene3D.box(0.8, 0.06, 0.7, '#7d6144', 0, 0.03, 0));
    [[-0.34,-0.29],[0.34,-0.29],[-0.34,0.29],[0.34,0.29]].forEach(p => {
      g.add(Scene3D.box(0.05, 0.6, 0.05, '#9a7a4e', p[0], 0.3, p[1]));
    });
    g.add(Scene3D.box(0.78, 0.04, 0.05, '#9a7a4e', 0, 0.4, -0.29));
    g.add(Scene3D.box(0.78, 0.04, 0.05, '#9a7a4e', 0, 0.55, 0.29));
    // 資材
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.5, 7), Scene3D.mat('#8a6a44'));
    log.rotation.z = Math.PI / 2; log.position.set(0.1, 0.09, 0.12); log.castShadow = true;
    g.add(log);
    const l2 = log.clone(); l2.position.set(0.1, 0.09, 0.0); g.add(l2);
    const l3 = log.clone(); l3.position.set(0.1, 0.2, 0.06); g.add(l3);
    return g;
  },

  campfire(){
    const g = new THREE.Group();
    // 石の輪
    for(let i = 0; i < 9; i++){
      const a = i / 9 * Math.PI * 2;
      const s = Scene3D.box(0.11, 0.09, 0.11, '#8f8a82',
        Math.cos(a) * 0.28, 0.045, Math.sin(a) * 0.28, a);
      g.add(s);
    }
    // 薪
    [0.5, -0.5, 1.4].forEach((r, i) => {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 6), Scene3D.mat('#6b4a30'));
      w.rotation.set(Math.PI / 2 - 0.35, r, 0);
      w.position.y = 0.07;
      w.castShadow = true;
      g.add(w);
    });
    // 炎
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 7),
      new THREE.MeshBasicMaterial({ color:'#ff9430', transparent:true, opacity:0.92 }));
    flame.position.y = 0.28;
    g.add(flame);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.24, 6),
      new THREE.MeshBasicMaterial({ color:'#ffdc7a' }));
    inner.position.y = 0.22;
    g.add(inner);
    Scene3D.fireMesh = { outer:flame, inner:inner };
    return g;
  },

  /* =========================================================
     村（人口や建物のレベルが変わったときだけ組み直す）
     ========================================================= */
  buildVillage(st){
    const G = Scene3D.villageGroup;
    while(G.children.length){
      const c = G.children.pop();
      c.traverse(o => {
        if(o.geometry) o.geometry.dispose();
        if(o.material && o.material.dispose) o.material.dispose();
      });
    }
    Scene3D.windowMats = []; Scene3D.lanternMats = []; Scene3D.fireMesh = null;

    const S = World.slots, B = st.buildings;
    const vx = World.vx, vy = World.vy;
    const place = (obj, rx, rz, ry) => {
      const tx = vx + rx, tz = vy + rz;
      obj.position.set(Scene3D.wx(tx), Scene3D.hAt(tx, tz), Scene3D.wz(tz));
      if(ry !== undefined) obj.rotation.y = ry;
      G.add(obj);
      return obj;
    };

    const hutCount = Math.min(10, 1 + Math.floor(st.villagers.length / 2.2));
    for(let i = 0; i < hutCount; i++){
      const s = S.huts[i];
      place(Scene3D.hut(s.seed, 1), s.x, s.y, Math.atan2(-s.x, -s.y) + (s.seed % 1 - 0.5) * 0.5);
    }
    place(Scene3D.campfire(), 0, 0);
    place(Scene3D.well(), S.well.x, S.well.y);

    /* 広場の小物（暮らしの気配） */
    const props = new THREE.Group();
    props.add(Scene3D.box(0.22, 0.2, 0.22, '#a8905e', 1.15, 0.1, 1.0, 0.4));
    props.add(Scene3D.box(0.2, 0.18, 0.2, '#9c8454', 1.32, 0.09, 0.72, -0.2));
    props.add(Scene3D.box(0.22, 0.16, 0.22, '#a8905e', 1.2, 0.28, 1.02, 0.15));
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 9), Scene3D.mat('#8a6a44'));
    barrel.position.set(-1.5, 0.1, -0.9); barrel.castShadow = true;
    props.add(barrel);
    // 干し草
    const hay = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.24, 10), Scene3D.mat('#c9ad5e'));
    hay.rotation.z = Math.PI / 2;
    hay.position.set(-1.75, 0.17, 0.95); hay.castShadow = true;
    props.add(hay);
    // 洗濯物を干す竿
    [-0.06, 0.06].forEach(o => props.add(Scene3D.box(0.04, 0.44, 0.04, '#7a5f45', 1.9 + o * 6, 0.22, -1.5)));
    props.add(Scene3D.box(0.03, 0.03, 0.76, '#7a5f45', 1.9, 0.42, -1.5));
    ['#d8cbb2','#9fb6c8','#c8a89a'].forEach((c, i) =>
      props.add(Scene3D.box(0.02, 0.16, 0.14, c, 1.9, 0.33, -1.75 + i * 0.25)));
    props.traverse(o => { if(o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
    place(props, 0, 0);
    if(B.altar > 0)      place(Scene3D.altar(B.altar), S.altar.x, S.altar.y, 0.1);
    if(B.watchtower > 0) place(Scene3D.watchtower(B.watchtower), S.tower.x, S.tower.y);
    if(B.storehouse > 0) place(Scene3D.storehouse(B.storehouse), S.store.x, S.store.y, -0.35);
    if(B.farm > 0)       place(Scene3D.farm(B.farm), S.farm.x, S.farm.y, 0.12);
    if(st.building)      place(Scene3D.buildSite(), S.site.x, S.site.y);

    // 焚き火の光の位置
    Scene3D.fireLight.position.set(Scene3D.wx(vx), Scene3D.hAt(vx, vy) + 0.45, Scene3D.wz(vy));
    if(B.watchtower > 0)
      Scene3D.towerLight.position.set(
        Scene3D.wx(vx + S.tower.x + 0.2), Scene3D.hAt(vx + S.tower.x, vy + S.tower.y) + 1.36,
        Scene3D.wz(vy + S.tower.y + 0.2));
  },

  /* =========================================================
     人・動物
     ========================================================= */
  limb(w, h, d, c, pivotY){
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, -h / 2, 0);                 // 上端を回転の軸にする
    const m = new THREE.Mesh(g, Scene3D.mat(c));
    m.position.y = pivotY;
    m.castShadow = true;
    return m;
  },

  makeVillager(look, dark){
    const g = new THREE.Group();
    const skin  = dark ? '#8d7a72' : (look.skin  || '#e8c39c');
    const hair  = dark ? '#241c1c' : (look.hair  || '#3a2a20');
    const cloth = dark ? '#3d3038' : (look.cloth || '#6a5a48');
    const trouser = dark ? '#2c2429' : '#4a3728';

    const legL = Scene3D.limb(0.058, 0.2, 0.062, trouser, 0.2);
    const legR = Scene3D.limb(0.058, 0.2, 0.062, trouser, 0.2);
    legL.position.x = -0.037; legR.position.x = 0.037;

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.1), Scene3D.mat(cloth));
    torso.position.y = 0.3; torso.castShadow = true;

    const armL = Scene3D.limb(0.045, 0.18, 0.05, cloth, 0.385);
    const armR = Scene3D.limb(0.045, 0.18, 0.05, cloth, 0.385);
    armL.position.x = -0.098; armR.position.x = 0.098;

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.125, 0.12), Scene3D.mat(skin));
    head.position.y = 0.465; head.castShadow = true;

    const hairM = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.055, 0.13), Scene3D.mat(hair));
    hairM.position.y = 0.535;

    const picker = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.66, 0.42),
      new THREE.MeshBasicMaterial({ visible:false }));
    picker.position.y = 0.33;

    g.add(legL, legR, torso, armL, armR, head, hairM, picker);
    g.scale.setScalar(1.18);
    return { group:g, legL, legR, torso, armL, armR, head, hair:hairM, picker, tool:null, carry:null, yaw:0 };
  },

  tool(kind){
    const g = new THREE.Group();
    if(kind === 'axe'){
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 5), Scene3D.mat('#6b4a30'));
      h.position.y = -0.12; g.add(h);
      g.add(Scene3D.box(0.09, 0.08, 0.03, '#b8bcc0', 0.03, -0.25, 0));
    }else if(kind === 'hammer'){
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.24, 5), Scene3D.mat('#6b4a30'));
      h.position.y = -0.1; g.add(h);
      g.add(Scene3D.box(0.08, 0.06, 0.06, '#8d8880', 0, -0.21, 0));
    }else if(kind === 'spear'){
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.52, 5), Scene3D.mat('#7a5f45'));
      h.position.y = -0.16; g.add(h);
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.09, 5), Scene3D.mat('#c2c6ca'));
      t.position.y = 0.14; g.add(t);
    }else if(kind === 'basket'){
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.1, 8), Scene3D.mat('#b08a4a'));
      b.position.y = -0.16; g.add(b);
    }else if(kind === 'bucket'){
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.1, 8), Scene3D.mat('#7a6a55'));
      b.position.y = -0.17; g.add(b);
    }else if(kind === 'sack'){
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.075, 6, 5), Scene3D.mat('#a8905e'));
      b.position.y = -0.16; g.add(b);
    }else return null;
    g.traverse(o => { if(o.isMesh) o.castShadow = true; });
    return g;
  },

  makeChicken(){
    const g = new THREE.Group();
    g.add(Scene3D.box(0.1, 0.09, 0.13, '#f0ece2', 0, 0.07, 0));
    g.add(Scene3D.box(0.07, 0.07, 0.06, '#f6f2ea', 0, 0.15, 0.07));
    g.add(Scene3D.box(0.03, 0.03, 0.03, '#e8a33c', 0, 0.14, 0.115));
    g.add(Scene3D.box(0.02, 0.04, 0.05, '#d0503c', 0, 0.2, 0.06));
    return { group:g };
  },

  makeDog(){
    const g = new THREE.Group();
    g.add(Scene3D.box(0.11, 0.1, 0.22, '#a87a4e', 0, 0.13, 0));
    g.add(Scene3D.box(0.09, 0.09, 0.09, '#b8875a', 0, 0.2, 0.14));
    g.add(Scene3D.box(0.03, 0.05, 0.02, '#8a6440', -0.03, 0.26, 0.13));
    g.add(Scene3D.box(0.03, 0.05, 0.02, '#8a6440', 0.03, 0.26, 0.13));
    const tail = Scene3D.box(0.025, 0.11, 0.025, '#a87a4e', 0, 0.2, -0.11);
    tail.rotation.x = 0.5;
    g.add(tail);
    [[-0.04,0.08],[0.04,0.08],[-0.04,-0.07],[0.04,-0.07]].forEach(p =>
      g.add(Scene3D.box(0.03, 0.09, 0.03, '#96693f', p[0], 0.045, p[1])));
    return { group:g, tail:tail };
  },

  /* =========================================================
     粒（スプライトのプール）
     ========================================================= */
  dotTexture(){
    if(Scene3D._dotTex) return Scene3D._dotTex;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.75)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
    Scene3D._dotTex = new THREE.CanvasTexture(cv);
    return Scene3D._dotTex;
  },

  buildPool(){
    const tex = Scene3D.dotTexture();
    for(let i = 0; i < 260; i++){
      const m = new THREE.SpriteMaterial({ map:tex, transparent:true, depthWrite:false });
      const s = new THREE.Sprite(m);
      s.visible = false;
      Scene3D.fxGroup.add(s);
      Scene3D.pool.push(s);
    }
  },

  /** plain = true なら枠なしの浮き文字（zzz や ＋ の表示に使う） */
  textTexture(txt, plain){
    const key = (plain ? 'p:' : 'b:') + txt;
    if(Scene3D.textCache[key]) return Scene3D.textCache[key];
    const cv = document.createElement('canvas');
    const pad = plain ? 10 : 16, fs = 34;
    const tmp = cv.getContext('2d');
    tmp.font = `600 ${fs}px "Zen Kaku Gothic New", sans-serif`;
    const w = Math.ceil(tmp.measureText(txt).width) + pad * 2;
    cv.width = w; cv.height = fs + pad * 2;
    const c = cv.getContext('2d');
    c.font = `600 ${fs}px "Zen Kaku Gothic New", sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';

    if(!plain){
      const r = 14;
      c.fillStyle = 'rgba(18,14,26,.88)';
      c.beginPath();
      c.moveTo(r, 0); c.lineTo(cv.width - r, 0);
      c.quadraticCurveTo(cv.width, 0, cv.width, r);
      c.lineTo(cv.width, cv.height - r);
      c.quadraticCurveTo(cv.width, cv.height, cv.width - r, cv.height);
      c.lineTo(r, cv.height);
      c.quadraticCurveTo(0, cv.height, 0, cv.height - r);
      c.lineTo(0, r);
      c.quadraticCurveTo(0, 0, r, 0);
      c.fill();
      c.strokeStyle = 'rgba(232,201,106,.55)'; c.lineWidth = 2.5; c.stroke();
    }else{
      c.strokeStyle = 'rgba(20,16,28,.85)'; c.lineWidth = 5;
      c.lineJoin = 'round';
      c.strokeText(txt, cv.width / 2, cv.height / 2 + 1);
    }
    c.fillStyle = '#f4ecd6';
    c.fillText(txt, cv.width / 2, cv.height / 2 + 1);
    const t = new THREE.CanvasTexture(cv);
    Scene3D.textCache[key] = { tex:t, w:cv.width, h:cv.height };
    return Scene3D.textCache[key];
  },

  getTextSprite(){
    for(const s of Scene3D.textSprites) if(!s.visible) return s;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent:true, depthWrite:false, depthTest:false }));
    s.renderOrder = 10;
    Scene3D.fxGroup.add(s);
    Scene3D.textSprites.push(s);
    return s;
  },

  /* =========================================================
     カメラ操作
     ========================================================= */
  bindCamera(){
    const cv = Scene3D.canvas;
    const down = e => {
      Scene3D.drag = { x:e.clientX, y:e.clientY, az:Scene3D.cam.az, el:Scene3D.cam.el, moved:0 };
      Scene3D.dragged = false;
    };
    const move = e => {
      const d = Scene3D.drag;
      if(!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.moved = Math.max(d.moved, Math.abs(dx) + Math.abs(dy));
      if(d.moved > 4) Scene3D.dragged = true;
      Scene3D.cam.az = d.az - dx * 0.006;
      Scene3D.cam.el = Math.max(0.42, Math.min(1.36, d.el + dy * 0.005));
    };
    const up = () => {
      if(Scene3D.drag){
        const moved = Scene3D.drag.moved;
        Scene3D.drag = null;
        setTimeout(() => { if(moved <= 4) Scene3D.dragged = false; }, 0);
      }
    };
    const wheel = e => {
      e.preventDefault();
      Scene3D.cam.dist = Math.max(9, Math.min(34, Scene3D.cam.dist + Math.sign(e.deltaY) * 1.3));
    };
    Scene3D._h = { down, move, up, wheel };
    cv.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    cv.addEventListener('wheel', wheel, { passive:false });
  },

  unbindCamera(){
    const h = Scene3D._h;
    if(!h || !Scene3D.canvas) return;
    Scene3D.canvas.removeEventListener('pointerdown', h.down);
    window.removeEventListener('pointermove', h.move);
    window.removeEventListener('pointerup', h.up);
    Scene3D.canvas.removeEventListener('wheel', h.wheel);
    Scene3D._h = null;
  },

  pickAgent(ev){
    if(!Scene3D.ready || !Scene3D.pickTargets.length) return null;
    const r = Scene3D.canvas.getBoundingClientRect();
    Scene3D.pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    Scene3D.pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    Scene3D.raycaster.setFromCamera(Scene3D.pointer, Scene3D.camera);
    const hit = Scene3D.raycaster.intersectObjects(Scene3D.pickTargets, false)[0];
    return hit ? World.agentOf(hit.object.userData.uid) : null;
  },

  resize(){
    const cv = Scene3D.canvas;
    const w = Math.max(320, cv.clientWidth || cv.parentElement.clientWidth || 900);
    if(w === Scene3D._w) return;
    Scene3D._w = w;
    const h = Math.round(w * 0.5);
    Scene3D.renderer.setSize(w, h, false);
    Scene3D.camera.aspect = w / h;
    Scene3D.camera.updateProjectionMatrix();
  },

  /* =========================================================
     昼夜
     ========================================================= */
  SKY: [
    { p:0.00, sun:'#ffb478', si:2.0, sky:'#f2b48c', gnd:'#7d6a52', bg:'#eab087', amb:0.40 },
    { p:0.10, sun:'#fff6e6', si:3.1, sky:'#a8cdea', gnd:'#84906a', bg:'#a9cfe8', amb:0.52 },
    { p:0.38, sun:'#fff2d8', si:3.0, sky:'#9fc7e8', gnd:'#84906a', bg:'#9fc7e8', amb:0.50 },
    { p:0.48, sun:'#ff8f52', si:2.2, sky:'#e79a70', gnd:'#6a5a48', bg:'#e08a5a', amb:0.38 },
    { p:0.58, sun:'#8a76bc', si:0.62, sky:'#4d4a86', gnd:'#33344f', bg:'#443d6b', amb:0.26 },
    { p:0.70, sun:'#7d9ce6', si:0.46, sky:'#22305e', gnd:'#151c33', bg:'#121834', amb:0.15 },
    { p:0.90, sun:'#7d9ce6', si:0.46, sky:'#22305e', gnd:'#151c33', bg:'#121834', amb:0.15 },
    { p:1.00, sun:'#ffb478', si:2.0, sky:'#f2b48c', gnd:'#7d6a52', bg:'#eab087', amb:0.40 }
  ],

  updateLight(st){
    const p = World.dayPhase(st).p;
    const K = Scene3D.SKY;
    let i = 0;
    while(i < K.length - 2 && p > K[i + 1].p) i++;
    const a = K[i], b = K[i + 1];
    const t = Math.max(0, Math.min(1, (p - a.p) / (b.p - a.p || 1)));
    const mix = (c1, c2) => new THREE.Color(c1).lerp(new THREE.Color(c2), t);

    Scene3D.sun.color = mix(a.sun, b.sun);
    Scene3D.sun.intensity = a.si + (b.si - a.si) * t;
    Scene3D.hemi.color = mix(a.sky, b.sky);
    Scene3D.hemi.groundColor = mix(a.gnd, b.gnd);
    Scene3D.hemi.intensity = a.amb + (b.amb - a.amb) * t;
    const bg = mix(a.bg, b.bg);
    Scene3D.scene.background = bg;
    Scene3D.scene.fog.color = bg;

    // 太陽は空を巡り、影の向きが一日でゆっくり回る
    const ang = p * Math.PI * 2 - Math.PI / 2;
    const night = World.dayPhase(st).night;
    const high = night ? 11 : 8 + 13 * Math.max(0.12, Math.sin(Math.min(1, p / 0.56) * Math.PI));
    Scene3D.sun.position.set(Math.cos(ang) * 14, high, Math.sin(ang) * 10);
    Scene3D.sun.target.position.set(0, 0, 0);

    // 夜は焚き火と灯りが主役になる
    const fl = night ? 2.6 : (p < 0.08 || p > 0.9 ? 1.0 : 0.35);
    Scene3D.fireLight.intensity = fl * (0.86 + Math.sin(World.time * 9) * 0.1 + Math.sin(World.time * 3.7) * 0.06);
    Scene3D.towerLight.intensity = night ? 1.5 : 0;

    const lit = night || p < 0.06 || p > 0.92;
    Scene3D.windowMats.forEach(m => m.emissive.set(lit ? '#ffb954' : '#000000'));
    Scene3D.lanternMats.forEach(m => m.emissive.set(lit ? '#ffc266' : '#241a00'));
    return night;
  },

  /* =========================================================
     毎フレーム
     ========================================================= */
  render(st){
    if(!Scene3D.ready) return;
    Scene3D.resize();

    const dt = Math.max(0, Math.min(0.12, World.time - Scene3D._lastT));
    Scene3D._lastT = World.time;
    const t = World.time;

    /* 村の作り直し判定 */
    const sig = st.villagers.length + '|' + st.buildings.watchtower + '|' + st.buildings.farm +
                '|' + st.buildings.altar + '|' + st.buildings.storehouse + '|' + (st.building ? 1 : 0);
    if(sig !== Scene3D._sig){ Scene3D._sig = sig; Scene3D.buildVillage(st); }

    const night = Scene3D.updateLight(st);

    // 文字（吹き出し・zzz・＋）はいったん全部隠し、この回で使うものだけ出す
    Scene3D.textSprites.forEach(s => { s.visible = false; });

    Scene3D.updateWater(t);
    Scene3D.updateTrees(t);
    Scene3D.updateAgents(st, dt, t);
    Scene3D.updateAnimals(t);
    Scene3D.updateRaiders(t);
    Scene3D.updateBirds();
    Scene3D.updateParticles(st);
    Scene3D.updateRings(dt);

    if(Scene3D.fireMesh){
      const f = 1 + Math.sin(t * 11) * 0.16 + Math.sin(t * 6.3) * 0.1;
      Scene3D.fireMesh.outer.scale.set(1, f, 1);
      Scene3D.fireMesh.inner.scale.set(1, 1 + Math.sin(t * 14 + 1) * 0.2, 1);
      Scene3D.fireMesh.outer.rotation.y = t * 1.4;
    }

    /* カメラ */
    const c = Scene3D.cam;
    const cx = Scene3D.wx(World.vx), cz = Scene3D.wz(World.vy);
    Scene3D.camera.position.set(
      cx + Math.sin(c.az) * Math.cos(c.el) * c.dist,
      Math.sin(c.el) * c.dist,
      cz + Math.cos(c.az) * Math.cos(c.el) * c.dist);
    Scene3D.camera.lookAt(cx, 0.4, cz);

    Scene3D.renderer.render(Scene3D.scene, Scene3D.camera);
  },

  updateWater(t){
    if(!Scene3D.water) return;
    const attr = Scene3D.water.geometry.attributes.position;
    const base = Scene3D.waterBase;
    for(let i = 0; i < attr.count; i++){
      const x = base[i * 3], z = base[i * 3 + 2];
      attr.array[i * 3 + 1] = base[i * 3 + 1]
        + Math.sin(x * 2.1 + t * 1.7) * 0.028
        + Math.sin(z * 1.7 - t * 1.3) * 0.026;
    }
    attr.needsUpdate = true;
  },

  updateTrees(t){
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(),
          P = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler();
    Scene3D.leafSets.forEach(set => {
      set.list.forEach((tr, i) => {
        const h = Scene3D.hAt(tr.x, tr.y);
        const sway = Math.sin(t * 1.5 + tr.seed) * 0.045 + Math.sin(t * 3.1 + tr.seed * 2) * 0.018;
        const shake = tr.shake > 0 ? Math.sin(t * 34) * tr.shake * 0.16 : 0;
        E.set(Math.sin(t * 1.2 + tr.seed * 1.7) * 0.03, tr.seed, sway + shake);
        P.set(Scene3D.wx(tr.x), h + set.yOff * tr.s, Scene3D.wz(tr.y));
        S.set(tr.s, tr.s, tr.s);
        M.compose(P, Q.setFromEuler(E), S);
        set.mesh.setMatrixAt(i, M);
      });
      set.mesh.instanceMatrix.needsUpdate = true;
    });
  },

  /* ---------- 村人 ---------- */
  updateAgents(st, dt, t){
    const alive = {};
    Scene3D.pickTargets.length = 0;

    World.agents.forEach(a => {
      alive[a.uid] = true;
      let o = Scene3D.agentObjs[a.uid];
      if(!o){
        const v = State.find(st, a.uid);
        o = Scene3D.makeVillager(a.look || (v ? Portrait.def(v) : {}), false);
        o.picker.userData.uid = a.uid;
        Scene3D.actorGroup.add(o.group);
        Scene3D.agentObjs[a.uid] = o;
      }
      Scene3D.pickTargets.push(o.picker);
      Scene3D.poseVillager(o, a, dt, t, st);
    });

    Object.keys(Scene3D.agentObjs).forEach(uid => {
      if(alive[uid]) return;
      const o = Scene3D.agentObjs[uid];
      Scene3D.actorGroup.remove(o.group);
      delete Scene3D.agentObjs[uid];
    });
  },

  poseVillager(o, a, dt, t, st){
    const g = o.group;
    const moving = a.state === 'moving' || a.state === 'returning';
    const acting = a.state === 'working';
    const sitting = a.state === 'resting' || a.task === 'fire';
    const h = Scene3D.hAt(a.x, a.y);
    const x = Scene3D.wx(a.x), z = Scene3D.wz(a.y);

    // 位置（高さは段差でカクつかないよう追従させる）
    g.position.x = x; g.position.z = z;
    const targetY = h + (sitting ? -0.06 : 0) + (moving ? Math.abs(Math.sin(a.phase)) * 0.014 : 0);
    g.position.y += (targetY - g.position.y) * Math.min(1, dt * 9) || 0;
    if(!isFinite(g.position.y)) g.position.y = targetY;

    // 向き
    let yaw = o.yaw;
    if(moving){
      const dx = a.tx - a.x, dz = a.ty - a.y;
      if(Math.abs(dx) + Math.abs(dz) > 0.02) yaw = Math.atan2(dx, dz);
    }else if(a.task === 'fire'){
      yaw = Math.atan2(World.vx - a.x, World.vy - a.y);
    }else if(a.task === 'pray'){
      const S = World.slots;
      yaw = Math.atan2(World.vx + S.altar.x - a.x, World.vy + S.altar.y - a.y);
    }
    let d = yaw - o.yaw;
    while(d > Math.PI) d -= Math.PI * 2;
    while(d < -Math.PI) d += Math.PI * 2;
    o.yaw += d * Math.min(1, dt * 8);
    g.rotation.y = o.yaw;

    // 手足
    const sw = moving ? Math.sin(a.phase) * 0.62 : Math.sin(t * 1.6 + a.phase * 0.1) * 0.04;
    if(sitting){
      o.legL.rotation.x = -1.45; o.legR.rotation.x = -1.45;
      o.legL.rotation.z = 0.12; o.legR.rotation.z = -0.12;
      o.torso.rotation.x = -0.12;
      o.armL.rotation.x = -0.55; o.armR.rotation.x = -0.55;
      o.torso.position.y = 0.16; o.head.position.y = 0.325; o.hair.position.y = 0.395;
      o.armL.position.y = 0.245; o.armR.position.y = 0.245;
    }else{
      o.legL.rotation.set(sw, 0, 0); o.legR.rotation.set(-sw, 0, 0);
      o.torso.rotation.x = a.task === 'food' && acting ? 0.5 : 0;
      o.torso.position.y = 0.3; o.head.position.y = 0.465; o.hair.position.y = 0.535;
      o.armL.position.y = 0.385; o.armR.position.y = 0.385;
      o.armL.rotation.x = -sw * 0.8;
      o.armR.rotation.x = sw * 0.8;

      if(acting){
        if(a.task === 'mat' || a.task === 'build'){
          const s = Math.sin(a.actT * 8);
          o.armR.rotation.x = -2.3 + s * 1.15;
          o.armL.rotation.x = -1.9 + s * 0.9;
        }else if(a.task === 'food'){
          o.armR.rotation.x = 0.9 + Math.sin(a.actT * 5) * 0.3;
          o.armL.rotation.x = 0.7;
        }else if(a.task === 'pray'){
          o.legL.rotation.x = -1.3; o.legR.rotation.x = -1.3;
          o.torso.position.y = 0.2; o.head.position.y = 0.365; o.hair.position.y = 0.435;
          o.armL.position.y = 0.285; o.armR.position.y = 0.285;
          o.armL.rotation.x = -1.1; o.armR.rotation.x = -1.1;
        }else if(a.task === 'water'){
          o.armR.rotation.x = -0.5 + Math.sin(a.actT * 4) * 0.4;
        }
      }
    }

    // 道具
    const def = a.task ? World.TASKS[a.task] : null;
    const want = (acting || a.task === 'patrol') && def ? def.tool : null;
    if(o.toolKind !== want){
      if(o.tool){ o.armR.remove(o.tool); o.tool = null; }
      o.toolKind = want;
      if(want){
        const tl = Scene3D.tool(want);
        if(tl){ tl.position.y = -0.17; o.armR.add(tl); o.tool = tl; }
      }
    }

    // 運んでいるもの
    if(o.carryKind !== a.carry){
      if(o.carry){ o.group.remove(o.carry); o.carry = null; }
      o.carryKind = a.carry;
      if(a.carry){
        let m;
        if(a.carry === 'log'){
          m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.46, 7), Scene3D.mat('#8a6a44'));
          m.rotation.z = Math.PI / 2; m.position.set(0, 0.47, -0.02);
        }else if(a.carry === 'bucket'){
          m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.1, 8), Scene3D.mat('#7a6a55'));
          m.position.set(0.13, 0.25, 0.02);
        }else{
          m = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.11, 8), Scene3D.mat('#b08a4a'));
          m.position.set(0, 0.45, -0.09);
        }
        m.castShadow = true;
        o.group.add(m); o.carry = m;
      }
    }

    // 吹き出し
    if(a.bubble && a.bubbleT > 0){
      const s = Scene3D.getTextSprite();
      const tx = Scene3D.textTexture(a.bubble);
      s.material.map = tx.tex; s.material.needsUpdate = true;
      const sc = 0.0040;
      s.scale.set(tx.w * sc, tx.h * sc, 1);
      s.position.set(x, g.position.y + 0.95, z);
      s.material.opacity = Math.min(1, a.bubbleT / 0.5);
      s.visible = true;
    }
  },

  /* ---------- 動物・襲撃者・鳥 ---------- */
  updateAnimals(t){
    World.animals.forEach((an, i) => {
      let o = Scene3D.animalObjs[i];
      if(!o){
        o = an.kind === 'dog' ? Scene3D.makeDog() : Scene3D.makeChicken();
        Scene3D.actorGroup.add(o.group);
        Scene3D.animalObjs[i] = o;
      }
      const h = Scene3D.hAt(an.x, an.y);
      o.group.position.set(Scene3D.wx(an.x), h + (an.moving ? Math.abs(Math.sin(an.phase)) * 0.02 : 0), Scene3D.wz(an.y));
      const dx = (an.tx || an.x) - an.x, dz = (an.ty || an.y) - an.y;
      if(an.moving && Math.abs(dx) + Math.abs(dz) > 0.01)
        o.group.rotation.y = Math.atan2(dx, dz);
      if(o.tail) o.tail.rotation.z = Math.sin(t * 9) * 0.5;
    });
  },

  updateRaiders(t){
    while(Scene3D.raiderObjs.length > World.raiders.length){
      const o = Scene3D.raiderObjs.pop();
      Scene3D.actorGroup.remove(o.group);
    }
    World.raiders.forEach((r, i) => {
      let o = Scene3D.raiderObjs[i];
      if(!o){
        o = Scene3D.makeVillager({}, true);
        o.group.scale.setScalar(1.12);
        Scene3D.actorGroup.add(o.group);
        Scene3D.raiderObjs[i] = o;
      }
      o.group.scale.setScalar(1.3);
      const h = Scene3D.hAt(r.x, r.y);
      o.group.position.set(Scene3D.wx(r.x), h, Scene3D.wz(r.y));
      o.group.rotation.y = Math.atan2(World.vx - r.x, World.vy - r.y);
      const sw = Math.sin(r.phase) * 0.6;
      o.legL.rotation.x = sw; o.legR.rotation.x = -sw;
      o.armL.rotation.x = -sw * 0.7; o.armR.rotation.x = sw * 0.7;
    });
  },

  updateBirds(){
    while(Scene3D.birdObjs.length > World.birds.length){
      const o = Scene3D.birdObjs.pop();
      Scene3D.actorGroup.remove(o);
    }
    World.birds.forEach((b, i) => {
      let o = Scene3D.birdObjs[i];
      if(!o){
        o = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.07),
          new THREE.MeshLambertMaterial({ color:'#3a3a44' }));
        Scene3D.actorGroup.add(o);
        Scene3D.birdObjs[i] = o;
      }
      o.position.set(Scene3D.wx(b.x), 3.4, Scene3D.wz(b.y));
      o.rotation.y = b.dir > 0 ? 0 : Math.PI;
      o.rotation.z = Math.sin(b.ph) * 0.5;
    });
  },

  /* ---------- 粒 ---------- */
  updateParticles(st){
    let n = 0;
    const pool = Scene3D.pool;

    World.particles.forEach(p => {
      if(p.kind === 'zzz' || p.kind === 'plus'){
        const s = Scene3D.getTextSprite();
        const tx = Scene3D.textTexture(p.kind === 'zzz' ? 'zzz' : p.txt, true);
        s.material.map = tx.tex; s.material.needsUpdate = true;
        const sc = 0.0034;
        s.scale.set(tx.w * sc, tx.h * sc, 1);
        s.position.set(Scene3D.wx(p.x), Scene3D.hAt(p.x, p.z) + p.h, Scene3D.wz(p.z));
        s.material.opacity = Math.max(0, Math.min(1, p.life / p.max));
        s.visible = true;
        return;
      }
      if(n >= pool.length) return;
      const s = pool[n++];
      const lf = Math.max(0, Math.min(1, p.life / p.max));
      let size = 0.1, col = '#ffffff', op = lf;

      switch(p.kind){
        case 'smoke':
          size = (p.r + (1 - lf) * 0.5) * 1.5; col = '#d6cfc4'; op = lf * 0.32; break;
        case 'ember':
          size = 0.055 * lf + 0.02; col = '#ffab4a'; op = lf; break;
        case 'spark':
          size = 0.07 * lf + 0.02; col = p.c || '#e8c96a'; op = lf; break;
        case 'chip':
          size = 0.05; col = p.c || '#c9a86a'; op = lf; break;
        case 'leaf':
          size = 0.07; col = p.c || '#9fd18a'; op = lf; break;
        case 'mote':
          size = 0.12 * lf + 0.03; col = '#f0dc96'; op = lf * 0.9; break;
        case 'butterfly':
          size = 0.09; col = '#f4e08a'; op = Math.min(1, lf * 4); break;
        case 'firefly':
          size = 0.1; col = '#c8ff9a';
          op = Math.min(1, lf * 4) * (0.45 + Math.sin(World.time * 4 + p.seed) * 0.45); break;
        case 'rain':
          size = 0.035; col = '#bcd8ea'; op = 0.5; break;
      }
      s.material.color.set(col);
      s.material.opacity = op;
      if(p.kind === 'rain') s.scale.set(size, size * 9, 1);
      else s.scale.set(size, size, 1);
      s.position.set(Scene3D.wx(p.x), Scene3D.hAt(p.x, p.z) + p.h, Scene3D.wz(p.z));
      s.visible = true;
    });

    for(let i = n; i < pool.length; i++) pool[i].visible = false;

    /* 戦いの余韻（広がる輪） */
    World.effects.forEach(e => {
      if(e._mesh) return;
      const geo = new THREE.RingGeometry(0.5, 0.62, 40);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: e.kind === 'win' ? '#e8c96a' : '#d0503c',
        transparent:true, opacity:0.7, side:THREE.DoubleSide, depthWrite:false }));
      m.position.set(Scene3D.wx(e.x), Scene3D.hAt(e.x, e.y) + 0.06, Scene3D.wz(e.y));
      Scene3D.fxGroup.add(m);
      e._mesh = m;
      Scene3D.rings.push({ e:e, m:m, max:e.t });
    });
  },

  updateRings(dt){
    Scene3D.rings = Scene3D.rings.filter(r => {
      const k = 1 - Math.max(0, r.e.t) / r.max;
      if(r.e.t <= 0 || World.effects.indexOf(r.e) < 0){
        Scene3D.fxGroup.remove(r.m);
        r.m.geometry.dispose(); r.m.material.dispose();
        return false;
      }
      r.m.scale.setScalar(1 + k * 7);
      r.m.material.opacity = 0.7 * (1 - k);
      return true;
    });
  }
};
