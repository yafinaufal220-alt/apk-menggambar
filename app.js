/**
 * app.js — HandDraw 3D
 * ─────────────────────────────────────────────────────────────
 * Menggambar di ruang 3D menggunakan gerakan tangan.
 *
 * GESTURE:
 *  ☝️  Telunjuk saja        → DRAW (menggambar)
 *  ✌️  Telunjuk + Tengah   → PAUSE (angkat pena)
 *  🤚  Semua jari terbuka  → ERASE last stroke
 *  👌  OK (thumb+index)    → ROTATE (putar kanvas)
 *  ✊  Kepalan             → CLEAR ALL
 *
 * Koordinat 3D:
 *  X = posisi horizontal tangan (kiri-kanan)
 *  Y = posisi vertikal tangan (atas-bawah)
 *  Z = kedalaman dari MediaPipe (maju-mundur)
 */

// ── DOM ───────────────────────────────────────────────────────
const video      = document.getElementById('video');
const camCanvas  = document.getElementById('cam-canvas');
const drawCanvas = document.getElementById('draw-canvas');
const camCtx     = camCanvas.getContext('2d');
const drawCtx    = drawCanvas.getContext('2d');

const statusDot   = document.getElementById('status-dot');
const statusText  = document.getElementById('status-text');
const startOverlay= document.getElementById('start-overlay');
const startBtn    = document.getElementById('start-btn');
const modeDot     = document.getElementById('mode-dot');
const modeLabel   = document.getElementById('mode-label');
const canvasHint  = document.getElementById('canvas-hint');
const fpsVal      = document.getElementById('fps-val');
const statStrokes = document.getElementById('stat-strokes');
const statPoints  = document.getElementById('stat-points');
const viX = document.getElementById('vi-x');
const viY = document.getElementById('vi-y');
const viZ = document.getElementById('vi-z');
const arLabel = document.getElementById('ar-label');

// ── State ─────────────────────────────────────────────────────
let currentColor  = '#4a7cf7';
let brushSize     = 6;
let zSensitivity  = 5;
let handsReady    = false;
let currentGesture = 'none';

// 3D view rotation
let rotX = -20;   // derajat
let rotY = 30;
let zoom = 1.0;
let autoRotate = false;
let autoRotateSpeed = 0.3;

// Mouse/touch drag for manual rotation
let isDragging = false;
let dragStart  = { x: 0, y: 0 };
let rotStart   = { x: 0, y: 0 };

// Drawing strokes: array of arrays of {x,y,z,color,size}
let strokes = [];
let currentStroke = [];
let isDrawing = false;

// Rotate mode
let isRotating = false;
let rotateStart = null;
let rotStartX = 0, rotStartY = 0;

// FPS
let frameCount = 0;
let lastFpsTime = performance.now();

// ── Color swatches ────────────────────────────────────────────
document.querySelectorAll('.color-swatch').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    el.classList.add('active');
    currentColor = el.dataset.color;
  });
});

// ── Sliders ───────────────────────────────────────────────────
document.getElementById('brush-size').addEventListener('input', e => {
  brushSize = parseInt(e.target.value);
  document.getElementById('brush-val').textContent = brushSize + 'px';
});
document.getElementById('z-sens').addEventListener('input', e => {
  zSensitivity = parseInt(e.target.value);
  document.getElementById('z-val').textContent = zSensitivity + 'x';
});

// ── Actions ───────────────────────────────────────────────────
function undoStroke() {
  if (strokes.length > 0) { strokes.pop(); renderScene(); updateStats(); }
}
function clearAll() {
  strokes = []; currentStroke = []; isDrawing = false;
  renderScene(); updateStats();
}
function resetView() {
  rotX = -20; rotY = 30; zoom = 1.0; renderScene();
}
function toggleAutoRotate() {
  autoRotate = !autoRotate;
  arLabel.textContent = autoRotate ? 'Stop Putar' : 'Auto Putar';
}
window.undoStroke = undoStroke;
window.clearAll   = clearAll;
window.resetView  = resetView;
window.toggleAutoRotate = toggleAutoRotate;

