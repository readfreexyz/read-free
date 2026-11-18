#!/usr/bin/env node
// Switches Read Free's look to one of extension/themes/<name>/:
//   node tools/theme.mjs solidarity     (or classic)
// A theme is:
//   theme.css        colors and decoration for the extension's own pages -> ui/theme.css
//   page.css         colors for its elements on news pages -> content.css, between the theme
//                    markers, with each url(*.svg) made into a data: URL (news pages can't load
//                    the extension's files)
//   icon.svg, icon-16.svg, icon-off.svg, icon-16-off.svg
//                    the toolbar and extension icons -> icons/, plus the PNGs Chrome needs
//                    (rsvg-convert: brew install librsvg)
// It prints which theme is active with no name given.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const EXT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../extension');
const START = '/* theme:start';
const END = '/* theme:end */';
const name = process.argv[2];

const contentCss = path.join(EXT, 'content.css');
const active = () => /theme "([a-z-]+)"/i.exec(fs.readFileSync(path.join(EXT, 'ui/theme.css'), 'utf8'))?.[1];
if (!name) {
  console.log(`active theme: ${active()}; themes: ${fs.readdirSync(path.join(EXT, 'themes')).join(', ')}`);
  process.exit(0);
}
const dir = path.join(EXT, 'themes', name);
const need = ['theme.css', 'page.css', 'icon.svg', 'icon-16.svg', 'icon-off.svg', 'icon-16-off.svg'];
const missing = need.filter(f => !fs.existsSync(path.join(dir, f)));
if (missing.length) {
  console.error(`themes/${name} is missing ${missing.join(', ')}`);
  process.exit(1);
}

// The SVG as a data: URL: comments and line breaks dropped, the rest percent-encoded.
const dataUrl = file => {
  const svg = fs.readFileSync(path.join(dir, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\s*\n\s*/g, ' ').trim();
  return `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}")`;
};

// 1. The extension's own pages
fs.copyFileSync(path.join(dir, 'theme.css'), path.join(EXT, 'ui/theme.css'));

// 2. News pages
const page = fs.readFileSync(path.join(dir, 'page.css'), 'utf8').replace(/url\(([\w.-]+\.svg)\)/g, (_, file) => dataUrl(file));
const css = fs.readFileSync(contentCss, 'utf8');
const from = css.indexOf(START);
const to = css.indexOf(END);
if (from < 0 || to < from) {
  console.error(`content.css has no theme markers (${START} … ${END})`);
  process.exit(1);
}
const marker = `${START} (tools/theme.mjs writes this block from themes/${name}/page.css) */\n`;
fs.writeFileSync(contentCss, css.slice(0, from) + marker + page.trim() + '\n' + css.slice(to));

// 3. Icons
const icons = path.join(EXT, 'icons');
fs.mkdirSync(icons, { recursive: true });
for (const f of ['icon.svg', 'icon-16.svg']) fs.copyFileSync(path.join(dir, f), path.join(icons, f));
const png = (svg, size, out) => execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), path.join(dir, svg), '-o', path.join(icons, out)]);
png('icon-16.svg', 16, 'icon-16.png');
for (const size of [32, 48, 128]) png('icon.svg', size, `icon-${size}.png`);
png('icon-16-off.svg', 16, 'off-16.png');
png('icon-off.svg', 32, 'off-32.png');

console.log(`theme: ${name} (ui/theme.css, content.css, icons/)`);
