/**
 * STACK & SIGNAL — Galaxy / Neural Nebula Background
 * ~13,500 particles in 4 logarithmic spiral arms with differential rotation,
 * neural connection lines, mouse gravity well, and slow camera orbit.
 */
import * as THREE from 'three';

// ── Configuration ────────────────────────────────────────────
const CFG = {
  N_CORE:          900,      // dense bright core cluster
  N_ARMS:          4,        // spiral arm count
  N_PER_ARM:       3000,     // particles per arm
  N_DUST:          1500,     // scattered background dust
  // TOTAL ≈ 13,500
  RADIUS_MAX:      420,      // world units — max arm radius
  SPIRAL_B:        0.22,     // log spiral tightness
  ARM_SPREAD:      0.38,     // scatter perpendicular to arm (fraction of r)
  BASE_OMEGA:      0.000055, // base angular velocity (rad/frame)
  LINE_DIST:       38,       // max world-unit distance for neural connections
  MAX_LINES:       18000,    // cap line count for GPU budget
  MOUSE_RADIUS:    180,      // gravity well radius (world units)
  MOUSE_GRAVITY:   55,       // gravity well strength
  GRAVITY_DAMPING: 0.88,     // velocity damping for displaced particles
  CAM_TILT:        0.42,     // radians — camera pitch down
  CAM_RADIUS:      680,      // camera orbit radius
  CAM_ORBIT_SPEED: 0.000045, // camera orbit speed (rad/frame)
  GALAXY_Z_THICK:  18,       // vertical disk scatter
  POINT_SIZE_BASE: 1.8,
  LINE_OPACITY:    0.09,
};

// Per-vertex colors (RGB 0–1)
const CORE_COLOR = [200/255, 232/255, 255/255]; // near-white blue
const ARM_INNER  = [0,       194/255, 1.0     ]; // electric cyan
const ARM_OUTER  = [0,       87/255,  1.0     ]; // deep signal blue
const DUST_COLOR = [0,       24/255,  68/255  ]; // very dark blue

// ── State ─────────────────────────────────────────────────────
let renderer, scene, camera;
let pointsMesh, linesMesh;
let N = 0;
let positions;      // Float32Array(N*3) — live XYZ
let colors;         // Float32Array(N*3) — static per-vertex RGB
let orbAngle;       // Float32Array(N) — current orbital angle (XZ plane)
let orbRadius;      // Float32Array(N) — radial distance, constant
let origY;          // Float32Array(N) — original Y height, constant
let dispX, dispZ;   // Float32Array(N) — mouse gravity displacement
let velX, velZ;     // Float32Array(N) — displacement velocity
let lineIndexPairs; // Int32Array([i,j, i,j, ...])
let linePositions;  // Float32Array for line segment endpoints
let camAngle = 0;
let mouseWorldX = 0, mouseWorldZ = 0;
let hasMouse = false;

const raycaster   = new THREE.Raycaster();
const galaxyPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const intersectPt = new THREE.Vector3();

// ── Boot ──────────────────────────────────────────────────────
export function initThreeBg() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060D1A);

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 3000);
  setCameraPosition();

  buildGalaxy();

  window.addEventListener('resize',    onResize,    { passive: true });
  window.addEventListener('mousemove', onMouseMove, { passive: true });

  renderer.setAnimationLoop(animate);
}

// ── Camera orbit ──────────────────────────────────────────────
function setCameraPosition() {
  const hDist = CFG.CAM_RADIUS * Math.cos(CFG.CAM_TILT);
  camera.position.set(
    Math.sin(camAngle) * hDist,
    Math.sin(CFG.CAM_TILT) * CFG.CAM_RADIUS,
    Math.cos(camAngle) * hDist
  );
  camera.lookAt(0, 0, 0);
}