function updateStats() {
  statStrokes.textContent = strokes.length;
  const pts = strokes.reduce((s, str) => s + str.length, 0);
  statPoints.textContent = pts;
}

// ── 3D Projection ─────────────────────────────────────────────
function project3D(x, y, z) {
  const W = drawCanvas.width;
  const H = drawCanvas.height;

  // Rotasi X (pitch)
  const radX = rotX * Math.PI / 180;
  const y1 = y * Math.cos(radX) - z * Math.sin(radX);
  const z1 = y * Math.sin(radX) + z * Math.cos(radX);

  // Rotasi Y (yaw)
  const radY = rotY * Math.PI / 180;
  const x2 = x * Math.cos(radY) + z1 * Math.sin(radY);
  const z2 = -x * Math.sin(radY) + z1 * Math.cos(radY);

  // Perspektif
  const fov = 600 * zoom;
  const perspective = fov / (fov + z2 + 300);

  const px = W / 2 + x2 * perspective;
  const py = H / 2 + y1 * perspective;
  const scale = perspective;

  return { px, py, scale };
}

// ── Render 3D Scene ───────────────────────────────────────────
function renderScene() {
  const W = drawCanvas.width  = drawCanvas.offsetWidth;
  const H = drawCanvas.height = drawCanvas.offsetHeight;

  drawCtx.clearRect(0, 0, W, H);

  // Grid dasar 3D (lantai)
  drawGrid();

  // Sumbu XYZ
  drawAxes();

  // Gambar semua stroke
  [...strokes, currentStroke.length > 0 ? currentStroke : []].forEach(stroke => {
    if (stroke.length < 1) return;
    drawStroke3D(stroke);
  });

  // Update info
  viX.textContent = Math.round(rotX) + '°';
  viY.textContent = Math.round(rotY) + '°';
  viZ.textContent = zoom.toFixed(1) + 'x';
}

function drawGrid() {
  const gridSize = 300;
  const step     = 60;
  drawCtx.strokeStyle = 'rgba(255,255,255,0.04)';
  drawCtx.lineWidth   = 1;

  for (let i = -gridSize; i <= gridSize; i += step) {
    // Garis searah X
    const a = project3D(i, 0, -gridSize);
    const b = project3D(i, 0,  gridSize);
    drawCtx.beginPath();
    drawCtx.moveTo(a.px, a.py);
    drawCtx.lineTo(b.px, b.py);
    drawCtx.stroke();

    // Garis searah Z
    const c = project3D(-gridSize, 0, i);
    const d = project3D( gridSize, 0, i);
    drawCtx.beginPath();
    drawCtx.moveTo(c.px, c.py);
    drawCtx.lineTo(d.px, d.py);
    drawCtx.stroke();
  }
}

function drawAxes() {
  const len = 120;
  const axes = [
    { from: [0,0,0], to: [len,0,0], color: 'rgba(255,80,80,0.5)',  label: 'X' },
    { from: [0,0,0], to: [0,-len,0], color: 'rgba(80,255,80,0.5)',  label: 'Y' },
    { from: [0,0,0], to: [0,0,len], color: 'rgba(80,80,255,0.5)',  label: 'Z' },
  ];
  axes.forEach(ax => {
    const a = project3D(...ax.from);
    const b = project3D(...ax.to);
    drawCtx.strokeStyle = ax.color;
    drawCtx.lineWidth = 1.5;
    drawCtx.beginPath();
    drawCtx.moveTo(a.px, a.py);
    drawCtx.lineTo(b.px, b.py);
    drawCtx.stroke();
    drawCtx.fillStyle = ax.color;
    drawCtx.font = '11px monospace';
    drawCtx.fillText(ax.label, b.px + 4, b.py + 4);
  });
}

