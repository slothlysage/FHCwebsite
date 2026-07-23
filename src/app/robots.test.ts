import { describe, expect, it } from "vitest";

import robots from "./robots";

describe("robots", () => {
  it("disallows /admin and /api and references the sitemap", () => {
    const result = robots();

    expect(result.rules).toEqual(
      expect.objectContaining({
        userAgent: "*",
        disallow: expect.arrayContaining(["/admin", "/api"]),
      }),
    );
    expect(result.sitemap).toBe("http://localhost:3000/sitemap.xml");
  });
});