// ── Build galaxy ──────────────────────────────────────────────
function buildGalaxy() {
  const N_ARM_TOTAL = CFG.N_ARMS * CFG.N_PER_ARM;
  N = CFG.N_CORE + N_ARM_TOTAL + CFG.N_DUST;

  positions = new Float32Array(N * 3);
  colors    = new Float32Array(N * 3);
  orbAngle  = new Float32Array(N);
  orbRadius = new Float32Array(N);
  origY     = new Float32Array(N);
  dispX     = new Float32Array(N);
  dispZ     = new Float32Array(N);
  velX      = new Float32Array(N);
  velZ      = new Float32Array(N);

  let idx = 0;

  // ── Core: Box-Muller gaussian cluster ──
  for (let i = 0; i < CFG.N_CORE; i++, idx++) {
    const u   = Math.random() + 1e-9;
    const mag = Math.sqrt(-2 * Math.log(u)) * 28;
    const th  = 2 * Math.PI * Math.random();
    const x   = mag * Math.cos(th);
    const z   = mag * Math.sin(th);
    const y   = (Math.random() - 0.5) * 24;
    positions[idx*3]   = x;
    positions[idx*3+1] = y;
    positions[idx*3+2] = z;
    orbAngle[idx]  = Math.atan2(z, x);
    orbRadius[idx] = Math.sqrt(x*x + z*z);
    origY[idx]     = y;
    colors[idx*3]   = CORE_COLOR[0];
    colors[idx*3+1] = CORE_COLOR[1];
    colors[idx*3+2] = CORE_COLOR[2];
  }

  // ── Arms: logarithmic spiral ──
  const expMax = Math.exp(CFG.SPIRAL_B * 4.5 * Math.PI) - 1;
  for (let arm = 0; arm < CFG.N_ARMS; arm++) {
    const armOff = (arm / CFG.N_ARMS) * 2 * Math.PI;
    for (let i = 0; i < CFG.N_PER_ARM; i++, idx++) {
      const t       = 0.001 + Math.random() * 0.999;
      const angle   = t * 4.5 * Math.PI;
      const r       = ((Math.exp(CFG.SPIRAL_B * angle) - 1) / expMax) * CFG.RADIUS_MAX;
      const scatter = (Math.random() - 0.5) * CFG.ARM_SPREAD * r;
      const totalA  = angle + armOff;
      const x = (r + scatter) * Math.cos(totalA);
      const z = (r + scatter) * Math.sin(totalA);
      const y = (Math.random() - 0.5) * CFG.GALAXY_Z_THICK;
      positions[idx*3]   = x;
      positions[idx*3+1] = y;
      positions[idx*3+2] = z;
      orbAngle[idx]  = Math.atan2(z, x);
      orbRadius[idx] = Math.sqrt(x*x + z*z);
      origY[idx]     = y;
      // Color lerp INNER→OUTER by radius fraction
      const frac = Math.min(r / CFG.RADIUS_MAX, 1);
      colors[idx*3]   = ARM_INNER[0] + (ARM_OUTER[0] - ARM_INNER[0]) * frac;
      colors[idx*3+1] = ARM_INNER[1] + (ARM_OUTER[1] - ARM_INNER[1]) * frac;
      colors[idx*3+2] = ARM_INNER[2] + (ARM_OUTER[2] - ARM_INNER[2]) * frac;
    }
  }

  // ── Dust: uniform disk ──
  for (let i = 0; i < CFG.N_DUST; i++, idx++) {
    const ang = Math.random() * 2 * Math.PI;
    const r   = Math.sqrt(Math.random()) * CFG.RADIUS_MAX * 1.3;
    const x   = r * Math.cos(ang);
    const z   = r * Math.sin(ang);
    const y   = (Math.random() - 0.5) * CFG.GALAXY_Z_THICK * 2;
    positions[idx*3]   = x;
    positions[idx*3+1] = y;
    positions[idx*3+2] = z;
    orbAngle[idx]  = ang;
    orbRadius[idx] = r;
    origY[idx]     = y;
    colors[idx*3]   = DUST_COLOR[0];
    colors[idx*3+1] = DUST_COLOR[1];
    colors[idx*3+2] = DUST_COLOR[2];
  }

  // Points geometry
  const ptGeo = new THREE.BufferGeometry();
  ptGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  ptGeo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));

  const ptMat = new THREE.PointsMaterial({
    vertexColors:    true,
    size:            CFG.POINT_SIZE_BASE,
    sizeAttenuation: true,
    transparent:     true,
    opacity:         0.85,
    depthWrite:      false,
    blending:        THREE.AdditiveBlending,
  });

  pointsMesh = new THREE.Points(ptGeo, ptMat);
  scene.add(pointsMesh);

  buildLines();
}

