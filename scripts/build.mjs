import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const outputDirectories = ['dist', 'docs'].map((name) => join(root, name));
const sourceFiles = ['index.html', 'styles.css', 'app.js'];
const publicFiles = ['questions.json', 'manus-routes.json', 'brandmark.svg'];

for (const output of outputDirectories) {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const file of sourceFiles) await cp(join(root, file), join(output, file));
  for (const file of publicFiles) await cp(join(root, 'public', file), join(output, file));
  await writeFile(join(output, '.nojekyll'), '');
}
console.log(`Static site built in ${outputDirectories.join(' and ')}`);
