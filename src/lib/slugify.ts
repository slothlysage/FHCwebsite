// Shared by the catalog importer's category slugs (1.4b) and the admin
// product editor's slug generation (4.3a) — free text in, URL-safe slug out.
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}
