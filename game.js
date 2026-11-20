import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// ============================================================================
// CONFIG & COURTYARD CONSTANTS (CAT LASER v0.5 — PAW SANCTUARY, 16:9 Optics)
// ============================================================================
const PLAZA_HALF_X = 8.4;
const PLAZA_MIN_Z = -14.8;
const PLAZA_MAX_Z = 12.4;
const EMITTER_POS = new THREE.Vector3(0, 1.22, 13.5);
const RAMP_CENTER = new THREE.Vector3(0, 0.25, -13.6);
const ROUND_DURATION = 75;
const TOTAL_CATS = 26;
const TOTAL_GOLDEN = 3;

const REFLECTOR_GLB_CONFIG = {
  citylight: { assetKey: 'reflectorCitylight', canonW: 3.8, canonH: 2.6, posY: 1.55 },
  busstop:   { assetKey: 'reflectorBusstop',   canonW: 4.6, canonH: 2.5, posY: 1.50 },
  shopfront: { assetKey: 'reflectorShopfront', canonW: 4.8, canonH: 2.7, posY: 1.55 },
};

const LEVEL_SPEC = {
  // 4 pure-optics angled reflectors: M1->M3 and M2->M4 reflect onto PAW SANCTUARY ramp!
  mirrors: [
    { id: 'M1', type: 'shopfront', label: 'Витрина справа',    x:  8.0, z:   1.8, w: 4.8, h: 2.6, nx: -0.99, nz: 0.14 },
    { id: 'M2', type: 'citylight', label: 'Ситилайт слева',    x: -8.0, z:   1.8, w: 4.6, h: 2.6, nx:  0.99, nz: 0.14 },
    { id: 'M3', type: 'busstop',   label: 'Остановка слева',   x: -8.0, z: -10.5, w: 4.8, h: 2.5, nx:  0.989, nz: 0.149 },
    { id: 'M4', type: 'shopfront', label: 'Бутик справа',      x:  8.0, z: -10.5, w: 4.8, h: 2.6, nx: -0.989, nz: 0.149 },
  ],
  vehicles: [
    // Central Bakery Van casts optical shadow over center; two angled Taxis shield deep left/right pockets
    { kind: 'van',  x:  0.0, z:  1.5, yaw: Math.PI / 2, scale: 1.15 },
    { kind: 'taxi', x: -4.2, z: -5.8, yaw:  0.55,       scale: 1.10 },
    { kind: 'taxi', x:  4.2, z: -5.8, yaw: -0.55,       scale: 1.10 },
  ],
};

const config = {
  catSpeed: 6.4,
  patience: 2.4,
  beamScale: 1.65,
  muted: false,
};

// ============================================================================
// PROCEDURAL WEB AUDIO SYNTHESIZER
// ============================================================================
let audioCtx = null;
function ensureAudio() {
  if (config.muted) return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTone(freqStart, freqEnd, duration, type = 'sine', volume = 0.06, delay = 0) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const now = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0008, now + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

const sfx = {
  rescue: (combo = 1, isGolden = false) => {
    const p = Math.pow(1.06, Math.min(combo, 10));
    playTone(520 * p, 880 * p, 0.14, 'triangle', 0.065);
    if (isGolden) playTone(880 * p, 1360 * p, 0.22, 'triangle', 0.07, 0.08);
  },
  feint: () => {
    playTone(620, 1240, 0.12, 'triangle', 0.06);
    playTone(940, 1520, 0.14, 'sine', 0.045, 0.04);
  },
  exposed: () => {
    playTone(340, 145, 0.24, 'sawtooth', 0.055);
  },
  walkAway: () => {
    playTone(280, 170, 0.18, 'sine', 0.035);
  },
  bounceSpark: (bounces = 1) => {
    playTone(680 + bounces * 220, 1100 + bounces * 240, 0.07, 'sine', 0.035);
  },
  laserOff: () => {
    playTone(400, 220, 0.04, 'sine', 0.02);
  },
  win: () => {
    playTone(523, 659, 0.14, 'triangle', 0.075);
    playTone(659, 784, 0.14, 'triangle', 0.075, 0.10);
    playTone(784, 1046, 0.30, 'triangle', 0.085, 0.21);
  },
  lose: () => {
    playTone(330, 210, 0.18, 'sawtooth', 0.055);
    playTone(210, 120, 0.30, 'sawtooth', 0.055, 0.16);
  },
};

// ============================================================================
// THREE.JS SCENE, SUNSET SKY, TEXTURED ASPHALT & LIGHTING
// ============================================================================
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();

function createSunsetSkyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.00, '#121f35');
  grad.addColorStop(0.18, '#2d3d57');
  grad.addColorStop(0.32, '#bd673c');
  grad.addColorStop(0.41, '#f69e47');
  grad.addColorStop(0.48, '#ffe9a8');
  grad.addColorStop(0.60, '#5a3a34');
  grad.addColorStop(1.00, '#1b1f29');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  const sunGrad = ctx.createRadialGradient(256, 232, 10, 256, 232, 130);
  sunGrad.addColorStop(0.0, 'rgba(255, 253, 226, 1)');
  sunGrad.addColorStop(0.28, 'rgba(255, 206, 108, 0.90)');
  sunGrad.addColorStop(0.66, 'rgba(235, 130, 54, 0.32)');
  sunGrad.addColorStop(1.0, 'rgba(235, 130, 54, 0)');
  ctx.fillStyle = sunGrad;
  ctx.fillRect(76, 80, 360, 300);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createWetAsphaltTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, 512, 0);
  bg.addColorStop(0.0, '#1b202a');
  bg.addColorStop(0.18, '#232936');
  bg.addColorStop(0.5, '#2c3341');
  bg.addColorStop(0.82, '#232936');
  bg.addColorStop(1.0, '#1b202a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 2800; i++) {
    const x = (i * 73) % 512;
    const y = (i * 197) % 512;
    const v = 24 + ((i * 29) % 24);
    ctx.fillStyle = `rgba(${v},${v + 3},${v + 9},0.22)`;
    ctx.fillRect(x, y, 2, 2);
  }

  ctx.fillStyle = 'rgba(130, 160, 200, 0.065)';
  ctx.beginPath();
  ctx.ellipse(256, 256, 110, 215, 0, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  return tex;
}

scene.background = createSunsetSkyTexture();
scene.fog = new THREE.FogExp2(0x744634, 0.0085);

{
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(7.2, 32),
    new THREE.MeshBasicMaterial({ color: 0xffe49e, transparent: true, opacity: 0.9, fog: false })
  );
  sunDisc.position.set(0, 12.0, -58);
  scene.add(sunDisc);

  const sunHalo = new THREE.Mesh(
    new THREE.CircleGeometry(16.0, 32),
    new THREE.MeshBasicMaterial({ color: 0xffa64d, transparent: true, opacity: 0.28, fog: false, depthWrite: false })
  );
  sunHalo.position.set(0, 12.0, -58.4);
  scene.add(sunHalo);
}

const camera = new THREE.PerspectiveCamera(56, 9 / 16, 0.5, 220);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
container.appendChild(renderer.domElement);

function getPortraitZoom() {
  return Math.max(1.0, 0.5625 / Math.max(0.42, camera.aspect || 0.5625));
}

function syncViewportSize() {
  const w = Math.max(280, container.clientWidth || window.innerWidth);
  const h = Math.max(360, container.clientHeight || window.innerHeight);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 0.85 ? 56 : 46;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
syncViewportSize();

{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = createSunsetSkyTexture();
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = pmrem.fromEquirectangular(envTex).texture;
  scene.environmentIntensity = 0.76;
  envTex.dispose();
  pmrem.dispose();
}

const hemiLight = new THREE.HemisphereLight(0xa3cbf0, 0x4b3328, 1.05);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xffbd6e, 1.9);
sunLight.position.set(10, 30, -24);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 4;
sunLight.shadow.camera.far = 90;
sunLight.shadow.camera.left = -22;
sunLight.shadow.camera.right = 22;
sunLight.shadow.camera.top = 26;
sunLight.shadow.camera.bottom = -26;
sunLight.shadow.bias = -0.0007;
scene.add(sunLight);

const fillLight = new THREE.DirectionalLight(0xa2c8ff, 0.68);
fillLight.position.set(-12, 24, 22);
scene.add(fillLight);

// ============================================================================
// STATIC PLAZA FLOOR, SIDEWALKS & RESCUER VOLUNTEER WITH LASER POINTER
// ============================================================================
const floorMat = new THREE.MeshStandardMaterial({
  map: createWetAsphaltTexture(),
  roughness: 0.54,
  metalness: 0.14,
});
const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(18.5, 48), floorMat);
floorMesh.rotation.x = -Math.PI / 2;
floorMesh.position.set(0, 0, -2);
floorMesh.receiveShadow = true;
scene.add(floorMesh);

const yellowLineMat = new THREE.MeshBasicMaterial({ color: 0xf5b82e, transparent: true, opacity: 0.78 });
const whiteLineMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.45 });
[-0.17, 0.17].forEach((lx) => {
  const line = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 32), yellowLineMat);
  line.rotation.x = -Math.PI / 2;
  line.position.set(lx, 0.015, -1);
  scene.add(line);
});
for (let x = -7.2; x <= 7.21; x += 1.2) {
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.85), whiteLineMat);
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.set(x, 0.017, 9.8);
  scene.add(stripe);
}

