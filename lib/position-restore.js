/**
 * Return to Reading — Position Restore Helper
 * 
 * Provides robust scroll restoration algorithms with retry loops
 * for dynamic pages, images, and single-page apps.
 * Also provides an optional subtle beacon so the user immediately
 * spots where they were reading.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PositionRestore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Attempts to smoothly scroll to (targetX, targetY) with retries
   * to accommodate lazy-loaded images, fonts, or dynamic DOM changes.
   */
  function restoreScrollWithRetries(targetX = 0, targetY = 0, options = {}) {
    const {
      maxRetries = 4,
      intervals = [50, 200, 500, 1000],
      smooth = true,
      showBeacon = true
    } = options;

    function applyScroll() {
      try {
        window.scrollTo({
          left: targetX,
          top: targetY,
          behavior: smooth ? 'smooth' : 'auto'
        });
      } catch {
        // Fallback for older browsers
        window.scroll(targetX, targetY);
      }
    }

    // First attempt immediately
    applyScroll();

    // Staggered retries for dynamic height expansion
    intervals.forEach((delay, index) => {
      if (index < maxRetries) {
        setTimeout(() => {
          const currentY = window.scrollY || document.documentElement.scrollTop || 0;
          const maxScroll = Math.max(
            0,
            document.documentElement.scrollHeight - window.innerHeight
          );

          // If we haven't reached target and the page can scroll further, re-scroll
          if (Math.abs(currentY - targetY) > 25 && targetY <= maxScroll + 50) {
            applyScroll();
          }
        }, delay);
      }
    });

    if (showBeacon) {
      highlightReadingPosition(targetY);
    }
  }

  /**
   * Displays a subtle, beautiful pulse indicator at the target reading position
   * to guide the user's eyes back to the text without being intrusive.
   */
  function highlightReadingPosition(targetY) {
    // Only display in browser DOM contexts
    if (typeof document === 'undefined' || !document.body) return;

    const BEACON_ID = 'rtr-reading-beacon';
    const existing = document.getElementById(BEACON_ID);
    if (existing) existing.remove();

    const beacon = document.createElement('div');
    beacon.id = BEACON_ID;
    beacon.setAttribute('aria-hidden', 'true');

    // Visual styles for a sleek gradient pulse line
    Object.assign(beacon.style, {
      position: 'fixed',
      top: '25%', // placed comfortably in the upper reading third of the viewport
      left: '0',
      right: '0',
      height: '3px',
      background: 'linear-gradient(90deg, rgba(16, 185, 129, 0) 0%, rgba(16, 185, 129, 0.85) 20%, rgba(14, 116, 144, 0.95) 50%, rgba(16, 185, 129, 0.85) 80%, rgba(16, 185, 129, 0) 100%)',
      boxShadow: '0 0 12px rgba(16, 185, 129, 0.5), 0 0 24px rgba(14, 116, 144, 0.3)',
      zIndex: '2147483640',
      pointerEvents: 'none',
      opacity: '0',
      transform: 'scaleX(0.4)',
      transition: 'opacity 0.35s ease, transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)'
    });

    document.body.appendChild(beacon);

    // Animate in
    requestAnimationFrame(() => {
      beacon.style.opacity = '1';
      beacon.style.transform = 'scaleX(1)';

      // Fade out smoothly after 1.6s
      setTimeout(() => {
        beacon.style.opacity = '0';
        beacon.style.transform = 'scaleX(0.8)';
        setTimeout(() => {
          if (beacon.parentNode) {
            beacon.remove();
          }
        }, 400);
      }, 1600);
    });
  }

  return {
    restoreScrollWithRetries,
    highlightReadingPosition
  };
});
