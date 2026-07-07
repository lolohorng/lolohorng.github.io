chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// Fallback in case the stored panel-behavior setting doesn't take effect
// (seen when Chrome caches an unpacked extension's old popup routing).
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
});