const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x3d4350, roughness: 0.85 });
const curbMat = new THREE.MeshStandardMaterial({ color: 0x565e6e, roughness: 0.78 });
[-10.2, 10.2].forEach((sx) => {
  const sw = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 48), sidewalkMat);
  sw.position.set(sx, 0.06, -2);
  sw.receiveShadow = true;
  scene.add(sw);

  const curb = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 48), curbMat);
  curb.position.set(Math.sign(sx) * 8.5, 0.07, -2);
  curb.receiveShadow = true;
  scene.add(curb);
});

// South curb platform & Rescuer Volunteer holding articulated laser pointer
{
  const southCurb = new THREE.Mesh(new THREE.BoxGeometry(20, 0.14, 4.5), sidewalkMat);
  southCurb.position.set(0, 0.07, 14.8);
  southCurb.receiveShadow = true;
  scene.add(southCurb);
}

const emitterGroup = new THREE.Group();
emitterGroup.position.set(EMITTER_POS.x, 0.14, EMITTER_POS.z);

const volLegs = new THREE.Mesh(
  new THREE.CylinderGeometry(0.26, 0.28, 0.65, 10),
  new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 })
);
volLegs.position.y = 0.32;
volLegs.castShadow = true;

const volJacket = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.32, 0.48, 6, 12),
  new THREE.MeshStandardMaterial({ color: 0x2e8b57, roughness: 0.58 })
);
volJacket.position.y = 0.92;
volJacket.castShadow = true;

const volHead = new THREE.Mesh(
  new THREE.SphereGeometry(0.26, 12, 12),
  new THREE.MeshStandardMaterial({ color: 0xfdba74, roughness: 0.55 })
);
volHead.position.y = 1.48;
volHead.castShadow = true;

const volCap = new THREE.Mesh(
  new THREE.CylinderGeometry(0.27, 0.28, 0.12, 12),
  new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.6 })
);
volCap.position.set(0, 1.66, 0);

const pointerArm = new THREE.Group();
pointerArm.position.set(0, 1.08, 0);
const pointerWand = new THREE.Mesh(
  new THREE.CylinderGeometry(0.055, 0.065, 0.55, 10),
  new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.6, roughness: 0.3 })
);
pointerWand.rotation.x = Math.PI / 2;
pointerWand.position.z = 0.28;
const pointerTip = new THREE.Mesh(
  new THREE.SphereGeometry(0.11, 10, 10),
  new THREE.MeshBasicMaterial({ color: 0xff2442 })
);
pointerTip.position.z = 0.58;
pointerArm.add(pointerWand, pointerTip);

const emitterRing = new THREE.Mesh(
  new THREE.RingGeometry(0.55, 0.72, 24),
  new THREE.MeshBasicMaterial({ color: 0x4ade80, side: THREE.DoubleSide, transparent: true, opacity: 0.75 })
);
emitterRing.rotation.x = -Math.PI / 2;
emitterRing.position.y = 0.02;

emitterGroup.add(volLegs, volJacket, volHead, volCap, pointerArm, emitterRing);
scene.add(emitterGroup);

// ============================================================================
// DYNAMIC LEVEL CONTAINERS & ASSET LOADER
// ============================================================================
const levelGroup = new THREE.Group();
scene.add(levelGroup);

const vehicleOBBs = [];
const mirrors = [];
const cats = [];
const particles = [];
const popups = [];

const ASSETS = {};
const CAT_COAT_KEYS = ['ginger', 'calico', 'tuxedo', 'gray', 'white'];
const CAT_COAT_MATS = {};
const CAT_DISAPPOINTED_MATS = {};
const loadErrors = [];
let assetsReady = false;

function prepStaticPrototype(root, cast = true, receive = true) {
  root.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = cast;
      obj.receiveShadow = receive;
    }
  });
}

async function loadAssets() {
  const gltfLoader = new GLTFLoader();
  const texLoader = new THREE.TextureLoader();

  const glbEntries = [
    ['cat', 'assets/models/cat_base_lod1.glb'],
    ['shelter', 'assets/models/shelter_house.glb'],
    ['taxi', 'assets/models/vehicle_taxi.glb'],
    ['bakeryVan', 'assets/models/vehicle_bakery_van.glb'],
    ['bldgBrick', 'assets/models/building_brick_fireescape.glb'],
    ['bldgLimestone', 'assets/models/building_limestone_shop.glb'],
    ['bldgBrownstone', 'assets/models/building_brownstone_cafe.glb'],
    ['lamp', 'assets/models/prop_streetlamp.glb'],
    ['tree', 'assets/models/prop_fairytree.glb'],
    ['hydrant', 'assets/models/prop_firehydrant.glb'],
    ['reflectorCitylight', 'assets/models/citylight_screen.glb'],
    ['reflectorShopfront', 'assets/models/closed_shopfront.glb'],
    ['reflectorBusstop', 'assets/models/busstop_glass.glb'],
  ];

  const coatEntries = [
    ['calico', 'assets/textures/cat_calico_albedo.png'],
    ['tuxedo', 'assets/textures/cat_tuxedo_albedo.png'],
    ['gray', 'assets/textures/cat_gray_albedo.png'],
    ['white', 'assets/textures/cat_white_albedo.png'],
    ['golden', 'assets/textures/cat_golden_albedo.png'],
  ];

  const [loadedGlbs, loadedCoats] = await Promise.all([
    Promise.all(
      glbEntries.map(([key, url]) =>
        gltfLoader.loadAsync(url).then((g) => [key, g]).catch((err) => {
          loadErrors.push(`${url}: ${err.message}`);
          throw err;
        })
      )
    ),
    Promise.all(
      coatEntries.map(([key, url]) =>
        texLoader.loadAsync(url).then((tex) => {
          tex.flipY = false;
          tex.colorSpace = THREE.SRGBColorSpace;
          return [key, tex];
        }).catch((err) => {
          loadErrors.push(`${url}: ${err.message}`);
          throw err;
        })
      )
    ),
  ]);

  for (const [key, g] of loadedGlbs) {
    ASSETS[key] = g;
    if (key !== 'cat') prepStaticPrototype(g.scene, true, true);
  }
  const coatTexMap = Object.fromEntries(loadedCoats);

  let baseBodyMat = null;
  ASSETS.cat.scene.traverse((obj) => {
    if (obj.isMesh && obj.name.includes('Cat_Body')) {
      baseBodyMat = obj.material;
    }
  });

  if (baseBodyMat) {
    for (const key of [...CAT_COAT_KEYS, 'golden']) {
      const mat = baseBodyMat.clone();
      if (key !== 'ginger' && coatTexMap[key]) {
        mat.map = coatTexMap[key];
      }
      if (key === 'golden') {
        mat.roughness = 0.38;
        mat.metalness = 0.28;
        mat.emissive = new THREE.Color(0x9a6700);
        mat.emissiveIntensity = 0.22;
      }
      mat.needsUpdate = true;
      CAT_COAT_MATS[key] = mat;

      const disMat = mat.clone();
      disMat.color = new THREE.Color(0x524864);
      disMat.emissive = new THREE.Color(0x000000);
      disMat.emissiveIntensity = 0;
      disMat.needsUpdate = true;
      CAT_DISAPPOINTED_MATS[key] = disMat;
    }
  }

  assetsReady = true;
}

