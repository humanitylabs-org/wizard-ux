// What a shell page loads, read the way the browser reads the page (wizard-ux issue 1674: parse the page, do not grep
// its text): web/<page> parsed into the tiny DOM; scripts and stylesheets in document order, as paths relative to web/
// (query strings dropped), with each script's type / async / defer.
import { readFileSync } from 'node:fs';
import { createDocument } from './mini-dom.mjs';

const WEB = new URL('../../web/', import.meta.url);

export function parsePage(page) {
  const doc = createDocument({ url: new URL(page, WEB).href });
  doc.documentElement.innerHTML = readFileSync(new URL(page, WEB), 'utf8').replace(/^\s*<!doctype[^>]*>/i, '').replace(/<\/?html[^>]*>/gi, '');
  return doc;
}

export function pageAssets(page) {
  const doc = parsePage(page), base = new URL(page, WEB);
  const rel = u => { const x = new URL(u, base); return x.href.startsWith(WEB.href) ? x.pathname.slice(WEB.pathname.length) : x.href.split('?')[0]; };
  const scripts = doc.querySelectorAll('script[src]').map(s => ({ src: rel(s.getAttribute('src')), type: s.getAttribute('type') || '', async: s.hasAttribute('async'), defer: s.hasAttribute('defer') }));
  const styles = doc.querySelectorAll('link[rel="stylesheet"]').map(l => rel(l.getAttribute('href')));
  const modules = doc.querySelectorAll('link[rel="modulepreload"]').map(l => rel(l.getAttribute('href')));
  return { doc, scripts, styles, modules, srcs: scripts.map(s => s.src), all: [...scripts.map(s => s.src), ...styles] };
}
