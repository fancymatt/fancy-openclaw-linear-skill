/**
 * Tests for the P4-2 metrics CLI module.
 *
 * Covers: duration parsing, human formatting, threshold detection,
 * empty-state handling, and the admin URL resolution.
 */

import {
  parseDuration,
  formatMetricsHuman,
  resolveAdminBaseUrl,
  type MetricRollup,
} from "../metrics";

// Helper to reset env between tests
function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const orig = process.env[key];
  if (value !== undefined) {
    process.env[key] = value;
  } else {
    delete process.env[key];
  }
  try {
    fn();
  } finally {
    if (orig !== undefined) {
      process.env[key] = orig;
    } else {
      delete process.env[key];
    }
  }
}

describe("parseDuration", () => {
  it("parses days", () => {
    const result = parseDuration("30d");
    expect(result).toBeDefined();
    // Should be ~30 days ago
    const then = new Date(result!);
    const now = new Date();
    const diffMs = now.getTime() - then.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(29.9);
    expect(diffDays).toBeLessThanOrEqual(30.1);
  });

  it("parses hours", () => {
    const result = parseDuration("24h");
    expect(result).toBeDefined();
    const then = new Date(result!);
    const now = new Date();
    const diffMs = now.getTime() - then.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    expect(diffHours).toBeGreaterThanOrEqual(23.9);
    expect(diffHours).toBeLessThanOrEqual(24.1);
  });

  it("parses minutes", () => {
    const result = parseDuration("60m");
    expect(result).toBeDefined();
  });

  it("returns undefined for unrecognized input", () => {
    expect(parseDuration("30w")).toBeUndefined();
    expect(parseDuration("abc")).toBeUndefined();
    expect(parseDuration("")).toBeUndefined();
    expect(parseDuration("2026-06-01")).toBeUndefined();
  });
});

describe("resolveAdminBaseUrl", () => {
  it("extracts admin base from proxy URL with path", () => {
    withEnv("LINEAR_PROXY_URL", "http://localhost:3100/graphql", () => {
      const result = resolveAdminBaseUrl();
      expect(result).toBe("http://localhost:3100/admin");
    });
  });

  it("extracts admin base from proxy URL without path", () => {
    withEnv("LINEAR_PROXY_URL", "http://localhost:3100", () => {
      const result = resolveAdminBaseUrl();
      expect(result).toBe("http://localhost:3100/admin");
    });
  });

  it("returns null when no proxy URL is set", () => {
    withEnv("LINEAR_PROXY_URL", undefined, () => {
      expect(resolveAdminBaseUrl()).toBeNull();
    });
  });
});

describe("formatMetricsHuman", () => {
  it("handles empty rollup", () => {
    const rollup: MetricRollup = {
      items: [],
      summary: {
        totalObservations: 0,
        uniqueWorkflows: 0,
        uniqueSteps: 0,
        stepsAboveThreshold: [],
      },
      query: {},
    };
    const output = formatMetricsHuman(rollup);
    expect(output).toContain("No observations found");
  });

  it("formats a simple single-workflow rollup", () => {
    const rollup: MetricRollup = {
      items: [
        { workflow: "dev-impl", step: "code-review", reasonCode: "missing-tests", count: 14, exceedsThreshold: true },
        { workflow: "dev-impl", step: "code-review", reasonCode: "style", count: 3, exceedsThreshold: false },
        { workflow: "dev-impl", step: "deployment", reasonCode: "correctness", count: 7, exceedsThreshold: true },
      ],
      summary: {
        totalObservations: 24,
        uniqueWorkflows: 1,
        uniqueSteps: 2,
        stepsAboveThreshold: [
          { workflow: "dev-impl", step: "code-review", total: 17 },
          { workflow: "dev-impl", step: "deployment", total: 7 },
        ],
      },
      query: { workflow: "dev-impl" },
    };
    const output = formatMetricsHuman(rollup);

    // Should group by workflow/step
    expect(output).toContain("dev-impl / code-review");
    expect(output).toContain("dev-impl / deployment");

    // Should contain the reason codes with emoji
    expect(output).toContain("missing-tests");
    expect(output).toContain("style");
    expect(output).toContain("correctness");

    // Should contain counts
    expect(output).toContain("14");
    expect(output).toContain("3");
    expect(output).toContain("7");

    // Should flag thresholds
    expect(output).toContain("⚠️  YES");

    // Should show totals
    expect(output).toContain("TOTAL");
    expect(output).toContain("17"); // code-review subtotal

    // Summary
    expect(output).toContain("24 observations");
    expect(output).toContain("Steps above threshold");
  });

  it("handles body breakdown", () => {
    const rollup: MetricRollup = {
      items: [
        { workflow: "dev-impl", step: "code-review", reasonCode: "missing-tests", count: 5, fromBody: "igor", exceedsThreshold: true },
        { workflow: "dev-impl", step: "code-review", reasonCode: "missing-tests", count: 9, fromBody: "sage", exceedsThreshold: true },
      ],
      summary: {
        totalObservations: 14,
        uniqueWorkflows: 1,
        uniqueSteps: 1,
        stepsAboveThreshold: [
          { workflow: "dev-impl", step: "code-review", total: 14 },
        ],
      },
      query: { includeBody: true },
    };
    const output = formatMetricsHuman(rollup);

    expect(output).toContain("igor");
    expect(output).toContain("sage");
  });

  it("handles unknown reason codes gracefully", () => {
    const rollup: MetricRollup = {
      items: [
        { workflow: "dev-impl", step: "code-review", reasonCode: "new-reason", count: 2, exceedsThreshold: false },
      ],
      summary: {
        totalObservations: 2,
        uniqueWorkflows: 1,
        uniqueSteps: 1,
        stepsAboveThreshold: [],
      },
      query: {},
    };
    const output = formatMetricsHuman(rollup);
    expect(output).toContain("new-reason");
  });
});