// ============================================================================
// REFLECTOR GLASS MATERIALS & HUGE PAW SANCTUARY RESCUE TRUCK
// ============================================================================
function createDarkGlossTexture(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, 256, 256);
  bg.addColorStop(0.0, '#050c16');
  bg.addColorStop(0.55, '#0b1a2a');
  bg.addColorStop(1.0, '#132c42');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 256);

  ctx.save();
  ctx.translate(128, 128);
  ctx.rotate(-0.55);
  const s1 = ctx.createLinearGradient(-180, -30, 180, 30);
  s1.addColorStop(0, 'rgba(56, 232, 255, 0)');
  s1.addColorStop(0.45, 'rgba(125, 211, 252, 0.16)');
  s1.addColorStop(0.52, 'rgba(255, 212, 155, 0.18)');
  s1.addColorStop(0.65, 'rgba(56, 232, 255, 0)');
  ctx.fillStyle = s1;
  ctx.fillRect(-200, -40, 400, 28);
  ctx.restore();

  if (kind === 'shopfront' || kind === 'busstop') {
    ctx.strokeStyle = 'rgba(148, 197, 233, 0.14)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(85, 0);
    ctx.lineTo(85, 256);
    ctx.moveTo(171, 0);
    ctx.lineTo(171, 256);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createReflectiveSurfaceMat(kind) {
  return new THREE.MeshPhysicalMaterial({
    map: createDarkGlossTexture(kind),
    color: 0x527a9c,
    emissive: new THREE.Color(0x0ea5e9),
    emissiveIntensity: 0.06,
    roughness: 0.05,
    metalness: 0.90,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    envMapIntensity: 0.96,
    side: THREE.DoubleSide,
  });
}

function createReflector(r) {
  const normal = new THREE.Vector3(r.nx, 0, r.nz).normalize();
  const tangent = new THREE.Vector3(normal.z, 0, -normal.x).normalize();
  const group = new THREE.Group();
  group.position.set(r.x, 0.12, r.z);
  group.rotation.y = Math.atan2(normal.x, normal.z);

  const cfg = REFLECTOR_GLB_CONFIG[r.type] || REFLECTOR_GLB_CONFIG.shopfront;
  const proto = ASSETS[cfg.assetKey]?.scene;
  let face = null;
  let faceMat = null;
  let accentMat = null;

  if (proto) {
    const model = proto.clone(true);
    const sx = r.w / cfg.canonW;
    const sy = r.h / cfg.canonH;
    model.scale.set(sx, sy, Math.min(sx, sy));
    group.add(model);

    model.traverse((obj) => {
      if (!obj.isMesh) return;
      const name = obj.name || '';
      if (name.endsWith('_Glass')) {
        face = obj;
        faceMat = createReflectiveSurfaceMat(r.type);
        face.material = faceMat;
        face.castShadow = false;
        face.receiveShadow = true;
      } else if (name.endsWith('_Accent')) {
        const mat = obj.material ? obj.material.clone() : new THREE.MeshStandardMaterial();
        mat.color.setHex(0x38e8ff);
        mat.emissive.setHex(0x0ea5e9);
        mat.emissiveIntensity = 0.40;
        mat.roughness = 0.22;
        obj.material = mat;
        obj.castShadow = false;
        obj.receiveShadow = false;
        accentMat = mat;
      } else {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }

  if (!face) {
    faceMat = createReflectiveSurfaceMat(r.type);
    face = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.h), faceMat);
    face.position.set(0, cfg.posY, 0.12);
    group.add(face);
  }

  // Reflection spark sphere shown right at exact contact point when beam bounces here
  const glint = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  glint.visible = false;
  levelGroup.add(glint);
  levelGroup.add(group);

  const planeOrigin = new THREE.Vector3(r.x, 0.9, r.z).addScaledVector(normal, 0.35);
  const mObj = {
    id: r.id,
    x: r.x,
    z: r.z,
    group,
    face,
    faceMat,
    accentMat,
    glint,
    planeOrigin,
    normal,
    tangent,
    width: r.w,
    height: r.h,
    type: r.type,
    label: r.label,
    litBounce: 0,
  };
  mirrors.push(mObj);
  return mObj;
}

function createSanctuaryBillboardTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Cozy emerald background with warm cream trim
  ctx.fillStyle = '#14532d';
  ctx.fillRect(0, 0, 768, 256);

  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 748, 236);

  ctx.fillStyle = '#16a34a';
  ctx.fillRect(22, 22, 724, 212);

  // Cute golden paw icon on left
  ctx.fillStyle = '#fde047';
  ctx.beginPath();
  ctx.ellipse(98, 152, 34, 28, 0, 0, Math.PI * 2);
  ctx.fill();
  [[-36, -42], [-12, -56], [14, -56], [38, -42]].forEach(([dx, dy]) => {
    ctx.beginPath();
    ctx.ellipse(98 + dx, 152 + dy, 12, 15, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // Main title
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 58px Segoe UI, Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('PAW SANCTUARY', 162, 106);

  // Subtitle
  ctx.fillStyle = '#fde68a';
  ctx.font = '800 30px Segoe UI, Arial, sans-serif';
  ctx.fillText('CAT RESCUE TRUCK  ★  SAFE SHELTER', 166, 174);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let rampArrows = [];
function buildPawSanctuaryTruck() {
  const group = new THREE.Group();
  group.position.set(0, 0, -16.8);

  // Huge scaled Bakery Van chassis transformed into the Sanctuary Rescue Truck
  const truckMesh = ASSETS.bakeryVan.scene.clone(true);
  truckMesh.rotation.y = Math.PI + Math.PI / 2;
  truckMesh.scale.setScalar(1.68);
  truckMesh.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  group.add(truckMesh);

  truckMesh.updateMatrixWorld(true);
  const truckBox = new THREE.Box3().setFromObject(truckMesh);
  const cargoOffsetX = -0.65;

  // Bold emerald roof trim & flashing sanctuary beacons cleanly above roof
  const roofTrim = new THREE.Mesh(
    new THREE.BoxGeometry(5.0, 0.24, 2.7),
    new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.45 })
  );
  roofTrim.position.set(cargoOffsetX, truckBox.max.y + 0.08, 0);
  group.add(roofTrim);

  [-2.1, 1.1].forEach((bx) => {
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 0.26, 12),
      new THREE.MeshBasicMaterial({ color: 0x4ade80 })
    );
    beacon.position.set(bx, truckBox.max.y + 0.30, 0.85);
    group.add(beacon);
  });

  // Prominent PAW SANCTUARY billboard sign mounted cleanly OUTSIDE camera-facing cargo wall
  const signGeo = new THREE.BoxGeometry(4.9, 1.68, 0.16);
  const signTex = createSanctuaryBillboardTexture();
  const signFrontMat = new THREE.MeshStandardMaterial({
    map: signTex,
    roughness: 0.35,
    emissive: new THREE.Color(0x14532d),
    emissiveIntensity: 0.28,
  });
  const signFrameMat = new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.5 });
  const signMesh = new THREE.Mesh(signGeo, [
    signFrameMat, signFrameMat, signFrameMat, signFrameMat, signFrontMat, signFrameMat,
  ]);
  signMesh.position.set(cargoOffsetX, 2.28, truckBox.max.z + 0.10);
  group.add(signMesh);

  // Illuminated emerald loading ramp extending out toward the plaza
  const rampMat = new THREE.MeshStandardMaterial({
    color: 0x15803d,
    emissive: 0x16a34a,
    emissiveIntensity: 0.38,
    roughness: 0.42,
  });
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.18, 3.2), rampMat);
  ramp.position.set(0, 0.14, 3.1);
  ramp.rotation.x = 0.08;
  ramp.receiveShadow = true;
  group.add(ramp);

  // Glowing side guide rails on the loading ramp
  const railMat = new THREE.MeshBasicMaterial({ color: 0x4ade80 });
  [-2.9, 2.9].forEach((rx) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.32, 3.2), railMat);
    rail.position.set(rx, 0.28, 3.1);
    group.add(rail);
  });

  // Animated floor glow ring & 3 chevron bars guiding cats inside
  const padRing = new THREE.Mesh(
    new THREE.RingGeometry(2.6, 3.05, 36),
    new THREE.MeshBasicMaterial({ color: 0x4ade80, side: THREE.DoubleSide, transparent: true, opacity: 0.72 })
  );
  padRing.rotation.x = -Math.PI / 2;
  padRing.position.set(0, 0.05, 3.2);
  group.add(padRing);

  rampArrows = [];
  for (let i = 0; i < 3; i++) {
    const bar = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.28),
      new THREE.MeshBasicMaterial({ color: 0xfde047, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
    );
    bar.rotation.x = -Math.PI / 2;
    bar.position.set(0, 0.26, 4.1 - i * 0.9);
    group.add(bar);
    rampArrows.push(bar);
  }

  levelGroup.add(group);

  // Cozy shelter_house.glb beside the rescue truck as station prop
  const shelter = ASSETS.shelter.scene.clone(true);
  shelter.position.set(6.7, 0.12, -14.8);
  shelter.scale.setScalar(1.85);
  shelter.rotation.y = Math.PI / 2 + 0.32;
  levelGroup.add(shelter);

  // Solid truck body OBB behind the ramp so cats enter ramp instead of running behind truck
  vehicleOBBs.push({
    cx: 0,
    cz: -16.8,
    yaw: 0,
    cosInv: 1,
    sinInv: 0,
    cosFwd: 1,
    sinFwd: 0,
    halfX: 4.4,
    halfZ: 1.65,
    height: 3.8,
    kind: 'sanctuary',
  });
}

// ============================================================================
// EXACT OBB VEHICLE BUILDER & COURTYARD SCENERY
// ============================================================================
function addGLBVehicle(v) {
  const g = new THREE.Group();
  g.position.set(v.x, 0, v.z);
  g.rotation.y = 0;

  const proto = v.kind === 'van' ? ASSETS.bakeryVan.scene : ASSETS.taxi.scene;
  const mesh = proto.clone(true);
  mesh.rotation.y = Math.PI;
  mesh.scale.setScalar(v.scale || 1.1);
  g.add(mesh);
  levelGroup.add(g);

  // Measure unrotated local dimensions cleanly for tight OBB raycasts
  g.updateMatrixWorld(true);
  const localBox = new THREE.Box3().setFromObject(g);
  const localSize = localBox.getSize(new THREE.Vector3());
  const localCenter = localBox.getCenter(new THREE.Vector3());

  g.rotation.y = v.yaw || 0;
  g.updateMatrixWorld(true);

  const cosFwd = Math.cos(v.yaw || 0);
  const sinFwd = Math.sin(v.yaw || 0);
  const cosInv = Math.cos(-(v.yaw || 0));
  const sinInv = Math.sin(-(v.yaw || 0));

  const dxLocal = localCenter.x - v.x;
  const dzLocal = localCenter.z - v.z;
  const worldCx = v.x + dxLocal * cosFwd + dzLocal * sinFwd;
  const worldCz = v.z - dxLocal * sinFwd + dzLocal * cosFwd;

  vehicleOBBs.push({
    cx: worldCx,
    cz: worldCz,
    yaw: v.yaw || 0,
    cosInv,
    sinInv,
    cosFwd,
    sinFwd,
    halfX: localSize.x * 0.38,
    halfZ: localSize.z * 0.40,
    height: localSize.y,
    kind: v.kind,
  });
}