function drawStroke3D(stroke) {
  if (stroke.length === 0) return;

  for (let i = 0; i < stroke.length; i++) {
    const pt = stroke[i];
    const { px, py, scale } = project3D(pt.x, pt.y, pt.z);
    const r = Math.max(1, pt.size * scale);

    // Hubungkan ke titik sebelumnya
    if (i > 0) {
      const prev = stroke[i - 1];
      const { px: px0, py: py0 } = project3D(prev.x, prev.y, prev.z);
      drawCtx.strokeStyle = pt.color;
      drawCtx.lineWidth   = r * 1.5;
      drawCtx.lineCap     = 'round';
      drawCtx.lineJoin    = 'round';
      drawCtx.globalAlpha = 0.85;
      drawCtx.beginPath();
      drawCtx.moveTo(px0, py0);
      drawCtx.lineTo(px, py);
      drawCtx.stroke();
    }

    // Titik
    drawCtx.globalAlpha = 0.95;
    drawCtx.fillStyle   = pt.color;
    drawCtx.beginPath();
    drawCtx.arc(px, py, r, 0, Math.PI * 2);
    drawCtx.fill();
  }
  drawCtx.globalAlpha = 1;
}

// ── Animation Loop ────────────────────────────────────────────
function animLoop() {
  requestAnimationFrame(animLoop);

  // Auto rotate
  if (autoRotate) {
    rotY += autoRotateSpeed;
    renderScene();
  }

  // FPS
  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    fpsVal.textContent = Math.round(frameCount * 1000 / (now - lastFpsTime));
    frameCount = 0;
    lastFpsTime = now;
  }
}
animLoop();

// ── Mouse / Touch drag to rotate ──────────────────────────────
const cs = document.querySelector('.canvas-section');

cs.addEventListener('mousedown', e => {
  isDragging = true;
  dragStart  = { x: e.clientX, y: e.clientY };
  rotStart   = { x: rotX, y: rotY };
});
cs.addEventListener('mousemove', e => {
  if (!isDragging) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  rotY = rotStart.y + dx * 0.4;
  rotX = rotStart.x + dy * 0.4;
  renderScene();
});
cs.addEventListener('mouseup',   () => { isDragging = false; });
cs.addEventListener('mouseleave',() => { isDragging = false; });

// Touch
cs.addEventListener('touchstart', e => {
  if (e.touches.length === 1) {
    isDragging = true;
    dragStart  = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    rotStart   = { x: rotX, y: rotY };
  }
}, { passive: true });
cs.addEventListener('touchmove', e => {
  if (!isDragging || e.touches.length !== 1) return;
  const dx = e.touches[0].clientX - dragStart.x;
  const dy = e.touches[0].clientY - dragStart.y;
  rotY = rotStart.y + dx * 0.4;
  rotX = rotStart.x + dy * 0.4;
  renderScene();
}, { passive: true });
cs.addEventListener('touchend', () => { isDragging = false; });

// Scroll to zoom
cs.addEventListener('wheel', e => {
  e.preventDefault();
  zoom = Math.max(0.3, Math.min(3, zoom - e.deltaY * 0.001));
  renderScene();
}, { passive: false });

// ── Gesture Detector ──────────────────────────────────────────
function detectGesture(lm) {
  function isUp(tip, pip) { return lm[tip].y < lm[pip].y; }
  function dist(a, b) { return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2); }

  const index  = isUp(8, 6);
  const middle = isUp(12, 10);
  const ring   = isUp(16, 14);
  const pinky  = isUp(20, 18);
  const thumbOut = lm[4].x < lm[3].x;

  const extCount = [index, middle, ring, pinky].filter(Boolean).length;

  // DRAW: hanya telunjuk
  if (index && !middle && !ring && !pinky && !thumbOut) return 'draw';

  // PAUSE: V (telunjuk + tengah)
  if (index && middle && !ring && !pinky && !thumbOut) return 'pause';

  // OPEN / ERASE: semua jari terbuka
  if (extCount === 4 && !thumbOut) return 'erase';

  // OK / ROTATE: ibu jari + telunjuk membentuk lingkaran, jari lain naik
  if (dist(lm[4], lm[8]) < 0.10 && !index && middle && ring && pinky) return 'rotate';

  // FIST / CLEAR
  if (extCount === 0 && !thumbOut) return 'clear';

  return 'none';
}

