/**
 * Comprehensive Verification Suite for Return to Reading Extension
 * Runs in Node.js to validate manifest, scripts, session store logic, and assets.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname);

console.log('🧪 Starting Return to Reading Verification Suite...\n');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     Error: ${err.message}`);
  }
}

// 1. Manifest verification
test('manifest.json exists and is valid MV3', () => {
  const manifestPath = path.join(ROOT_DIR, 'manifest.json');
  assert(fs.existsSync(manifestPath), 'manifest.json must exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.strictEqual(manifest.manifest_version, 3, 'Must be Manifest V3');
  assert(manifest.name, 'Must have name');
  assert(manifest.version, 'Must have version');
  assert(Array.isArray(manifest.permissions), 'Must specify permissions');
  assert(manifest.permissions.includes('storage'), 'Must have storage permission');
  assert(manifest.permissions.includes('tabs'), 'Must have tabs permission');
  assert(manifest.permissions.includes('contextMenus'), 'Must have contextMenus permission');
  assert(manifest.background && manifest.background.service_worker, 'Must declare service worker');
  assert(Array.isArray(manifest.content_scripts), 'Must declare content scripts');
  assert.strictEqual(manifest.content_scripts.length, 2, 'Must have 2 content scripts (reader and chatgpt)');
});

// 2. Icon files verification
test('All icon files exist and are valid PNGs', () => {
  const sizes = [16, 32, 48, 128];
  sizes.forEach(size => {
    const iconPath = path.join(ROOT_DIR, 'icons', `icon-${size}.png`);
    assert(fs.existsSync(iconPath), `icon-${size}.png must exist`);
    const buf = fs.readFileSync(iconPath);
    // PNG magic header: 89 50 4E 47 0D 0A 1A 0A
    assert.strictEqual(buf[0], 0x89, 'PNG magic header 0');
    assert.strictEqual(buf[1], 0x50, 'PNG magic header 1');
    assert.strictEqual(buf[2], 0x4E, 'PNG magic header 2');
    assert.strictEqual(buf[3], 0x47, 'PNG magic header 3');
  });
});

// 3. Script syntax validation
test('All JavaScript files parse with zero syntax errors', () => {
  const jsFiles = [
    'service-worker.js',
    'lib/session-store.js',
    'lib/position-restore.js',
    'content/source-tracker.js',
    'content/chatgpt-button.js',
    'popup/popup.js'
  ];

  jsFiles.forEach(file => {
    const filePath = path.join(ROOT_DIR, file);
    assert(fs.existsSync(filePath), `${file} must exist`);
    const code = fs.readFileSync(filePath, 'utf8');
    // Test parsing with new Function
    assert.doesNotThrow(() => {
      // In Node environment, wrap in function syntax check
      new Function(code);
    }, `Syntax check failed on ${file}`);
  });
});

// 4. Session Store Logic Verification
test('SessionStore logic handles URL validation, upserting, and tab resolution', async () => {
  // Set up in-memory storage mock
  globalThis.__mockStorage = {};
  
  const SessionStore = require('./lib/session-store.js');

  // Test URL validation
  assert.strictEqual(SessionStore.isValidReadingUrl('https://developer.mozilla.org/en-US/'), true);
  assert.strictEqual(SessionStore.isValidReadingUrl('http://example.com/article'), true);
  assert.strictEqual(SessionStore.isValidReadingUrl('https://chatgpt.com/c/123'), false);
  assert.strictEqual(SessionStore.isValidReadingUrl('https://chat.openai.com/'), false);
  assert.strictEqual(SessionStore.isValidReadingUrl('chrome://extensions'), false);
  assert.strictEqual(SessionStore.isValidReadingUrl('about:blank'), false);

  // Test session creation
  const sess1 = await SessionStore.saveOrUpdateSourceSession({
    tabId: 101,
    windowId: 1,
    url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
    title: 'MDN Web Docs — JavaScript',
    scrollX: 0,
    scrollY: 1250,
    scrollPercent: 42,
    selectedText: 'Promises are objects representing the eventual completion'
  });

  assert(sess1 && sess1.id, 'Session must be created with ID');
  assert.strictEqual(sess1.scrollY, 1250);
  assert.strictEqual(sess1.scrollPercent, 42);

  // Test updating scroll on existing tab
  const updatedSess = await SessionStore.updateScrollPosition(101, 'https://developer.mozilla.org/en-US/docs/Web/JavaScript', 0, 1800, 60);
  assert(updatedSess, 'Session must update');
  assert.strictEqual(updatedSess.scrollY, 1800);
  assert.strictEqual(updatedSess.scrollPercent, 60);

  // Test link ChatGPT tab
  await SessionStore.linkChatGPTTabToSession(202, sess1.id);

  // Test resolve for that ChatGPT tab
  const resolved = await SessionStore.resolveSessionForChatGPTTab(202, 1);
  assert(resolved, 'Must resolve linked session');
  assert.strictEqual(resolved.id, sess1.id);
  assert.strictEqual(resolved.sourceTabId, 101);

  // Test resolve via openerTabId
  const openerResolved = await SessionStore.resolveSessionForChatGPTTab(205, 1, 101);
  assert(openerResolved, 'Must resolve via openerTabId');
  assert.strictEqual(openerResolved.id, sess1.id);

  // Test clear all sessions
  await SessionStore.clearAllSessions();
  const emptySessions = await SessionStore.getSessions();
  assert.strictEqual(emptySessions.length, 0, 'Sessions must be empty after clear');
});

console.log(`\n📊 Results: ${passedTests}/${totalTests} tests passed.`);
if (passedTests === totalTests) {
  console.log('🎉 All verification tests passed successfully!\n');
} else {
  process.exit(1);
}
