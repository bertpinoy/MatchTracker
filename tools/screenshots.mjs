// Maakt de screenshots voor de README (docs/screenshots/*.png) met fictieve demodata.
//
// Gebruik (vanuit de projectmap, met een lokale webserver op poort 5173):
//   python -m http.server 5173
//   node tools/screenshots.mjs [http://localhost:5173]
//
// Vereist Node 22+ (ingebouwde WebSocket) en Google Chrome of Microsoft Edge.
// Er gaat niets naar Firebase: live delen wordt niet gestart, de ouderview krijgt de data rechtstreeks.

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');
const PORT = 9333;
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
];
const exe = BROWSERS.find(existsSync);
if (!exe) { console.error('Geen Chrome of Edge gevonden.'); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), 'kwsc-shots-'));
const browser = spawn(exe, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- minimale Chrome DevTools Protocol-client ----
let ws, nextId = 1; const pending = new Map(), waiters = [];
async function connect(){
  for (let i = 0; i < 50; i++){
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const page = list.find(t => t.type === 'page'); if (page){ ws = new WebSocket(page.webSocketDebuggerUrl); break; } } catch {}
    await sleep(200);
  }
  if (!ws) throw new Error('Kon niet verbinden met de browser');
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)){ const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else if (m.method) waiters.filter(w => w.method === m.method).forEach(w => { waiters.splice(waiters.indexOf(w), 1); w.res(m.params); });
  });
}
const send = (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const once = method => new Promise(res => waiters.push({ method, res }));
async function evaluate(expr){
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function go(url){ const loaded = once('Page.loadEventFired'); await send('Page.navigate', { url }); await loaded; await sleep(600); }
async function shot(name){   // schermafbeelding van wat zichtbaar is (390 × 844, ×2)
  await sleep(450);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
  console.log('✔', name);
}

// ---- demodata (fictief) ----
const DEMO = `
  window.confirm = () => true;
  const S2 = st.setup;
  Object.assign(S2, {team:'KWSC Lauwe U10', opponent:'FC Voorbeeld', oppColor:'#e53935', weAreHome:true, periods:4, periodMin:15, fieldSize:8, squadSize:12,
    kickoff:'10:30', whenTouched:true, players:{1:'Noah',2:'Lars',4:'Jules',5:'Mila',6:'Finn',7:'Lucas',8:'Mats',9:'Bram',10:'Emma',11:'Lotte'}});
  save(); render();
`;
const at = sec => `st.runStart = Date.now() - ${sec} * 1000; save();`;

try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });

  // 1. instellen
  await go(`${BASE}/index.html`);
  await evaluate(`localStorage.clear();`);
  await go(`${BASE}/index.html`);
  await evaluate(DEMO + `window.scrollTo(0, 0);`);
  await shot('01-instellen.png');

  // wedstrijd opbouwen: opstelling + 1e kwart + 2e kwart
  await evaluate(`
    document.querySelector('#s-go').click(); document.querySelector('#l-main').click();
    [1,4,5,6,7,8,10,11].forEach(n => document.querySelector('[data-n="' + n + '"]').click());
    document.querySelector('[data-gk="1"]').click(); document.querySelector('#lu-ok').click();
    const log = (sec, ev) => { ${at('sec')} logEvent({...ev, ...capture()}); };
    log(250, {type:'goal', team:'us', player:'#7 Lucas', assist:'#10 Emma'});
    log(330, {type:'corner', team:'us'});
    log(470, {type:'save', team:'us', player:'#1 Noah'});
    log(570, {type:'goal', team:'them', player:'#9'});
    log(640, {type:'yellow', team:'them', player:'#4'});
    ${at(900)} endPeriod(); document.querySelector('#lu-ok').click();
    mainAction();
    log(60, {type:'sub', team:'us', in:'#9 Bram', out:'#8 Mats'});
    log(200, {type:'goal', team:'us', player:'#10 Emma', assist:'#7 Lucas'});
    log(410, {type:'shot', team:'them', player:'#11'});
    log(470, {type:'pen_goal', team:'us', player:'#7 Lucas'});
    ${at(504)}
    document.getElementById('toast').classList.remove('on'); window.scrollTo(0, 0);
  `);
  await shot('02-wedstrijd.png');

  await evaluate(`window.scrollTo(0, document.querySelector('#l-field').getBoundingClientRect().top + scrollY - 12);`);
  await shot('03-veld-doelpunten.png');

  await evaluate(`window.scrollTo(0, 0); document.querySelector('[data-type=goal]').click();`);
  await shot('04-wie-scoorde.png');
  await evaluate(`closeSheet(); await new Promise(r => setTimeout(r, 300)); editLineup();`);
  await shot('05-opstelling.png');
  await evaluate(`closeSheet();`);

  // data voor de ouderview (zoals de coach ze zou doorsturen)
  const body = await evaluate(`return liveBody('demo');`);

  // verslag
  await evaluate(`${at(905)} finish(); document.getElementById('toast').classList.remove('on'); window.scrollTo(0, 0);`);
  await shot('06-verslag.png');
  await evaluate(`window.scrollTo(0, document.querySelector('#r-scorers').closest('.card').getBoundingClientRect().top + scrollY - 12);`);
  await shot('07-verslag-doelpunten.png');

  // ouderview (zonder Firebase: data rechtstreeks)
  await go(`${BASE}/index.html?volg=demo`);
  await evaluate(`
    LIVE.dbUrl = 'http://127.0.0.1:9'; try { watchES && watchES.close(); } catch {}
    applyRemote(${JSON.stringify(body)}, false); viewerCount = 9; document.querySelector('#w-upd').innerHTML = wUpdText();
    window.scrollTo(0, 0);
  `);
  await shot('08-ouderview.png');
  await evaluate(`playGoalFx(); await new Promise(r => setTimeout(r, 700));`);
  await sleep(0);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, '09-ouderview-goal.png'), Buffer.from(data, 'base64')); console.log('✔ 09-ouderview-goal.png');
  await evaluate(`await new Promise(r => setTimeout(r, 2600)); window.scrollTo(0, document.querySelector('#w-scorers').closest('.card').getBoundingClientRect().top + scrollY - 12);`);
  await shot('10-ouderview-verloop.png');

  // handleiding
  await go(`${BASE}/handleiding.html`);
  await shot('11-handleiding.png');
} catch (e) {
  console.error('Fout:', e.message); process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch {}
  browser.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
