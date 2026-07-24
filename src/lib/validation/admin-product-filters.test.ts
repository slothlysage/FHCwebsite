import { describe, expect, it } from "vitest";

import { parseAdminProductFilters } from "@/lib/validation/admin-product-filters";

describe("parseAdminProductFilters", () => {
  it("defaults search and status to undefined when absent", () => {
    const filters = parseAdminProductFilters({});
    expect(filters).toEqual({ search: undefined, status: undefined });
  });

  it("trims a search string", () => {
    const filters = parseAdminProductFilters({ search: "  lavender  " });
    expect(filters.search).toBe("lavender");
  });

  it("treats a blank search as absent", () => {
    const filters = parseAdminProductFilters({ search: "   " });
    expect(filters.search).toBeUndefined();
  });

  it("takes the first value when search is repeated in the query string", () => {
    const filters = parseAdminProductFilters({ search: ["first", "second"] });
    expect(filters.search).toBe("first");
  });

  it("accepts a known product status", () => {
    const filters = parseAdminProductFilters({ status: "published" });
    expect(filters.status).toBe("published");
  });

  it("drops an unknown status value rather than erroring", () => {
    const filters = parseAdminProductFilters({ status: "not-a-status" });
    expect(filters.status).toBeUndefined();
  });
});
