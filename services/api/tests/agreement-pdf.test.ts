import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateAgreementPdf } from '../src/utils/pdf-generator.js';

describe('Agreement PDF generation', () => {
  it('writes a valid PDF to disk and a parser can open it (1+ pages)', async () => {
    const signatureBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const pdf = await generateAgreementPdf({
      agreementTitle: 'Club Dallas Agreement',
      agreementVersion: 'test-v1',
      agreementText: 'This is a test agreement body.\n\nIt should appear in the PDF.',
      customerName: 'Test Customer',
      membershipNumber: 'TEST-001',
      signedAt: new Date('2026-01-03T00:00:00.000Z'),
      signatureImageBase64: signatureBase64,
    });

    const outDir = path.resolve(process.cwd(), 'tests', '_artifacts');
    const outPath = path.join(outDir, 'agreement.generated.pdf');
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(outPath, pdf);

    // Parse with a different library than the generator to confirm the PDF is readable.
    const mod = await import('pdf-parse');
    const pdfParse = (mod as any).default ?? mod;
    const parsed = await pdfParse(pdf);

    expect(parsed.numpages).toBeGreaterThan(0);
    expect(parsed.text).toContain('Test Customer');
  });
});


