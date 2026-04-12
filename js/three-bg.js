/**
 * STACK & SIGNAL — Three.js Digital Signal Background
 * A mouse-reactive grid of glowing points and connecting lines
 * with a heartbeat pulse animation.
 */
import * as THREE from 'three';

// ── Configuration ────────────────────────────────────────────
const CFG = {
  GRID_COLS:            28,
  GRID_ROWS:            18,
  POINT_SPACING_X:      null,   // computed from viewport
  POINT_SPACING_Y:      null,   // computed from viewport
  CONNECTION_DIST:      120,    // world-unit radius for drawing a line
  MOUSE_RADIUS:         160,    // world-unit radius of mouse influence
  MOUSE_STRENGTH:       28,     // max displacement
  SPRING_STIFFNESS:     0.08,
  SPRING_DAMPING:       0.82,
  HEARTBEAT_INTERVAL:   3200,   // ms between pulses
  HEARTBEAT_DURATION:   1800,   // ms for one pulse to cross grid
  POINT_COLOR:          0x00C2FF,
  LINE_COLOR:           0x0057FF,
  LINE_COLOR_PULSE:     0x00C2FF,
  POINT_OPACITY:        0.65,
  LINE_OPACITY_BASE:    0.12,
  LINE_OPACITY_PULSE:   0.55,
  POINT_SIZE:           2.2,
  CAM_Z:                550,
};

// ── State ────────────────────────────────────────────────────
let renderer, scene, camera;
let pointsMesh, linesMesh;
let pointPositions, origX, origY, velX, velY;
let lineIndices   = [];  // pairs of indices connected by lines
let linePositions;       // Float32Array for line geometry
let N = 0;               // total point count

let mouseWorldX = -9999, mouseWorldY = -9999;

let pulseActive    = false;
let pulseStartTime = 0;
let pulseOriginX   = 0;

// ── Boot ─────────────────────────────────────────────────────
export function initThreeBg() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;

  // Renderer
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060D1A);

  // Camera — perspective, near-flat view of 2D grid
  camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    1, 2000
  );
  camera.position.set(0, 0, CFG.CAM_Z);
  camera.lookAt(0, 0, 0);

  buildGrid();

  // Events
  window.addEventListener('resize',    onResize,    { passive: true });
  window.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });

  // Heartbeat pulse
  setTimeout(triggerPulse, 1200);
  setInterval(triggerPulse, CFG.HEARTBEAT_INTERVAL);

  // Animation loop
  renderer.setAnimationLoop(animate);
}

// ── Grid Construction ────────────────────────────────────────
function buildGrid() {
  N = CFG.GRID_COLS * CFG.GRID_ROWS;

  // Compute spacing so grid fills ~85% of viewport
  const vFOV = (camera.fov * Math.PI) / 180;
  const viewH = 2 * Math.tan(vFOV / 2) * CFG.CAM_Z;
  const viewW = viewH * camera.aspect;
  CFG.POINT_SPACING_X = (viewW * 0.95) / (CFG.GRID_COLS - 1);
  CFG.POINT_SPACING_Y = (viewH * 0.95) / (CFG.GRID_ROWS - 1);

  const halfW = ((CFG.GRID_COLS - 1) * CFG.POINT_SPACING_X) / 2;
  const halfH = ((CFG.GRID_ROWS - 1) * CFG.POINT_SPACING_Y) / 2;

  origX = new Float32Array(N);
  origY = new Float32Array(N);
  velX  = new Float32Array(N);
  velY  = new Float32Array(N);

  pointPositions = new Float32Array(N * 3);

  for (let row = 0; row < CFG.GRID_ROWS; row++) {
    for (let col = 0; col < CFG.GRID_COLS; col++) {
      const i = row * CFG.GRID_COLS + col;
      const x = col * CFG.POINT_SPACING_X - halfW;
      const y = row * CFG.POINT_SPACING_Y - halfH;
      origX[i] = x;
      origY[i] = y;
      pointPositions[i * 3]     = x;
      pointPositions[i * 3 + 1] = y;
      pointPositions[i * 3 + 2] = 0;
    }
  }

  // ── Points mesh ──
  const ptGeo = new THREE.BufferGeometry();
  ptGeo.setAttribute('position', new THREE.BufferAttribute(pointPositions, 3));

  const ptMat = new THREE.PointsMaterial({
    color:       CFG.POINT_COLOR,
    size:        CFG.POINT_SIZE,
    transparent: true,
    opacity:     CFG.POINT_OPACITY,
    sizeAttenuation: false,
    depthWrite:  false,
  });

  pointsMesh = new THREE.Points(ptGeo, ptMat);
  scene.add(pointsMesh);

  // ── Lines mesh ──
  buildLineGeometry();
}

function buildLineGeometry() {
  // Collect adjacent pairs (horizontal, vertical, diagonal)
  lineIndices = [];

  for (let i = 0; i < N; i++) {
    const row = Math.floor(i / CFG.GRID_COLS);
    const col = i % CFG.GRID_COLS;

    // right, down, diagonal-right-down, diagonal-left-down
    const neighbors = [
      col < CFG.GRID_COLS - 1 ? i + 1 : -1,
      row < CFG.GRID_ROWS - 1 ? i + CFG.GRID_COLS : -1,
      (col < CFG.GRID_COLS - 1 && row < CFG.GRID_ROWS - 1) ? i + CFG.GRID_COLS + 1 : -1,
      (col > 0 && row < CFG.GRID_ROWS - 1)                  ? i + CFG.GRID_COLS - 1 : -1,
    ];

    for (const j of neighbors) {
      if (j !== -1) lineIndices.push(i, j);
    }
  }

  linePositions = new Float32Array(lineIndices.length * 3);

  // Populate initial positions
  updateLinePositions();

  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));

  const lineMat = new THREE.LineBasicMaterial({
    color:       CFG.LINE_COLOR,
    transparent: true,
    opacity:     CFG.LINE_OPACITY_BASE,
    depthWrite:  false,
  });

  linesMesh = new THREE.LineSegments(lineGeo, lineMat);
  scene.add(linesMesh);
}

