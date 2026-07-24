import { z } from "zod";

// 4.5c's product-images admin form. Two shapes live here:
// - the single-image upload form (file + required alt text)
// - the batch edit form for existing images (alt text/position/delete per
//   row), field-named per image id rather than by array index so the
//   server action can read a row by the id it already trusts from its own
//   `listImagesByProductId` call, not from anything the client submitted.

export const imageUploadFormSchema = z.object({
  altText: z.string().trim().min(1, "Alt text is required."),
});
export type ImageUploadFormInput = z.infer<typeof imageUploadFormSchema>;

export function parseImageUploadForm(
  formData: FormData,
): z.ZodSafeParseResult<ImageUploadFormInput> {
  return imageUploadFormSchema.safeParse({
    altText: formData.get("altText"),
  });
}

export function altTextFieldName(imageId: string): string {
  return `altText__${imageId}`;
}

export function positionFieldName(imageId: string): string {
  return `position__${imageId}`;
}

export function deleteFieldName(imageId: string): string {
  return `delete__${imageId}`;
}
