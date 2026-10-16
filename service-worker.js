/**
 * Return to Reading — Background Service Worker (Manifest V3)
 * 
 * Central coordinator for:
 * - Tracking reader tabs and their reading coordinates
 * - Detecting transitions to ChatGPT (via context menu, opener relationships, tab switches)
 * - Restoring the user back to the source webpage and exact scroll position
 * - Managing local-first session persistence
 */

importScripts('lib/session-store.js', 'lib/position-restore.js');

// In-memory tab navigation history (tracks the previous URL of tabs before navigation)
const previousTabUrls = new Map();

/**
 * Safe wrapper for chrome.tabs.sendMessage that suppresses
 * "Could not establish connection. Receiving end does not exist."
 * errors (content script not yet loaded or tab closed).
 * Optionally retries with back-off when retries > 0.
 */
function safeSendTabMessage(tabId, message, callback, retries = 0) {
  try {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        // Content script not ready yet — retry if allowed
        if (retries > 0) {
          setTimeout(() => {
            safeSendTabMessage(tabId, message, callback, retries - 1);
          }, 500);
        } else if (callback) {
          callback(null);
        }
        return;
      }
      if (callback) callback(response);
    });
  } catch {
    // Tab may have been closed or extension context invalidated
    if (callback) callback(null);
  }
}

/**
 * Extension Installation & Context Menu Setup
 */
chrome.runtime.onInstalled.addListener(() => {
  // Create Context Menu item for seamless "Ask ChatGPT" workflow
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'rtr-ask-chatgpt-menu',
      title: 'Ask ChatGPT (with Return to Reading)',
      contexts: ['selection', 'page']
    });
  });
});

/**
 * Check if a URL belongs to ChatGPT
 */
function isChatGPTUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'chatgpt.com' || host === 'chat.openai.com' || host.endsWith('.chatgpt.com');
  } catch {
    return false;
  }
}

/**
 * Handle Tab Creation (captures openerTabId relationship)
 */
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab.id) return;

  if (tab.openerTabId) {
    try {
      const openerTab = await chrome.tabs.get(tab.openerTabId);
      if (openerTab && openerTab.url && SessionStore.isValidReadingUrl(openerTab.url)) {
        // Query the opener tab for its latest scroll position
        safeSendTabMessage(openerTab.id, { type: 'GET_CURRENT_POSITION' }, async (response) => {
          if (!response) return;

          const session = await SessionStore.saveOrUpdateSourceSession({
            tabId: openerTab.id,
            windowId: openerTab.windowId,
            url: response.url || openerTab.url,
            title: response.title || openerTab.title,
            scrollX: response.scrollX || 0,
            scrollY: response.scrollY || 0,
            scrollPercent: response.scrollPercent || 0,
            selectedText: response.selectedText || ''
          });

          if (session && tab.url && isChatGPTUrl(tab.url)) {
            await SessionStore.linkChatGPTTabToSession(tab.id, session.id);
          }
        });
      }
    } catch {
      // Opener tab may not be accessible
    }
  }
});

/**
 * Handle Tab URL Updates (tracks page navigations, including same-tab ChatGPT visits)
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab || !tab.url) return;

  // Track previous URL to detect same-tab transitions
  const prevUrl = previousTabUrls.get(tabId);
  if (changeInfo.url) {
    previousTabUrls.set(tabId, changeInfo.url);
  }

  // When a tab navigates to ChatGPT
  if (isChatGPTUrl(tab.url) && changeInfo.status === 'complete') {
    let matchedSession = null;

    // Case 1: Tab has an openerTabId that has an active reading session
    if (tab.openerTabId) {
      matchedSession = await SessionStore.resolveSessionForChatGPTTab(tabId, tab.windowId, tab.openerTabId);
    }

    // Case 2: Same-tab transition (user navigated this tab from a reader page to ChatGPT)
    if (!matchedSession && prevUrl && SessionStore.isValidReadingUrl(prevUrl)) {
      const sessions = await SessionStore.getSessions();
      matchedSession = sessions.find(s => s.sourceUrl === prevUrl);
      if (matchedSession) {
        await SessionStore.linkChatGPTTabToSession(tabId, matchedSession.id);
      }
    }

    // Case 3: Fallback resolution (most recent reading page)
    if (!matchedSession) {
      matchedSession = await SessionStore.resolveSessionForChatGPTTab(tabId, tab.windowId);
    }

    // Notify ChatGPT content script if a return destination is ready
    if (matchedSession) {
      safeSendTabMessage(tabId, {
        type: 'SESSION_AVAILABLE',
        session: matchedSession
      }, null, 3);  // Retry up to 3 times — content script may still be initializing
    }
  }
});

/**
 * Handle Tab Activation (switching between tabs)
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab || !tab.url) return;

    if (SessionStore.isValidReadingUrl(tab.url)) {
      // Request fresh reading position from source tracker
      safeSendTabMessage(tab.id, { type: 'GET_CURRENT_POSITION' }, async (response) => {
        if (!response) return;
        await SessionStore.saveOrUpdateSourceSession({
          tabId: tab.id,
          windowId: tab.windowId,
          url: response.url || tab.url,
          title: response.title || tab.title,
          scrollX: response.scrollX || 0,
          scrollY: response.scrollY || 0,
          scrollPercent: response.scrollPercent || 0,
          selectedText: response.selectedText || ''
        });
      });
    } else if (isChatGPTUrl(tab.url)) {
      // Re-verify destination for active ChatGPT tab
      const session = await SessionStore.resolveSessionForChatGPTTab(tab.id, tab.windowId, tab.openerTabId);
      if (session) {
        safeSendTabMessage(tab.id, {
          type: 'SESSION_AVAILABLE',
          session
        }, null, 2);
      }
    }
  } catch {
    // Tab may have closed
  }
});

/**
 * Handle Tab Removal (cleanup active links)
 */