function buildCourtyardScenery() {
  const bldgs = [ASSETS.bldgBrick.scene, ASSETS.bldgLimestone.scene, ASSETS.bldgBrownstone.scene];
  [-1, 1].forEach((side) => {
    let zCursor = 18;
    let idx = 0;
    while (zCursor > -24) {
      const cz = zCursor - 3;
      const proto = bldgs[(idx + (side > 0 ? 1 : 0)) % bldgs.length];
      const b = proto.clone(true);
      const nearMirror = LEVEL_SPEC.mirrors.some((m) => Math.sign(m.x) === side && Math.abs(m.z - cz) < 4.5);
      b.position.set(side * (nearMirror ? 13.5 : 12.7), 0, cz);
      b.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2;
      b.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      levelGroup.add(b);
      zCursor -= 6.0;
      idx++;
    }
  });

  // Distant lit sunset backdrop buildings framing the open horizon behind PAW SANCTUARY
  [[-10.4, 0], [10.4, 1]].forEach(([bx, bIdx]) => {
    const b = bldgs[bIdx % bldgs.length].clone(true);
    b.position.set(bx, 0, -25.5);
    b.rotation.y = Math.PI;
    b.scale.setScalar(1.05);
    levelGroup.add(b);
  });

  // Streetlamps, fairy trees, hydrants strictly away from mirrors
  [[-9.0, 9.2], [9.0, 9.2], [-9.0, -4.4], [9.0, -4.4], [-9.0, -16.2]].forEach(([lx, lz]) => {
    const lamp = ASSETS.lamp.scene.clone(true);
    lamp.position.set(lx, 0.12, lz);
    lamp.scale.setScalar(1.05);
    lamp.rotation.y = lx < 0 ? -Math.PI / 2 : Math.PI / 2;
    levelGroup.add(lamp);
  });

  [[-9.5, 6.8], [9.5, 6.8], [-9.5, -5.8], [9.5, -5.8]].forEach(([tx, tz]) => {
    const tree = ASSETS.tree.scene.clone(true);
    tree.position.set(tx, 0.12, tz);
    tree.scale.setScalar(0.84);
    levelGroup.add(tree);
  });

  [[-8.7, 10.6], [8.7, -3.5]].forEach(([hx, hz]) => {
    const h = ASSETS.hydrant.scene.clone(true);
    h.position.set(hx, 0.12, hz);
    h.rotation.y = hx < 0 ? -Math.PI / 2 : Math.PI / 2;
    levelGroup.add(h);
  });
}

function clearLevelObjects() {
  for (const c of cats) {
    if (c.mixer) c.mixer.stopAllAction();
    scene.remove(c.group);
  }
  cats.length = 0;

  while (levelGroup.children.length > 0) {
    levelGroup.remove(levelGroup.children[0]);
  }
  vehicleOBBs.length = 0;
  mirrors.length = 0;
  rampArrows = [];
  for (const p of particles) scene.remove(p.mesh);
  particles.length = 0;
  for (const pop of popups) pop.el.remove();
  popups.length = 0;
}

function buildLevel() {
  clearLevelObjects();
  buildCourtyardScenery();
  buildPawSanctuaryTruck();
  for (const v of LEVEL_SPEC.vehicles) addGLBVehicle(v);
  for (const r of LEVEL_SPEC.mirrors) createReflector(r);
}

// ============================================================================
// LASER BEAM VISUALS (Crimson Direct -> Cyan 1x Bounce -> Gold 2x+ Bounce!)
// ============================================================================
const MAX_BEAM_LEGS = 4;
const beamLegs = [];
const beamCoreGeo = new THREE.CylinderGeometry(0.036, 0.036, 1, 8);
beamCoreGeo.translate(0, 0.5, 0);
beamCoreGeo.rotateX(Math.PI / 2);

const beamHaloGeo = new THREE.CylinderGeometry(0.11, 0.11, 1, 8);
beamHaloGeo.translate(0, 0.5, 0);
beamHaloGeo.rotateX(Math.PI / 2);

const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const haloColors = [0xff2442, 0x38e8ff, 0xfbbf24, 0xfbbf24];
const haloMats = haloColors.map((col) => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.68 }));

for (let i = 0; i < MAX_BEAM_LEGS; i++) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(beamCoreGeo, coreMat);
  const halo = new THREE.Mesh(beamHaloGeo, haloMats[i]);
  g.add(halo, core);
  g.visible = false;
  scene.add(g);
  beamLegs.push(g);
}

// Active Laser Dot
const dotGroup = new THREE.Group();
const dotCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const dotHaloMat = new THREE.MeshBasicMaterial({ color: 0xff2442, transparent: true, opacity: 0.85 });
const dotRingMat = new THREE.MeshBasicMaterial({ color: 0xff2442, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false });

const dotCore = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), dotCoreMat);
const dotHalo = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 16), dotHaloMat);
const dotGroundRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.72, 24), dotRingMat);
dotGroundRing.rotation.x = -Math.PI / 2;
dotGroundRing.position.y = 0.04;
dotGroup.add(dotCore, dotHalo, dotGroundRing);
dotGroup.visible = false;
scene.add(dotGroup);

// Faint angle-continuation hint past dot (6m dotted extension along current ray)
const HINT_DOTS = 6;
const hintDots = [];
const hintDotGeo = new THREE.SphereGeometry(0.085, 6, 6);
const hintDotMat = new THREE.MeshBasicMaterial({ color: 0x99f6ff, transparent: true, opacity: 0.48 });
for (let i = 0; i < HINT_DOTS; i++) {
  const m = new THREE.Mesh(hintDotGeo, hintDotMat);
  m.visible = false;
  scene.add(m);
  hintDots.push(m);
}

// ============================================================================
// PARTICLE BURSTS & WORLD FLOATING POPUPS
// ============================================================================
const particleGeo = new THREE.SphereGeometry(0.09, 6, 6);
function spawnBurst(pos, colorHex, count = 10, speed = 5.0) {
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.95 });
    const mesh = new THREE.Mesh(particleGeo, mat);
    mesh.position.copy(pos);
    scene.add(mesh);
    const a = Math.random() * Math.PI * 2;
    const sp = speed * (0.4 + Math.random() * 0.7);
    particles.push({
      mesh,
      mat,
      vx: Math.cos(a) * sp,
      vy: 2.0 + Math.random() * speed * 0.75,
      vz: Math.sin(a) * sp,
      life: 0.52 + Math.random() * 0.25,
      maxLife: 0.78,
      gravity: 14,
    });
  }
}

const popupsLayer = document.getElementById('popups-layer');
function spawnWorldPopup(worldPos, text, cssClass = '') {
  const p = worldPos.clone();
  p.y += 1.05;
  p.project(camera);
  if (p.z > 1) return;
  const x = (p.x * 0.5 + 0.5) * container.clientWidth;
  const y = (-p.y * 0.5 + 0.5) * container.clientHeight;
  const el = document.createElement('div');
  el.className = `world-popup ${cssClass}`;
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  popupsLayer.appendChild(el);
  popups.push({ el, life: 0.95 });
}

// ============================================================================
// EXACT 2D OBB COLLISIONS & HONEST MULTI-BOUNCE OPTICAL RAYTRACER
// ============================================================================
function worldToOBBLocal(px, pz, obb) {
  const rx = px - obb.cx;
  const rz = pz - obb.cz;
  return {
    x: rx * obb.cosInv + rz * obb.sinInv,
    z: -rx * obb.sinInv + rz * obb.cosInv,
  };
}

function resolveCircleOBBs(pos, radius, pad = 0) {
  for (const obb of vehicleOBBs) {
    const loc = worldToOBBLocal(pos.x, pos.z, obb);
    const hx = obb.halfX + pad;
    const hz = obb.halfZ + pad;
    const cx = THREE.MathUtils.clamp(loc.x, -hx, hx);
    const cz = THREE.MathUtils.clamp(loc.z, -hz, hz);
    const dx = loc.x - cx;
    const dz = loc.z - cz;
    const distSq = dx * dx + dz * dz;
    if (distSq < radius * radius) {
      let pushX = 0;
      let pushZ = 0;
      if (distSq > 1e-6) {
        const d = Math.sqrt(distSq);
        const push = radius - d;
        pushX = (dx / d) * push;
        pushZ = (dz / d) * push;
      } else {
        const left = loc.x + hx;
        const right = hx - loc.x;
        const top = loc.z + hz;
        const bot = hz - loc.z;
        const m = Math.min(left, right, top, bot);
        if (m === left) pushX = -(left + radius);
        else if (m === right) pushX = right + radius;
        else if (m === top) pushZ = -(top + radius);
        else pushZ = bot + radius;
      }
      // Rotate local push back into world coordinates
      pos.x += pushX * obb.cosFwd + pushZ * obb.sinFwd;
      pos.z += -pushX * obb.sinFwd + pushZ * obb.cosFwd;
    }
  }
}

function rayIntersectOBB(ox, oz, dx, dz, obb, maxDist, pad = 0.05) {
  const locO = worldToOBBLocal(ox, oz, obb);
  const ldx = dx * obb.cosInv + dz * obb.sinInv;
  const ldz = -dx * obb.sinInv + dz * obb.cosInv;
  const hx = obb.halfX + pad;
  const hz = obb.halfZ + pad;

  let tmin = 0;
  let tmax = maxDist;
  if (Math.abs(ldx) < 1e-6) {
    if (locO.x < -hx || locO.x > hx) return null;
  } else {
    let t1 = (-hx - locO.x) / ldx;
    let t2 = (hx - locO.x) / ldx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(ldz) < 1e-6) {
    if (locO.z < -hz || locO.z > hz) return null;
  } else {
    let t1 = (-hz - locO.z) / ldz;
    let t2 = (hz - locO.z) / ldz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin > 0.05 ? tmin : null;
}

function hasLineOfSight(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.1) return true;
  const ndx = dx / dist;
  const ndz = dz / dist;
  for (const obb of vehicleOBBs) {
    if (obb.kind === 'sanctuary') continue;
    const t = rayIntersectOBB(ax, az, ndx, ndz, obb, dist - 0.1, 0);
    if (t !== null) return false;
  }
  return true;
}

