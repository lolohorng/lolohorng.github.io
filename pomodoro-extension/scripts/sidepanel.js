import * as THREE from '../vendor/three/build/three.module.min.js';
import { GLTFLoader } from '../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from '../vendor/three/examples/jsm/loaders/DRACOLoader.js';

const MODEL_URL = '../assets/tomato19.glb';
const DRACO_DECODER_PATH = '../vendor/three/examples/jsm/libs/draco/gltf/';

const DEFAULT_SETTINGS = { pomodoro: 25, 'short-break': 5, 'long-break': 15 };
const TYPE_LABELS = { pomodoro: 'pomodoro', 'short-break': 'short break', 'long-break': 'long break' };
const PRESET_ORDER = ['pomodoro', 'short-break', 'long-break'];

const STORAGE_KEY = 'tomatoPomodoroState';

// ---- DOM ----
const canvas = document.getElementById('three-canvas');
const canvasWrap = document.getElementById('canvas-wrap');
const loadingEl = document.getElementById('loading');
const timerDisplay = document.getElementById('timer-display');
const chevronUp = document.getElementById('chevron-up');
const chevronDown = document.getElementById('chevron-down');
const playBtn = document.getElementById('play-btn');
const presetBtn = document.getElementById('preset-btn');
const queueHeading = document.getElementById('queue-heading');
const queueList = document.getElementById('queue-list');
const addQueueBtn = document.getElementById('add-queue-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const settingInputs = {
  pomodoro: document.getElementById('setting-pomodoro'),
  'short-break': document.getElementById('setting-short'),
  'long-break': document.getElementById('setting-long'),
};

// ---- state ----
let settings = { ...DEFAULT_SETTINGS };
let queue = [
  { id: crypto.randomUUID(), type: 'short-break', minutes: 5 },
  { id: crypto.randomUUID(), type: 'pomodoro', minutes: 25 },
  { id: crypto.randomUUID(), type: 'short-break', minutes: 5 },
];
let current = { type: 'pomodoro', minutes: 25 };
let remainingSeconds = current.minutes * 60;
let running = false;
let intervalId = null;
let addPresetIndex = 0;

function persist() {
  chrome.storage?.local?.set({
    [STORAGE_KEY]: { settings, queue, current, remainingSeconds, addPresetIndex },
  });
}

function restore() {
  chrome.storage?.local?.get(STORAGE_KEY, (result) => {
    const saved = result?.[STORAGE_KEY];
    if (!saved) return;
    settings = { ...DEFAULT_SETTINGS, ...saved.settings };
    if (Array.isArray(saved.queue)) queue = saved.queue;
    if (saved.current) current = saved.current;
    if (typeof saved.remainingSeconds === 'number') remainingSeconds = saved.remainingSeconds;
    if (typeof saved.addPresetIndex === 'number') addPresetIndex = saved.addPresetIndex;
    renderQueue();
    renderTimer();
    syncDialToMinutes(current.minutes);
    syncSettingsInputs();
  });
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderTimer() {
  timerDisplay.textContent = formatTime(Math.max(remainingSeconds, 0));
}

function renderQueue() {
  queueList.innerHTML = '';
  queueHeading.hidden = queue.length === 0;

  queue.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'queue-item';
    li.draggable = true;
    li.dataset.id = item.id;

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '☰';

    const name = document.createElement('span');
    name.className = 'queue-item-name';
    name.textContent = TYPE_LABELS[item.type] ?? item.type;

    const duration = document.createElement('span');
    duration.className = 'queue-item-duration';
    duration.textContent = `${item.minutes} min.`;

    const del = document.createElement('button');
    del.className = 'queue-item-delete';
    del.setAttribute('aria-label', 'Remove');
    del.textContent = '🗑';
    del.addEventListener('click', () => {
      queue = queue.filter((q) => q.id !== item.id);
      renderQueue();
      persist();
    });

    li.append(handle, name, duration, del);
    wireDragEvents(li);
    queueList.appendChild(li);
  });
}

let dragSourceId = null;

function wireDragEvents(li) {
  li.addEventListener('dragstart', () => {
    dragSourceId = li.dataset.id;
    li.classList.add('dragging');
  });
  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    queueList.querySelectorAll('.queue-item').forEach((el) => el.classList.remove('drag-over'));
  });
  li.addEventListener('dragover', (e) => {
    e.preventDefault();
    li.classList.add('drag-over');
  });
  li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
  li.addEventListener('drop', (e) => {
    e.preventDefault();
    li.classList.remove('drag-over');
    const targetId = li.dataset.id;
    if (!dragSourceId || dragSourceId === targetId) return;

    const fromIndex = queue.findIndex((q) => q.id === dragSourceId);
    const toIndex = queue.findIndex((q) => q.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const [moved] = queue.splice(fromIndex, 1);
    queue.splice(toIndex, 0, moved);
    dragSourceId = null;
    renderQueue();
    persist();
  });
}