// ── Build neural lines via spatial grid bucketing ─────────────
function buildLines() {
  const lineN  = CFG.N_CORE + CFG.N_ARMS * CFG.N_PER_ARM; // skip dust
  const cs     = CFG.LINE_DIST;
  const distSq = cs * cs;
  const grid   = new Map();

  // Bucket particles into grid cells
  for (let i = 0; i < lineN; i++) {
    const cx  = Math.floor(positions[i*3]   / cs);
    const cz  = Math.floor(positions[i*3+2] / cs);
    const key = (cx + 1000) * 10000 + (cz + 1000);
    let cell = grid.get(key);
    if (!cell) { cell = []; grid.set(key, cell); }
    cell.push(i);
  }

  const pairsArr = [];

  outer:
  for (let i = 0; i < lineN; i++) {
    const xi = positions[i*3], zi = positions[i*3+2];
    const cx = Math.floor(xi / cs);
    const cz = Math.floor(zi / cs);

    for (let dcx = -1; dcx <= 1; dcx++) {
      for (let dcz = -1; dcz <= 1; dcz++) {
        const cell = grid.get((cx + dcx + 1000) * 10000 + (cz + dcz + 1000));
        if (!cell) continue;
        for (const j of cell) {
          if (j <= i) continue;
          const dx = xi               - positions[j*3];
          const dy = positions[i*3+1] - positions[j*3+1];
          const dz = zi               - positions[j*3+2];
          if (dx*dx + dy*dy + dz*dz < distSq) {
            pairsArr.push(i, j);
            if (pairsArr.length >= CFG.MAX_LINES * 2) break outer;
          }
        }
      }
    }
  }

  lineIndexPairs = new Int32Array(pairsArr);
  const lineCount = lineIndexPairs.length / 2;
  linePositions   = new Float32Array(lineCount * 6);

  // Write initial positions into line buffer
  for (let l = 0; l < lineCount; l++) {
    const i = lineIndexPairs[l*2], j = lineIndexPairs[l*2+1];
    linePositions[l*6]   = positions[i*3];
    linePositions[l*6+1] = positions[i*3+1];
    linePositions[l*6+2] = positions[i*3+2];
    linePositions[l*6+3] = positions[j*3];
    linePositions[l*6+4] = positions[j*3+1];
    linePositions[l*6+5] = positions[j*3+2];
  }

  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));

  const lineMat = new THREE.LineBasicMaterial({
    color:       0x0057FF,
    transparent: true,
    opacity:     CFG.LINE_OPACITY,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  });

  linesMesh = new THREE.LineSegments(lineGeo, lineMat);
  scene.add(linesMesh);
}

// ── Differential orbital rotation ─────────────────────────────
function updateOrbits() {
  for (let i = 0; i < N; i++) {
    const r = orbRadius[i];
    // Inner core spins fast; outer arms slow (Keplerian-ish)
    const omega = r < 30
      ? CFG.BASE_OMEGA * 3
      : CFG.BASE_OMEGA / Math.sqrt(r + 8);
    orbAngle[i] += omega;
    positions[i*3]   = r * Math.cos(orbAngle[i]) + dispX[i];
    positions[i*3+1] = origY[i];
    positions[i*3+2] = r * Math.sin(orbAngle[i]) + dispZ[i];
  }
}

// ── Mouse gravity well ─────────────────────────────────────────
function updateMouseGravity() {
  if (!hasMouse) return;
  const R2 = CFG.MOUSE_RADIUS * CFG.MOUSE_RADIUS;

  for (let i = 0; i < N; i++) {
    const px = positions[i*3];
    const pz = positions[i*3+2];
    const dx = mouseWorldX - px;
    const dz = mouseWorldZ - pz;
    const d2 = dx*dx + dz*dz;

    if (d2 < R2 && d2 > 0.01) {
      const d   = Math.sqrt(d2);
      const inf = 1 - d / CFG.MOUSE_RADIUS;
      const f   = inf * inf * CFG.MOUSE_GRAVITY * 0.018;
      velX[i] += (dx / d) * f;
      velZ[i] += (dz / d) * f;
    }

    // Spring restore toward zero displacement
    velX[i] += -dispX[i] * 0.04;
    velZ[i] += -dispZ[i] * 0.04;
    // Damping
    velX[i] *= CFG.GRAVITY_DAMPING;
    velZ[i] *= CFG.GRAVITY_DAMPING;
    dispX[i] += velX[i];
    dispZ[i] += velZ[i];
  }
}

// ── Sync line buffer from particle positions ───────────────────
function updateLinePositions() {
  const lc = lineIndexPairs.length / 2;
  for (let l = 0; l < lc; l++) {
    const i = lineIndexPairs[l*2], j = lineIndexPairs[l*2+1];
    linePositions[l*6]   = positions[i*3];
    linePositions[l*6+1] = positions[i*3+1];
    linePositions[l*6+2] = positions[i*3+2];
    linePositions[l*6+3] = positions[j*3];
    linePositions[l*6+4] = positions[j*3+1];
    linePositions[l*6+5] = positions[j*3+2];
  }
  linesMesh.geometry.attributes.position.needsUpdate = true;
}

// ── Mouse → galaxy plane projection ───────────────────────────
function onMouseMove(e) {
  hasMouse = true;
  const ndcX =  (e.clientX / window.innerWidth)  * 2 - 1;
  const ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
  if (raycaster.ray.intersectPlane(galaxyPlane, intersectPt)) {
    mouseWorldX = intersectPt.x;
    mouseWorldZ = intersectPt.z;
  }
}

// ── Main animation loop ────────────────────────────────────────
function animate() {
  camAngle += CFG.CAM_ORBIT_SPEED;
  setCameraPosition();
  updateOrbits();
  updateMouseGravity();
  pointsMesh.geometry.attributes.position.needsUpdate = true;
  updateLinePositions();
  renderer.render(scene, camera);
}

// ── Resize ─────────────────────────────────────────────────────
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
