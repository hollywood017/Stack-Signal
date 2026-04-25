/**
 * STACK & SIGNAL — Neural Manifest GPGPU Particle System
 * 262,144 GPU-computed particles morph between brand formations as you scroll.
 * Bloom post-processing, mouse repulsion, auto-play hero cinematic.
 */
import * as THREE from 'three';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';

// ── Device detection ──────────────────────────────────────────
// Catches phones AND tablets (iPad in any orientation, Surface, etc.).
// 1280px breakpoint covers iPad Pro 12.9" landscape (1366×1024).
const IS_MOBILE  = navigator.maxTouchPoints > 0 && window.innerWidth < 1280;
const IS_TOUCH   = navigator.maxTouchPoints > 0 &&
                   !window.matchMedia('(hover: hover)').matches;
const GPGPU_SIZE = IS_MOBILE ? 128 : 512;   // 16,384 mobile / 262,144 desktop
const N          = GPGPU_SIZE * GPGPU_SIZE;

// ── Brand colours ─────────────────────────────────────────────
const C = {
  signal: () => new THREE.Color(0x0057FF),
  cyan:   () => new THREE.Color(0x00C2FF),
  burn:   () => new THREE.Color(0xFF4D00),
  white:  () => new THREE.Color(0xFFFFFF),
};

const SECTION_COLORS = {
  logo:      [C.signal(), C.cyan()  ],
  hero:      [C.signal(), C.cyan()  ],
  services:  [C.cyan(),   C.burn()  ],
  stats:     [C.cyan(),   C.white() ],
  portfolio: [C.signal(), C.cyan()  ],
  flow:      [C.signal(), C.cyan()  ],
  grid:      [C.signal(), C.cyan()  ],
  contact:   [C.burn(),   C.white() ],
};

// ── GPGPU — Position simulation shader ───────────────────────
const positionSimShader = /* glsl */`
  uniform sampler2D uTargetPosition;
  uniform float     uLerpSpeed;
  uniform float     uTime;

  void main() {
    vec2 uv     = gl_FragCoord.xy / resolution.xy;
    vec4 pos    = texture2D( texturePosition,  uv );
    vec4 target = texture2D( uTargetPosition,  uv );

    // Smooth lerp toward target
    vec3 next = mix( pos.xyz, target.xyz, uLerpSpeed );

    // Organic micro-drift: keeps formation alive, not static
    float n = sin( uTime * 0.28 + uv.x * 53.1 ) * cos( uTime * 0.19 + uv.y * 37.4 );
    next += vec3( n, n * 0.6, n * 0.4 ) * 0.9;

    gl_FragColor = vec4( next, 1.0 );
  }
`;

// ── Render — Vertex shader ────────────────────────────────────
const particleVS = /* glsl */`
  uniform sampler2D uPosTex;
  uniform float     uSize;
  uniform vec3      uMouseWorld;
  uniform float     uMouseRadius;

  attribute vec2 aUv;

  varying vec2  vUv;
  varying float vEdge;   // distance from centre, 0–1

  void main() {
    vUv = aUv;

    vec3 pos = texture2D( uPosTex, aUv ).xyz;

    // Mouse repulsion (in world space)
    vec3  diff = pos - uMouseWorld;
    float d    = length( diff );
    if ( d < uMouseRadius && d > 0.001 ) {
      float f = pow( 1.0 - d / uMouseRadius, 2.0 ) * 90.0;
      pos += normalize( diff ) * f;
    }

    vec4 mvPos = modelViewMatrix * vec4( pos, 1.0 );
    gl_Position = projectionMatrix * mvPos;

    // Size attenuation
    gl_PointSize = uSize * ( 500.0 / max( -mvPos.z, 1.0 ) );
    gl_PointSize = clamp( gl_PointSize, 0.4, 9.0 );

    // Depth fade for very near / very far particles
    float cd = -mvPos.z;
    vEdge = clamp( cd / 600.0, 0.0, 1.0 );
  }
`;

// ── Render — Fragment shader ──────────────────────────────────
const particleFS = /* glsl */`
  uniform vec3  uColorA;
  uniform vec3  uColorB;

  varying vec2  vUv;
  varying float vEdge;

  void main() {
    vec2  c    = gl_PointCoord - 0.5;
    float d    = length( c );
    if ( d > 0.5 ) discard;

    float alpha = smoothstep( 0.5, 0.04, d );

    // Per-particle colour blend (deterministic from UV)
    float t     = fract( vUv.x * 17.3 + vUv.y * 9.1 );
    vec3  color = mix( uColorA, uColorB, t );

    // Bright glow core
    color += vec3( 0.18 ) * ( 1.0 - d * 2.0 );

    gl_FragColor = vec4( color, alpha * vEdge * 0.88 );
  }
`;

