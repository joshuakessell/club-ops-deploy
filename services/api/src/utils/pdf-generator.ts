/**
 * PDF generation utility for agreement documents.
 *
 * Uses `pdf-lib` to generate robust, reader-compatible PDFs with embedded images.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

function extractBase64FromDataUrlOrRaw(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('data:')) {
    const comma = trimmed.indexOf(',');
    if (comma === -1) throw new Error('Invalid data URL: missing comma');
    return trimmed.slice(comma + 1);
  }
  return trimmed;
}

function base64ToUint8Array(base64: string): Uint8Array {
  // Buffer is available in Node; pdf-lib wants Uint8Array.
  return Uint8Array.from(Buffer.from(base64, 'base64'));
}

function wrapText(params: {
  text: string;
  font: { widthOfTextAtSize: (t: string, size: number) => number };
  fontSize: number;
  maxWidth: number;
  maxLines: number;
}): { lines: string[]; truncated: boolean } {
  const raw = params.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const paragraphs = raw.split('\n');
  const lines: string[] = [];

  const pushLine = (line: string): boolean => {
    lines.push(line);
    return lines.length >= params.maxLines;
  };

  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      if (pushLine('')) return { lines, truncated: true };
      continue;
    }

    let current = '';
    for (const w of words) {
      const next = current ? `${current} ${w}` : w;
      const width = params.font.widthOfTextAtSize(next, params.fontSize);
      if (width <= params.maxWidth) {
        current = next;
        continue;
      }

      if (current) {
        if (pushLine(current)) return { lines, truncated: true };
        current = w;
      } else {
        // Single word longer than max width: hard break by characters.
        let chunk = '';
        for (const ch of w) {
          const candidate = chunk + ch;
          if (params.font.widthOfTextAtSize(candidate, params.fontSize) <= params.maxWidth) {
            chunk = candidate;
          } else {
            if (pushLine(chunk)) return { lines, truncated: true };
            chunk = ch;
          }
        }
        current = chunk;
      }
    }
    if (current) {
      if (pushLine(current)) return { lines, truncated: true };
    }
  }

  return { lines, truncated: false };
}

/**
 * Generate a PDF document for a signed agreement.
 *
 * Layout notes:
 * - Letter page (612x792 pts), 1 page
 * - Header: agreement title + version
 * - Body: wrapped/truncated agreement text
 * - Footer: customer name, membership #, UTC timestamp, and embedded signature image in a labeled box
 */
export async function generateAgreementPdf(params: {
  agreementTitle?: string;
  agreementVersion?: string;
  agreementText: string;
  customerName: string;
  membershipNumber?: string;
  signedAt: Date;
  signatureImageBase64?: string; // raw base64 OR full data URL
}): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // US Letter

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 48;
  const contentWidth = 612 - margin * 2;
  const black = rgb(0, 0, 0);
  const gray = rgb(0.35, 0.35, 0.35);

  // Header
  const title = (params.agreementTitle || 'Club Agreement').trim();
  const version = (params.agreementVersion || '').trim();
  const headerY = 792 - margin;

  page.drawText(title, { x: margin, y: headerY, size: 18, font: fontBold, color: black });
  if (version) {
    page.drawText(`Version: ${version}`, { x: margin, y: headerY - 22, size: 10, font, color: gray });
  }

  // Customer + timestamp
  const signedAtUtc = params.signedAt.toISOString(); // UTC
  const customerLine = `Customer: ${params.customerName}`;
  const memberLine = `Membership #: ${params.membershipNumber || 'N/A'}`;
  const signedLine = `Signed (UTC): ${signedAtUtc}`;

  page.drawText(customerLine, { x: margin, y: headerY - 44, size: 11, font, color: black });
  page.drawText(memberLine, { x: margin, y: headerY - 58, size: 11, font, color: black });
  page.drawText(signedLine, { x: margin, y: headerY - 72, size: 11, font, color: black });

  // Signature box (reserve space at bottom)
  const signatureBoxHeight = 110;
  const signatureBoxY = margin;
  const signatureBoxX = margin;
  const signatureBoxWidth = contentWidth;
  const signatureImagePadding = 10;

  // Agreement text area bounds (leave some padding above signature box + header)
  const textTopY = headerY - 100;
  const textBottomY = signatureBoxY + signatureBoxHeight + 18;
  const textHeight = Math.max(0, textTopY - textBottomY);
  const fontSize = 10.5;
  const lineHeight = 13;
  const maxLines = Math.max(1, Math.floor(textHeight / lineHeight));

  page.drawText('Agreement Text (snapshot):', {
    x: margin,
    y: textTopY + 8,
    size: 11,
    font: fontBold,
    color: black,
  });

  const wrapped = wrapText({
    text: params.agreementText,
    font,
    fontSize,
    maxWidth: contentWidth,
    maxLines,
  });

  let y = textTopY - lineHeight;
  for (const line of wrapped.lines) {
    page.drawText(line, { x: margin, y, size: fontSize, font, color: black });
    y -= lineHeight;
    if (y < textBottomY) break;
  }
  if (wrapped.truncated) {
    page.drawText('… (truncated)', { x: margin, y: textBottomY - 2, size: 10, font, color: gray });
  }

  // Signature label + box
  page.drawText('Signature (PNG):', { x: signatureBoxX, y: signatureBoxY + signatureBoxHeight + 4, size: 11, font: fontBold, color: black });
  page.drawRectangle({
    x: signatureBoxX,
    y: signatureBoxY,
    width: signatureBoxWidth,
    height: signatureBoxHeight,
    borderColor: gray,
    borderWidth: 1,
  });

  if (params.signatureImageBase64) {
    const rawBase64 = extractBase64FromDataUrlOrRaw(params.signatureImageBase64);
    const pngBytes = base64ToUint8Array(rawBase64);
    const pngImage = await pdfDoc.embedPng(pngBytes);

    const maxW = signatureBoxWidth - signatureImagePadding * 2;
    const maxH = signatureBoxHeight - signatureImagePadding * 2;
    const scale = Math.min(maxW / pngImage.width, maxH / pngImage.height);
    const drawW = pngImage.width * scale;
    const drawH = pngImage.height * scale;

    const drawX = signatureBoxX + signatureImagePadding + (maxW - drawW) / 2;
    const drawY = signatureBoxY + signatureImagePadding + (maxH - drawH) / 2;
    page.drawImage(pngImage, { x: drawX, y: drawY, width: drawW, height: drawH });
  } else {
    page.drawText('(no signature image provided)', { x: signatureBoxX + 10, y: signatureBoxY + signatureBoxHeight / 2 - 4, size: 10, font, color: gray });
  }

  // Use a more traditional PDF structure for maximum compatibility with older parsers/readers.
  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  return Buffer.from(pdfBytes);
}

