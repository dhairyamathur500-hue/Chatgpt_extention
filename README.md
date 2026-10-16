# Return to Reading — Chrome Extension (Manifest V3)

> Seamlessly return to the exact reading position in your articles, documentation, and tutorials after asking questions on ChatGPT.

---

## 1. Product Vision & Problem Solved

When reading long technical documentation, research papers, or articles, developers and readers frequently switch to ChatGPT to ask clarification questions. Once ChatGPT answers, returning to the exact reading location is tedious:
- You lose track of which tab was open.
- You lose your scroll position on long pages.
- If you navigated away or closed the tab, you have to search for the article all over again.

**Return to Reading** solves this by injecting an unobtrusive, floating **"← Return to Reading"** button directly into the ChatGPT interface. With one click, it focuses the original tab and smoothly restores your exact reading position, complete with a subtle visual beacon to guide your eyes back to the text.

---

## 2. Technical Architecture & File Directory

The extension is built strictly adhering to Chrome's **Manifest V3** standard, utilizing isolated contexts, local storage, and high-performance passive event listeners.

```
return-to-reading/
├── manifest.json              # Manifest V3 configuration & permission boundaries
├── service-worker.js          # Central background coordinator (tabs, sessions, navigation)
├── content/
│   ├── source-tracker.js      # Monitors reading position on reader websites (scroll, visibility)
│   ├── chatgpt-button.js      # Injects isolated Shadow DOM return button into ChatGPT
│   └── chatgpt-button.css     # Glassmorphic, dark/light theme responsive stylesheet
├── lib/
│   ├── session-store.js       # Local-first storage manager (chrome.storage.local)
│   └── position-restore.js    # Resilient scroll restoration algorithm with retry loop
├── popup/
│   ├── popup.html             # Status popup & privacy controls
│   ├── popup.js               # Session status & "Clear all sessions" trigger
│   └── popup.css              # Modern popup styling
├── icons/                     # Standard Chrome extension icons (16, 32, 48, 128)
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   └── icon-128.png
├── generate_icons.py          # Icon generation script
└── test-verification.js       # Automated Node.js test suite
```

---

## 3. Transition Detection Workflows

The extension supports three primary workflows:

### Workflow 1: Right-Click Context Menu ("Ask ChatGPT")
1. Highlight any text or right-click anywhere on an article.
2. Select **"Ask ChatGPT (with Return to Reading)"** from the context menu.
3. The extension captures your exact scroll position and URL, opens ChatGPT in a new tab with your selected text pre-filled, and links the new tab to your reading session.
4. The **"Return to Reading"** button appears immediately inside ChatGPT.

### Workflow 2: Tab Created with Opener Relationship
1. Click a ChatGPT link from any documentation or open ChatGPT in a new tab (`target="_blank"` or Ctrl/Cmd-click).
2. The service worker detects the `openerTabId` relationship and links the ChatGPT tab to the originating source tab.
3. The button appears inside ChatGPT, showing the source site's title.

### Workflow 3: Switching or Navigating to ChatGPT
1. While reading in Tab A, you switch to or open ChatGPT in Tab B (or navigate directly to ChatGPT in the same tab).
2. The extension resolves the candidate reading session (most recent active reading tab in the same window).
3. The button appears inside ChatGPT with a tooltip showing the destination title and URL.

---

## 4. Permission Strategy & Privacy-First Disclosures

We enforce the **Principle of Least Privilege**:

| Permission | Justification |
| :--- | :--- |
| `storage` | Stores reading sessions locally in `chrome.storage.local`. Data never leaves the browser. |
| `tabs` | Allows querying `openerTabId`, activating the source tab, and restoring the source tab if closed. |
| `contextMenus` | Provides the right-click "Ask ChatGPT (with Return to Reading)" workflow. |
| `scripting` | Fallback scroll restoration in case a reopened page requires programmatic scrolling. |
| `http://*/*`, `https://*/*` | Necessary to inject the lightweight scroll monitor on general reader websites without requiring manual icon clicks. Excludes ChatGPT hosts. |

### Privacy Commitments:
- **Zero Remote Tracking**: 100% local-first. No analytics, no remote APIs, no telemetry.
- **No Conversation Reading**: The extension never reads your ChatGPT prompts, answers, or chat history.
- **No Sensitive Data**: Form inputs, password fields, and cookies are never tracked.
- **Easy Purging**: Click the extension icon in the toolbar and hit the trash icon to instantly erase all stored reading sessions.

---

## 5. How to Load and Test the Extension in Chrome

Follow these simple steps to install the extension in developer mode:

1. Open Google Chrome.
2. Navigate to `chrome://extensions/` in the URL bar.
3. Toggle the **"Developer mode"** switch in the top-right corner.
4. Click the **"Load unpacked"** button in the top-left corner.
5. Select the project folder:
   ```
   /Users/dhairyamathur/.gemini/antigravity-ide/scratch/return-to-reading
   ```
6. The extension **"Return to Reading — for ChatGPT"** will appear in your installed extensions list.

---

## 6. Manual Testing Checklist

| Step | Action | Expected Result |
| :---: | :--- | :--- |
| 1 | Open any long article (e.g. [MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/JavaScript)) and scroll down 50%. | Scroll position is silently tracked. |
| 2 | Right-click text & select **"Ask ChatGPT (with Return to Reading)"**. | ChatGPT opens in a new tab. |
| 3 | Observe ChatGPT bottom-right corner. | Floating **"← Return to Reading"** pill appears with the site badge. |
| 4 | Hover over the pill. | Tooltip displays full page title, URL, and ~50% scroll info. |
| 5 | Click **"← Return to Reading"**. | Browser switches back to MDN tab; page smoothly scrolls to exact reading position with a subtle emerald beacon line. |
| 6 | Close the original reading tab, then click Return from ChatGPT. | Extension reopens the original URL and restores the scroll position. |
| 7 | Toggle dark mode in ChatGPT. | Return button automatically adapts between sleek dark glass and clean light theme. |
| 8 | Switch conversations in ChatGPT (`/c/...`). | The button remains docked and does not duplicate or break. |
| 9 | Click toolbar icon & select trash icon. | Navigation data is wiped clean immediately. |

---

## 7. Automated Test Suite

To run the automated verification suite:

```bash
cd /Users/dhairyamathur/.gemini/antigravity-ide/scratch/return-to-reading
node test-verification.js
```
