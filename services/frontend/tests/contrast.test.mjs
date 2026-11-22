import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Read production tokens rather than maintaining a separate test palette.
const sheets = ['styles.css', 'enterprise.css', 'readability.css']
  .map((file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'));
function tokens(dark) {
  const result = {};
  for (const css of sheets) {
    const selectors = dark ? [':root', ':root[data-theme="dark"]'] : [':root'];
    for (const selector of selectors) {
      const start = css.indexOf(`${selector} {`);
      if (start < 0) continue;
      const block = css.slice(start, css.indexOf('}', start));
      for (const [, name, value] of block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})\s*;/gi)) result[name] = value;
    }
  }
  return result;
}
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map((v) => parseInt(v, 16) / 255)
    .map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function ratio(a, b) {
  const [low, high] = [luminance(a), luminance(b)].sort((a, b) => a - b);
  return (high + .05) / (low + .05);
}
for (const dark of [false, true]) {
  const t = tokens(dark);
  const check = (fg, bg, min) => {
    const value = ratio(t[fg], t[bg]);
    assert(value >= min, `${fg}/${bg}: ${value.toFixed(2)} < ${min}`);
  };
  test(`${dark ? 'dark' : 'light'}: primary, secondary and metadata in all row states`, () => {
    for (const bg of ['bg', 'surface', 'surface-2', 'record-hover']) {
      check('record-text', bg, 7);
      for (const fg of ['record-secondary', 'record-meta', 'record-link']) check(fg, bg, 4.5);
      for (const fg of ['record-high', 'record-mid', 'record-low']) check(fg, bg, dark ? 7 : 4.5);
      check('record-line', bg, 3);
    }
  });
  test(`${dark ? 'dark' : 'light'}: badges, buttons, selected and focus`, () => {
    for (const [fg, bg] of [['record-high', 'high-bg'], ['record-mid', 'mid-bg'], ['record-low', 'low-bg'], ['record-secondary', 'na-bg'], ['record-link', 'chip-brand-bg'], ['on-brand', 'brand-2'], ['on-brand', 'brand']]) check(fg, bg, 4.5);
    for (const bg of ['surface', 'surface-2', 'record-hover']) check('record-link', bg, 3);
  });
}