function syncSettingsInputs() {
  settingInputs.pomodoro.value = settings.pomodoro;
  settingInputs['short-break'].value = settings['short-break'];
  settingInputs['long-break'].value = settings['long-break'];
}

// ---- add to queue / presets ----
function updatePresetButton() {
  const type = PRESET_ORDER[addPresetIndex];
  presetBtn.title = `Add to queue: ${TYPE_LABELS[type]} (click to cycle)`;
}

presetBtn.addEventListener('click', () => {
  addPresetIndex = (addPresetIndex + 1) % PRESET_ORDER.length;
  updatePresetButton();
  persist();
});

addQueueBtn.addEventListener('click', () => {
  const type = PRESET_ORDER[addPresetIndex];
  queue.push({ id: crypto.randomUUID(), type, minutes: settings[type] });
  renderQueue();
  persist();
});

// ---- settings overlay ----
settingsBtn.addEventListener('click', () => {
  syncSettingsInputs();
  settingsOverlay.hidden = false;
});

settingsCloseBtn.addEventListener('click', () => {
  settings.pomodoro = clampMinutes(settingInputs.pomodoro.value, DEFAULT_SETTINGS.pomodoro);
  settings['short-break'] = clampMinutes(settingInputs['short-break'].value, DEFAULT_SETTINGS['short-break']);
  settings['long-break'] = clampMinutes(settingInputs['long-break'].value, DEFAULT_SETTINGS['long-break']);
  settingsOverlay.hidden = true;
  persist();
});

function clampMinutes(value, fallback) {
  const n = Math.round(Number(value) / 5) * 5;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 60);
}

// ---- timer controls ----
function stopInterval() {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
}

function setRunningUI(isRunning) {
  playBtn.textContent = isRunning ? '⏸' : '▶';
  playBtn.setAttribute('aria-label', isRunning ? 'Pause' : 'Start');
  playBtn.classList.toggle('is-running', isRunning);
  chevronUp.disabled = isRunning;
  chevronDown.disabled = isRunning;
}

function advanceToNextInQueue() {
  const next = queue.shift();
  if (!next) {
    current = { type: current.type, minutes: settings[current.type] ?? current.minutes };
    remainingSeconds = current.minutes * 60;
    running = false;
    setRunningUI(false);
    renderQueue();
    renderTimer();
    syncDialToMinutes(current.minutes);
    persist();
    return;
  }
  current = { type: next.type, minutes: next.minutes };
  remainingSeconds = current.minutes * 60;
  renderQueue();
  renderTimer();
  syncDialToMinutes(current.minutes);
  persist();
}

function tick() {
  remainingSeconds -= 1;
  if (remainingSeconds <= 0) {
    advanceToNextInQueue();
    if (queue.length === 0 && !running) {
      stopInterval();
      return;
    }
    return;
  }
  renderTimer();
  persist();
}

playBtn.addEventListener('click', () => {
  running = !running;
  setRunningUI(running);
  if (running) {
    if (remainingSeconds <= 0) remainingSeconds = current.minutes * 60;
    intervalId = setInterval(tick, 1000);
  } else {
    stopInterval();
  }
  persist();
});

// ---- three.js tomato dial ----
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
camera.position.set(0, 0, 8.5);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xfff4e8, 0xdcb89f, 1.0));
const key = new THREE.DirectionalLight(0xffffff, 1.8);
key.position.set(4, 5, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0xffd9bd, 0.9);
rim.position.set(-4, 2, -3);
scene.add(rim);