// ── Module state ──────────────────────────────────────────────
let renderer, scene, camera, composer;
let gpuCompute, posVar;
let renderMesh;
let targetTextures = {};
let colorA = new THREE.Color(0x0057FF);
let colorB = new THREE.Color(0x00C2FF);
let targetA = new THREE.Color(0x0057FF);
let targetB = new THREE.Color(0x00C2FF);
let mouseWorld = new THREE.Vector3();
let mouseNDC   = new THREE.Vector2();
const clock    = new THREE.Clock();

// ── Helpers ───────────────────────────────────────────────────
const rnd  = (lo, hi) => lo + Math.random() * (hi - lo);
const rndN = () => {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

function makeTargetTex(positions) {
  // positions: Float32Array length N*3
  const data = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    data[i * 4]     = positions[i * 3];
    data[i * 4 + 1] = positions[i * 3 + 1];
    data[i * 4 + 2] = positions[i * 3 + 2];
    data[i * 4 + 3] = 1.0;
  }
  const tex = new THREE.DataTexture(data, GPGPU_SIZE, GPGPU_SIZE, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  return tex;
}

// ── Formation generators ──────────────────────────────────────

// Hero — Signal Pulse: concentric rings radiating outward
function genHero() {
  const p = new Float32Array(N * 3);
  const rings = 14;
  const perRing = Math.floor(N / rings);
  for (let r = 0; r < rings; r++) {
    const radius = 30 + r * 24;
    const count  = Math.min(perRing, N - r * perRing);
    for (let i = 0; i < count; i++) {
      const idx   = r * perRing + i;
      const angle = (i / count) * Math.PI * 2;
      const jx    = rnd(-6, 6), jz = rnd(-6, 6);
      p[idx * 3]     = Math.cos(angle) * radius + jx;
      p[idx * 3 + 1] = rnd(-12, 12) * (1 - r / rings * 0.6);
      p[idx * 3 + 2] = Math.sin(angle) * radius + jz;
    }
  }
  return p;
}

// Logo — S&S icon: 3 stacked bars + 2 signal arcs
function genLogo() {
  const p    = new Float32Array(N * 3);
  const bars = [ { y: 70, w: 190 }, { y: 0, w: 140 }, { y: -70, w: 95 } ];
  const barN = Math.floor(N * 0.58);
  const arcN = N - barN;
  const perBar = Math.floor(barN / 3);
  let idx = 0;

  bars.forEach((bar, bi) => {
    const count = bi < 2 ? perBar : barN - 2 * perBar;
    for (let i = 0; i < count && idx < N; i++, idx++) {
      p[idx * 3]     = rnd(-bar.w / 2, bar.w / 2);
      p[idx * 3 + 1] = bar.y + rnd(-5, 5);
      p[idx * 3 + 2] = bi * 4 + rnd(-3, 3);
    }
  });

  // Two signal arcs on the right
  const arcRadii = [108, 150];
  const perArc   = Math.floor(arcN / 2);
  arcRadii.forEach((radius, ai) => {
    const count = ai === 0 ? perArc : arcN - perArc;
    for (let i = 0; i < count && idx < N; i++, idx++) {
      const t = (i / count) * Math.PI * 0.85 - Math.PI * 0.425;
      p[idx * 3]     = 120 + Math.cos(t) * radius;
      p[idx * 3 + 1] = Math.sin(t) * radius;
      p[idx * 3 + 2] = rnd(-4, 4);
    }
  });

  return p;
}

// Services — 3 gaussian clusters, one per service
function genServices() {
  const p = new Float32Array(N * 3);
  const centers = [
    { x: -210, y: 50,  z: 20  },
    { x:  0,   y: -60, z: 60  },
    { x:  210, y: 50,  z: -30 },
  ];
  const perC = Math.floor(N / 3);
  for (let i = 0; i < N; i++) {
    const ci = Math.min(Math.floor(i / perC), 2);
    const c  = centers[ci];
    p[i * 3]     = c.x + rndN() * 50;
    p[i * 3 + 1] = c.y + rndN() * 40;
    p[i * 3 + 2] = c.z + rndN() * 50;
  }
  return p;
}

// Stats — explosion burst: random sphere
function genStats() {
  const p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r     = rnd(100, 460);
    p[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    p[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.55;
    p[i * 3 + 2] = r * Math.cos(phi);
  }
  return p;
}

// Portfolio — tight 3D grid matrix
function genPortfolio() {
  const p    = new Float32Array(N * 3);
  const side = Math.ceil(Math.cbrt(N));
  const sp   = 340 / side;
  let idx    = 0;
  outer: for (let z = 0; z < side; z++) {
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side && idx < N; x++, idx++) {
        p[idx * 3]     = (x - side / 2) * sp + rnd(-sp * 0.12, sp * 0.12);
        p[idx * 3 + 1] = (y - side / 2) * sp * 0.75 + rnd(-2, 2);
        p[idx * 3 + 2] = (z - side / 2) * sp * 0.35;
      }
      if (idx >= N) break outer;
    }
  }
  return p;
}

