import * as THREE from '../vendor/three/build/three.module.min.js';
import { GLTFLoader } from '../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from '../vendor/three/examples/jsm/loaders/DRACOLoader.js';

const MODEL_URL = '../assets/tomato19.glb';
const DRACO_DECODER_PATH = '../vendor/three/examples/jsm/libs/draco/gltf/';

const TYPE_LABELS = { pomodoro: 'pomodoro', 'short-break': 'short break', 'long-break': 'long break' };
const PRESET_ORDER = ['pomodoro', 'short-break', 'long-break'];

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
// The background service worker owns the real state (so the countdown keeps
// running when this panel is closed). This module just mirrors the latest
// broadcast and dispatches action messages; it never mutates state itself.
let state = null;
let completionPinged = false;

function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function computeRemainingSeconds() {
  if (!state) return 0;
  if (!state.running) return state.pausedRemainingSeconds;
  return Math.max((state.sessionEndTimestamp - Date.now()) / 1000, 0);
}

function applyIncoming(payload) {
  if (!payload?.state) return;
  state = payload.state;
  completionPinged = false;
  renderAll();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'STATE_UPDATED') applyIncoming(message);
});

send('GET_STATE').then(applyIncoming);

setInterval(() => {
  if (!state) return;
  renderTimer();
  if (state.running && computeRemainingSeconds() <= 0.05 && !completionPinged) {
    completionPinged = true;
    send('CHECK_COMPLETION').then(applyIncoming);
  }
}, 250);

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds) % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderTimer() {
  timerDisplay.textContent = formatTime(Math.max(computeRemainingSeconds(), 0));
}

function renderAll() {
  if (!state) return;
  renderQueue();
  renderTimer();
  syncSettingsInputs();
  setRunningUI(state.running);
  updatePresetButton();
  // Keep the step-reference in sync so chevrons/drag step from near
  // wherever the tomato actually is, without moving it — the tomato's
  // rotation itself is only ever touched by the running countdown loop,
  // an explicit chevron/drag commit, or the one-time initial paint below.
  if (!state.running && dialNumbers.length) {
    currentDialIndex = nearestDialIndex(computeRemainingSeconds() / 60);
  }
  positionDialOnce();
}

function renderQueue() {
  queueList.innerHTML = '';
  queueHeading.hidden = state.queue.length === 0;

  state.queue.forEach((item) => {
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
    del.addEventListener('click', () => send('DELETE_QUEUE_ITEM', { id: item.id }).then(applyIncoming));

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
    send('REORDER_QUEUE', { fromId: dragSourceId, toId: targetId }).then(applyIncoming);
    dragSourceId = null;
  });
}

function syncSettingsInputs() {
  settingInputs.pomodoro.value = state.settings.pomodoro;
  settingInputs['short-break'].value = state.settings['short-break'];
  settingInputs['long-break'].value = state.settings['long-break'];
}

// ---- add to queue / presets ----
function updatePresetButton() {
  const type = PRESET_ORDER[state.addPresetIndex];
  presetBtn.title = `Add to queue: ${TYPE_LABELS[type]} (click to cycle)`;
}

presetBtn.addEventListener('click', () => send('CYCLE_PRESET').then(applyIncoming));

addQueueBtn.addEventListener('click', () => {
  const type = PRESET_ORDER[state.addPresetIndex];
  send('ADD_TO_QUEUE', { sessionType: type, minutes: state.settings[type] }).then(applyIncoming);
});

// ---- settings overlay ----
settingsBtn.addEventListener('click', () => {
  syncSettingsInputs();
  settingsOverlay.hidden = false;
});

settingsCloseBtn.addEventListener('click', () => {
  const settings = {
    pomodoro: clampMinutes(settingInputs.pomodoro.value, state.settings.pomodoro),
    'short-break': clampMinutes(settingInputs['short-break'].value, state.settings['short-break']),
    'long-break': clampMinutes(settingInputs['long-break'].value, state.settings['long-break']),
  };
  settingsOverlay.hidden = true;
  send('SAVE_SETTINGS', { settings }).then(applyIncoming);
});

function clampMinutes(value, fallback) {
  const n = Math.round(Number(value) / 5) * 5;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 60);
}

