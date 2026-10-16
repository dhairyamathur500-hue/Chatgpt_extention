/**
 * Return to Reading — ChatGPT Button Content Script
 * 
 * Injected into ChatGPT (chatgpt.com and chat.openai.com).
 * Renders an isolated, unobtrusive, keyboard-accessible "Return to Reading" button
 * directly in ChatGPT when a valid return session exists.
 * Adapts dynamically to ChatGPT's single-page router and dark/light themes.
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__rtrChatGPTButtonInjected) return;
  window.__rtrChatGPTButtonInjected = true;

  const ROOT_ELEMENT_ID = 'rtr-chatgpt-button-root';
  let activeSession = null;
  let shadowRoot = null;
  let isReturning = false;
  let lastCheckedUrl = window.location.href;

  /**
   * Safe wrapper for sending runtime messages to service worker
   */
  function safeSendMessage(message, callback) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            return;
          }
          if (callback && typeof callback === 'function') {
            callback(response);
          }
        });
      }
    } catch {
      // Context invalidated
    }
  }

  /**
   * Determine whether ChatGPT is currently in dark mode
   */
  function isDarkMode() {
    return document.documentElement.classList.contains('dark') ||
      document.body.classList.contains('dark') ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  /**
   * Extract friendly domain or site name from URL
   */
  function getFriendlySiteName(url, title) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, '');
      if (title && title.length > 0 && title !== host) {
        // Look for common separators in title: " - ", " | "
        const parts = title.split(/ [|—–-] /);
        if (parts.length > 1) {
          return parts[parts.length - 1].trim().substring(0, 20);
        }
        return title.substring(0, 20);
      }
      return host;
    } catch {
      return 'Source Page';
    }
  }

  /**
   * Create or fetch the Shadow DOM root container
   */
  function getOrCreateShadowRoot() {
    let host = document.getElementById(ROOT_ELEMENT_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = ROOT_ELEMENT_ID;
      document.documentElement.appendChild(host);
      shadowRoot = host.attachShadow({ mode: 'open' });

      // Inject Scoped Stylesheet
      const styleEl = document.createElement('style');
      styleEl.textContent = `
        :host {
          all: initial;
          position: fixed;
          z-index: 2147483645;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          -webkit-font-smoothing: antialiased;
          bottom: 84px;
          right: 24px;
          pointer-events: auto;
        }
        .rtr-container {
          display: inline-flex;
          align-items: center;
          position: relative;
          user-select: none;
          opacity: 0;
          transform: translateY(12px) scale(0.96);
          transition: opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                      transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .rtr-container.rtr-visible {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
        .rtr-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px 8px 12px;
          border-radius: 9999px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          line-height: 1.4;
          outline: none;
          border: 1px solid rgba(16, 185, 129, 0.35);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.08);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .rtr-container.light .rtr-pill {
          background: rgba(255, 255, 255, 0.94);
          color: #0f172a;
          border-color: rgba(16, 185, 129, 0.4);
        }
        .rtr-container.light .rtr-pill:hover {
          background: #ffffff;
          border-color: #10b981;
          box-shadow: 0 8px 24px rgba(16, 185, 129, 0.2), 0 2px 6px rgba(0, 0, 0, 0.08);
          transform: translateY(-2px);
        }
        .rtr-container.dark .rtr-pill {
          background: rgba(24, 24, 27, 0.88);
          color: #f4f4f5;
          border-color: rgba(16, 185, 129, 0.45);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.45), 0 0 1px rgba(255, 255, 255, 0.1);
        }
        .rtr-container.dark .rtr-pill:hover {
          background: rgba(39, 39, 42, 0.96);
          border-color: #34d399;
          box-shadow: 0 8px 28px rgba(16, 185, 129, 0.32), 0 0 2px rgba(255, 255, 255, 0.2);
          transform: translateY(-2px);
        }
        .rtr-pill:focus-visible {
          outline: 2px solid #10b981;
          outline-offset: 3px;
        }
        .rtr-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          color: #10b981;
          flex-shrink: 0;
          transition: transform 0.2s ease;
        }
        .rtr-pill:hover .rtr-icon {
          transform: translateX(-3px);
        }
        .rtr-label {
          font-weight: 600;
          letter-spacing: -0.01em;
          white-space: nowrap;
        }
        .rtr-badge {
          display: inline-block;
          max-width: 130px;
          padding: 2px 7px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .rtr-container.light .rtr-badge {
          background: rgba(15, 23, 42, 0.06);
          color: #475569;
        }
        .rtr-container.dark .rtr-badge {
          background: rgba(255, 255, 255, 0.1);
          color: #a1a1aa;
        }
        .rtr-dismiss {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          border: none;
          background: transparent;
          cursor: pointer;
          color: #94a3b8;
          margin-left: 3px;
          padding: 0;
          outline: none;
          transition: all 0.15s ease;
        }
        .rtr-dismiss:hover {
          background: rgba(239, 68, 68, 0.15);
          color: #ef4444;
        }
        .rtr-tooltip {
          position: absolute;
          bottom: calc(100% + 10px);
          right: 0;
          width: 260px;
          padding: 10px 12px;
          border-radius: 10px;
          font-size: 12px;
          line-height: 1.4;
          pointer-events: none;
          opacity: 0;
          visibility: hidden;
          transform: translateY(6px);
          transition: opacity 0.2s ease, transform 0.2s ease, visibility 0.2s;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
          z-index: 10;
        }
        .rtr-container:hover .rtr-tooltip {
          opacity: 1;
          visibility: visible;
          transform: translateY(0);
        }
        .rtr-container.light .rtr-tooltip {
          background: #1e293b;
          color: #f8fafc;
        }
        .rtr-container.dark .rtr-tooltip {
          background: #09090b;
          color: #e4e4e7;
          border: 1px solid rgba(255, 255, 255, 0.12);
        }
        .rtr-tooltip-title {
          font-weight: 600;
          margin-bottom: 3px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .rtr-tooltip-url {
          color: #94a3b8;
          font-size: 11px;
          word-break: break-all;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .rtr-tooltip-meta {
          margin-top: 6px;
          padding-top: 6px;
          border-top: 1px solid rgba(255, 255, 255, 0.12);
          font-size: 10px;
          color: #10b981;
          display: flex;
          justify-content: space-between;
        }
        .rtr-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(16, 185, 129, 0.3);
          border-top-color: #10b981;
          border-radius: 50%;
          animation: rtr-spin 0.6s linear infinite;
        }
        @keyframes rtr-spin {
          to { transform: rotate(360deg); }
        }
        @media (max-width: 768px) {
          :host {
            bottom: 96px;
            right: 16px;
          }
          .rtr-badge {
            max-width: 85px;
          }
        }
      `;
      shadowRoot.appendChild(styleEl);

      const container = document.createElement('div');
      container.className = `rtr-container ${isDarkMode() ? 'dark' : 'light'}`;
      container.id = 'rtr-button-container';
      shadowRoot.appendChild(container);
    }
    return shadowRoot;
  }

  /**
   * Render the Return to Reading pill into the Shadow DOM
   */
  function renderButton(session) {
    if (!session) {
      hideButton();
      return;
    }

    activeSession = session;
    const root = getOrCreateShadowRoot();
    const container = root.getElementById('rtr-button-container');
    if (!container) return;

    // Update theme
    container.className = `rtr-container ${isDarkMode() ? 'dark' : 'light'}`;

    const siteBadge = getFriendlySiteName(session.sourceUrl, session.sourceTitle);
    const scrollInfo = typeof session.scrollPercent === 'number' 
      ? `Reading position: ~${session.scrollPercent}% down`
      : 'Saved reading position';

    container.innerHTML = `
      <div 
        class="rtr-pill" 
        role="button" 
        tabindex="0" 
        aria-label="Return to Reading: ${escapeHtml(session.sourceTitle || siteBadge)}"
        id="rtr-action-pill"
      >
        <span class="rtr-icon" id="rtr-icon-container">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </span>
        <span class="rtr-label" id="rtr-label-text">Return to Reading</span>
        <span class="rtr-badge" title="${escapeHtml(session.sourceTitle || session.sourceUrl)}">${escapeHtml(siteBadge)}</span>
        <button class="rtr-dismiss" id="rtr-dismiss-btn" title="Dismiss return destination" aria-label="Dismiss return button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div class="rtr-tooltip" role="tooltip">
        <div class="rtr-tooltip-title">${escapeHtml(session.sourceTitle || siteBadge)}</div>
        <div class="rtr-tooltip-url">${escapeHtml(session.sourceUrl)}</div>
        <div class="rtr-tooltip-meta">
          <span>${escapeHtml(scrollInfo)}</span>
          <span>Click to resume</span>
        </div>
      </div>
    `;

    // Make visible with smooth entry animation
    requestAnimationFrame(() => {
      container.classList.add('rtr-visible');
    });

    // Attach interaction handlers
    const pill = container.querySelector('#rtr-action-pill');
    const dismissBtn = container.querySelector('#rtr-dismiss-btn');

    if (pill) {
      pill.addEventListener('click', onPillClick);
      pill.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPillClick(e);
        }
      });
    }

    if (dismissBtn) {
      dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissDestination();
      });
    }
  }

  /**
   * Hide the button gracefully
   */
  function hideButton() {
    activeSession = null;
    if (shadowRoot) {
      const container = shadowRoot.getElementById('rtr-button-container');
      if (container) {
        container.classList.remove('rtr-visible');
      }
    }
  }

  /**
   * Handles user clicking 'Return to Reading'
   */
  function onPillClick(e) {
    if (isReturning || !activeSession) return;
    isReturning = true;

    const root = getOrCreateShadowRoot();
    const pill = root.querySelector('#rtr-action-pill');
    const iconContainer = root.querySelector('#rtr-icon-container');
    const labelText = root.querySelector('#rtr-label-text');

    if (pill) pill.classList.add('rtr-returning');
    if (labelText) labelText.textContent = 'Returning...';
    if (iconContainer) {
      iconContainer.innerHTML = `<div class="rtr-spinner"></div>`;
    }

    safeSendMessage({
      type: 'TRIGGER_RETURN',
      sessionId: activeSession.id
    }, (response) => {
      isReturning = false;
      if (!response || !response.success) {
        // Reset label if failed
        if (labelText) labelText.textContent = 'Return to Reading';
        if (iconContainer) {
          iconContainer.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          `;
        }
        if (pill) pill.classList.remove('rtr-returning');
      }
    });
  }

  /**
   * Handles user dismissing the return destination
   */
  function dismissDestination() {
    if (activeSession) {
      safeSendMessage({
        type: 'DISMISS_SESSION',
        sessionId: activeSession.id
      });
    }
    hideButton();
  }

  /**
   * Safe HTML Escaper to prevent any XSS issues
   */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Query the service worker for the active return destination for this tab
   */
  function checkReturnDestination() {
    safeSendMessage({
      type: 'GET_RETURN_DESTINATION'
    }, (response) => {
      if (response && response.session) {
        renderButton(response.session);
      } else {
        hideButton();
      }
    });
  }

  // Initial check once document is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkReturnDestination, { once: true });
  } else {
    checkReturnDestination();
  }

  // Listen for runtime updates from service worker
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message !== 'object') return false;

      if (message.type === 'SESSION_AVAILABLE') {
        renderButton(message.session);
        sendResponse({ received: true });
        return true;
      }

      if (message.type === 'SESSION_CLEARED') {
        hideButton();
        sendResponse({ received: true });
        return true;
      }

      return false;
    });
  }

  // Observe theme changes (dark/light mode toggles on ChatGPT)
  const themeObserver = new MutationObserver(() => {
    if (shadowRoot) {
      const container = shadowRoot.getElementById('rtr-button-container');
      if (container) {
        const dark = isDarkMode();
        container.classList.toggle('dark', dark);
        container.classList.toggle('light', !dark);
      }
    }
  });

  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme']
  });

  // Watch for SPA URL changes (React router navigation between /c/... conversations)
  setInterval(() => {
    if (window.location.href !== lastCheckedUrl) {
      lastCheckedUrl = window.location.href;
      // Re-verify return destination on conversation switch
      checkReturnDestination();
    }
  }, 1500);

  // Also check when tab regains focus
  window.addEventListener('focus', checkReturnDestination);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkReturnDestination();
    }
  });
})();
