#!/usr/bin/env node
/**
 * SPEC Compliance Check Script
 *
 * Validates that the runtime (API + UIs) stays aligned with SPEC.md and the shared enums.
 *
 * Key behavior:
 * - Scans ONLY runtime/UI source roots (src/) for deprecated tier strings that must not be used for
 *   new assignments (e.g. legacy "VIP"/"DELUXE").
 * - Explicitly allows legacy strings to exist in canonical DB documentation and historical artifacts:
 *   - docs/database/**
 *   - services/api/migrations/**
 *   - db/** (schema snapshots)
 * - Skips vendor/build dirs everywhere to keep scans fast and deterministic:
 *   node_modules, .git, .pnpm-store, dist, build, .vite, coverage
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

const FORBIDDEN_STRINGS = ['VIP', 'DELUXE', 'Deluxe', 'Vip'];
const REQUIRED_TIER_VALUES = ['STANDARD', 'DOUBLE', 'SPECIAL'];
const ALLOWED_RENTAL_VALUES = ['STANDARD', 'DOUBLE', 'SPECIAL', 'LOCKER', 'GYM_LOCKER'];

// NOTE: This tool is intentionally conservative about what it scans.
// If you add a new runtime app/package, add its src/ directory here.
const SOURCE_ROOTS_TO_SCAN = [
  'services/api/src',
  'packages/shared/src',
  'packages/ui/src',
  'apps/customer-kiosk/src',
  'apps/employee-register/src',
  'apps/cleaning-station-kiosk/src',
  'apps/checkout-kiosk/src',
  'apps/office-dashboard/src',
].map((p) => join(ROOT_DIR, p));

const SKIP_DIR_NAMES = new Set(['node_modules', '.git', '.pnpm-store', 'dist', 'build', '.vite', 'coverage']);

// These are allowed to contain legacy strings and are never scanned for forbidden strings.
const LEGACY_ALLOWED_PATH_PREFIXES = [
  'docs/database/',
  'services/api/migrations/',
  'db/',
].map((p) => p.replaceAll('\\', '/'));

let errors = [];
let warnings = [];

/**
 * Recursively find all files matching extensions
 */
function findFiles(dir, extensions) {
  const files = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (SKIP_DIR_NAMES.has(entry)) continue;
      
      if (entry.includes('..')) throw new Error('Invalid file path');
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        files.push(...findFiles(fullPath, extensions));
      } else if (stat.isFile()) {
        const ext = entry.split('.').pop();
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch (err) {
    // Skip directories we can't read
  }
  return files;
}

/**
 * Check enum file for correct tier values
 */
function checkEnums() {
  const enumPath = join(ROOT_DIR, 'packages/shared/src/enums.ts');
  try {
    const content = readFileSync(enumPath, 'utf-8');
    
    // Check for RoomType enum
    const roomTypeMatch = content.match(/export enum RoomType \{([^}]+)\}/s);
    if (!roomTypeMatch) {
      errors.push(`❌ packages/shared/src/enums.ts: RoomType enum not found`);
      return;
    }
    
    const enumBody = roomTypeMatch[1];
    
    // Check for forbidden values
    for (const forbidden of FORBIDDEN_STRINGS) {
      if (enumBody.includes(forbidden)) {
        errors.push(`❌ packages/shared/src/enums.ts: RoomType enum contains forbidden value: ${forbidden}`);
      }
    }
    
    // Check for required values
    for (const required of REQUIRED_TIER_VALUES) {
      if (!enumBody.includes(`${required} = '${required}'`)) {
        errors.push(`❌ packages/shared/src/enums.ts: RoomType enum missing required value: ${required}`);
      }
    }
    
    // Check for LOCKER (should be present)
    if (!enumBody.includes("LOCKER = 'LOCKER'")) {
      warnings.push(`⚠️  packages/shared/src/enums.ts: RoomType enum missing LOCKER (expected but not required)`);
    }
    
    console.log('✓ Enum check passed');
  } catch (err) {
    if (err.code === 'ENOENT') {
      errors.push(`❌ packages/shared/src/enums.ts: File not found`);
    } else {
      errors.push(`❌ packages/shared/src/enums.ts: Error reading file: ${err.message}`);
    }
  }
}

/**
 * Check for forbidden strings in codebase
 */
