/**
 * QR Code encoder — thin wrapper around qrcode-generator.
 * Bundled into webmaven-ui's dist so consumers have zero runtime dependencies.
 */

// @ts-ignore — no types for qrcode-generator
import qrcode from 'qrcode-generator';

/**
 * Generate a QR code matrix (boolean[][]) for the given text.
 * Uses error correction level H (30%) for maximum logo tolerance.
 * `version` 1 to 40 draws the code at that version (it must hold the text);
 * 0, the default, picks the smallest that does.
 */
export function generateQRMatrix(text: string, version = 0): boolean[][] {
  // 'H' = highest error correction
  const qr = qrcode(version as Parameters<typeof qrcode>[0], 'H');
  qr.addData(text);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const matrix: boolean[][] = [];

  for (let row = 0; row < moduleCount; row++) {
    const rowData: boolean[] = [];
    for (let col = 0; col < moduleCount; col++) {
      rowData.push(qr.isDark(row, col));
    }
    matrix.push(rowData);
  }

  return matrix;
}

/** The version (1 to 40) of a code `moduleCount` modules wide. */
export function qrVersion(moduleCount: number): number {
  return (moduleCount - 17) / 4;
}

/**
 * Check if a module is part of a finder pattern (the 3 corner squares).
 */
export function isFinderModule(row: number, col: number, size: number): boolean {
  const inTopLeft = row < 8 && col < 8;
  const inTopRight = row < 8 && col >= size - 8;
  const inBottomLeft = row >= size - 8 && col < 8;
  return inTopLeft || inTopRight || inBottomLeft;
}

/**
 * The side, in modules, of the square hole a mark may take at the centre of
 * an H code, per version (index 0 is version 1); 0 where it may take none
 * (2026-10-11). A reader only restores what the error correction covers, so
 * the hole is the largest centred square that:
 * - clears no function pattern (finder, separator, timing, alignment, format
 *   or version information): versions 7 to 13, 21 to 27 and 35 to 40 hold an
 *   alignment pattern at their very centre, so they take none;
 * - damages, in every block, at most half the codewords the block can
 *   correct (every module under the mark counted as misread), the other half
 *   left for glare, blur and a tilted phone;
 * - clears at most 15% of the data modules;
 * - stays within about a quarter of the code's width with its quiet zone,
 *   and at least a tenth of it (smaller, the mark would not read).
 * The QRCode tests derive this table again from the code's layout, read
 * back from the encoder's own matrices, and hold it to those limits.
 */
export const MARK_HOLE_MODULES: readonly number[] = [
  3, 5, 5, 7, 9, 11, 0, 0, 0, 0,
  0, 0, 0, 15, 15, 15, 19, 19, 19, 23,
  0, 0, 0, 0, 0, 0, 0, 15, 19, 15,
  19, 19, 19, 23, 0, 0, 0, 0, 0, 0,
];

export interface MarkedQRMatrix {
  matrix: boolean[][];
  /** Side of the centred square left for the mark, in modules; 0 for none. */
  hole: number;
}

/**
 * The matrix for `text` with room for a mark at its centre (2026-10-11).
 * When the smallest version that holds the text has an alignment pattern at
 * its centre, the code moves up to the first version with a free centre, up
 * to `maxVersion` (the caller keeps the modules large enough to read); past
 * it, the smallest version is drawn whole, without a mark.
 */
export function markedQRMatrix(text: string, maxVersion = 40): MarkedQRMatrix {
  const matrix = generateQRMatrix(text);
  const needed = qrVersion(matrix.length);
  for (let version = needed; version <= Math.min(maxVersion, 40); version++) {
    const hole = MARK_HOLE_MODULES[version - 1];
    if (hole > 0) {
      return { matrix: version === needed ? matrix : generateQRMatrix(text, version), hole };
    }
  }
  return { matrix, hole: 0 };
}
