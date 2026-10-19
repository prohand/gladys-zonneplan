// -----------------------------------------------------------------------------
// Persistence of the Zonneplan tokens.
//
// The container rootfs is read-only: /data is the one writable volume, and it
// survives updates and restarts of the integration. The tokens are written
// there with owner-only permissions (0600) and never logged.
//
// ZONNEPLAN_DATA_DIR overrides the directory, for a local run or the tests.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rm, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

const TOKEN_FILE = 'zonneplan-tokens.json';

export function dataDirectory() {
  return process.env.ZONNEPLAN_DATA_DIR || '/data';
}

/**
 * A token store backed by one JSON file.
 * @param {string} directory where the file lives (default: /data)
 */
export function createFileTokenStore(directory = dataDirectory()) {
  const file = join(directory, TOKEN_FILE);
  return {
    async load() {
      try {
        const tokens = JSON.parse(await readFile(file, 'utf8'));
        return tokens && typeof tokens.access_token === 'string' ? tokens : null;
      } catch (err) {
        if (err.code === 'ENOENT') {
          return null;
        }
        // A corrupted file is a lost session, not a crash loop.
        if (err instanceof SyntaxError) {
          return null;
        }
        throw err;
      }
    },
    async save(tokens) {
      await mkdir(directory, { recursive: true });
      // Write then rename: a crash in the middle never leaves half a file.
      const temporary = `${file}.tmp`;
      await writeFile(temporary, JSON.stringify(tokens), { mode: 0o600 });
      await rename(temporary, file);
    },
    async clear() {
      await rm(file, { force: true });
    },
  };
}

/** An in-memory token store, for the tests. */
export function createMemoryTokenStore(initial = null) {
  let tokens = initial;
  return {
    async load() {
      return tokens;
    },
    async save(next) {
      tokens = next;
    },
    async clear() {
      tokens = null;
    },
  };
}
