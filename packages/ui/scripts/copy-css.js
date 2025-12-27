import { copyFileSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const srcDir = resolve(__dirname, '../src/styles');
const destDir = resolve(__dirname, '../dist/styles');

mkdirSync(destDir, { recursive: true });

for (const file of readdirSync(srcDir)) {
  if (file.endsWith('.css')) {
    copyFileSync(join(srcDir, file), join(destDir, file));
    console.log(`Copied ${file} -> dist/styles/${file}`);
  }
}