// ── Update gesture UI ─────────────────────────────────────────
const gestureConfig = {
  draw:   { dot: 'draw',   label: '✏️ Menggambar',    statusId: 'gs-draw' },
  pause:  { dot: 'pause',  label: '⏸ Jeda',           statusId: 'gs-pause' },
  erase:  { dot: 'erase',  label: '🗑 Hapus Terakhir', statusId: 'gs-erase' },
  rotate: { dot: 'rotate', label: '🔄 Putar Kanvas',   statusId: 'gs-rotate' },
  clear:  { dot: 'clear',  label: '💥 Hapus Semua',    statusId: 'gs-clear' },
  none:   { dot: '',       label: '— Tidak ada',        statusId: null },
};

let clearHoldStart = 0;
let eraseHoldStart = 0;
const HOLD_TIME = 1200; // ms

function updateGestureUI(gesture) {
  const cfg = gestureConfig[gesture] || gestureConfig['none'];
  modeDot.className  = cfg.dot;
  modeLabel.textContent = cfg.label;

  // Reset semua status dot
  Object.values(gestureConfig).forEach(c => {
    if (c.statusId) document.getElementById(c.statusId).classList.remove('on');
  });
  if (cfg.statusId) document.getElementById(cfg.statusId).classList.add('on');

  // Highlight gesture item
  document.querySelectorAll('.gesture-item').forEach(el => el.classList.remove('active'));
  if (cfg.statusId) {
    const statusEl = document.getElementById(cfg.statusId);
    if (statusEl) statusEl.closest('.gesture-item').classList.add('active');
  }
}

// ── Hand coordinate to 3D space ───────────────────────────────
function landmarkTo3D(lm) {
  // Ujung telunjuk = landmark 8
  const tip = lm[8];
  // Pusat telapak = landmark 9
  const palm = lm[9];

  // X: -300 sampai 300 (kiri ke kanan, dibalik karena mirror)
  const x = -(tip.x - 0.5) * 600;
  // Y: -300 sampai 300 (atas ke bawah)
  const y = -(tip.y - 0.5) * 500;
  // Z: kedalaman dari MediaPipe (tip.z negatif = lebih dekat ke kamera)
  const z = tip.z * zSensitivity * -300;

  return { x, y, z };
}

// Untuk mode rotate: ambil posisi telapak
function palmTo3D(lm) {
  const palm = lm[9];
  return {
    x: -(palm.x - 0.5) * 600,
    y: -(palm.y - 0.5) * 500,
  };
}