function rayIntersectMirror(ox, oz, dx, dz, m, maxDist) {
  const denom = dx * m.normal.x + dz * m.normal.z;
  if (denom >= -0.05) return null; // Must strike front face
  const vx = m.planeOrigin.x - ox;
  const vz = m.planeOrigin.z - oz;
  const t = (vx * m.normal.x + vz * m.normal.z) / denom;
  if (t < 0.25 || t > maxDist) return null;
  const hx = ox + dx * t;
  const hz = oz + dz * t;
  const relX = hx - m.planeOrigin.x;
  const relZ = hz - m.planeOrigin.z;
  const along = relX * m.tangent.x + relZ * m.tangent.z;
  if (Math.abs(along) > m.width * 0.52) return null;
  return { t, x: hx, z: hz, mirror: m };
}

function rayIntersectPlazaBounds(ox, oz, dx, dz, maxDist) {
  let best = maxDist;
  const minX = -PLAZA_HALF_X - 0.4;
  const maxX = PLAZA_HALF_X + 0.4;
  const minZ = PLAZA_MIN_Z - 0.6;
  const maxZ = PLAZA_MAX_Z + 1.8;

  if (dx > 1e-5) best = Math.min(best, (maxX - ox) / dx);
  else if (dx < -1e-5) best = Math.min(best, (minX - ox) / dx);
  if (dz > 1e-5) best = Math.min(best, (maxZ - oz) / dz);
  else if (dz < -1e-5) best = Math.min(best, (minZ - oz) / dz);
  return Math.max(0.1, best);
}

function traceOpticalBeam(origin, initDir, totalLen) {
  const segments = [];
  let curOrigin = origin.clone();
  let curDir = initDir.clone().setY(0).normalize();
  let remaining = totalLen;
  let lastMirror = null;
  let bounces = 0;
  let blocked = false;
  const hitMirrors = [];

  for (let step = 0; step < MAX_BEAM_LEGS; step++) {
    let bestT = remaining;
    let hitKind = 'end';
    let hitMirror = null;

    // 1) Check plaza bounds
    const boundT = rayIntersectPlazaBounds(curOrigin.x, curOrigin.z, curDir.x, curDir.z, bestT);
    if (boundT < bestT) {
      bestT = boundT;
      hitKind = 'wall';
    }

    // 2) Check vehicle OBB hulls
    for (const obb of vehicleOBBs) {
      const t = rayIntersectOBB(curOrigin.x, curOrigin.z, curDir.x, curDir.z, obb, bestT, 0.04);
      if (t !== null && t < bestT) {
        bestT = t;
        hitKind = 'vehicle';
        hitMirror = null;
      }
    }

    // 3) Check mirror glass planes (pure angle of incidence = angle of reflection!)
    for (const m of mirrors) {
      if (m === lastMirror) continue;
      const hit = rayIntersectMirror(curOrigin.x, curOrigin.z, curDir.x, curDir.z, m, bestT);
      if (hit && hit.t < bestT) {
        bestT = hit.t;
        hitKind = 'mirror';
        hitMirror = m;
      }
    }

    const segStart = new THREE.Vector3(curOrigin.x, step === 0 ? origin.y : 0.88, curOrigin.z);
    const segEndY = hitKind === 'mirror' ? 0.88 : (hitKind === 'vehicle' ? 0.65 : 0.20);
    const segEnd = new THREE.Vector3(
      curOrigin.x + curDir.x * bestT,
      segEndY,
      curOrigin.z + curDir.z * bestT
    );
    segments.push({ start: segStart, end: segEnd, leg: step });

    if (hitKind === 'mirror' && hitMirror && remaining - bestT > 0.2 && step < MAX_BEAM_LEGS - 1) {
      bounces++;
      hitMirrors.push({ mirror: hitMirror, pos: segEnd.clone(), bounceIdx: bounces });
      lastMirror = hitMirror;
      remaining -= bestT;

      // Pure optical reflection: R = D - 2(D·N)N
      const dDotN = curDir.dot(hitMirror.normal);
      curDir = curDir.clone().addScaledVector(hitMirror.normal, -2 * dDotN).setY(0).normalize();
      curOrigin.set(segEnd.x + curDir.x * 0.04, 0.88, segEnd.z + curDir.z * 0.04);
    } else {
      blocked = hitKind === 'vehicle' || hitKind === 'wall';
      return {
        segments,
        endPos: new THREE.Vector3(segEnd.x, hitKind === 'vehicle' ? 0.65 : 0.06, segEnd.z),
        endDir: curDir,
        bounces,
        blocked,
        hitMirrors,
      };
    }
  }

  const last = segments[segments.length - 1];
  return {
    segments,
    endPos: last ? last.end.clone() : origin.clone(),
    endDir: curDir,
    bounces,
    blocked,
    hitMirrors,
  };
}

// ============================================================================
// 26 IMPATIENT EXPRESSIVE CATS (6 Coats, 9 Clips, Pounce Expose & Feints)
// ============================================================================
const CAT_MODEL_SCALE = 1.98;
const crownGeo = new THREE.TorusGeometry(0.08, 0.024, 6, 12);
crownGeo.rotateX(Math.PI / 2);

const lungeRingGeo = new THREE.RingGeometry(0.32, 0.44, 20);
lungeRingGeo.rotateX(-Math.PI / 2);

const patienceRingGeo = new THREE.RingGeometry(0.24, 0.30, 16);
patienceRingGeo.rotateX(-Math.PI / 2);

