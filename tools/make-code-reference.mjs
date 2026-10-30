#!/usr/bin/env node
/**
 * make-code-reference.mjs - generates and verifies the line-by-line code reference docs.
 *
 * Ensures that docs/CODE-{CORE,WEB,SERVER,PROJECT}.md always match the repository
 * source byte-for-byte. Runs in `npm test` as `npm run test:docs`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const GROUPS = [
  {
    id: 'core',
    doc: 'docs/CODE-CORE.md',
    title: 'The engine, file by file',
    blurb:
      'Every file in `packages/core` — the platform-agnostic optical fountain engine.\n' +
      'Covers ISO/IEC 18004 QR generation, Luby Transform fountain coding, XChaCha20-Poly1305\n' +
      'authenticated encryption, SHA-256/CRC integrity, and the sender/receiver state machines.',
    files: [
      'packages/core/src/index.ts',
      'packages/core/src/util/bits.ts',
      'packages/core/src/util/bytes.ts',
      'packages/core/src/util/base32.ts',
      'packages/core/src/util/rng.ts',
      'packages/core/src/util/utf8.ts',
      'packages/core/src/qr/tables.ts',
      'packages/core/src/qr/galois.ts',
      'packages/core/src/qr/reed-solomon.ts',
      'packages/core/src/qr/segments.ts',
      'packages/core/src/qr/matrix.ts',
      'packages/core/src/qr/encoder.ts',
      'packages/core/src/qr/render.ts',
      'packages/core/src/fountain/degree.ts',
      'packages/core/src/fountain/lt.ts',
      'packages/core/src/crypto/crc.ts',
      'packages/core/src/crypto/aead.ts',
      'packages/core/src/crypto/integrity.ts',
      'packages/core/src/protocol/frame.ts',
      'packages/core/src/protocol/manifest.ts',
      'packages/core/src/protocol/planner.ts',
      'packages/core/src/transfer/compress.ts',
      'packages/core/src/transfer/sender.ts',
      'packages/core/src/transfer/receiver.ts',
      'packages/core/test/qr-encoder.test.ts',
      'packages/core/test/fountain.test.ts',
      'packages/core/test/transfer-e2e.test.ts',
      'packages/core/test/utf8.test.ts',
    ],
  },
  {
    id: 'web',
    doc: 'docs/CODE-WEB.md',
    title: 'The React + Vite Progressive Web App, file by file',
    blurb:
      'Every file in `apps/web`: Vite and Vitest configs, PWA manifest and offline Service Worker,\n' +
      'browser services (Screen Wake Lock, IndexedDB inbox, dual BarcodeDetector/jsQR scanner,\n' +
      'telemetry client), GPU-upscaled QR canvas component, loopback workbench, all six screens, and tests.',
    files: [
      'apps/web/package.json',
      'apps/web/tsconfig.json',
      'apps/web/vite.config.ts',
      'apps/web/vitest.config.ts',
      'apps/web/index.html',
      'apps/web/public/manifest.webmanifest',
      'apps/web/public/icon.svg',
      'apps/web/public/sw.js',
      'apps/web/src/main.tsx',
      'apps/web/src/App.tsx',
      'apps/web/src/styles.css',
      'apps/web/src/state/settings.ts',
      'apps/web/src/services/display.ts',
      'apps/web/src/services/inbox.ts',
      'apps/web/src/services/scanner.ts',
      'apps/web/src/services/telemetry.ts',
      'apps/web/src/components/Layout.tsx',
      'apps/web/src/components/Panel.tsx',
      'apps/web/src/components/Controls.tsx',
      'apps/web/src/components/QrView.tsx',
      'apps/web/src/components/LoopbackBench.tsx',
      'apps/web/src/screens/HomeScreen.tsx',
      'apps/web/src/screens/SendScreen.tsx',
      'apps/web/src/screens/ReceiveScreen.tsx',
      'apps/web/src/screens/FilesScreen.tsx',
      'apps/web/src/screens/SettingsScreen.tsx',
      'apps/web/src/screens/AboutScreen.tsx',
      'apps/web/test/web-app.test.tsx',
      'apps/web/test/optical-transfer.test.ts',
    ],
  },
  {
    id: 'server',
    doc: 'docs/CODE-SERVER.md',
    title: 'The unified Node web server, file by file',
    blurb:
      'Every file in `apps/server`: the dependency-free HTTP server with SPA routing and\n' +
      'path-traversal protection, pure JSON API handlers, query-preserving short redirects,\n' +
      'atomic JSON session registry, esbuild bundler, and HTTP/API test suites.',
    files: [
      'apps/server/package.json',
      'apps/server/tsconfig.json',
      'apps/server/vitest.config.ts',
      'apps/server/src/server.ts',
      'apps/server/src/routes/api.ts',
      'apps/server/src/routes/redirects.ts',
      'apps/server/src/store/session-store.ts',
      'apps/server/scripts/build.mjs',
      'apps/server/test/redirects.test.ts',
      'apps/server/test/api.test.ts',
      'apps/server/test/server-spa.test.ts',
      'apps/server/test/core-link-check.ts',
    ],
  },
  {
    id: 'project',
    doc: 'docs/CODE-PROJECT.md',
    title: 'The workspace, generators, diagnostics and deployment, file by file',
    blurb:
      'Root monorepo configuration, TypeScript base config, QR table and PWA icon generators,\n' +
      'channel measurement experiments under `tools/diag`, and Docker/Caddy/systemd deployment files.',
    files: [
      'package.json',
      'tsconfig.base.json',
      '.gitignore',
      '.dockerignore',
      'LICENSE',
      'packages/core/package.json',
      'packages/core/tsconfig.json',
      'packages/core/tsconfig.build.json',
      'packages/core/vitest.config.ts',
      'tools/gen-qr-tables.mjs',
      'tools/make-icons.mjs',
      'tools/make-code-reference.mjs',
      'tools/diag/README.md',
      'tools/diag/degree-experiment.ts',
      'tools/diag/prefix-experiment.ts',
      'tools/diag/path-length.ts',
      'tools/diag/verify-roundtrip.ts',
      'tools/diag/debug-frame.ts',
      'tools/diag/profile-lt.ts',
      'tools/diag/lt-diag.ts',
      'tools/diag/diag.mjs',
      'deploy/Dockerfile',
      'deploy/docker-compose.yml',
      'deploy/Caddyfile',
      'deploy/lightbeam.service',
      'deploy/DEPLOY.md',
    ],
  },
];

const GUTTER = /^\s*\d+ │ /;
const PENDING = '<!-- WALKTHROUGH-PENDING -->';
const LISTING_MARKER = '**Every line**';

function groupFiles(group) {
  return group.files.map((f) => join(ROOT, f));
}

function read(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function languageOf(path) {
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'ts';
  if (path.endsWith('.mjs') || path.endsWith('.js')) return 'js';
  if (path.endsWith('.json') || path.endsWith('.webmanifest')) return 'json';
  if (path.endsWith('.html') || path.endsWith('.svg')) return 'html';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.yml')) return 'yaml';
  if (path.endsWith('Dockerfile') || path.includes('Dockerfile')) return 'dockerfile';
  return 'text';
}

function rel(path) {
  return relative(ROOT, path).split(sep).join('/');
}

function sectionHeading(path) {
  return `## \`${path}\``;
}

function renderListing(path) {
  const text = read(join(ROOT, path));
  const lines = text.length === 0 ? [] : text.replace(/\n$/, '').split('\n');
  const width = String(lines.length).length;
  const body = lines.map((line, i) => `${String(i + 1).padStart(width, ' ')} │ ${line}`).join('\n');
  return { body, count: lines.length, lang: languageOf(path) };
}

function carryOverProse(docPath) {
  const text = existsSync(docPath) ? read(docPath) : '';
  const carried = new Map();
  const lines = text.split('\n');
  let path = null;
  let buffer = [];
  let depth = 0;
  for (const line of lines) {
    const heading = /^## `([^`]+)`\s*$/.exec(line);
    if (heading) {
      if (path) carried.set(path, buffer.join('\n').trim());
      path = heading[1];
      buffer = [];
      depth = 0;
      continue;
    }
    if (!path) continue;
    if (line.startsWith('```')) {
      depth = depth === 0 ? 1 : 0;
      continue;
    }
    if (depth === 1) continue;
    if (/^> \d+ lines?$/.test(line) || line === '**Every line**' || line === '---') continue;
    buffer.push(line);
  }
  if (path) carried.set(path, buffer.join('\n').trim());
  for (const [k, v] of carried) {
    if (v.length === 0 || v.includes(PENDING)) carried.delete(k);
  }
  return carried;
}

function skeleton(group) {
  const carried = carryOverProse(join(ROOT, group.doc));
  const out = [];
  out.push(`# ${group.title}`);
  out.push('');
  out.push(group.blurb);
  out.push('');
  out.push(
    '> **This document is generated and verified.** The code listings below are copied\n' +
      '> from the repository by `tools/make-code-reference.mjs`; the prose around them is\n' +
      '> written by hand. `npm run test:docs` fails if a single line of any listing stops\n' +
      '> matching the file it claims to show, or if a file is missing, extra, or in the\n' +
      '> wrong order. A walkthrough therefore cannot quietly go stale.',
  );
  out.push('');
  out.push('---');
  out.push('');
  for (const file of group.files) {
    const { body, count, lang } = renderListing(file);
    out.push(sectionHeading(file));
    out.push('');
    out.push(`> ${count} line${count === 1 ? '' : 's'}`);
    out.push('');
    const prose = carried.get(file);
    out.push(prose && prose.length > 0 ? prose : PENDING);
    out.push('');
    out.push(LISTING_MARKER);
    out.push('');
    out.push('```' + lang);
    out.push(body);
    out.push('```');
    out.push('');
    out.push('---');
    out.push('');
  }
  return out.join('\n').replace(/\n+$/, '\n');
}

function parseSections(docText) {
  const lines = docText.split('\n');
  const sections = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^## `([^`]+)`\s*$/.exec(lines[i]);
    if (m) {
      if (current) {
        current.end = i;
        sections.push(current);
      }
      current = { path: m[1], start: i, lines: [] };
    } else if (current) {
      current.lines.push({ text: lines[i], no: i + 1 });
    }
  }
  if (current) {
    current.end = lines.length;
    sections.push(current);
  }
  return sections;
}

function firstFence(section) {
  const lines = section.lines.map((l) => l.text);
  const marker = lines.findIndex((l) => l === LISTING_MARKER);
  const from = marker === -1 ? 0 : marker + 1;
  const start = lines.findIndex((l, i) => i >= from && l.startsWith('```'));
  if (start === -1) return null;
  const lang = lines[start].slice(3).trim();
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '```') {
      end = i;
      break;
    }
  }
  if (end === -1) return null;
  return {
    lang,
    code: lines.slice(start + 1, end),
    declared: lines.find((l) => /^> \d+ lines?\s*$/.test(l)) ?? null,
  };
}

function verifyGroup(group, { quiet } = {}) {
  const docPath = join(ROOT, group.doc);
  const problems = [];
  const pending = [];
  const say = (msg) => {
    if (!quiet) console.log(msg);
  };

  if (!existsSync(docPath)) {
    return {
      problems: [`${group.doc} does not exist — run: node tools/make-code-reference.mjs --init ${group.id}`],
      pending,
    };
  }

  const doc = read(docPath);
  const sections = parseSections(doc);

  const found = sections.map((s) => s.path);
  const expected = group.files;
  if (found.length !== expected.length) {
    problems.push(`${group.doc}: found ${found.length} file sections, expected ${expected.length}`);
  }
  const limit = Math.max(found.length, expected.length);
  for (let i = 0; i < limit; i++) {
    if (found[i] !== expected[i]) {
      problems.push(
        `${group.doc}: section ${i + 1} is \`${found[i] ?? '(missing)'}\`, expected \`${expected[i] ?? '(nothing)'}\``,
      );
    }
  }

  for (const section of sections) {
    const abs = join(ROOT, section.path);
    if (!existsSync(abs)) {
      problems.push(`${group.doc}: \`${section.path}\` is listed but does not exist`);
      continue;
    }

    const fence = firstFence(section);
    if (!fence) {
      problems.push(`${group.doc}: \`${section.path}\` has no code fence`);
      continue;
    }

    const actualText = read(abs);
    const actual = actualText.length === 0 ? [] : actualText.replace(/\n$/, '').split('\n');

    const declared = Number(/^> (\d+) lines?/.exec(fence.declared ?? '')?.[1] ?? NaN);
    if (declared !== actual.length) {
      problems.push(
        `${group.doc}: \`${section.path}\` claims ${Number.isNaN(declared) ? 'no' : declared} lines, file has ${actual.length}`,
      );
    }

    if (fence.lang !== languageOf(section.path)) {
      problems.push(
        `${group.doc}: \`${section.path}\` fence language is \`${fence.lang}\`, expected \`${languageOf(section.path)}\``,
      );
    }

    if (fence.code.length !== actual.length) {
      problems.push(
        `${group.doc}: \`${section.path}\` lists ${fence.code.length} lines, file has ${actual.length}`,
      );
      continue;
    }

    for (let i = 0; i < fence.code.length; i++) {
      const listed = fence.code[i];
      if (!GUTTER.test(listed)) {
        problems.push(
          `${group.doc}: \`${section.path}\` line ${i + 1} has no line-number gutter: ${JSON.stringify(listed.slice(0, 60))}`,
        );
        break;
      }
      const stripped = listed.replace(GUTTER, '');
      if (stripped !== actual[i]) {
        problems.push(
          `${group.doc}: \`${section.path}\` line ${i + 1} differs from the file\n` +
            `      document: ${JSON.stringify(stripped)}\n` +
            `      file:     ${JSON.stringify(actual[i])}`,
        );
        break;
      }
    }

    const markerAt = section.lines.findIndex((l) => l.text === LISTING_MARKER);
    const proseLines = (markerAt === -1 ? section.lines : section.lines.slice(0, markerAt)).map(
      (l) => l.text,
    );
    if (proseLines.some((line) => line.trim() === PENDING)) {
      pending.push(section.path);
    }
  }

  if (problems.length === 0) {
    const done = sections.length - pending.length;
    say(
      `  ${pending.length === 0 ? '✓' : '·'} ${group.doc} — ${done}/${group.files.length} files in sync` +
        (pending.length === 0 ? '' : ` (${pending.length} awaiting a walkthrough)`),
    );
  }
  return { problems, pending };
}

function syncGroup(group) {
  const docPath = join(ROOT, group.doc);
  if (!existsSync(docPath)) {
    throw new Error(
      `${group.doc} does not exist — run: node tools/make-code-reference.mjs --init ${group.id}`,
    );
  }

  const lines = read(docPath).split('\n');
  const out = [];
  const problems = [];
  let section = null;
  let inCode = false;

  const startSection = (path) => {
    let rendered;
    try {
      rendered = renderListing(path);
    } catch (error) {
      problems.push(`${path}: cannot read source (${error.message})`);
      rendered = null;
    }
    section = { path, sawListing: false, atListing: false, rendered };
  };

  for (const line of lines) {
    const heading = /^## `([^`]+)`\s*$/.exec(line);
    if (heading) {
      if (section && !section.sawListing) problems.push(`${section.path}: no listing found`);
      startSection(heading[1]);
      out.push(line);
      continue;
    }

    if (!section) {
      out.push(line);
      continue;
    }

    if (inCode) {
      if (line === '```') {
        inCode = false;
        out.push(line);
      }
      continue;
    }

    if (line === LISTING_MARKER) {
      section.atListing = true;
      out.push(line);
      continue;
    }

    if (line.startsWith('```') && section.atListing && !section.sawListing) {
      const wantLang = languageOf(section.path);
      if (section.rendered) {
        out.push('```' + wantLang);
        out.push(section.rendered.body);
      } else {
        out.push(line);
      }
      section.sawListing = true;
      inCode = true;
      continue;
    }

    if (section.rendered && /^> \d+ lines?$/.test(line)) {
      const n = section.rendered.count;
      out.push(`> ${n} line${n === 1 ? '' : 's'}`);
      continue;
    }

    out.push(line);
  }

  if (section && !section.sawListing) problems.push(`${section.path}: no listing found`);

  writeFileSync(docPath, out.join('\n'));
  return { doc: group.doc, problems };
}

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const value = (flag) => {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1];
};

if (has('--list')) {
  for (const g of GROUPS) {
    console.log(`${g.id.padEnd(9)} ${g.doc.padEnd(24)} ${g.files.length} files`);
  }
  process.exit(0);
}

if (has('--sync')) {
  const id = value('--sync');
  const group = GROUPS.find((g) => g.id === id);
  if (!group) {
    console.error(`unknown group "${id}". Try --list.`);
    process.exit(2);
  }
  const result = syncGroup(group);
  console.log(`re-copied ${group.files.length} listings into ${result.doc}`);
  for (const p of result.problems) console.error(`  ! ${p}`);
  process.exit(0);
}

if (has('--init')) {
  const id = value('--init');
  const group = GROUPS.find((g) => g.id === id);
  if (!group) {
    console.error(`unknown group "${id}". Try --list.`);
    process.exit(2);
  }
  const docPath = join(ROOT, group.doc);
  if (existsSync(docPath) && !has('--force')) {
    const existing = verifyGroup(group, { quiet: true });
    if (existing.problems.length === 0) {
      console.log(`${group.doc} already exists and verifies. Refusing to overwrite (use --force).`);
      process.exit(0);
    }
  }
  for (const file of groupFiles(group)) {
    if (!existsSync(file)) {
      console.error(`warning: ${rel(file)} does not exist and will be listed as empty`);
    }
  }
  mkdirSync(dirname(docPath), { recursive: true });
  writeFileSync(docPath, skeleton(group));
  console.log(`wrote ${group.doc} — ${group.files.length} files`);
  process.exit(0);
}

const wanted = value('--group');
const groups = wanted ? GROUPS.filter((g) => g.id === wanted) : GROUPS;
if (groups.length === 0) {
  console.error(`unknown group "${wanted}". Try --list.`);
  process.exit(2);
}

console.log('code reference: verifying listings against source');
const all = [];
const pending = [];
for (const g of groups) {
  const result = verifyGroup(g);
  all.push(...result.problems);
  pending.push(...result.pending);
}

if (all.length > 0) {
  console.error('');
  for (const p of all) console.error(`  ✗ ${p}`);
  console.error(`\n${all.length} problem${all.length === 1 ? '' : 's'}.`);
  process.exit(1);
}

const total = groups.reduce((n, g) => n + g.files.length, 0);

if (pending.length > 0) {
  if (has('--strict')) {
    console.error('');
    for (const path of pending) console.error(`  ✗ ${path} still has a pending walkthrough`);
    process.exit(1);
  }
  console.log(`\nlistings verified for all ${total} files in ${groups.length} documents.`);
  console.log(
    `coverage: ${total - pending.length}/${total} files have a written walkthrough (${pending.length} pending).`,
  );
  process.exit(0);
}

console.log(`\nall ${total} files verified in ${groups.length} document${groups.length === 1 ? '' : 's'}`);
console.log('coverage: every file has a written walkthrough.');
