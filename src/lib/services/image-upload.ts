import sharp from "sharp";

// specs/07-security-legal.md: "Uploads: validate by magic bytes not
// extension, cap size, strip EXIF". This is deliberately the file-type-
// blind half of 4.5 (see fix_plan.md's 4.5a) — it never looks at a
// filename or a client-claimed Content-Type, only the actual bytes.

export type ImageProcessingError = "file_too_large" | "unrecognized_image_type";

export type ResponsiveSizeLabel = "thumbnail" | "medium" | "large";

export type ProcessedImageSize = {
  label: ResponsiveSizeLabel;
  width: number;
  height: number;
  buffer: Buffer;
  contentType: "image/webp";
};

export type ProcessUploadedImageResult =
  | { ok: true; sizes: ProcessedImageSize[] }
  | { ok: false; error: ImageProcessingError };

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const RESPONSIVE_TARGETS: Array<{
  label: ResponsiveSizeLabel;
  width: number;
}> = [
  { label: "thumbnail", width: 400 },
  { label: "medium", width: 800 },
  { label: "large", width: 1600 },
];

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

function hasRecognizedImageSignature(buffer: Buffer): boolean {
  if (
    buffer.length >= PNG_SIGNATURE.length &&
    buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return true;
  }
  if (
    buffer.length >= JPEG_SIGNATURE.length &&
    buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)
  ) {
    return true;
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return true;
  }
  return false;
}

export async function processUploadedImage(
  buffer: Buffer,
): Promise<ProcessUploadedImageResult> {
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "file_too_large" };
  }

  if (!hasRecognizedImageSignature(buffer)) {
    return { ok: false, error: "unrecognized_image_type" };
  }

  // Auto-orient from EXIF, then never call .withMetadata() downstream —
  // sharp omits metadata (including the EXIF block) by default, so this
  // buffer is already the fully-stripped source every responsive size is
  // resized from. A dedicated instance + toBuffer() boundary before resize,
  // per feedback_sharp_pipeline_gotcha: chaining unrelated ops on one
  // sharp() instance has silently produced wrong output dimensions before.
  let oriented: Buffer;
  try {
    oriented = await sharp(buffer).rotate().toBuffer();
  } catch {
    return { ok: false, error: "unrecognized_image_type" };
  }

  const sizes: ProcessedImageSize[] = [];
  for (const target of RESPONSIVE_TARGETS) {
    const { data, info } = await sharp(oriented)
      .resize({ width: target.width, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    sizes.push({
      label: target.label,
      width: info.width,
      height: info.height,
      buffer: data,
      contentType: "image/webp",
    });
  }

  return { ok: true, sizes };
}
