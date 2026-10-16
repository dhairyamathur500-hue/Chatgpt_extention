/**
 * Return to Reading — Extension Popup Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  const cardContainer = document.getElementById('active-session-card');
  const clearAllBtn = document.getElementById('clear-all-btn');

  async function refreshUI() {
    try {
      const sessions = await SessionStore.getSessions();
      if (sessions && sessions.length > 0) {
        const latest = sessions[0];
        renderActiveSession(latest);
      } else {
        renderEmptyState();
      }
    } catch {
      renderEmptyState();
    }
  }

  function renderActiveSession(session) {
    cardContainer.className = 'session-card has-data';
    const percentText = typeof session.scrollPercent === 'number'
      ? `${session.scrollPercent}% scrolled`
      : 'Saved position';

    cardContainer.innerHTML = `
      <div class="card-header">
        <div class="card-title" title="${escapeHtml(session.sourceTitle || session.sourceUrl)}">
          ${escapeHtml(session.sourceTitle || 'Reading Document')}
        </div>
      </div>
      <div class="card-url" title="${escapeHtml(session.sourceUrl)}">
        ${escapeHtml(session.sourceUrl)}
      </div>
      <div class="card-meta">
        <span class="scroll-badge">&darr; ${escapeHtml(percentText)}</span>
        <button class="jump-button" id="return-now-btn">Return Now</button>
      </div>
    `;

    const returnBtn = cardContainer.querySelector('#return-now-btn');
    if (returnBtn) {
      returnBtn.addEventListener('click', () => {
        returnBtn.textContent = 'Returning...';
        returnBtn.disabled = true;
        chrome.runtime.sendMessage({
          type: 'TRIGGER_RETURN',
          sessionId: session.id
        }, () => {
          window.close();
        });
      });
    }
  }

  function renderEmptyState() {
    cardContainer.className = 'session-card empty';
    cardContainer.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">No active reading session</p>
        <p class="empty-desc">Open an article, documentation, or tutorial and scroll. When you switch or ask ChatGPT, your position is remembered.</p>
      </div>
    `;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CLEAR_ALL_SESSIONS' }, () => {
        refreshUI();
      });
    });
  }

  // Initial render
  await refreshUI();
});