chrome.tabs.onRemoved.addListener(async (tabId) => {
  previousTabUrls.delete(tabId);
  await SessionStore.unlinkChatGPTTab(tabId);
});

/**
 * Context Menu Click Handler:
 * "Ask ChatGPT (with Return to Reading)"
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'rtr-ask-chatgpt-menu' || !tab || !tab.url) return;

  // Retrieve current reading position
  safeSendTabMessage(tab.id, { type: 'GET_CURRENT_POSITION' }, async (response) => {
    const scrollX = response ? response.scrollX : 0;
    const scrollY = response ? response.scrollY : 0;
    const scrollPercent = response ? response.scrollPercent : 0;
    const selectedText = info.selectionText || (response ? response.selectedText : '');

    const session = await SessionStore.saveOrUpdateSourceSession({
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url,
      title: tab.title || tab.url,
      scrollX,
      scrollY,
      scrollPercent,
      selectedText
    });

    // Build ChatGPT URL
    let chatGptUrl = 'https://chatgpt.com/';
    if (selectedText && selectedText.trim()) {
      chatGptUrl = `https://chatgpt.com/?q=${encodeURIComponent(selectedText.trim())}`;
    }

    // Open ChatGPT tab with openerTabId explicitly linked to this source tab
    chrome.tabs.create({
      url: chatGptUrl,
      openerTabId: tab.id,
      windowId: tab.windowId,
      active: true
    }, async (newTab) => {
      if (session && newTab && newTab.id) {
        await SessionStore.linkChatGPTTabToSession(newTab.id, session.id);
      }
    });
  });
});

/**
 * Central Message Router
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  const tabId = sender.tab ? sender.tab.id : null;
  const windowId = sender.tab ? sender.tab.windowId : null;

  // 1. Source Tracker sends updated reading coordinates
  if (message.type === 'SOURCE_POSITION_UPDATE') {
    const payload = message.payload || {};
    if (tabId && payload.url) {
      SessionStore.saveOrUpdateSourceSession({
        tabId,
        windowId,
        url: payload.url,
        title: payload.title,
        scrollX: payload.scrollX,
        scrollY: payload.scrollY,
        scrollPercent: payload.scrollPercent,
        selectedText: payload.selectedText
      }).then((session) => {
        sendResponse({ success: true, session });
      });
      return true; // async response
    }
    sendResponse({ success: false });
    return false;
  }

  // 2. ChatGPT button checks for a return destination
  if (message.type === 'GET_RETURN_DESTINATION') {
    const openerId = sender.tab ? sender.tab.openerTabId : null;
    SessionStore.resolveSessionForChatGPTTab(tabId, windowId, openerId).then((session) => {
      sendResponse({ session });
    });
    return true; // async response
  }

  // 3. User clicks 'Return to Reading' button on ChatGPT
  if (message.type === 'TRIGGER_RETURN') {
    handleTriggerReturn(message.sessionId, sender.tab).then((result) => {
      sendResponse(result);
    });
    return true; // async response
  }

  // 4. User dismisses destination on ChatGPT button
  if (message.type === 'DISMISS_SESSION') {
    if (tabId) {
      SessionStore.unlinkChatGPTTab(tabId).then(() => {
        sendResponse({ dismissed: true });
      });
      return true;
    }
  }

  // 5. Popup clears all sessions
  if (message.type === 'CLEAR_ALL_SESSIONS') {
    SessionStore.clearAllSessions().then(() => {
      // Broadcast to any open ChatGPT tabs that sessions were cleared
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((t) => {
          if (t.url && isChatGPTUrl(t.url)) {
            safeSendTabMessage(t.id, { type: 'SESSION_CLEARED' });
          }
        });
      });
      sendResponse({ cleared: true });
    });
    return true;
  }

  return false;
});

/**
 * Executes the Return to Reading workflow:
 * 1. Validates the session
 * 2. Checks if original tab exists
 * 3. Restores window and tab focus
 * 4. Navigates or restores scroll position with retries
 * 5. Reopens URL if original tab was closed
 */