function updateLinePositions() {
  for (let k = 0; k < lineIndices.length; k++) {
    const i = lineIndices[k];
    linePositions[k * 3]     = pointPositions[i * 3];
    linePositions[k * 3 + 1] = pointPositions[i * 3 + 1];
    linePositions[k * 3 + 2] = 0;
  }
}

// ── Animation Loop ───────────────────────────────────────────
function animate() {
  updatePhysics();
  updatePulse();
  updateLinePositions();

  linesMesh.geometry.attributes.position.needsUpdate  = true;
  pointsMesh.geometry.attributes.position.needsUpdate = true;

  renderer.render(scene, camera);
}

// ── Spring Physics for Points ────────────────────────────────
function updatePhysics() {
  for (let i = 0; i < N; i++) {
    const cx = pointPositions[i * 3];
    const cy = pointPositions[i * 3 + 1];

    // Restore spring toward origin
    let fx = (origX[i] - cx) * CFG.SPRING_STIFFNESS;
    let fy = (origY[i] - cy) * CFG.SPRING_STIFFNESS;

    // Mouse repulsion
    const dx = cx - mouseWorldX;
    const dy = cy - mouseWorldY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < CFG.MOUSE_RADIUS && dist > 0.01) {
      const influence = (1 - dist / CFG.MOUSE_RADIUS);
      const force = influence * influence * CFG.MOUSE_STRENGTH;
      fx += (dx / dist) * force * 0.12;
      fy += (dy / dist) * force * 0.12;
    }

    // Integrate velocity
    velX[i] = (velX[i] + fx) * CFG.SPRING_DAMPING;
    velY[i] = (velY[i] + fy) * CFG.SPRING_DAMPING;

    pointPositions[i * 3]     = cx + velX[i];
    pointPositions[i * 3 + 1] = cy + velY[i];
  }
}

// ── Heartbeat Pulse ──────────────────────────────────────────
function triggerPulse() {
  pulseActive    = true;
  pulseStartTime = performance.now();

  // Compute grid width for speed calculation
  const vFOV = (camera.fov * Math.PI) / 180;
  const viewH = 2 * Math.tan(vFOV / 2) * CFG.CAM_Z;
  const viewW = viewH * camera.aspect;
  pulseOriginX = -(viewW * 0.52);
}

function updatePulse() {
  if (!pulseActive) {
    linesMesh.material.opacity = CFG.LINE_OPACITY_BASE;
    return;
  }

  const elapsed  = performance.now() - pulseStartTime;
  const progress = elapsed / CFG.HEARTBEAT_DURATION;

  if (progress >= 1) {
    pulseActive = false;
    linesMesh.material.opacity = CFG.LINE_OPACITY_BASE;
    return;
  }

  // Wave front X position
  const vFOV = (camera.fov * Math.PI) / 180;
  const viewH = 2 * Math.tan(vFOV / 2) * CFG.CAM_Z;
  const viewW = viewH * camera.aspect;
  const waveX = pulseOriginX + progress * viewW * 1.1;

  // Global opacity boost — peaks mid-pulse with a smooth bell
  const bell = Math.sin(progress * Math.PI);
  linesMesh.material.opacity = CFG.LINE_OPACITY_BASE + bell * 0.22;
  linesMesh.material.color.setHex(
    progress < 0.5 ? CFG.LINE_COLOR : CFG.LINE_COLOR_PULSE
  );

  // Point brightness wave
  const ptOpacity = CFG.POINT_OPACITY + bell * 0.25;
  pointsMesh.material.opacity = Math.min(ptOpacity, 0.95);

  // Gently push points near the wave front
  const WAVE_HALF = 80;
  for (let i = 0; i < N; i++) {
    const px = origX[i];
    const distToWave = Math.abs(px - waveX);
    if (distToWave < WAVE_HALF) {
      const waveFactor = (1 - distToWave / WAVE_HALF) * 6;
      velY[i] += Math.sin(elapsed * 0.008) * waveFactor * 0.3;
    }
  }
}

// ── Mouse / Touch ────────────────────────────────────────────
function onMouseMove(e) {
  mouseWorldX = ((e.clientX / window.innerWidth)  * 2 - 1) * getViewHalfW();
  mouseWorldY = (-(e.clientY / window.innerHeight) * 2 + 1) * getViewHalfH();
}

function onTouchMove(e) {
  if (!e.touches.length) return;
  const t = e.touches[0];
  mouseWorldX = ((t.clientX / window.innerWidth)  * 2 - 1) * getViewHalfW();
  mouseWorldY = (-(t.clientY / window.innerHeight) * 2 + 1) * getViewHalfH();
}

function getViewHalfW() {
  const vFOV = (camera.fov * Math.PI) / 180;
  const viewH = 2 * Math.tan(vFOV / 2) * CFG.CAM_Z;
  return (viewH * camera.aspect) / 2;
}

function getViewHalfH() {
  const vFOV = (camera.fov * Math.PI) / 180;
  return (2 * Math.tan(vFOV / 2) * CFG.CAM_Z) / 2;
}

// ── Resize ───────────────────────────────────────────────────
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Rebuild grid to match new viewport dimensions
  scene.remove(pointsMesh);
  scene.remove(linesMesh);
  pointsMesh.geometry.dispose();
  linesMesh.geometry.dispose();
  buildGrid();
}
