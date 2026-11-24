// IJOS entry point: node server.js [--open]
// Env: IJOS_DATA (data folder, default ./data), IJOS_PORT (default 4321). The older STUDY_OS_* names still work.
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`IJOS needs Node.js 22.13 or newer (found ${process.version}). Install the LTS version from https://nodejs.org`);
  process.exit(1);
}
const { createApp } = await import('./server/app.js');

const port = Number(process.env.IJOS_PORT || process.env.STUDY_OS_PORT) || 4321;
const dataDir = path.resolve(process.env.IJOS_DATA || process.env.STUDY_OS_DATA || path.join(import.meta.dirname, 'data'));
const url = `http://127.0.0.1:${port}/`;
const openBrowser = () => process.argv.includes('--open') && spawn(process.platform === 'win32' ? 'explorer.exe' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
const portBusy = () => {
  console.error(`\nPort ${port} is used by another program (not IJOS).`);
  console.error(`הפורט ${port} תפוס על ידי תוכנה אחרת. סגרו אותה, או הפעילו על פורט אחר, למשל:`);
  console.error(process.platform === 'win32' ? `  set IJOS_PORT=4322 && start-ijos.cmd` : `  IJOS_PORT=4322 npm start`);
  process.exit(2);
};

// Something already on the port? If it is IJOS, just open the browser; otherwise explain.
http.get(url + 'api/health', { timeout: 1500 }, res => {
  let body = '';
  res.on('data', c => { body += c; });
  res.on('end', () => {
    let app; try { app = JSON.parse(body).app; } catch { /* not JSON */ }
    if (app !== 'ijos') return portBusy();
    console.log('IJOS כבר פועל: ' + url);
    openBrowser();
  });
}).on('error', () => {
  let server;
  try { ({ server } = createApp({ dataDir, port })); }
  catch (e) { console.error('IJOS could not open its data folder:', dataDir, '\n', e.message); process.exit(1); }
  server.on('error', e => { if (e.code === 'EADDRINUSE') portBusy(); console.error(e.message); process.exit(1); });
  server.listen(port, '127.0.0.1', () => {
    console.log(`IJOS · כל התואר. מקום אחד.`);
    console.log(`פועל בכתובת ${url}`);
    console.log(`תיקיית הנתונים: ${dataDir}`);
    console.log('אפשר למזער את החלון. סגירת החלון (או Ctrl+C) עוצרת את האפליקציה. הנתונים שמורים.');
    openBrowser();
  });
});