// ── MediaPipe onResults ───────────────────────────────────────
function onResults(results) {
  // Draw cam skeleton
  camCanvas.width  = video.videoWidth  || 640;
  camCanvas.height = video.videoHeight || 480;
  camCtx.clearRect(0, 0, camCanvas.width, camCanvas.height);

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    currentGesture = 'none';
    updateGestureUI('none');
    if (isDrawing && currentStroke.length > 1) {
      strokes.push([...currentStroke]);
      updateStats();
    }
    currentStroke = [];
    isDrawing     = false;
    isRotating    = false;
    return;
  }

  const lm = results.multiHandLandmarks[0];

  // Gambar skeleton di kamera
  if (typeof drawConnectors !== 'undefined') {
    drawConnectors(camCtx, lm, HAND_CONNECTIONS, { color: 'rgba(74,124,247,0.6)', lineWidth: 2 });
    drawLandmarks(camCtx, lm, { color: '#fff', fillColor: currentColor, lineWidth: 1, radius: 3 });
  }

  const gesture = detectGesture(lm);
  currentGesture = gesture;
  updateGestureUI(gesture);

  const pos3D = landmarkTo3D(lm);
  const now   = Date.now();

  // ── DRAW ──
  if (gesture === 'draw') {
    canvasHint.classList.add('hidden');
    clearHoldStart = 0;
    eraseHoldStart = 0;
    isRotating     = false;

    if (!isDrawing) {
      currentStroke = [];
      isDrawing     = true;
    }
    currentStroke.push({
      x: pos3D.x, y: pos3D.y, z: pos3D.z,
      color: currentColor,
      size:  brushSize,
    });
    renderScene();
  }

  // ── PAUSE ──
  else if (gesture === 'pause') {
    clearHoldStart = 0;
    eraseHoldStart = 0;
    isRotating     = false;

    if (isDrawing && currentStroke.length > 1) {
      strokes.push([...currentStroke]);
      updateStats();
    }
    currentStroke = [];
    isDrawing     = false;
  }

  // ── ERASE (tahan 1.2 detik) ──
  else if (gesture === 'erase') {
    if (isDrawing && currentStroke.length > 1) {
      strokes.push([...currentStroke]);
    }
    currentStroke = [];
    isDrawing     = false;

    if (eraseHoldStart === 0) eraseHoldStart = now;
    const held = now - eraseHoldStart;
    if (held >= HOLD_TIME) {
      if (strokes.length > 0) { strokes.pop(); renderScene(); updateStats(); }
      eraseHoldStart = 0;
    }
    clearHoldStart = 0;
  }

  // ── ROTATE ──
  else if (gesture === 'rotate') {
    clearHoldStart = 0;
    eraseHoldStart = 0;

    if (isDrawing && currentStroke.length > 1) {
      strokes.push([...currentStroke]);
    }
    currentStroke = [];
    isDrawing     = false;

    const palmPos = palmTo3D(lm);
    if (!isRotating) {
      isRotating  = true;
      rotateStart = palmPos;
      rotStartX   = rotX;
      rotStartY   = rotY;
    } else {
      const dx = palmPos.x - rotateStart.x;
      const dy = palmPos.y - rotateStart.y;
      rotY = rotStartY + dx * 0.15;
      rotX = rotStartX + dy * 0.15;
      renderScene();
    }
  }

  // ── CLEAR ALL (tahan 1.2 detik) ──
  else if (gesture === 'clear') {
    eraseHoldStart = 0;
    isRotating     = false;

    if (isDrawing && currentStroke.length > 1) {
      strokes.push([...currentStroke]);
    }
    currentStroke = [];
    isDrawing     = false;

    if (clearHoldStart === 0) clearHoldStart = now;
    const held = now - clearHoldStart;
    if (held >= HOLD_TIME) {
      strokes = [];
      renderScene();
      updateStats();
      clearHoldStart = 0;
    }
  }

  // ── NONE ──
  else {
    clearHoldStart = 0;
    eraseHoldStart = 0;
    isRotating     = false;

    if (isDrawing && currentStroke.length > 1) {
      strokes.push([...currentStroke]);
      updateStats();
    }
    currentStroke = [];
    isDrawing     = false;
  }
}

// ── Start Camera ──────────────────────────────────────────────
startBtn.addEventListener('click', async () => {
  startBtn.disabled    = true;
  startBtn.textContent = 'Memuat...';
  statusText.textContent = 'Meminta izin kamera...';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
    });
    video.srcObject = stream;

    video.onloadedmetadata = () => {
      video.play();
      statusText.textContent = 'Memuat model MediaPipe...';

      const mp = new Hands({
        locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
      });
      mp.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.65,
        minTrackingConfidence: 0.55,
      });
      mp.onResults(onResults);

      const cam = new Camera(video, {
        onFrame: async () => { if (handsReady) await mp.send({ image: video }); },
        width: 1280, height: 720,
      });

      cam.start().then(() => {
        handsReady = true;
        startOverlay.style.display = 'none';
        statusDot.classList.add('active');
        statusText.textContent = 'Kamera aktif — gunakan isyarat tangan untuk menggambar';
        renderScene();
      }).catch(e => showError(e.message));
    };
  } catch(e) {
    showError(e.message);
    startBtn.disabled    = false;
    startBtn.textContent = '▶ Mulai Kamera';
  }
});

function showError(msg) {
  statusText.textContent = 'Error: ' + msg;
  statusDot.style.background = '#f45f5f';
}

// ── Keyboard shortcuts ────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'z' || e.key === 'Z') undoStroke();
  if (e.key === 'c' || e.key === 'C') clearAll();
  if (e.key === 'r' || e.key === 'R') resetView();
  if (e.key === 'a' || e.key === 'A') toggleAutoRotate();
});

// Initial render
renderScene();