// Process/flow — sine-wave stream left to right
function genFlow() {
  const p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 4;
    const x = (i / N - 0.5) * 620;
    p[i * 3]     = x + rnd(-18, 18);
    p[i * 3 + 1] = Math.sin(t) * 70 + rnd(-22, 22);
    p[i * 3 + 2] = rnd(-50, 50);
  }
  return p;
}

// Pricing — flat dense plane
function genGrid() {
  const p    = new Float32Array(N * 3);
  const side = Math.ceil(Math.sqrt(N));
  const sp   = 360 / side;
  for (let i = 0; i < N; i++) {
    const x = (i % side) - side / 2;
    const y = Math.floor(i / side) - side / 2;
    p[i * 3]     = x * sp + rnd(-sp * 0.18, sp * 0.18);
    p[i * 3 + 1] = y * sp * 0.45 + rnd(-3, 3);
    p[i * 3 + 2] = rnd(-25, 25);
  }
  return p;
}

// Contact — vortex spiral collapsing to centre
function genContact() {
  const p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const frac = i / N;
    const t    = frac * Math.PI * 10;  // 5 full turns
    const r    = (1 - frac) * 360;
    p[i * 3]     = Math.cos(t) * r;
    p[i * 3 + 1] = (frac - 0.5) * 280 + rnd(-10, 10);
    p[i * 3 + 2] = Math.sin(t) * r;
  }
  return p;
}

// ── Public API ────────────────────────────────────────────────
export const particleSystem = {
  morphTo(key) {
    if (!posVar || !targetTextures[key]) return;
    posVar.material.uniforms.uTargetPosition.value = targetTextures[key];
    const [ca, cb] = SECTION_COLORS[key] ?? SECTION_COLORS.hero;
    targetA.copy(ca);
    targetB.copy(cb);
  },
};