function buildCatMesh(coatKey, isGolden) {
  const group = new THREE.Group();
  const model = SkeletonUtils.clone(ASSETS.cat.scene);
  model.rotation.y = Math.PI;

  const bodyMeshes = [];
  model.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = false;
      obj.frustumCulled = false;
      if (obj.name.includes('Cat_Body') && CAT_COAT_MATS[coatKey]) {
        obj.material = CAT_COAT_MATS[coatKey];
        bodyMeshes.push(obj);
      }
    }
  });
  group.add(model);

  if (isGolden) {
    const crown = new THREE.Mesh(crownGeo, new THREE.MeshBasicMaterial({ color: 0xfef08a }));
    crown.position.set(0, 0.48, 0.21);
    group.add(crown);
  }

  const telMat = new THREE.MeshBasicMaterial({
    color: 0xf97316,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const telRing = new THREE.Mesh(lungeRingGeo, telMat);
  telRing.position.y = 0.03;
  group.add(telRing);

  const patMat = new THREE.MeshBasicMaterial({
    color: 0xfbbf24,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const patRing = new THREE.Mesh(patienceRingGeo, patMat);
  patRing.position.y = 0.025;
  group.add(patRing);

  const baseScale = CAT_MODEL_SCALE * (isGolden ? 1.15 : 0.90 + Math.random() * 0.16);
  group.scale.setScalar(baseScale);

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const clip of ASSETS.cat.animations) {
    const action = mixer.clipAction(clip);
    if (clip.name === 'Pounce' || clip.name === 'Disappointed') {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    actions[clip.name] = action;
  }

  const initialClip = actions.Idle ? 'Idle' : Object.keys(actions)[0];
  if (initialClip) {
    const a = actions[initialClip];
    a.time = Math.random() * a.getClip().duration;
    a.play();
  }

  return { group, bodyMeshes, telRing, telMat, patRing, patMat, coatKey, baseScale, mixer, actions, currentAnim: initialClip };
}

function setCatAnim(c, name, { fade = 0.12, timeScale = 1.0, forceRestart = false } = {}) {
  const next = c.actions[name];
  if (!next) return;
  if (c.currentAnim === name && !forceRestart) {
    next.setEffectiveTimeScale(timeScale);
    return;
  }
  const prev = c.currentAnim ? c.actions[c.currentAnim] : null;
  if (prev && prev !== next) prev.fadeOut(fade);
  next.reset();
  next.setEffectiveTimeScale(timeScale);
  next.setEffectiveWeight(1);
  next.fadeIn(fade);
  next.play();
  c.currentAnim = name;
}

function spawnCourtyardCats() {
  const pockets = [
    // Front plaza (7 regular cats)
    { count: 7, goldenIdx: -1, minX: -6.2, maxX: 6.2, minZ: 4.5, maxZ: 8.6 },
    // Mid-Behind-Van pocket (7 cats, incl 1 golden)
    { count: 7, goldenIdx: 3,  minX: -3.8, maxX: 3.8, minZ: -4.2, maxZ: -1.4 },
    // Left deep pocket behind Left Taxi (6 cats, incl 1 golden)
    { count: 6, goldenIdx: 2,  minX: -7.0, maxX: -2.2, minZ: -10.8, maxZ: -7.6 },
    // Right deep pocket behind Right Taxi (6 cats, incl 1 golden)
    { count: 6, goldenIdx: 4,  minX: 2.2,  maxX: 7.0,  minZ: -10.8, maxZ: -7.6 },
  ];

  let idx = 0;
  for (const pk of pockets) {
    for (let k = 0; k < pk.count; k++) {
      const isGolden = k === pk.goldenIdx;
      const coatKey = isGolden ? 'golden' : CAT_COAT_KEYS[idx % CAT_COAT_KEYS.length];
      const visual = buildCatMesh(coatKey, isGolden);

      const x = pk.minX + Math.random() * (pk.maxX - pk.minX);
      const z = pk.minZ + Math.random() * (pk.maxZ - pk.minZ);
      const pos = new THREE.Vector3(x, 0, z);
      resolveCircleOBBs(pos, 0.55, 0.15);
      visual.group.position.copy(pos);
      scene.add(visual.group);

      cats.push({
        ...visual,
        pos,
        vel: new THREE.Vector3(0, 0, 0),
        yaw: Math.random() * Math.PI * 2,
        state: 'IDLE',
        stateTimer: 0,
        interest: 1.0,
        speedMult: (isGolden ? 1.26 : 0.92 + Math.random() * 0.24),
        isGolden,
        lastSeenDot: pos.clone(),
        lungeDir: new THREE.Vector3(0, 0, -1),
        lungePhase: 'windup',
        feinted: false,
        idleTimer: Math.random() * 2.5,
      });
      idx++;
    }
  }
}

// ============================================================================
// GAME STATE, INPUT (HOLD = BEAM ANGLE+LENGTH, RELEASE = FEINT!) & LOOP
// ============================================================================
const game = {
  dotActive: false,
  dotPos: new THREE.Vector3(0, 0.06, 8),
  dotBlocked: false,
  bounces: 0,
  prevBounces: 0,
  aimDir: new THREE.Vector3(0, 0, -1),
  beamLen: 12,
  rescued: 0,
  goldenRescued: 0,
  lost: 0,
  feints: 0,
  maxBounces: 0,
  score: 0,
  timeLeft: ROUND_DURATION,
  finished: false,
  hasRescuedAny: false,
};

const pointerState = {
  down: false,
  groundPos: new THREE.Vector3(0, 0, 6),
};

const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndcVec = new THREE.Vector2();
const thumbGuide = document.getElementById('thumb-guide');
const onboardToast = document.getElementById('onboard-toast');

function updatePointerGround(clientX, clientY, isTouch) {
  const rect = renderer.domElement.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return;

  if (isTouch && pointerState.down) {
    thumbGuide.classList.remove('hidden');
    thumbGuide.style.left = `${clientX - rect.left}px`;
    thumbGuide.style.top = `${clientY - rect.top}px`;
  } else {
    thumbGuide.classList.add('hidden');
  }

  const yOffset = isTouch ? -44 : 0;
  ndcVec.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndcVec.y = -((clientY + yOffset - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(ndcVec, camera);
  const target = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, target)) {
    target.x = THREE.MathUtils.clamp(target.x, -26, 26);
    target.z = THREE.MathUtils.clamp(target.z, -38, 13.0);
    pointerState.groundPos.copy(target);
  }
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  if (game.finished) return;
  ensureAudio();
  pointerState.down = true;
  updatePointerGround(e.clientX, e.clientY, e.pointerType === 'touch');
});

window.addEventListener('pointermove', (e) => {
  if (!pointerState.down && e.pointerType !== 'mouse') return;
  updatePointerGround(e.clientX, e.clientY, e.pointerType === 'touch');
});

function handlePointerUp() {
  if (!pointerState.down) return;
  pointerState.down = false;
  thumbGuide.classList.add('hidden');

  if (!game.finished && game.dotActive) {
    triggerExtinguishFeint();
  }
  game.dotActive = false;
  sfx.laserOff();
}

window.addEventListener('pointerup', handlePointerUp);
window.addEventListener('pointercancel', handlePointerUp);

function triggerExtinguishFeint() {
  let feintCount = 0;
  for (const c of cats) {
    if (c.state !== 'LUNGE' || c.feinted) continue;
    const d = Math.hypot(c.pos.x - game.dotPos.x, c.pos.z - game.dotPos.z);
    if (d < 3.4) {
      c.feinted = true;
      c.interest = 1.0;
      feintCount++;
    }
  }
  if (feintCount > 0) {
    game.feints += feintCount;
    const pts = 150 * feintCount;
    game.score += pts;
    sfx.feint();
    spawnWorldPopup(game.dotPos, `⚡ ФИНТ! ×${feintCount} (+${pts})`, 'popup-cyan');
    spawnBurst(game.dotPos, 0x38e8ff, 12, 5.5);
  }
}

function updateBeam() {
  for (const leg of beamLegs) leg.visible = false;
  for (const hd of hintDots) hd.visible = false;
  for (const m of mirrors) {
    m.glint.visible = false;
    m.litBounce = 0;
  }

  if (!pointerState.down || game.finished) {
    game.dotActive = false;
    game.bounces = 0;
    dotGroup.visible = false;
    return;
  }

  const dx = pointerState.groundPos.x - EMITTER_POS.x;
  const dz = Math.min(-0.35, pointerState.groundPos.z - EMITTER_POS.z);
  const rawDist = Math.hypot(dx, dz);
  game.aimDir.set(dx / rawDist, 0, dz / rawDist);

  // Piecewise length: 1:1 on front plaza (<=10.5m), smooth telescoping beyond mirrors (>10.5m)
  const beamLen = rawDist <= 10.5
    ? Math.max(1.4, rawDist)
    : Math.min(50.0, 10.5 + (rawDist - 10.5) * config.beamScale * 1.6);
  game.beamLen = beamLen;

  pointerArm.rotation.y = Math.atan2(game.aimDir.x, game.aimDir.z);

  const trace = traceOpticalBeam(EMITTER_POS, game.aimDir, beamLen);
  game.dotActive = true;
  game.dotPos.copy(trace.endPos);
  game.dotBlocked = trace.blocked;
  game.bounces = trace.bounces;
  if (trace.bounces > game.maxBounces) game.maxBounces = trace.bounces;

  if (trace.bounces > game.prevBounces) {
    sfx.bounceSpark(trace.bounces);
  }
  game.prevBounces = trace.bounces;

  // Render beam legs
  for (let i = 0; i < trace.segments.length && i < MAX_BEAM_LEGS; i++) {
    const seg = trace.segments[i];
    const legMesh = beamLegs[i];
    const len = seg.start.distanceTo(seg.end);
    if (len > 0.05) {
      legMesh.visible = true;
      legMesh.position.copy(seg.start);
      legMesh.lookAt(seg.end);
      legMesh.scale.set(1, 1, len);
    }
  }

  // Light up mirrors touched by live beam
  for (const hm of trace.hitMirrors) {
    hm.mirror.litBounce = hm.bounceIdx;
    hm.mirror.glint.visible = true;
    hm.mirror.glint.position.copy(hm.pos);
  }

  // Dot visuals
  const dotCol = trace.bounces >= 2 ? 0xfbbf24 : (trace.bounces === 1 ? 0x38e8ff : 0xff2442);
  dotHaloMat.color.setHex(dotCol);
  dotRingMat.color.setHex(dotCol);
  dotGroup.visible = true;
  dotGroup.position.copy(trace.endPos);
  dotGroundRing.position.y = -trace.endPos.y + 0.04;

  // Faint 6m angle continuation hint along current leg direction
  for (let i = 0; i < HINT_DOTS; i++) {
    const t = (i + 1) * 1.05;
    const hx = trace.endPos.x + trace.endDir.x * t;
    const hz = trace.endPos.z + trace.endDir.z * t;
    if (Math.abs(hx) > PLAZA_HALF_X + 0.5 || hz < PLAZA_MIN_Z - 1) break;
    hintDots[i].visible = true;
    hintDots[i].position.set(hx, 0.14, hz);
  }
}

function updateCats(dt) {
  const activeCount = cats.length;
  for (let i = 0; i < activeCount; i++) {
    const c = cats[i];
    if (c.state === 'RESCUED' || c.state === 'GONE') continue;

    // Check PAW SANCTUARY Ramp Rescue!
    if ((c.state === 'CHASE' || c.state === 'LUNGE' || c.state === 'FEINT_TUMBLE') &&
        Math.abs(c.pos.x) <= 2.95 && c.pos.z <= -12.35) {
      c.state = 'RESCUED';
      c.telMat.opacity = 0;
      c.patMat.opacity = 0;
      c.stateTimer = 0.45;
      game.rescued++;
      if (c.isGolden) game.goldenRescued++;
      const bounceMult = game.bounces >= 2 ? 2.5 : (game.bounces === 1 ? 1.5 : 1.0);
      const pts = Math.round((c.isGolden ? 650 : 250) * bounceMult);
      game.score += pts;
      sfx.rescue(game.rescued, c.isGolden);
      spawnBurst(RAMP_CENTER, c.isGolden ? 0xfbbf24 : 0x4ade80, 14, 6.0);
      spawnWorldPopup(c.pos, c.isGolden ? `★ ЗОЛОТОЙ СПАСЁН! +${pts}` : `🐾 СПАСЁН! +${pts}`, c.isGolden ? 'popup-gold' : 'popup-green');
      setCatAnim(c, 'Pounce', { forceRestart: true, timeScale: 1.2 });

      if (!game.hasRescuedAny) {
        game.hasRescuedAny = true;
        setTimeout(() => onboardToast.classList.add('faded'), 1500);
      }
      continue;
    }

    if (c.state === 'IDLE') {
      if (game.dotActive) {
        const d = Math.hypot(game.dotPos.x - c.pos.x, game.dotPos.z - c.pos.z);
        if (d < 11.2 && hasLineOfSight(c.pos.x, c.pos.z, game.dotPos.x, game.dotPos.z)) {
          c.state = 'CHASE';
          c.interest = 1.0;
          c.lastSeenDot.copy(game.dotPos);
          setCatAnim(c, 'Run', { timeScale: 1.25 * c.speedMult });
          continue;
        }
      }
      c.idleTimer -= dt;
      if (c.idleTimer <= 0) {
        c.idleTimer = 1.6 + Math.random() * 2.2;
        setCatAnim(c, Math.random() < 0.6 ? 'Idle' : 'Walk', { timeScale: 0.9 });
      }
    } else if (c.state === 'CHASE') {
      const distDot = Math.hypot(game.dotPos.x - c.pos.x, game.dotPos.z - c.pos.z);
      const canSee = game.dotActive && distDot < 12.2 && hasLineOfSight(c.pos.x, c.pos.z, game.dotPos.x, game.dotPos.z);

      if (canSee) {
        c.interest = Math.min(1.0, c.interest + dt * 1.8);
        c.lastSeenDot.copy(game.dotPos);
      } else {
        const drainRate = (c.isGolden ? 1.35 : 1.0) / config.patience;
        c.interest -= dt * drainRate;
      }

      // Patience visual warning ring under impatient cat
      if (c.interest < 0.72) {
        c.patMat.opacity = 0.85;
        c.patMat.color.setHex(c.interest < 0.35 ? 0xff2442 : 0xfbbf24);
        c.patRing.scale.setScalar(0.55 + c.interest * 0.75);
      } else {
        c.patMat.opacity = 0;
      }

      if (c.interest <= 0) {
        c.state = 'BORED_LEAVE';
        c.stateTimer = 0.55;
        c.patMat.opacity = 0;
        c.telMat.opacity = 0;
        game.lost++;
        sfx.walkAway();
        spawnWorldPopup(c.pos, '💨 УШЁЛ...', 'popup-crimson');
        setCatAnim(c, 'Disappointed', { forceRestart: true, timeScale: 1.0 });
        continue;
      }

      const target = canSee ? game.dotPos : c.lastSeenDot;
      const dx = target.x - c.pos.x;
      const dz = target.z - c.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const dirX = dx / dist;
      const dirZ = dz / dist;

      // Soft separation + steering
      let sepX = 0;
      let sepZ = 0;
      for (let j = (i + 1) % 3; j < activeCount; j += 3) {
        if (j === i) continue;
        const o = cats[j];
        if (o.state === 'RESCUED' || o.state === 'GONE') continue;
        const sdx = c.pos.x - o.pos.x;
        const sdz = c.pos.z - o.pos.z;
        const sd2 = sdx * sdx + sdz * sdz;
        if (sd2 > 0.0001 && sd2 < 0.64) {
          const inv = (0.80 - Math.sqrt(sd2)) / Math.sqrt(sd2);
          sepX += sdx * inv * 2.8;
          sepZ += sdz * inv * 2.8;
        }
      }

      const spd = config.catSpeed * c.speedMult;
      c.vel.x = THREE.MathUtils.lerp(c.vel.x, dirX * spd + sepX, Math.min(1, dt * 8));
      c.vel.z = THREE.MathUtils.lerp(c.vel.z, dirZ * spd + sepZ, Math.min(1, dt * 8));
      c.pos.x += c.vel.x * dt;
      c.pos.z += c.vel.z * dt;
      resolveCircleOBBs(c.pos, 0.44, 0.06);
      c.pos.x = THREE.MathUtils.clamp(c.pos.x, -PLAZA_HALF_X, PLAZA_HALF_X);
      c.pos.z = THREE.MathUtils.clamp(c.pos.z, PLAZA_MIN_Z, PLAZA_MAX_Z);

      if (c.vel.lengthSq() > 0.12) c.yaw = Math.atan2(c.vel.x, c.vel.z);
      setCatAnim(c, 'Run', { timeScale: 1.25 * c.speedMult });

      // Lunge trigger if close to active dot
      if (canSee && distDot < (c.isGolden ? 3.2 : 2.7)) {
        c.state = 'LUNGE';
        c.lungePhase = 'windup';
        c.stateTimer = 0.30;
        c.feinted = false;
        c.lungeDir.set(dirX, 0, dirZ);
        c.yaw = Math.atan2(dirX, dirZ);
        setCatAnim(c, 'Crouch_Wiggle', { forceRestart: true, timeScale: 1.5 });
      }
    } else if (c.state === 'LUNGE') {
      c.stateTimer -= dt;
      if (c.lungePhase === 'windup') {
        c.telMat.opacity = 0.88;
        c.telRing.scale.setScalar(0.8 + (0.30 - Math.max(0, c.stateTimer)) * 2.0);
        if (c.stateTimer <= 0) {
          c.lungePhase = 'leap';
          c.stateTimer = 0.34;
          c.telMat.opacity = 0;
          setCatAnim(c, 'Pounce', { forceRestart: true, timeScale: 1.3 });
        }
      } else {
        const leapSpd = 12.2;
        c.pos.x += c.lungeDir.x * leapSpd * dt;
        c.pos.z += c.lungeDir.z * leapSpd * dt;
        c.pos.y = Math.sin((1 - Math.max(0, c.stateTimer) / 0.34) * Math.PI) * 0.55;
        resolveCircleOBBs(c.pos, 0.44, 0.06);

        // If laser dot is STILL ON on the ground and cat lands on it -> EXPOSED FAKE!
        if (!c.feinted && game.dotActive && game.dotPos.y < 0.25 && Math.hypot(game.dotPos.x - c.pos.x, game.dotPos.z - c.pos.z) < 0.78) {
          c.pos.y = 0;
          c.state = 'EXPOSED_LEAVE';
          c.stateTimer = 0.75;
          c.patMat.opacity = 0;
          game.lost++;
          sfx.exposed();
          for (const bm of c.bodyMeshes) {
            if (CAT_DISAPPOINTED_MATS[c.coatKey]) bm.material = CAT_DISAPPOINTED_MATS[c.coatKey];
          }
          spawnWorldPopup(c.pos, '😒 ПОНЯЛ ЧТО ФЕЙК!', 'popup-crimson');
          setCatAnim(c, 'Disappointed', { forceRestart: true, timeScale: 1.0 });
          continue;
        }

        if (c.stateTimer <= 0) {
          c.pos.y = 0;
          if (c.feinted) {
            c.state = 'FEINT_TUMBLE';
            c.stateTimer = 0.55;
            setCatAnim(c, 'Tumble', { forceRestart: true, timeScale: 1.25 });
          } else {
            c.state = 'CHASE';
            setCatAnim(c, 'Run', { timeScale: 1.2 * c.speedMult });
          }
        }
      }
    } else if (c.state === 'FEINT_TUMBLE') {
      c.stateTimer -= dt;
      if (c.stateTimer <= 0) {
        c.state = 'CHASE';
        c.interest = 1.0;
        setCatAnim(c, 'Run', { timeScale: 1.2 * c.speedMult });
      }
    } else if (c.state === 'EXPOSED_LEAVE' || c.state === 'BORED_LEAVE') {
      c.stateTimer -= dt;
      if (c.stateTimer <= 0) {
        const exitX = c.pos.x < 0 ? -11.5 : 11.5;
        const dx = exitX - c.pos.x;
        const dz = 0.5;
        const len = Math.hypot(dx, dz) || 1;
        c.pos.x += (dx / len) * 3.8 * dt;
        c.pos.z += (dz / len) * 3.8 * dt;
        c.yaw = Math.atan2(dx / len, dz / len);
        setCatAnim(c, 'Walk', { timeScale: 1.1 });
        if (Math.abs(c.pos.x) > 10.6) {
          c.state = 'GONE';
          c.group.visible = false;
        }
      }
    }

    c.group.position.copy(c.pos);
    c.group.rotation.y = c.yaw;
    if (c.mixer) c.mixer.update(dt);
  }

  // Handle rescued cats hopping up into PAW SANCTUARY truck
  for (const c of cats) {
    if (c.state !== 'RESCUED') continue;
    if (c.stateTimer > 0) {
      c.stateTimer -= dt;
      c.pos.z -= 4.5 * dt;
      c.pos.y = Math.max(0, (0.45 - c.stateTimer) * 1.4);
      c.group.position.copy(c.pos);
      c.group.scale.setScalar(c.baseScale * Math.max(0.05, c.stateTimer / 0.45));
      if (c.mixer) c.mixer.update(dt);
    } else {
      c.group.visible = false;
    }
  }
}

function updateVisualsAndFX(dt) {
  // Mirror cyan/gold flare
  for (const m of mirrors) {
    const lit = m.litBounce;
    if (m.accentMat) {
      const col = lit >= 2 ? 0xfbbf24 : 0x38e8ff;
      m.accentMat.color.setHex(col);
      m.accentMat.emissive.setHex(lit >= 2 ? 0xf59e0b : 0x0ea5e9);
      m.accentMat.emissiveIntensity = lit > 0 ? 1.85 : 0.40 + Math.sin(game.timeLeft * 3.0) * 0.12;
    }
    if (m.faceMat) {
      m.faceMat.emissive.setHex(lit >= 2 ? 0xf59e0b : 0x0ea5e9);
      m.faceMat.emissiveIntensity = lit > 0 ? 0.45 : 0.06;
    }
  }

  // Animated chevron arrows on PAW SANCTUARY ramp
  const tPhase = (ROUND_DURATION - game.timeLeft) * 3.2;
  for (let i = 0; i < rampArrows.length; i++) {
    const wave = Math.sin(tPhase + i * 1.3) * 0.5 + 0.5;
    rampArrows[i].material.opacity = 0.35 + wave * 0.65;
  }

  // Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.life -= dt;
    if (pt.life <= 0) {
      scene.remove(pt.mesh);
      particles.splice(i, 1);
      continue;
    }
    pt.vy -= pt.gravity * dt;
    pt.mesh.position.x += pt.vx * dt;
    pt.mesh.position.y += pt.vy * dt;
    pt.mesh.position.z += pt.vz * dt;
    if (pt.mesh.position.y < 0.04) {
      pt.mesh.position.y = 0.04;
      pt.vy = Math.abs(pt.vy) * 0.3;
    }
    pt.mat.opacity = Math.max(0, pt.life / pt.maxLife);
  }

  for (let i = popups.length - 1; i >= 0; i--) {
    popups[i].life -= dt;
    if (popups[i].life <= 0) {
      popups[i].el.remove();
      popups.splice(i, 1);
    }
  }

  // Subtle panoramic camera drift following active laser dot while keeping full 9:16 courtyard framed
  const zoom = getPortraitZoom();
  const baseY = 26.8 * zoom;
  const baseZ = 35.6 * zoom;
  const panX = game.dotActive ? THREE.MathUtils.clamp(game.dotPos.x * 0.12, -1.1, 1.1) : 0;
  const panZ = game.dotActive ? THREE.MathUtils.clamp(game.dotPos.z * 0.06, -0.9, 0.8) : 0;
  camera.position.x = THREE.MathUtils.lerp(camera.position.x, panX, Math.min(1, dt * 4));
  camera.position.y = THREE.MathUtils.lerp(camera.position.y, baseY, Math.min(1, dt * 6));
  camera.position.z = THREE.MathUtils.lerp(camera.position.z, baseZ + panZ, Math.min(1, dt * 4));
  camera.lookAt(camera.position.x * 0.55, 0.6, -1.6);
}

// ============================================================================
// HUD, ROUND COMPLETION & RESTART
// ============================================================================
const ui = {
  rescued: document.getElementById('stat-rescued'),
  golden: document.getElementById('stat-golden'),
  lost: document.getElementById('stat-lost'),
  timerPill: document.getElementById('timer-pill'),
  timer: document.getElementById('stat-timer'),
  bouncePill: document.getElementById('bounce-pill'),
  bounceText: document.getElementById('bounce-text'),
  feints: document.getElementById('stat-feints'),
  score: document.getElementById('stat-score'),
  modal: document.getElementById('result-modal'),
  stars: document.getElementById('result-stars'),
  title: document.getElementById('result-title'),
  summary: document.getElementById('result-summary'),
};

function formatClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const rem = String(s % 60).padStart(2, '0');
  return `${m}:${rem}`;
}

