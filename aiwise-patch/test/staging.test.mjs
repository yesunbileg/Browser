import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.AIWISE_OUTPUT || '/home/home/Documents/AIWise-Donor-Staging';
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('staged manifest keeps donor capabilities and installs only the Claude observer', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const scripts = manifest.content_scripts.flatMap((entry) => entry.js);
  assert.equal(manifest.name, 'AIWise — Claude & Gemini Usage, Quota Tracker & Bookmarks');
  assert.ok(scripts.includes('content-scripts/bookmark-capture.js'));
  assert.ok(scripts.includes('content-scripts/gemini-capture.js'));
  assert.ok(scripts.includes('aiwise-patch/account-limit-watcher.js'));
  assert.ok(!scripts.includes('content-scripts/usage-widget.js'));
  assert.ok(!manifest.key);
  assert.ok(!manifest.update_url);
});

test('staged popup preserves donor controls and removes analytics execution and consent gating', () => {
  const html = read('popup.html');
  const popup = read('chunks/popup-DTZywcuG.js');
  const theme = read('chunks/theme-D3CBbH01.js');
  assert.match(html, /chunks\/popup-DTZywcuG\.js/);
  assert.match(html, /aiwise-patch\/popup-account-area\.js/);
  assert.match(popup, /"Bookmarks"/);
  assert.match(popup, /"Settings"/);
  assert.match(popup, /" Claude "/);
  assert.match(popup, /" Gemini "/);
  assert.doesNotMatch(popup, /C\.page\(location\.href\)|C\.autoTrack\(document\)/);
  assert.match(popup, /i\.value\?1\?\(n\(\),r\(_,/);
  assert.match(theme, /const uc=\{identify:async\(\)=>\{\},track:async\(\)=>\{\},page:async\(\)=>\{\},autoTrack:\(\)=>\(\)=>\{\}/);
});

test('staged worker disables the analytics bridge but retains both message handlers', () => {
  const worker = read('background.js');
  assert.match(worker, /O\.runtime\.onConnect\.addListener\(\(\)=>\{\}\)/);
  assert.match(worker, /importScripts\('aiwise-patch\/background\.js'\)/);
  const patch = read('aiwise-patch/background.js');
  assert.match(patch, /AIWISE_CONFIRMED_LIMIT/);
  assert.match(patch, /AIWISE_ACCOUNT_SEEN/);
  assert.match(worker, /usage-captured/);
  assert.match(worker, /const rr=\{track:async\(\)=>\{\}\};/);
  assert.doesNotMatch(worker, /G-6NHC8JVJQ4|Ht\(\);const tr=|const Kt=Vi\(/);
});

test('staging excludes Chrome verification metadata and leaves consent untouched', () => {
  assert.ok(!fs.existsSync(path.join(root, '_metadata')));
  const patch = read('aiwise-patch/popup-account-area.js');
  assert.match(patch, /aiwise\.account\./);
  assert.doesNotMatch(patch, /Sensor Tower|consent/i);
});
