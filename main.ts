// Entry packaging program for the GTA 6 trophy guide.
//
// Running this file assembles the deliverable in the output directory:
// the guide itself (everything under app/), the screenshots that show it,
// and a dossier.json summary produced by the vendored make.fun library.
// It relies only on the Node 22 standard library and produces the same
// bytes on every run — entries are visited in sorted order and nothing
// here reads the clock.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-frontend.ts';

const repoDir = dirname(fileURLToPath(import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Copy a directory tree, visiting names in code-unit order so the walk
// is stable from one machine and one run to the next.
function copyTree(sourceDir: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true });
  const names = readdirSync(sourceDir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const name of names) {
    const from = join(sourceDir, name);
    const to = join(targetDir, name);
    if (statSync(from).isDirectory()) {
      copyTree(from, to);
    } else {
      copyFileSync(from, to);
    }
  }
}

mkdirSync(outputDir, { recursive: true });

copyTree(join(repoDir, 'app'), join(outputDir, 'app'));

const shotsSource = join(repoDir, 'screenshots');
if (existsSync(shotsSource)) {
  copyTree(shotsSource, join(outputDir, 'screenshots'));
} else {
  mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
}

const dossierBytes = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 50331648,
});
writeFileSync(join(outputDir, 'dossier.json'), dossierBytes);
