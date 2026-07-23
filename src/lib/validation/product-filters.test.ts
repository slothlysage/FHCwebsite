import { describe, expect, it } from "vitest";

import {
  filtersToSearchParams,
  parseProductFilters,
} from "@/lib/validation/product-filters";

describe("parseProductFilters", () => {
  it("defaults to no facets, no price bounds, not in-stock-only, sort newest", () => {
    const filters = parseProductFilters({});

    expect(filters).toEqual({
      categorySlugs: [],
      scents: [],
      sizes: [],
      minPriceCents: undefined,
      maxPriceCents: undefined,
      inStockOnly: false,
      sort: "newest",
      page: 1,
    });
  });

  it("collects a single repeated facet value as a one-element array", () => {
    const filters = parseProductFilters({ category: "candles" });
    expect(filters.categorySlugs).toEqual(["candles"]);
  });

  it("collects multiple values of the same facet (Next gives an array for repeats)", () => {
    const filters = parseProductFilters({
      category: ["candles", "soap"],
      scent: ["lavender", "vanilla"],
      size: "8oz",
    });

    expect(filters.categorySlugs).toEqual(["candles", "soap"]);
    expect(filters.scents).toEqual(["lavender", "vanilla"]);
    expect(filters.sizes).toEqual(["8oz"]);
  });

  it("drops blank facet values instead of keeping empty strings", () => {
    const filters = parseProductFilters({ category: ["", "candles", "  "] });
    expect(filters.categorySlugs).toEqual(["candles"]);
  });

  it("parses minPrice/maxPrice as whole dollars converted to cents", () => {
    const filters = parseProductFilters({ minPrice: "10", maxPrice: "30" });
    expect(filters.minPriceCents).toBe(1000);
    expect(filters.maxPriceCents).toBe(3000);
  });

  it("parses fractional dollar prices", () => {
    const filters = parseProductFilters({ minPrice: "19.99" });
    expect(filters.minPriceCents).toBe(1999);
  });

  it("ignores a non-numeric price rather than erroring", () => {
    const filters = parseProductFilters({ minPrice: "not-a-number" });
    expect(filters.minPriceCents).toBeUndefined();
  });

  it("ignores a negative price", () => {
    const filters = parseProductFilters({ minPrice: "-5" });
    expect(filters.minPriceCents).toBeUndefined();
  });

  it("treats presence of inStock as true regardless of its value", () => {
    expect(parseProductFilters({ inStock: "true" }).inStockOnly).toBe(true);
    expect(parseProductFilters({ inStock: "" }).inStockOnly).toBe(true);
    expect(parseProductFilters({ inStock: "false" }).inStockOnly).toBe(true);
  });

  it("accepts every documented sort value", () => {
    expect(parseProductFilters({ sort: "newest" }).sort).toBe("newest");
    expect(parseProductFilters({ sort: "price_asc" }).sort).toBe("price_asc");
    expect(parseProductFilters({ sort: "price_desc" }).sort).toBe("price_desc");
    expect(parseProductFilters({ sort: "name_asc" }).sort).toBe("name_asc");
  });

  it("falls back to newest for an unknown sort value instead of erroring", () => {
    expect(parseProductFilters({ sort: "bogus" }).sort).toBe("newest");
  });

  it("takes the first value when a single-value param is repeated", () => {
    expect(parseProductFilters({ sort: ["price_asc", "name_asc"] }).sort).toBe(
      "price_asc",
    );
    expect(parseProductFilters({ minPrice: ["10", "20"] }).minPriceCents).toBe(
      1000,
    );
  });

  it("ignores unknown query parameters entirely", () => {
    const filters = parseProductFilters({
      utm_source: "newsletter",
      category: "candles",
    });
    expect(filters.categorySlugs).toEqual(["candles"]);
  });

  it("defaults page to 1 when absent", () => {
    expect(parseProductFilters({}).page).toBe(1);
  });

  it("parses a valid page number", () => {
    expect(parseProductFilters({ page: "3" }).page).toBe(3);
  });

  it("defaults to 1 for a non-numeric page instead of erroring", () => {
    expect(parseProductFilters({ page: "not-a-number" }).page).toBe(1);
  });

  it("defaults to 1 for page 0", () => {
    expect(parseProductFilters({ page: "0" }).page).toBe(1);
  });

  it("defaults to 1 for a negative page", () => {
    expect(parseProductFilters({ page: "-2" }).page).toBe(1);
  });

  it("defaults to 1 for a fractional page", () => {
    expect(parseProductFilters({ page: "1.5" }).page).toBe(1);
  });
});

describe("filtersToSearchParams", () => {
  it("produces an empty query string for the default filters", () => {
    const params = filtersToSearchParams(parseProductFilters({}));
    expect(params.toString()).toBe("");
  });

  it("round-trips facets, price bounds, inStock, and sort", () => {
    const params = filtersToSearchParams(
      parseProductFilters({
        category: ["candles", "soap"],
        minPrice: "10",
        maxPrice: "30",
        inStock: "true",
        sort: "price_asc",
      }),
    );

    expect(params.getAll("category")).toEqual(["candles", "soap"]);
    expect(params.get("minPrice")).toBe("10");
    expect(params.get("maxPrice")).toBe("30");
    expect(params.get("inStock")).toBe("true");
    expect(params.get("sort")).toBe("price_asc");
  });

  it("omits sort when it is the default", () => {
    const params = filtersToSearchParams(
      parseProductFilters({ sort: "newest" }),
    );
    expect(params.has("sort")).toBe(false);
  });

  it("omits page when it is 1 (the default)", () => {
    const params = filtersToSearchParams(parseProductFilters({ page: "1" }));
    expect(params.has("page")).toBe(false);
  });

  it("includes page when greater than 1", () => {
    const params = filtersToSearchParams(parseProductFilters({ page: "2" }));
    expect(params.get("page")).toBe("2");
  });
});
