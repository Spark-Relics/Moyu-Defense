import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

export async function balanceFingerprint(root) {
  const files = [];
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await collect(path);
      else if (entry.name.endsWith('.js')) files.push(path);
    }
  }
  await collect(join(root, 'src'));
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    hash.update(relative(root, file).replaceAll('\\', '/'));
    hash.update((await readFile(file, 'utf8')).replaceAll('\r\n', '\n'));
  }
  return hash.digest('hex');
}
