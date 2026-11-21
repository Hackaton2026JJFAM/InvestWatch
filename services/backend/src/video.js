// Wideo/reels: rozpoznanie adresów platform (lustro listy w scraperze) i długie wywołania scrapera.
// fetch() w Node ma 5-minutowy limit na nagłówki odpowiedzi – transkrypcja dłuższego filmu
// trwa dłużej, więc wywołania wideo idą przez node:http z własnym limitem czasu.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const VIDEO_HOSTS = [
  ['tiktok.com', /\/video\/|\/photo\/|^\/t\/|^\/v\/|^\/embed\//], ['vm.tiktok.com', null], ['vt.tiktok.com', null],
  ['youtube.com', /^\/(watch|shorts\/|live\/|embed\/|v\/)/], ['youtu.be', null], ['youtube-nocookie.com', /^\/embed\//],
  ['instagram.com', /^\/(reels?|p|tv)\/|\/reels?\//],
  ['facebook.com', /\/videos?\/|\/reels?\/|^\/watch|^\/share\/[vr]\/|\/posts\//], ['fb.watch', null],
  ['x.com', /\/status\/\d+/], ['twitter.com', /\/status\/\d+/],
  ['threads.net', /\/post\//], ['threads.com', /\/post\//],
  ['linkedin.com', /^\/(posts|feed\/update|events)\//],
  ['vimeo.com', /^\/(\d+|video\/|channels\/|groups\/|showcase\/)/], ['player.vimeo.com', null],
  ['twitch.tv', /\/clip\/|^\/videos\//], ['clips.twitch.tv', null],
  ['reddit.com', /\/comments\//], ['v.redd.it', null],
  ['dailymotion.com', /^\/video\//], ['dai.ly', null],
  ['rumble.com', /^\/v|^\/embed\//], ['kick.com', /\/(clips|videos)\//],
  ['vk.com', /video/], ['vkvideo.ru', null], ['pinterest.com', /^\/pin\//], ['pin.it', null],
  ['bilibili.com', /^\/video\//], ['streamable.com', null], ['t.me', /^\/[^/]+\/\d+/],
].sort((a, b) => b[0].length - a[0].length); // najpierw subdomeny (vm.tiktok.com przed tiktok.com)
const VIDEO_EXT = /\.(mp4|m4v|webm|mov|mkv|avi|mpeg|mpg|3gp)$/i;

export function isVideoUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  for (const [h, re] of VIDEO_HOSTS) {
    if (host === h || host.endsWith(`.${h}`)) return re ? re.test(u.pathname || '/') : true;
  }
  return VIDEO_EXT.test(u.pathname);
}

export const VIDEO_MAX_BYTES = Number(process.env.VIDEO_MAX_MB ?? 250) * 1024 * 1024;
export const VIDEO_TIMEOUT_MS = Number(process.env.VIDEO_TIMEOUT_MS ?? 20 * 60 * 1000);
const UPLOAD_DIR = path.join(os.tmpdir(), 'investwatch-video');

/** Zapis przesłanego pliku wideo do katalogu tymczasowego (do czasu przetworzenia zadania). */
export async function saveUpload(buf) {
  await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
  const file = path.join(UPLOAD_DIR, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.bin`);
  await fs.promises.writeFile(file, buf);
  return file;
}

export function isUploadPath(file) {
  return typeof file === 'string' && path.resolve(file).startsWith(UPLOAD_DIR + path.sep);
}

export async function removeUpload(file) {
  if (isUploadPath(file)) await fs.promises.rm(file, { force: true });
}

/** POST z długim limitem czasu; body = obiekt JSON albo ścieżka pliku (strumień octet-stream). */
export function longPost(base, pathAndQuery, { json, file, timeoutMs = VIDEO_TIMEOUT_MS }) {
  const url = new URL(pathAndQuery, base);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const headers = json ? { 'content-type': 'application/json' } : { 'content-type': 'application/octet-stream' };
    if (file) headers['content-length'] = fs.statSync(file).size;
    const req = lib.request(url, { method: 'POST', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let data = {};
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* pusta/nie-JSON */ }
        resolve({ status: res.statusCode, data });
      });
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('timeout'), { name: 'AbortError' })));
    req.on('error', reject);
    if (json) req.end(JSON.stringify(json));
    else fs.createReadStream(file).on('error', reject).pipe(req);
  });
}