// ── Init ──────────────────────────────────────────────────────
export function initThreeBg() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;

  // WebGL2 required for GPGPU float textures
  if (!canvas.getContext('webgl2')) {
    document.body.style.background = '#060D1A';
    return;
  }

  // ── Renderer ────────────────────────────────────────────────
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, IS_MOBILE ? 1 : 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping        = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // ── Scene & Camera ───────────────────────────────────────────
  scene  = new THREE.Scene();
  scene.background = new THREE.Color(0x060D1A);
  camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1, 3000);
  camera.position.set(0, 80, 600);
  camera.lookAt(0, 0, 0);

  // ── Post-processing ──────────────────────────────────────────
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (IS_MOBILE) {
    // Half-res bloom on mobile — biggest "premium feel" lever on small screens.
    composer.addPass(new UnrealBloomPass(
      new THREE.Vector2(innerWidth * 0.5, innerHeight * 0.5),
      1.0,   // strength
      0.5,   // radius
      0.15   // threshold
    ));
  } else {
    composer.addPass(new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight),
      1.4,   // strength
      0.4,   // radius
      0.08   // threshold
    ));
  }

  // ── GPGPU ────────────────────────────────────────────────────
  gpuCompute = new GPUComputationRenderer(GPGPU_SIZE, GPGPU_SIZE, renderer);

  // Initial positions: loose scatter
  const initPos = gpuCompute.createTexture();
  const d = initPos.image.data;
  for (let i = 0; i < N; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r     = rnd(80, 320);
    d[i * 4]     = r * Math.sin(phi) * Math.cos(theta);
    d[i * 4 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.3;
    d[i * 4 + 2] = r * Math.cos(phi);
    d[i * 4 + 3] = 1.0;
  }

  posVar = gpuCompute.addVariable('texturePosition', positionSimShader, initPos);
  gpuCompute.setVariableDependencies(posVar, [posVar]);
  posVar.material.uniforms.uTargetPosition = { value: null };
  posVar.material.uniforms.uLerpSpeed      = { value: 0.028 };
  posVar.material.uniforms.uTime           = { value: 0.0 };

  const err = gpuCompute.init();
  if (err) { console.error('GPGPU init error:', err); return; }

  // ── Pre-compute all target formations ────────────────────────
  targetTextures = {
    hero:      makeTargetTex(genHero()),
    logo:      makeTargetTex(genLogo()),
    services:  makeTargetTex(genServices()),
    stats:     makeTargetTex(genStats()),
    portfolio: makeTargetTex(genPortfolio()),
    flow:      makeTargetTex(genFlow()),
    grid:      makeTargetTex(genGrid()),
    contact:   makeTargetTex(genContact()),
  };

  // Start with logo formation
  posVar.material.uniforms.uTargetPosition.value = targetTextures.logo;

  // ── Render mesh ───────────────────────────────────────────────
  // One UV attribute per particle so the vertex shader knows which texel to read
  const uvArr = new Float32Array(N * 2);
  for (let i = 0; i < GPGPU_SIZE; i++) {
    for (let j = 0; j < GPGPU_SIZE; j++) {
      const k = (i * GPGPU_SIZE + j) * 2;
      uvArr[k]     = (j + 0.5) / GPGPU_SIZE;
      uvArr[k + 1] = (i + 0.5) / GPGPU_SIZE;
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('aUv', new THREE.BufferAttribute(uvArr, 2));
  geom.setDrawRange(0, N);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uPosTex:      { value: null },
      uColorA:      { value: colorA },
      uColorB:      { value: colorB },
      uSize:        { value: IS_MOBILE ? 2.4 : 2.2 },
      uMouseWorld:  { value: mouseWorld },
      uMouseRadius: { value: 180.0 },
    },
    vertexShader:   particleVS,
    fragmentShader: particleFS,
    blending:       THREE.AdditiveBlending,
    depthWrite:     false,
    transparent:    true,
  });

  renderMesh = new THREE.Points(geom, mat);
  scene.add(renderMesh);

  // ── Hero cinematic auto-play ──────────────────────────────────
  // Phase 1 (0s):      logo forms
  // Phase 2 (2.0s):    morph to signal-pulse hero rings
  // Phase 3 (4.0s):    stay — scroll takes over from here
  setTimeout(() => particleSystem.morphTo('hero'), 2000);

  // ── Mouse repulsion ───────────────────────────────────────────
  if (IS_TOUCH) {
    // No hover cursor — park the repulsion sphere far off-stage so it
    // doesn't carve a permanent hole in the centre of every formation.
    mouseWorld.set(99999, 99999, 99999);
    renderMesh.material.uniforms.uMouseWorld.value.copy(mouseWorld);
  } else {
    window.addEventListener('mousemove', e => {
      mouseNDC.x =  (e.clientX / innerWidth)  * 2 - 1;
      mouseNDC.y = -(e.clientY / innerHeight) * 2 + 1;

      // Unproject mouse to the z=0 world plane
      const ray = new THREE.Ray();
      ray.origin.setFromMatrixPosition(camera.matrixWorld);
      ray.direction.set(mouseNDC.x, mouseNDC.y, 0.5)
        .unproject(camera)
        .sub(ray.origin)
        .normalize();
      const t = -ray.origin.z / ray.direction.z;
      mouseWorld.set(
        ray.origin.x + ray.direction.x * t,
        ray.origin.y + ray.direction.y * t,
        0
      );
      renderMesh.material.uniforms.uMouseWorld.value.copy(mouseWorld);
    }, { passive: true });
  }

  // ── Resize ────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    composer.setSize(innerWidth, innerHeight);
  });

  // ── Reduced-motion: freeze after first compute ────────────────
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    gpuCompute.compute();
    renderMesh.material.uniforms.uPosTex.value =
      gpuCompute.getCurrentRenderTarget(posVar).texture;
    composer.render();
    return;
  }

  animate();
}

// ── Render loop ───────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();

  // GPGPU step
  posVar.material.uniforms.uTime.value = t;
  gpuCompute.compute();
  renderMesh.material.uniforms.uPosTex.value =
    gpuCompute.getCurrentRenderTarget(posVar).texture;

  // Smooth colour transition between sections
  colorA.lerp(targetA, 0.012);
  colorB.lerp(targetB, 0.012);
  renderMesh.material.uniforms.uColorA.value.copy(colorA);
  renderMesh.material.uniforms.uColorB.value.copy(colorB);

  // Camera gentle parallax following mouse (desktop only)
  if (!IS_TOUCH) {
    camera.position.x += (mouseNDC.x * 28  - camera.position.x) * 0.025;
    camera.position.y += (mouseNDC.y * 18 + 80 - camera.position.y) * 0.025;
    camera.lookAt(0, 0, 0);
  }

  composer.render();
}