function resizeRenderer() {
  const width = canvasWrap.clientWidth;
  const height = canvasWrap.clientHeight;
  if (!width || !height) return;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
resizeRenderer();
window.addEventListener('resize', resizeRenderer);
new ResizeObserver(resizeRenderer).observe(canvasWrap);

let tomatoBody = null;
const degToRad = (deg) => (deg * Math.PI) / 180;
const ORIGIN_BODY_ROT_Y = degToRad(-96);
let targetBodyRotY = ORIGIN_BODY_ROT_Y;
let bodyRotY = ORIGIN_BODY_ROT_Y;
let dialNumbers = [];
let currentDialIndex = 0;
const DRAG_PIXELS_PER_STEP = 40;

function wrapIndex(idx, len) {
  return ((idx % len) + len) % len;
}

function stepAngle() {
  return (Math.PI * 2) / dialNumbers.length;
}

function applyDialIndex(nextIndex, { setMinutes = true } = {}) {
  if (!dialNumbers.length) return;
  currentDialIndex = wrapIndex(nextIndex, dialNumbers.length);
  targetBodyRotY = ORIGIN_BODY_ROT_Y + currentDialIndex * stepAngle();
  if (setMinutes) {
    current.minutes = dialNumbers[currentDialIndex];
    remainingSeconds = current.minutes * 60;
    renderTimer();
    persist();
  }
}

function syncDialToMinutes(minutes) {
  if (!dialNumbers.length) return;
  let idx = dialNumbers.indexOf(minutes);
  if (idx === -1) {
    idx = dialNumbers.reduce((best, val, i) => (
      Math.abs(val - minutes) < Math.abs(dialNumbers[best] - minutes) ? i : best
    ), 0);
  }
  applyDialIndex(idx, { setMinutes: false });
}

const MODEL_ZOOM = 1.58;

function frameCamera(root) {
  const box = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  const sphere = new THREE.Sphere();
  box.getCenter(center);
  box.getBoundingSphere(sphere);
  if (!sphere.radius) return;

  const fovRad = camera.fov * (Math.PI / 180);
  const fitDistance = sphere.radius / Math.sin(fovRad / 2);

  camera.position.set(center.x, center.y, center.z + fitDistance);
  camera.lookAt(center);
  camera.zoom = MODEL_ZOOM;
  camera.updateProjectionMatrix();
}

const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(new URL(DRACO_DECODER_PATH, import.meta.url).href);
loader.setDRACOLoader(dracoLoader);

loader.load(
  new URL(MODEL_URL, import.meta.url).href,
  (gltf) => {
    const root = gltf.scene;
    scene.add(root);
    tomatoBody = root.getObjectByName('tomato_body');
    const tomatoHead = root.getObjectByName('tomato_head');
    if (tomatoHead) tomatoHead.rotation.y += -Math.PI / 2;

    const numericNames = new Set();
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      if (/^\d+$/.test(obj.name)) numericNames.add(Number(obj.name));
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((mat) => {
        if (mat?.map) {
          mat.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
          mat.map.needsUpdate = true;
        }
      });
    });

    dialNumbers = Array.from(numericNames).sort((a, b) => a - b);
    if (dialNumbers.length === 0) dialNumbers = Array.from({ length: 12 }, (_, i) => i * 5);

    bodyRotY = ORIGIN_BODY_ROT_Y;
    syncDialToMinutes(current.minutes);
    frameCamera(root);
    loadingEl.style.display = 'none';
  },
  (progress) => {
    if (progress.total > 0) {
      const pct = Math.round((progress.loaded / progress.total) * 100);
      loadingEl.textContent = `Loading tomato… ${pct}%`;
    }
  },
  (err) => {
    console.error('GLB load error:', err);
    loadingEl.textContent = 'Error loading model';
  }
);

let dragging = false;
let startY = 0;
let startDialIndex = 0;

function dragStart(y) {
  if (!tomatoBody || running) return;
  dragging = true;
  startY = y;
  startDialIndex = currentDialIndex;
  canvasWrap.classList.add('dragging');
}

function dragMove(y) {
  if (!dragging) return;
  const dy = y - startY;
  const deltaSteps = Math.round(dy / DRAG_PIXELS_PER_STEP);
  applyDialIndex(startDialIndex + deltaSteps);
}

function dragEnd() {
  dragging = false;
  canvasWrap.classList.remove('dragging');
}

canvasWrap.addEventListener('mousedown', (e) => dragStart(e.clientY));
window.addEventListener('mousemove', (e) => dragMove(e.clientY));
window.addEventListener('mouseup', dragEnd);

canvasWrap.addEventListener('touchstart', (e) => {
  dragStart(e.touches[0].clientY);
  e.preventDefault();
}, { passive: false });

window.addEventListener('touchmove', (e) => {
  if (!dragging) return;
  dragMove(e.touches[0].clientY);
  e.preventDefault();
}, { passive: false });

window.addEventListener('touchend', dragEnd);

chevronUp.addEventListener('click', () => applyDialIndex(currentDialIndex + 1));
chevronDown.addEventListener('click', () => applyDialIndex(currentDialIndex - 1));

function animate() {
  requestAnimationFrame(animate);
  bodyRotY += (targetBodyRotY - bodyRotY) * 0.35;
  if (tomatoBody) tomatoBody.rotation.y = bodyRotY;
  renderer.render(scene, camera);
}
animate();

// ---- init ----
updatePresetButton();
renderQueue();
renderTimer();
setRunningUI(false);
restore();