function syncHUD() {
  ui.rescued.textContent = `${game.rescued}/${TOTAL_CATS}`;
  ui.golden.textContent = `${game.goldenRescued}/${TOTAL_GOLDEN}`;
  ui.lost.textContent = game.lost;
  ui.timer.textContent = formatClock(game.timeLeft);
  ui.timerPill.classList.toggle('urgent', game.timeLeft <= 15);
  ui.feints.textContent = game.feints;
  ui.score.textContent = game.score.toLocaleString('ru-RU');

  if (game.dotActive && game.bounces >= 1) {
    ui.bouncePill.classList.remove('hidden');
    ui.bouncePill.classList.toggle('double', game.bounces >= 2);
    ui.bounceText.textContent = game.bounces >= 2
      ? `${game.bounces}× ДВОЙНОЙ РИКОШЕТ!`
      : '1× РИКОШЕТ!';
  } else {
    ui.bouncePill.classList.add('hidden');
  }
}

function finishRound() {
  if (game.finished) return;
  game.finished = true;
  game.dotActive = false;
  pointerState.down = false;
  thumbGuide.classList.add('hidden');
  for (const leg of beamLegs) leg.visible = false;
  for (const hd of hintDots) hd.visible = false;
  dotGroup.visible = false;

  const stars = game.rescued >= 18 ? 3 : (game.rescued >= 11 ? 2 : (game.rescued >= 5 ? 1 : 0));
  if (stars >= 1) {
    sfx.win();
    ui.title.textContent = stars === 3 ? 'Полный грузовик котов!' : 'Грузовик PAW SANCTUARY отправляется!';
  } else {
    sfx.lose();
    ui.title.textContent = 'Коты разбежались!';
  }
  ui.stars.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  ui.summary.textContent = `Спасено ${game.rescued} из ${TOTAL_CATS} · Золотые ${game.goldenRescued}/${TOTAL_GOLDEN} · Ушли ${game.lost} · Финты ${game.feints} · Макс. отскок ${game.maxBounces}× · ${game.score.toLocaleString('ru-RU')} очков`;
  ui.modal.classList.remove('hidden');
  syncHUD();
}

