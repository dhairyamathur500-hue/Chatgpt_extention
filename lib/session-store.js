/**
 * Return to Reading — Session Store
 * 
 * Manages local-first navigation sessions in chrome.storage.local.
 * Tracks reading position, source URLs, and associations with ChatGPT tabs.
 * 
 * Designed to work in Service Workers (via importScripts or modules)
 * and in Node.js test environments.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SessionStore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORAGE_KEY_SESSIONS = 'rtr_sessions';
  const STORAGE_KEY_ACTIVE_LINKS = 'rtr_active_links';
  const STORAGE_KEY_LAST_SOURCE = 'rtr_last_active_source';
  const STORAGE_KEY_SETTINGS = 'rtr_settings';

  const MAX_SESSIONS = 50;
  const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
  const RECENT_WINDOW_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes for fallback association

  /**
   * Helper to safely interact with chrome.storage.local
   */
  const storage = {
    async get(keys) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        return new Promise((resolve) => {
          chrome.storage.local.get(keys, (res) => resolve(res || {}));
        });
      }
      // In-memory fallback for unit testing if chrome.storage is not present
      if (typeof globalThis !== 'undefined' && globalThis.__mockStorage) {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) {
          result[k] = globalThis.__mockStorage[k];
        }
        return result;
      }
      return {};
    },

    async set(items) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        return new Promise((resolve) => {
          chrome.storage.local.set(items, () => resolve());
        });
      }
      if (typeof globalThis !== 'undefined' && globalThis.__mockStorage) {
        Object.assign(globalThis.__mockStorage, items);
      }
    },

    async remove(keys) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        return new Promise((resolve) => {
          chrome.storage.local.remove(keys, () => resolve());
        });
      }
      if (typeof globalThis !== 'undefined' && globalThis.__mockStorage) {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) {
          delete globalThis.__mockStorage[k];
        }
      }
    }
  };

  /**
   * Generates a unique, non-colliding session ID
   */
  function generateSessionId() {
    return 'rtr_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
  }

  /**
   * Checks whether a URL is a valid reading page (not browser internal or ChatGPT)
   */
  function isValidReadingUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    if (lower.startsWith('chrome://') || 
        lower.startsWith('chrome-extension://') || 
        lower.startsWith('edge://') || 
        lower.startsWith('about:') || 
        lower.startsWith('view-source:') ||
        lower.startsWith('devtools://')) {
      return false;
    }
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      if (host === 'chatgpt.com' || host === 'chat.openai.com' || host.endsWith('.chatgpt.com')) {
        return false;
      }
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Cleans title string for display
   */
  function sanitizeTitle(title, url) {
    if (title && typeof title === 'string' && title.trim()) {
      return title.trim().substring(0, 150);
    }
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return 'Reading Document';
    }
  }

  return {
    isValidReadingUrl,
    generateSessionId,

    /**
     * Retrieves all non-expired reading sessions, sorted newest first
     */
    async getSessions() {
      const data = await storage.get(STORAGE_KEY_SESSIONS);
      const sessions = Array.isArray(data[STORAGE_KEY_SESSIONS]) ? data[STORAGE_KEY_SESSIONS] : [];
      const now = Date.now();
      
      // Filter expired sessions
      const valid = sessions.filter(s => (now - (s.updatedAt || s.createdAt)) < DEFAULT_EXPIRY_MS);
      
      if (valid.length !== sessions.length) {
        await storage.set({ [STORAGE_KEY_SESSIONS]: valid });
      }
      return valid;
    },

    /**
     * Retrieves a session by its unique ID
     */
    async getSessionById(id) {
      if (!id) return null;
      const sessions = await this.getSessions();
      return sessions.find(s => s.id === id) || null;
    },

    /**
     * Saves or updates a reading session from a source webpage.
     * Keeps the scroll position, tab details, and timestamp fresh.
     */
    async saveOrUpdateSourceSession({
      tabId,
      windowId,
      url,
      title,
      scrollX = 0,
      scrollY = 0,
      scrollPercent = 0,
      selectedText = ''
    }) {
      if (!isValidReadingUrl(url)) {
        return null;
      }

      const sessions = await this.getSessions();
      const now = Date.now();
      const cleanTitle = sanitizeTitle(title, url);
      const cleanSnippet = (typeof selectedText === 'string') ? selectedText.trim().substring(0, 160) : '';

      // Check if we already have an existing session for this exact tab and URL
      let existingIndex = sessions.findIndex(s => s.sourceTabId === tabId && s.sourceUrl === url);

      let session;
      if (existingIndex >= 0) {
        // Update existing session
        session = sessions[existingIndex];
        session.scrollX = Math.max(0, Math.round(scrollX));
        session.scrollY = Math.max(0, Math.round(scrollY));
        session.scrollPercent = Math.max(0, Math.min(100, Math.round(scrollPercent)));
        session.sourceTitle = cleanTitle;
        session.sourceWindowId = windowId;
        session.updatedAt = now;
        if (cleanSnippet) {
          session.selectedText = cleanSnippet;
        }
        // Move to the front of list
        sessions.splice(existingIndex, 1);
        sessions.unshift(session);
      } else {
        // Create new session
        session = {
          id: generateSessionId(),
          sourceTabId: tabId,
          sourceWindowId: windowId,
          sourceUrl: url,
          sourceTitle: cleanTitle,
          scrollX: Math.max(0, Math.round(scrollX)),
          scrollY: Math.max(0, Math.round(scrollY)),
          scrollPercent: Math.max(0, Math.min(100, Math.round(scrollPercent))),
          selectedText: cleanSnippet,
          createdAt: now,
          updatedAt: now
        };
        sessions.unshift(session);
      }

      // Bound total storage to MAX_SESSIONS
      const trimmed = sessions.slice(0, MAX_SESSIONS);
      await storage.set({ [STORAGE_KEY_SESSIONS]: trimmed });

      // Record this tab as the latest active source
      await storage.set({
        [STORAGE_KEY_LAST_SOURCE]: {
          sessionId: session.id,
          tabId,
          windowId,
          url,
          title: cleanTitle,
          updatedAt: now
        }
      });

      return session;
    },

    /**
     * Efficiently updates scroll coordinates for an active session
     */
    async updateScrollPosition(tabId, url, scrollX, scrollY, scrollPercent) {
      if (!isValidReadingUrl(url)) return null;
      const sessions = await this.getSessions();
      const session = sessions.find(s => s.sourceTabId === tabId && s.sourceUrl === url);
      if (session) {
        session.scrollX = Math.max(0, Math.round(scrollX));
        session.scrollY = Math.max(0, Math.round(scrollY));
        session.scrollPercent = Math.max(0, Math.min(100, Math.round(scrollPercent)));
        session.updatedAt = Date.now();
        await storage.set({ [STORAGE_KEY_SESSIONS]: sessions });
        return session;
      }
      return null;
    },

    /**
     * Links a ChatGPT tab directly to a specific source session ID
     */
    async linkChatGPTTabToSession(chatGptTabId, sessionId) {
      if (!chatGptTabId || !sessionId) return;
      const data = await storage.get(STORAGE_KEY_ACTIVE_LINKS);
      const links = data[STORAGE_KEY_ACTIVE_LINKS] || {};
      links[chatGptTabId] = {
        sessionId,
        linkedAt: Date.now()
      };
      await storage.set({ [STORAGE_KEY_ACTIVE_LINKS]: links });
    },

    /**
     * Unlinks a ChatGPT tab
     */
    async unlinkChatGPTTab(chatGptTabId) {
      if (!chatGptTabId) return;
      const data = await storage.get(STORAGE_KEY_ACTIVE_LINKS);
      const links = data[STORAGE_KEY_ACTIVE_LINKS] || {};
      if (links[chatGptTabId]) {
        delete links[chatGptTabId];
        await storage.set({ [STORAGE_KEY_ACTIVE_LINKS]: links });
      }
    },

    /**
     * Resolves the most accurate return session for a ChatGPT tab.
     * Waterfall:
     * 1. Direct explicit link for this tab (from opener, context menu, or navigation)
     * 2. Opener Tab match (source tab that opened this ChatGPT tab)
     * 3. Most recently updated reading session in the same window (within 30 mins)
     * 4. Most recently updated reading session overall (within 15 mins)
     */
    async resolveSessionForChatGPTTab(chatGptTabId, chatGptWindowId, openerTabId = null) {
      const sessions = await this.getSessions();
      if (!sessions || sessions.length === 0) return null;

      const now = Date.now();

      // 1. Direct link
      const linksData = await storage.get(STORAGE_KEY_ACTIVE_LINKS);
      const links = linksData[STORAGE_KEY_ACTIVE_LINKS] || {};
      if (chatGptTabId && links[chatGptTabId]) {
        const linkedId = links[chatGptTabId].sessionId;
        const matched = sessions.find(s => s.id === linkedId);
        if (matched) return matched;
      }

      // 2. Opener tab relationship
      if (openerTabId) {
        const openerSession = sessions.find(s => s.sourceTabId === openerTabId);
        if (openerSession) {
          // Link it for future quick lookups
          if (chatGptTabId) {
            await this.linkChatGPTTabToSession(chatGptTabId, openerSession.id);
          }
          return openerSession;
        }
      }

      // 3. Same window recent session
      if (chatGptWindowId) {
        const sameWindowSession = sessions.find(s => 
          s.sourceWindowId === chatGptWindowId && 
          s.sourceTabId !== chatGptTabId && 
          (now - s.updatedAt) < RECENT_WINDOW_THRESHOLD_MS
        );
        if (sameWindowSession) {
          return sameWindowSession;
        }
      }

      // 4. Fallback: Most recent session overall within 15 minutes
      const mostRecent = sessions[0];
      if (mostRecent && mostRecent.sourceTabId !== chatGptTabId && (now - mostRecent.updatedAt) < (15 * 60 * 1000)) {
        return mostRecent;
      }

      return null;
    },

    /**
     * Deletes a single session by ID
     */
    async deleteSession(sessionId) {
      if (!sessionId) return;
      const sessions = await this.getSessions();
      const filtered = sessions.filter(s => s.id !== sessionId);
      await storage.set({ [STORAGE_KEY_SESSIONS]: filtered });

      // Clean up links
      const linksData = await storage.get(STORAGE_KEY_ACTIVE_LINKS);
      const links = linksData[STORAGE_KEY_ACTIVE_LINKS] || {};
      let changed = false;
      for (const [tabId, item] of Object.entries(links)) {
        if (item.sessionId === sessionId) {
          delete links[tabId];
          changed = true;
        }
      }
      if (changed) {
        await storage.set({ [STORAGE_KEY_ACTIVE_LINKS]: links });
      }
    },

    /**
     * Clears all stored sessions, links, and temporary markers.
     * Core privacy-first feature.
     */
    async clearAllSessions() {
      await storage.remove([
        STORAGE_KEY_SESSIONS,
        STORAGE_KEY_ACTIVE_LINKS,
        STORAGE_KEY_LAST_SOURCE
      ]);
    },

    /**
     * Get or set user preferences
     */
    async getSettings() {
      const data = await storage.get(STORAGE_KEY_SETTINGS);
      return Object.assign({
        autoDetect: true,
        smoothScroll: true,
        highlightReturnLocation: true,
        buttonPosition: 'bottom-right' // 'bottom-right' | 'top-right' | 'floating'
      }, data[STORAGE_KEY_SETTINGS] || {});
    },

    async updateSettings(newSettings) {
      const current = await this.getSettings();
      const updated = Object.assign(current, newSettings);
      await storage.set({ [STORAGE_KEY_SETTINGS]: updated });
      return updated;
    }
  };
});