// ---- timer controls ----
function setRunningUI(isRunning) {
  playBtn.textContent = isRunning ? '⏸' : '▶';
  playBtn.setAttribute('aria-label', isRunning ? 'Pause' : 'Start');
  playBtn.classList.toggle('is-running', isRunning);
  chevronUp.disabled = isRunning;
  chevronDown.disabled = isRunning;
}

playBtn.addEventListener('click', () => send('TOGGLE_PLAY').then(applyIncoming));

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
let anglePerMinute = 0;
const DRAG_PIXELS_PER_STEP = 40;

function wrapIndex(idx, len) {
  return ((idx % len) + len) % len;
}

function stepAngle() {
  return (Math.PI * 2) / dialNumbers.length;
}

function rotationForMinutes(minutes) {
  return ORIGIN_BODY_ROT_Y + minutes * anglePerMinute;
}

function nearestDialIndex(minutes) {
  let idx = dialNumbers.indexOf(minutes);
  if (idx === -1) {
    idx = dialNumbers.reduce((best, val, i) => (
      Math.abs(val - minutes) < Math.abs(dialNumbers[best] - minutes) ? i : best
    ), 0);
  }
  return idx;
}

// Moves the tomato to reflect a minutes value without notifying the
// background — used to sync the visual dial to state we already received.
function moveDialVisualOnly(index) {
  if (!dialNumbers.length) return;
  currentDialIndex = wrapIndex(index, dialNumbers.length);
  targetBodyRotY = ORIGIN_BODY_ROT_Y + currentDialIndex * stepAngle();
}

// Moves the tomato AND tells the background this is the new current
// duration — used for chevrons/drag, which only the panel (owner of the
// loaded GLB's dial marks) knows how to snap to a valid mark.
function commitDialIndex(index) {
  if (!dialNumbers.length || !state || state.running) return;
  moveDialVisualOnly(index);
  const minutes = dialNumbers[currentDialIndex];
  send('SET_CURRENT', { sessionType: state.current.type, minutes }).then(applyIncoming);
}

// Positions the tomato exactly once, the first time both the model and the
// background's state are available. After this, rotation is only ever
// touched by the running countdown loop or an explicit chevron/drag commit
// — never by a routine re-render — so pausing freezes it in place instead
// of snapping back to the session's original duration.
let initialDialPositionSet = false;

function positionDialOnce() {
  if (initialDialPositionSet || !state || !dialNumbers.length) return;
  const minutes = computeRemainingSeconds() / 60;
  targetBodyRotY = rotationForMinutes(minutes);
  bodyRotY = targetBodyRotY;
  currentDialIndex = nearestDialIndex(minutes);
  initialDialPositionSet = true;
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

    const dialStepMinutes = dialNumbers[1] - dialNumbers[0];
    anglePerMinute = stepAngle() / dialStepMinutes;

    bodyRotY = ORIGIN_BODY_ROT_Y;
    positionDialOnce();
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
  if (!tomatoBody || state?.running) return;
  dragging = true;
  startY = y;
  startDialIndex = currentDialIndex;
  canvasWrap.classList.add('dragging');
}

function dragMove(y) {
  if (!dragging) return;
  const dy = y - startY;
  const deltaSteps = Math.round(dy / DRAG_PIXELS_PER_STEP);
  const nextIndex = wrapIndex(startDialIndex + deltaSteps, dialNumbers.length);
  if (nextIndex === currentDialIndex) return;
  commitDialIndex(nextIndex);
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

chevronUp.addEventListener('click', () => commitDialIndex(currentDialIndex + 1));
chevronDown.addEventListener('click', () => commitDialIndex(currentDialIndex - 1));

function animate() {
  requestAnimationFrame(animate);

  if (state?.running && anglePerMinute && state.sessionEndTimestamp) {
    const preciseRemaining = Math.max((state.sessionEndTimestamp - Date.now()) / 1000, 0);
    targetBodyRotY = rotationForMinutes(preciseRemaining / 60);
    bodyRotY = targetBodyRotY;
  } else {
    bodyRotY += (targetBodyRotY - bodyRotY) * 0.35;
  }

  if (tomatoBody) tomatoBody.rotation.y = bodyRotY;
  renderer.render(scene, camera);
}
animate();

// ---- init ----
const versionEl = document.getElementById('app-version');
if (versionEl && chrome.runtime?.getManifest) {
  versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
}
