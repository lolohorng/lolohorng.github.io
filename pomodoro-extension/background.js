// Background service worker: owns the authoritative timer state so the
// countdown keeps running (and the toolbar badge stays live) even when the
// side panel is closed. State lives in chrome.storage.local; the running
// session is tracked as an absolute end timestamp rather than a tick count,
// so it's always correct regardless of how long the worker was asleep.

const STORAGE_KEY = 'tomatoPomodoroState';
const TICK_ALARM = 'tomato-tick';
const SESSION_END_ALARM = 'tomato-session-end';

const DEFAULT_SETTINGS = { pomodoro: 25, 'short-break': 5, 'long-break': 15 };

function defaultState() {
  return {
    settings: { ...DEFAULT_SETTINGS },
    queue: [
      { id: crypto.randomUUID(), type: 'short-break', minutes: 5 },
      { id: crypto.randomUUID(), type: 'pomodoro', minutes: 25 },
      { id: crypto.randomUUID(), type: 'short-break', minutes: 5 },
    ],
    current: { type: 'pomodoro', minutes: 25 },
    running: false,
    sessionEndTimestamp: null,
    pausedRemainingSeconds: 25 * 60,
    addPresetIndex: 0,
  };
}

async function loadState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const saved = result?.[STORAGE_KEY];
  if (!saved) return defaultState();
  return { ...defaultState(), ...saved, settings: { ...DEFAULT_SETTINGS, ...saved.settings } };
}

async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function getRemainingSeconds(state) {
  if (!state.running) return state.pausedRemainingSeconds;
  return Math.max(Math.round((state.sessionEndTimestamp - Date.now()) / 1000), 0);
}

// Advances past any sessions that finished while the worker was asleep.
// Idempotent: calling it again with unchanged state is a no-op.
function checkAndAdvance(state) {
  let changed = false;
  let guard = 0;
  while (state.running && Date.now() >= state.sessionEndTimestamp - 250 && guard < 100) {
    guard += 1;
    changed = true;
    const next = state.queue.shift();
    if (!next) {
      state.current = { type: state.current.type, minutes: state.settings[state.current.type] ?? state.current.minutes };
      state.running = false;
      state.sessionEndTimestamp = null;
      state.pausedRemainingSeconds = state.current.minutes * 60;
      break;
    }
    state.current = { type: next.type, minutes: next.minutes };
    // Chain from the previous end time (not Date.now()) so if several
    // sessions elapsed while the worker was asleep, the loop condition
    // re-checks against the correct point and fast-forwards through them.
    state.sessionEndTimestamp += next.minutes * 60 * 1000;
  }
  return changed;
}

function updateBadge(state) {
  if (!state.running) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const minutes = Math.max(Math.ceil(getRemainingSeconds(state) / 60), 0);
  chrome.action.setBadgeText({ text: `${minutes}m` });
  chrome.action.setBadgeBackgroundColor({ color: '#b30000' });
}

async function scheduleAlarms(state) {
  await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
  if (state.running && state.sessionEndTimestamp) {
    await chrome.alarms.create(SESSION_END_ALARM, { when: state.sessionEndTimestamp });
  } else {
    await chrome.alarms.clear(SESSION_END_ALARM);
  }
}

function broadcast(state) {
  chrome.runtime.sendMessage({
    type: 'STATE_UPDATED',
    state,
    remainingSeconds: getRemainingSeconds(state),
  }).catch(() => {
    // No side panel listening right now — expected, ignore.
  });
}

// Runs a mutator against the current state, then advances/persists/badges/
// broadcasts. Every message handler and alarm funnels through here so
// there's a single authoritative place that touches storage.
async function applyStateChange(mutator) {
  const state = await loadState();
  mutator(state);
  checkAndAdvance(state);
  await saveState(state);
  updateBadge(state);
  await scheduleAlarms(state);
  broadcast(state);
  return state;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'GET_STATE': {
        const state = await applyStateChange(() => {});
        sendResponse({ state, remainingSeconds: getRemainingSeconds(state) });
        break;
      }
      case 'TOGGLE_PLAY': {
        const state = await applyStateChange((s) => {
          if (s.running) {
            s.pausedRemainingSeconds = getRemainingSeconds(s);
            s.running = false;
            s.sessionEndTimestamp = null;
          } else {
            const seconds = s.pausedRemainingSeconds > 0 ? s.pausedRemainingSeconds : s.current.minutes * 60;
            s.running = true;
            s.sessionEndTimestamp = Date.now() + seconds * 1000;
          }
        });
        sendResponse({ state, remainingSeconds: getRemainingSeconds(state) });
        break;
      }
      case 'SET_CURRENT': {
        const state = await applyStateChange((s) => {
          if (s.running) return;
          s.current = { type: message.sessionType, minutes: message.minutes };
          s.pausedRemainingSeconds = message.minutes * 60;
        });
        sendResponse({ state, remainingSeconds: getRemainingSeconds(state) });
        break;
      }
      case 'ADD_TO_QUEUE': {
        const state = await applyStateChange((s) => {
          s.queue.push({ id: crypto.randomUUID(), type: message.sessionType, minutes: message.minutes });
        });
        sendResponse({ state, remainingSeconds: getRemainingSeconds(state) });
        break;
      }
      case 'DELETE_QUEUE_ITEM': {
        const state = await applyStateChange((s) => {
          s.queue = s.queue.filter((q) => q.id !== message.id);
        });
        sendResponse({ state, remainingSeconds: getRemainingSeconds(state) });
        break;
      }
      case 'REORDER_QUEUE': {
        const state = await applyStateChange((s) => {
          const fromIndex = s.queue.findIndex((q) => q.id === message.fromId);
          const toIndex = s.queue.findIndex((q) => q.id === message.toId);
          if (fromIndex === -1 || toIndex === -1) return;
          const [moved] = s.queue.splice(fromIndex, 1);
          s.queue.splice(toIndex, 0, moved);
        });
        sendResponse({ state, remainingSeconds: getRemainingSeconds(state) });
        break;
      }
      case 'CYCLE_PRESET': {
        const state = await applyStateChange((s) => {
          s.addPresetIndex = (s.addPresetIndex + 1) % 3;
        });
        sendResponse({ state, remainingSeconds: getRemainingSeconds(state) });
        break;
      }
      case 'SAVE_SETTINGS': {
        const state = await applyStateChange((s) => {
          s.settings = { ...s.settings, ...message.settings };
        });
        sendResponse({ state, remainingSeconds: getRemainingSeconds(state) });
        break;
      }
      case 'CHECK_COMPLETION': {
        const state = await applyStateChange(() => {});
        sendResponse({ state, remainingSeconds: getRemainingSeconds(state) });
        break;
      }
      default:
        sendResponse({ error: `Unknown message type: ${message.type}` });
    }
  })();
  return true; // async sendResponse
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM || alarm.name === SESSION_END_ALARM) {
    applyStateChange(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  applyStateChange(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  applyStateChange(() => {});
});

// Fallback in case the stored panel-behavior setting doesn't take effect
// (seen when Chrome caches an unpacked extension's old popup routing).
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
});
