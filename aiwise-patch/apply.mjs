import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const donor = process.env.AIWISE_DONOR || '/home/home/.config/BraveSoftware/Brave-Browser/Profile 5/Extensions/aoefpjdgkiijhbnjkcmcoiaojbfdkoib/0.7.0_0';
const output = process.env.AIWISE_OUTPUT || '/home/home/Documents/AIWise-Donor-Staging';
const sourceRepo = path.resolve(here, '../claude-account-limits');

if (!fs.existsSync(path.join(donor, 'manifest.json'))) throw new Error(`Donor not found: ${donor}`);
const donorPath = path.resolve(donor);
const outputPath = path.resolve(output);
if (donorPath === outputPath || donorPath.startsWith(outputPath + path.sep) || outputPath.startsWith(donorPath + path.sep)) {
  throw new Error('Output must be separate from the original donor');
}
const marker = path.join(output, '.aiwise-local-patch-output');
if (fs.existsSync(output) && !fs.existsSync(marker)) throw new Error('Refusing to overwrite a directory not created by this patcher');
fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(donor, output, { recursive: true, filter: (src) => !path.relative(donor, src).split(path.sep).includes('_metadata') });
fs.writeFileSync(marker, 'Generated local AIWise patch output. Original donor is unchanged.\n');

const manifestPath = path.join(output, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
delete manifest.key;
delete manifest.update_url;
manifest.version = '0.9.1';
manifest.content_security_policy = {
  extension_pages: "script-src 'self'; object-src 'self'; connect-src 'self' https://claude.ai https://gemini.google.com",
};
manifest.content_scripts = manifest.content_scripts.map((entry) => ({
  ...entry,
  js: entry.js.filter((script) => script !== 'content-scripts/usage-widget.js'),
})).filter((entry) => entry.js.length > 0);
manifest.content_scripts.push({
  matches: ['https://claude.ai/*'],
  js: ['aiwise-patch/usage-state.js', 'aiwise-patch/free-limit-parser.js', 'aiwise-patch/account-limit-watcher.js'],
  run_at: 'document_idle',
});
manifest.web_accessible_resources = manifest.web_accessible_resources.map((entry) => ({
  ...entry,
  resources: entry.resources.filter((resource) => resource !== 'content-scripts/usage-widget.css'),
})).filter((entry) => entry.resources.length > 0);
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const themeChunk = path.join(output, 'chunks/theme-D3CBbH01.js');
let theme = fs.readFileSync(themeChunk, 'utf8');
const analyticsExport = 'const Mn=Ur(mo().analytics),uc={...Mn,track:(e,t={})=>Mn.track(e,t),identify:async()=>{}};';
const disabledAnalyticsExport = 'const uc={identify:async()=>{},track:async()=>{},page:async()=>{},autoTrack:()=>()=>{},captureException:async()=>{},setEnabled:async()=>{}};';
if (theme.includes(analyticsExport)) theme = theme.replace(analyticsExport, disabledAnalyticsExport);
else if (!theme.includes(disabledAnalyticsExport)) throw new Error('Analytics SDK export not found; refusing to leave popup telemetry enabled');
fs.writeFileSync(themeChunk, theme);

const popupChunk = path.join(output, 'chunks/popup-DTZywcuG.js');
let popup = fs.readFileSync(popupChunk, 'utf8');
const consentGate = 'i.value?o.value?(n(),r(_,{key:2},[';
if (popup.includes(consentGate)) popup = popup.replace(consentGate, 'i.value?1?(n(),r(_,{key:2},[');
else if (!popup.includes('i.value?1?(n(),r(_,{key:2},[')) throw new Error('Popup consent gate not found; refusing to make consent an access requirement');
const telemetryTail = ';C.page(location.href);C.autoTrack(document);';
if (popup.includes(telemetryTail)) popup = popup.replace(telemetryTail, ';');
else if (!popup.endsWith('We(ks).mount("#app");')) throw new Error('Unexpected popup bundle ending; refusing to patch telemetry hooks');
fs.writeFileSync(popupChunk, popup);

const backgroundPath = path.join(output, 'background.js');
let background = fs.readFileSync(backgroundPath, 'utf8');
const analyticsInit = /Ht\(\);const tr=\{analytics:\{providers:\[\$i\(\{measurementId:"[^"]+",apiSecret:"[^"]+"\}\)\][\s\S]*?const Kt=Vi\(ir\(\)\.analytics\),rr=\{\.\.\.Kt,track:\(e,t=\{\}\)=>Kt\.track\(e,t\),identify:async\(\)=>\{\}\};/;
if (analyticsInit.test(background)) background = background.replace(analyticsInit, 'const rr={track:async()=>{}};');
else if (!background.includes('const rr={track:async()=>{}};')) throw new Error('Background analytics initializer not found; refusing to leave telemetry initialized');
fs.writeFileSync(backgroundPath, background);

const analyticsBridge = 'O.runtime.onConnect.addListener(r=>{r.name===Wt&&r.onMessage.addListener(({fn:s,args:f})=>{var g;(g=y[s])==null||g.call(y,...f)})})';
if (background.includes(analyticsBridge)) background = background.replace(analyticsBridge, 'O.runtime.onConnect.addListener(()=>{})');
else if (!background.includes('O.runtime.onConnect.addListener(()=>{})')) throw new Error('Analytics bridge not found; refusing to leave telemetry enabled');
fs.writeFileSync(backgroundPath, background);
fs.appendFileSync(backgroundPath, "\nimportScripts('aiwise-patch/background.js');\n");

const popupHtml = path.join(output, 'popup.html');
let html = fs.readFileSync(popupHtml, 'utf8');
if (!html.includes('aiwise-patch/popup-account-area.js')) {
  html = html.replace('</body>', '    <script src="/aiwise-patch/usage-state.js"></script>\n    <script type="module" src="/aiwise-patch/popup-account-area.js"></script>\n  </body>');
}
fs.writeFileSync(popupHtml, html);

const patchDir = path.join(output, 'aiwise-patch');
fs.mkdirSync(patchDir, { recursive: true });
for (const name of ['usage-state.js', 'free-limit-parser.js', 'account-limit-watcher.js']) {
  fs.copyFileSync(path.join(sourceRepo, 'content-scripts', name), path.join(patchDir, name));
}
for (const name of ['background.js', 'popup-account-area.js']) {
  fs.copyFileSync(path.join(here, 'patch', name), path.join(patchDir, name));
}
console.log(`Patched donor staged at ${output}`);