async function handleTriggerReturn(sessionId, currentChatGPTTab) {
  let session = await SessionStore.getSessionById(sessionId);

  // If specific session not found, try fallback
  if (!session && currentChatGPTTab) {
    session = await SessionStore.resolveSessionForChatGPTTab(
      currentChatGPTTab.id,
      currentChatGPTTab.windowId
    );
  }

  if (!session) {
    return { success: false, error: 'No valid return session found' };
  }

  const targetTabId = session.sourceTabId;
  const targetWindowId = session.sourceWindowId;
  const targetUrl = session.sourceUrl;
  const targetX = session.scrollX || 0;
  const targetY = session.scrollY || 0;

  try {
    // Check if original source tab is still open
    let originalTab = null;
    if (targetTabId) {
      try {
        originalTab = await chrome.tabs.get(targetTabId);
      } catch {
        originalTab = null;
      }
    }

    if (originalTab) {
      // 1. Focus the window
      if (originalTab.windowId) {
        await chrome.windows.update(originalTab.windowId, { focused: true });
      }

      // 2. Activate the tab
      await chrome.tabs.update(originalTab.id, { active: true });

      // 3. Check if tab still has the original URL
      const currentUrlClean = originalTab.url.split('#')[0];
      const targetUrlClean = targetUrl.split('#')[0];

      if (currentUrlClean === targetUrlClean) {
        // Tab is right on the page! Restore scroll smoothly
        safeSendTabMessage(originalTab.id, {
          type: 'RESTORE_SCROLL',
          scrollX: targetX,
          scrollY: targetY
        }, (response) => {
          if (!response) {
            // Fallback: inject scroll script via chrome.scripting
            injectScrollFallback(originalTab.id, targetX, targetY);
          }
        });
      } else {
        // Tab was navigated to a different page; navigate it back
        await chrome.tabs.update(originalTab.id, { url: targetUrl });
        attachSingleScrollRestoration(originalTab.id, targetX, targetY);
      }

      return { success: true, method: 'existing_tab' };
    } else {
      // Tab was closed: reopen URL in active window
      const newTab = await chrome.tabs.create({
        url: targetUrl,
        active: true
      });

      // Update session with new tab ID
      session.sourceTabId = newTab.id;
      attachSingleScrollRestoration(newTab.id, targetX, targetY);

      return { success: true, method: 'reopened_tab' };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Attaches a one-time tab update listener to restore scroll position
 * once a newly navigated or reopened tab finishes loading.
 */
function attachSingleScrollRestoration(tabId, targetX, targetY) {
  function listener(updatedTabId, changeInfo) {
    if (updatedTabId === tabId && changeInfo.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(listener);

      // Give dynamic scripts a brief moment to render, then restore
      setTimeout(() => {
        safeSendTabMessage(tabId, {
          type: 'RESTORE_SCROLL',
          scrollX: targetX,
          scrollY: targetY
        }, (res) => {
          if (!res) {
            injectScrollFallback(tabId, targetX, targetY);
          }
        }, 2);
      }, 250);
    }
  }

  chrome.tabs.onUpdated.addListener(listener);

  // Safety cleanup: remove listener after 20 seconds in case load hangs
  setTimeout(() => {
    chrome.tabs.onUpdated.removeListener(listener);
  }, 20000);
}

/**
 * Direct programmatic scroll injection fallback via chrome.scripting
 */
function injectScrollFallback(tabId, scrollX, scrollY) {
  if (typeof chrome.scripting !== 'undefined') {
    chrome.scripting.executeScript({
      target: { tabId },
      func: (x, y) => {
        try {
          window.scrollTo({ left: x, top: y, behavior: 'smooth' });
          [150, 400, 900].forEach((d) => {
            setTimeout(() => {
              const curr = window.scrollY || document.documentElement.scrollTop || 0;
              if (Math.abs(curr - y) > 30) {
                window.scrollTo({ left: x, top: y, behavior: 'smooth' });
              }
            }, d);
          });
        } catch {
          window.scroll(x, y);
        }
      },
      args: [scrollX, scrollY]
    }).catch(() => {});
  }
}