function checkForbiddenStrings() {
  console.log('🔎 Forbidden string scan configuration:');
  console.log(`   - Scanning source roots:\n${SOURCE_ROOTS_TO_SCAN.map((p) => `     - ${relative(ROOT_DIR, p)}`).join('\n')}`);
  console.log(`   - Skipping directory names anywhere: ${Array.from(SKIP_DIR_NAMES).join(', ')}`);
  console.log(`   - Allowing legacy strings (not scanned): ${LEGACY_ALLOWED_PATH_PREFIXES.join(', ')}`);
  console.log('');

  const filesToCheck = SOURCE_ROOTS_TO_SCAN.flatMap((root) => findFiles(root, ['ts', 'tsx', 'js', 'jsx']))
    .filter((f) => {
      const relPath = relative(ROOT_DIR, f).replaceAll('\\', '/');
      if (relPath.includes('total-diff.txt')) return false; // local diff artifacts
      if (relPath.includes('diffs-last-three-commits.txt')) return false;

      // Extra safety: never scan allowed legacy areas even if a source root ever overlaps.
      return !LEGACY_ALLOWED_PATH_PREFIXES.some((prefix) => relPath.startsWith(prefix));
    });
  
  let foundForbidden = false;
  
  for (const file of filesToCheck) {
    try {
      const relPath = relative(ROOT_DIR, file);
      const content = readFileSync(file, 'utf-8');
      
      // Check each forbidden string
      for (const forbidden of FORBIDDEN_STRINGS) {
        // Get line numbers and check if in comments
        const lines = content.split('\n');
        const lineNumbers = [];
        lines.forEach((line, idx) => {
          // Use word boundaries to avoid false positives
          const regex = new RegExp(`\\b${forbidden}\\b`);
          if (regex.test(line)) {
            lineNumbers.push(idx + 1);
          }
        });
        
        if (lineNumbers.length > 0) {
          errors.push(`❌ ${relPath}: Found forbidden string "${forbidden}" (lines: ${lineNumbers.join(', ')})`);
          foundForbidden = true;
        }
      }
    } catch (err) {
      // Skip files we can't read
    }
  }
  
  if (!foundForbidden) {
    console.log('✓ No forbidden strings found in runtime/UI source');
  }
}

/**
 * Check SPEC.md mentions correct tiers
 */
function checkSpecMd() {
  const specPath = join(ROOT_DIR, 'SPEC.md');
  try {
    const content = readFileSync(specPath, 'utf-8');
    
    // Check that SPEC.md mentions the correct tiers
    const hasStandard = content.includes('Standard') || content.includes('STANDARD');
    const hasDouble = content.includes('Double') || content.includes('DOUBLE');
    const hasSpecial = content.includes('Special') || content.includes('SPECIAL');
    
    if (!hasStandard || !hasDouble || !hasSpecial) {
      errors.push(`❌ SPEC.md: Missing required tier mentions (Standard, Double, Special)`);
    }
    
    // Check that SPEC.md doesn't mention forbidden tiers
    for (const forbidden of ['VIP', 'Deluxe']) {
      if (content.includes(forbidden) && !content.includes(`Note: ${forbidden}`) && !content.includes(`old ${forbidden}`)) {
        warnings.push(`⚠️  SPEC.md: Contains "${forbidden}" - ensure this is only in historical/context notes`);
      }
    }
    
    console.log('✓ SPEC.md check passed');
  } catch (err) {
    errors.push(`❌ SPEC.md: Error reading file: ${err.message}`);
  }
}

/**
 * Main execution
 */
function main() {
  console.log('🔍 Running SPEC compliance checks...\n');
  
  checkEnums();
  checkForbiddenStrings();
  checkSpecMd();
  
  console.log('\n' + '='.repeat(60));
  
  if (warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    warnings.forEach(w => console.log(`  ${w}`));
  }
  
  if (errors.length > 0) {
    console.log('\n❌ Errors found:');
    errors.forEach(e => console.log(`  ${e}`));
    console.log('\n❌ SPEC compliance check FAILED');
    process.exit(1);
  } else {
    console.log('\n✅ SPEC compliance check PASSED');
    if (warnings.length > 0) {
      console.log(`   (with ${warnings.length} warning(s))`);
    }
    process.exit(0);
  }
}

main();

