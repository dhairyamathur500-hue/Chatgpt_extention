/**
 * Return to Reading — Source Tracker Content Script
 * 
 * Runs on reader webpages (articles, documentation, blogs).
 * Silently monitors reading scroll position, page lifecycle changes,
 * and text selection context, syncing coordinates with the background service worker.
 * Also receives commands to restore reading position smoothly.
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__rtrSourceTrackerInjected) return;
  window.__rtrSourceTrackerInjected = true;

  // Verify we are not in an iframe or unsupported scheme
  if (window.top !== window.self) return;

  const url = window.location.href;
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
    return;
  }

  let lastReportedX = -1;
  let lastReportedY = -1;
  let scrollThrottleTimer = null;
  let currentSelectionText = '';

  /**
   * Safe wrapper for sending messages to background service worker.
   * Catches errors when extension reloads or context is invalidated.
   */
  function safeSendMessage(message, callback) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            // Silently ignore expected disconnects during navigation
            return;
          }
          if (callback && typeof callback === 'function') {
            callback(response);
          }
        });
      }
    } catch {
      // Extension context invalidated
    }
  }

  /**
   * Computes reading metrics from the current document
   */
  function getReadingMetrics() {
    const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const docHeight = Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0
    );
    const viewHeight = window.innerHeight || 1;
    const maxScroll = Math.max(1, docHeight - viewHeight);
    const scrollPercent = Math.min(100, Math.max(0, Math.round((scrollY / maxScroll) * 100)));

    return {
      url: window.location.href,
      title: document.title || window.location.hostname,
      scrollX: Math.round(scrollX),
      scrollY: Math.round(scrollY),
      scrollPercent,
      selectedText: currentSelectionText
    };
  }

  /**
   * Reports current position to the background service worker
   */
  function reportPosition(immediate = false) {
    const metrics = getReadingMetrics();

    // Check if position changed noticeably (more than 10px or forced)
    if (
      !immediate &&
      Math.abs(metrics.scrollX - lastReportedX) < 10 &&
      Math.abs(metrics.scrollY - lastReportedY) < 10
    ) {
      return;
    }

    lastReportedX = metrics.scrollX;
    lastReportedY = metrics.scrollY;

    safeSendMessage({
      type: 'SOURCE_POSITION_UPDATE',
      payload: metrics
    });
  }

  /**
   * Throttled scroll listener (fires at most once per 250ms)
   */
  function onScroll() {
    if (scrollThrottleTimer) return;
    scrollThrottleTimer = setTimeout(() => {
      scrollThrottleTimer = null;
      reportPosition(false);
    }, 250);
  }

  /**
   * Track selected text context (limited to short readable snippet, max 120 chars)
   */
  function onSelectionChange() {
    try {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        currentSelectionText = '';
        return;
      }
      // Don't capture if selected inside password or sensitive form inputs
      const anchorNode = sel.anchorNode;
      if (anchorNode && anchorNode.parentElement) {
        const tag = anchorNode.parentElement.tagName.toLowerCase();
        const type = (anchorNode.parentElement.type || '').toLowerCase();
        if (tag === 'input' && (type === 'password' || type === 'email' || type === 'tel')) {
          return;
        }
      }
      const rawText = sel.toString().trim();
      if (rawText.length > 0) {
        currentSelectionText = rawText.substring(0, 120);
      }
    } catch {
      // Ignore selection errors
    }
  }

  /**
   * Immediately flush reading state when tab becomes hidden or user leaves
   */
  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      reportPosition(true);
    }
  }

  function onPageHide() {
    reportPosition(true);
  }

  // Register passive event listeners for high performance
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('selectionchange', onSelectionChange, { passive: true });
  document.addEventListener('visibilitychange', onVisibilityChange, { passive: true });
  window.addEventListener('pagehide', onPageHide, { passive: true });
  window.addEventListener('beforeunload', onPageHide, { passive: true });

  // Initial report when DOM is interactive
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => reportPosition(true), { once: true });
  } else {
    reportPosition(true);
  }

  /**
   * Listen for commands from the background service worker
   * e.g. when the user clicks 'Return to Reading' from ChatGPT!
   */
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message !== 'object') return false;

      if (message.type === 'RESTORE_SCROLL') {
        const targetX = message.scrollX || 0;
        const targetY = message.scrollY || 0;

        // Perform smooth restoration with retries
        smoothRestore(targetX, targetY);
        sendResponse({ success: true, restoredX: targetX, restoredY: targetY });
        return true;
      }

      if (message.type === 'GET_CURRENT_POSITION') {
        const metrics = getReadingMetrics();
        sendResponse(metrics);
        return true;
      }

      return false;
    });
  }

  /**
   * In-page smooth scroll restoration with retry loop and visual beacon
   */
  function smoothRestore(targetX, targetY) {
    function doScroll() {
      try {
        window.scrollTo({
          left: targetX,
          top: targetY,
          behavior: 'smooth'
        });
      } catch {
        window.scroll(targetX, targetY);
      }
    }

    doScroll();

    // Staggered retries for lazy content / reflow
    [100, 300, 600, 1200].forEach((delay) => {
      setTimeout(() => {
        const currY = window.scrollY || document.documentElement.scrollTop || 0;
        const maxScroll = Math.max(0, (document.documentElement.scrollHeight || 0) - window.innerHeight);
        if (Math.abs(currY - targetY) > 30 && targetY <= maxScroll + 50) {
          doScroll();
        }
      }, delay);
    });

    // Visual reading beacon
    showReadingBeacon();
  }

  function showReadingBeacon() {
    const existing = document.getElementById('rtr-reading-beacon');
    if (existing) existing.remove();

    const beacon = document.createElement('div');
    beacon.id = 'rtr-reading-beacon';
    beacon.setAttribute('aria-hidden', 'true');
    Object.assign(beacon.style, {
      position: 'fixed',
      top: '30%',
      left: '0',
      right: '0',
      height: '3px',
      background: 'linear-gradient(90deg, rgba(16, 185, 129, 0) 0%, rgba(16, 185, 129, 0.9) 25%, rgba(14, 116, 144, 1) 50%, rgba(16, 185, 129, 0.9) 75%, rgba(16, 185, 129, 0) 100%)',
      boxShadow: '0 0 14px rgba(16, 185, 129, 0.6), 0 0 28px rgba(14, 116, 144, 0.4)',
      zIndex: '2147483647',
      pointerEvents: 'none',
      opacity: '0',
      transform: 'scaleX(0.2)',
      transition: 'opacity 0.3s ease, transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
    });

    document.body.appendChild(beacon);

    requestAnimationFrame(() => {
      beacon.style.opacity = '1';
      beacon.style.transform = 'scaleX(1)';

      setTimeout(() => {
        beacon.style.opacity = '0';
        beacon.style.transform = 'scaleX(0.7)';
        setTimeout(() => {
          if (beacon.parentNode) beacon.remove();
        }, 350);
      }, 1500);
    });
  }
})();
