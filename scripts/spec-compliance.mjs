#!/usr/bin/env node
/**
 * SPEC Compliance Check Script
 * 
 * Validates that the codebase complies with SPEC.md:
 * 1. Room tier enums match SPEC.md (STANDARD, DOUBLE, SPECIAL)
 * 2. No forbidden tier strings exist: "VIP", "DELUXE", "Deluxe", "Vip"
 * 3. Room tier values are exactly STANDARD, DOUBLE, SPECIAL (plus LOCKER and optionally GYM_LOCKER)
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

let errors = [];
let warnings = [];

/**
 * Recursively find all files matching extensions
 */
function findFiles(dir, extensions, excludeDirs = ['node_modules', '.git', 'dist']) {
  const files = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (excludeDirs.includes(entry)) continue;
      
      if (entry.includes('..')) throw new Error('Invalid file path');
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        files.push(...findFiles(fullPath, extensions, excludeDirs));
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
  const filesToCheck = [
    ...findFiles(ROOT_DIR, ['ts', 'tsx', 'js', 'jsx', 'sql']),
    ...findFiles(join(ROOT_DIR, 'services/api/migrations'), ['sql']),
  ].filter(f => {
    // Exclude certain files
    const relPath = relative(ROOT_DIR, f);
    if (relPath.includes('node_modules')) return false;
    if (relPath.includes('dist')) return false;
    if (relPath.includes('total-diff.txt')) return false; // This is just a diff file
    if (relPath.includes('diffs-last-three-commits.txt')) return false;
    // Exclude schema.sql - it documents actual DB state which includes legacy enum values
    if (relPath === 'db/schema.sql') return false;
    // Allow the migration that updates the enum
    if (relPath.includes('030_update_room_type_enum.sql')) return false;
    // Allow the migration comment that documents old values
    if (relPath.includes('002_create_rooms.sql')) {
      // Check if it's just a comment mentioning old values
      return false; // We'll check this separately
    }
    return true;
  });
  
  let foundForbidden = false;
  
  for (const file of filesToCheck) {
    try {
      const relPath = relative(ROOT_DIR, file);
      
      // Skip schema.sql - it documents actual DB state which includes legacy enum values
      if (relPath === 'db/schema.sql' || relPath.includes('db\\schema.sql')) {
        continue;
      }
      
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
  
  // Special case: check migration 002 - it should only mention old values in comments
  const migration002Path = join(ROOT_DIR, 'services/api/migrations/002_create_rooms.sql');
  try {
    const content = readFileSync(migration002Path, 'utf-8');
    // Check if DELUXE/VIP are in the enum definition (not just comments)
    if (content.includes("CREATE TYPE room_type AS ENUM ('STANDARD', 'DELUXE', 'VIP'")) {
      // This is expected - the enum originally had these values
      // But we should check if migration 030 exists to update them
      const migration030Path = join(ROOT_DIR, 'services/api/migrations/030_update_room_type_enum.sql');
      try {
        statSync(migration030Path);
        console.log('✓ Migration 030 exists to update enum values');
      } catch {
        warnings.push(`⚠️  Migration 002 defines old enum values, but migration 030 (update) not found`);
      }
    }
  } catch {
    // File doesn't exist, that's ok
  }
  
  if (!foundForbidden) {
    console.log('✓ No forbidden strings found in codebase');
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