function restartGame() {
  ui.modal.classList.add('hidden');
  pointerState.down = false;
  thumbGuide.classList.add('hidden');

  game.dotActive = false;
  game.dotPos.set(0, 0.06, 8);
  game.dotBlocked = false;
  game.bounces = 0;
  game.prevBounces = 0;
  game.rescued = 0;
  game.goldenRescued = 0;
  game.lost = 0;
  game.feints = 0;
  game.maxBounces = 0;
  game.score = 0;
  game.timeLeft = ROUND_DURATION;
  game.finished = false;
  game.hasRescuedAny = false;

  onboardToast.classList.remove('faded');

  buildLevel();
  spawnCourtyardCats();

  const zoom = getPortraitZoom();
  camera.position.set(0, 26.8 * zoom, 35.6 * zoom);
  camera.lookAt(0, 0.6, -1.6);
  syncHUD();
}

// ============================================================================
// MAIN LOOP & UI WIRING
// ============================================================================
let lastTime = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (!assetsReady) return;

  if (!game.finished) {
    game.timeLeft = Math.max(0, game.timeLeft - dt);
    updateBeam();
    updateCats(dt);

    if (game.timeLeft <= 0 || game.rescued + game.lost >= TOTAL_CATS) {
      finishRound();
    }
    syncHUD();
  }

  updateVisualsAndFX(dt);
  renderer.render(scene, camera);
}

function wireUI() {
  const panel = document.getElementById('tuning-panel');
  const panelBody = document.getElementById('panel-body');
  const btnToggle = document.getElementById('btn-toggle-panel');
  const btnMute = document.getElementById('btn-mute');
  const btnRestartDev = document.getElementById('btn-restart-dev');
  const btnRetry = document.getElementById('btn-retry-level');

  const togglePanel = () => {
    const collapsed = panelBody.classList.toggle('collapsed');
    panel.classList.toggle('is-collapsed', collapsed);
  };
  btnToggle.addEventListener('click', togglePanel);

  btnMute.addEventListener('click', () => {
    config.muted = !config.muted;
    btnMute.textContent = config.muted ? '🔇' : '🔊';
  });

  btnRestartDev.addEventListener('click', restartGame);
  btnRetry.addEventListener('click', restartGame);

  const bindSlider = (inpId, valId, key, suffix = '') => {
    const inp = document.getElementById(inpId);
    const valEl = document.getElementById(valId);
    inp.addEventListener('input', () => {
      config[key] = parseFloat(inp.value);
      valEl.textContent = `${inp.value}${suffix}`;
    });
  };
  bindSlider('inp-cat-speed', 'val-cat-speed', 'catSpeed');
  bindSlider('inp-patience', 'val-patience', 'patience', 'с');
  bindSlider('inp-beam-scale', 'val-beam-scale', 'beamScale', '×');

  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') restartGame();
    if (e.key === 'Tab') {
      e.preventDefault();
      togglePanel();
    }
  });
  window.addEventListener('resize', syncViewportSize);
}

window.__CAT_LASER__ = {
  get dotActive() { return game.dotActive; },
  get dot() { return { x: +game.dotPos.x.toFixed(2), y: +game.dotPos.y.toFixed(2), z: +game.dotPos.z.toFixed(2) }; },
  get bounces() { return game.bounces; },
  get dotBlocked() { return game.dotBlocked; },
  get rescued() { return game.rescued; },
  get goldenRescued() { return game.goldenRescued; },
  get lost() { return game.lost; },
  get feints() { return game.feints; },
  get score() { return game.score; },
  get timeLeft() { return +game.timeLeft.toFixed(1); },
  get totalCats() { return cats.length; },
  get loadErrors() { return [...loadErrors]; },
  get mirrors() {
    return mirrors.map((m) => ({
      id: m.id,
      type: m.type,
      label: m.label,
      x: m.x,
      z: m.z,
      nx: m.normal.x,
      nz: m.normal.z,
      litBounce: m.litBounce,
    }));
  },
  projectToScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
      visible: v.z <= 1,
    };
  },
  setPointerWorld(x, z, down = true) {
    if (down) {
      pointerState.down = true;
      pointerState.groundPos.set(x, 0, z);
      updateBeam();
    } else {
      handlePointerUp();
      updateBeam();
    }
  },
  restart: restartGame,
};

(async function init() {
  const overlay = document.getElementById('loading-overlay');
  try {
    wireUI();
    await loadAssets();
    restartGame();
    overlay.classList.add('hidden');
    requestAnimationFrame(animate);
  } catch (err) {
    console.error('Failed to load CAT LASER assets:', err);
    overlay.querySelector('span').textContent = `Ошибка загрузки 3D-ассетов: ${err.message}`;
  }
})();
