const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function dependency(name) {
  try { return require(name); } catch (error) {
    const roots = (process.env.ARTISTIC_QR_NODE_MODULES || '').split(path.delimiter).filter(Boolean);
    for (const root of roots) { try { return require(path.join(root, name)); } catch {} }
    throw new Error(`Missing ${name}; run npm install in the Skill folder or set ARTISTIC_QR_NODE_MODULES.`, { cause: error });
  }
}
function args(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      result[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else result._.push(argv[i]);
  }
  return result;
}
function xml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])); }
function bounds(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw Error(`Invalid ${label}`);
  return value;
}
function safeSvg(text) {
  if (/<(?:script|foreignObject)\b|\bon[a-z]+\s*=|<!DOCTYPE|<!ENTITY/i.test(text)) throw Error('Active SVG content is unsupported');
  for (const match of text.matchAll(/(?:href|xlink:href)\s*=\s*["']([^"']*)["']/g)) {
    if (!match[1].startsWith('#') && !match[1].startsWith('data:image/')) throw Error('SVG must be self-contained; external resources are unsupported');
  }
  for (const match of text.matchAll(/url\(\s*["']?([^)'"\s]+)/g)) if (!match[1].startsWith('#')) throw Error('External SVG URL is unsupported');
  return text;
}
function bodyOfSvg(text) {
  safeSvg(text);
  const match = text.match(/<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/i);
  if (!match) throw Error('Unsupported SVG root');
  return match[1];
}
module.exports = { sha, dependency, args, xml, bounds, safeSvg, bodyOfSvg };
