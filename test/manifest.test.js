// -----------------------------------------------------------------------------
// Consistency checks between gladys-assistant-integration.json and the code.
// The store indexer validates the manifest, but nothing there can know which
// handlers the code registers: these tests keep both sides in sync, and catch
// the store rules that are easiest to miss.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, PRICE_INTERVALS } from '../src/config.js';
import { SCENE_ACTIONS, SCENE_TRIGGERS } from '../src/capabilities/scenes.js';
import { WIDGETS } from '../src/capabilities/widgets.js';
import { LANGUAGES } from '../src/i18n.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');

test('version, image tag and package.json agree (the Release workflow bumps all three)', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-zonneplan:${pkg.version}`);
});

// The minimum of the gladys_version range, as numbers (never a regex over digits).
function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('the capability fields require Gladys 5.1.0 or later', () => {
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]), manifest.gladys_version);
});

test('keywords and countries require Gladys 5.3.0 or later', () => {
  // An older core rejects the whole manifest over a field it does not know.
  assert.ok('keywords' in manifest || 'countries' in manifest);
  assert.ok(isAtLeast(minGladysVersion(), [5, 3, 0]), manifest.gladys_version);
});

test('keywords: 1 to 10 unique search terms of 2 to 30 characters', () => {
  const { keywords } = manifest;
  assert.ok(Array.isArray(keywords) && keywords.length >= 1 && keywords.length <= 10);
  for (const keyword of keywords) {
    assert.equal(typeof keyword, 'string');
    const length = keyword.trim().length;
    assert.ok(length >= 2 && length <= 30, `keyword "${keyword}": ${length} characters`);
  }
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, normalized.length, 'keywords must be unique');
});

test('countries: Zonneplan only supplies the Netherlands', () => {
  assert.deepEqual(manifest.countries, ['NL']);
  for (const country of manifest.countries) {
    assert.match(country, /^[A-Z]{2}$/);
  }
});

test('Zonneplan is a cloud service: the transport is cloud only', () => {
  // A single channel: no "prefer local" toggle in the Configuration screen.
  assert.deepEqual(manifest.transports, ['cloud']);
});

test('the catalog shelves are known keys', () => {
  const known = [
    'climate',
    'lighting',
    'energy',
    'security',
    'multimedia',
    'appliances',
    'environment',
    'protocols',
    'network',
    'notifications',
    'assistants',
    'services',
    'transport',
    'vehicles',
    'servers',
    'leisure',
  ];
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const category of manifest.categories) {
    assert.ok(known.includes(category), category);
  }
});

test('the description fits what the store allows, in every language', () => {
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const language of LANGUAGES) {
    const text = manifest.description[language];
    assert.ok(text, `description.${language} is missing`);
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${language} must be 10-100 characters, got ${text.length}`,
    );
  }
});

// Every user-facing text of the manifest: label, description, placeholder.
function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) yield* texts(item, `${path}[${index}]`);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (['label', 'description', 'placeholder'].includes(key)) {
      yield [`${path}.${key}`, value];
    } else {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('every text is a multi-language object in English, French, German and Spanish', () => {
  let count = 0;
  for (const [path, value] of texts(manifest)) {
    count += 1;
    assert.equal(typeof value, 'object', `${path} must be a multi-language object`);
    for (const language of LANGUAGES) {
      assert.ok(
        typeof value[language] === 'string' && value[language].length > 0,
        `${path}.${language} is missing`,
      );
    }
  }
  assert.ok(count > 50, `the walk found the texts (${count})`);
});

const FIELD_TYPES = ['string', 'number', 'boolean', 'select', 'multi_select', 'secret', 'section'];

test('every field uses a type the store accepts, with a snake_case key', () => {
  const fields = [
    ...manifest.config_schema,
    ...manifest.actions.flatMap((a) => a.fields ?? []),
    ...manifest.scene_triggers.flatMap((t) => t.fields ?? []),
    ...manifest.scene_actions.flatMap((a) => a.fields ?? []),
  ];
  for (const field of fields) {
    assert.ok(FIELD_TYPES.includes(field.type), `${field.key}: ${field.type}`);
    assert.match(field.key, /^[a-z0-9_]+$/);
    if (field.placeholder !== undefined) {
      assert.ok(['string', 'number', 'secret'].includes(field.type), `${field.key}: placeholder`);
    }
    if (field.min !== undefined || field.max !== undefined) {
      assert.equal(field.type, 'number', `${field.key}: min/max are number-only`);
    }
    if (field.source !== undefined) {
      assert.equal(field.options, undefined, `${field.key}: source and options together`);
    }
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, field.key);
    }
  }
  const interval = manifest.config_schema.find((f) => f.key === 'price_interval');
  assert.deepEqual(
    interval.options.map((o) => o.value),
    Object.values(PRICE_INTERVALS),
  );
});

test('the tokens are never configuration: no token or password field', () => {
  for (const field of manifest.config_schema) {
    assert.doesNotMatch(field.key, /token|password|secret/);
  }
});

test('every manifest action is registered in index.js', () => {
  for (const action of manifest.actions) {
    assert.match(indexSource, new RegExp(`onAction\\('${action.key}'`), action.key);
  }
});

test('the scene actions of the manifest and of the code are the same', () => {
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.keys(SCENE_ACTIONS).sort(),
  );
});

test('the scene triggers of the manifest and of the code are the same', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
});

test('the widgets of the manifest and of the code are the same (5 at most)', () => {
  assert.ok(manifest.widgets.length <= 5);
  assert.deepEqual(manifest.widgets.map((w) => w.key).sort(), Object.keys(WIDGETS).sort());
});

test('timeouts stay in the 5-120 s the core accepts', () => {
  for (const entry of [...manifest.actions, ...manifest.scene_actions]) {
    if (entry.timeout_seconds !== undefined) {
      assert.ok(entry.timeout_seconds >= 5 && entry.timeout_seconds <= 120, entry.key);
    }
  }
});

test('the cover and the documentation link point to this repository', () => {
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/prohand/gladys-zonneplan/main/cover.png',
  );
  const links = manifest.config_schema[0].links.map((l) => l.url);
  assert.ok(links.every((url) => url.startsWith('https://')));
});

test('the user documentation exists in every language, with the same sections', async () => {
  const headings = {};
  for (const language of LANGUAGES) {
    const text = await readFile(new URL(`../docs/${language}.md`, import.meta.url), 'utf8');
    headings[language] = text.split('\n').filter((line) => /^#{1,3} /.test(line)).length;
  }
  for (const language of LANGUAGES) {
    assert.equal(headings[language], headings.en, `docs/${language}.md sections`);
  }
});
