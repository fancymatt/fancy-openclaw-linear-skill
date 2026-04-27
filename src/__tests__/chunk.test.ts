import { chunkCommentBody, splitIntoBlocks, captionChunks, DEFAULT_MAX_COMMENT_BYTES } from "../chunk";

import { linearGraphQL } from "../client";
import { addComment } from "../issues";

jest.mock("../client", () => ({
  ...jest.requireActual("../client"),
  linearGraphQL: jest.fn(),
}));

jest.mock("../auth", () => ({
  getSelfUser: jest.fn().mockResolvedValue({ id: "self-1", name: "Test Bot", email: "bot@test.com" }),
}));

const mockedGraphQL = linearGraphQL as jest.MockedFunction<typeof linearGraphQL>;

describe("chunkCommentBody", () => {
  it("returns body unchanged when under the limit", () => {
    const body = "Hello world\n\nA short note.";
    expect(chunkCommentBody(body, 1000)).toEqual([body]);
  });

  it("splits at paragraph boundaries", () => {
    const para = "lorem ipsum dolor sit amet ".repeat(20).trim();
    const body = `${para}\n\n${para}\n\n${para}`;
    const chunks = chunkCommentBody(body, para.length + 5);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      // no chunk should exceed maxBytes
      expect(Buffer.byteLength(c, "utf8")).toBeLessThanOrEqual(para.length + 5);
    }
    expect(chunks.join("\n\n")).toBe(body);
  });

  it("never splits inside a fenced code block when the block fits in a chunk", () => {
    const fencedCode = ["```ts", "const x = 1;", "const y = 2;", "```"].join("\n");
    const filler = "x".repeat(180);
    const body = `${filler}\n\n${fencedCode}\n\n${filler}\n\n${filler}`;

    const chunks = chunkCommentBody(body, 250);

    for (const c of chunks) {
      const opens = (c.match(/^```/gm) ?? []).length;
      expect(opens % 2).toBe(0);
    }
    expect(chunks.some((c) => c.includes(fencedCode))).toBe(true);
  });

  it("never splits inside a markdown table when the table fits in a chunk", () => {
    const tableLines = [
      "| col1 | col2 | col3 |",
      "|------|------|------|",
      ...Array.from({ length: 4 }, (_, i) => `| a${i} | b${i} | c${i} |`),
    ];
    const table = tableLines.join("\n");
    const filler = "x".repeat(200);
    const body = `${filler}\n\n${table}\n\n${filler}\n\n${filler}`;

    const chunks = chunkCommentBody(body, 250);

    expect(chunks.some((c) => c.includes(table))).toBe(true);
  });

  it("last-resort splits a single oversized fenced block but keeps fences balanced", () => {
    const lines = ["```python", ...Array.from({ length: 200 }, (_, i) => `def f${i}(): return ${i}`), "```"];
    const body = lines.join("\n");

    const chunks = chunkCommentBody(body, 400);

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      const fences = (c.match(/^```/gm) ?? []).length;
      expect(fences % 2).toBe(0);
      // Each interior chunk should both open and close a fence
      expect(fences).toBeGreaterThanOrEqual(2);
    }
    // First chunk should open with python fence
    expect(chunks[0].startsWith("```python")).toBe(true);
    // Last chunk should end with closing fence
    expect(chunks[chunks.length - 1].trimEnd().endsWith("```")).toBe(true);
  });

  it("handles a 50KB body with mixed content (tables, fences, paragraphs)", () => {
    const para = "This is a paragraph of moderate length used to fill up the body. ".repeat(8);
    const fence = ["```js", "function hello() {", "  return 'world';", "}", "```"].join("\n");
    const table = ["| a | b |", "|---|---|", "| 1 | 2 |", "| 3 | 4 |"].join("\n");
    const block = `${para}\n\n${fence}\n\n${table}\n\n`;
    let body = "";
    while (Buffer.byteLength(body, "utf8") < 50_000) body += block;

    const chunks = chunkCommentBody(body, DEFAULT_MAX_COMMENT_BYTES);

    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(Buffer.byteLength(c, "utf8")).toBeLessThanOrEqual(DEFAULT_MAX_COMMENT_BYTES);
      const fences = (c.match(/^```/gm) ?? []).length;
      expect(fences % 2).toBe(0);
    }
  });
});

describe("splitIntoBlocks", () => {
  it("preserves a fenced block as one block even with internal blank lines", () => {
    const body = "intro\n\n```ts\nconst x = 1;\n\nconst y = 2;\n```\n\nouter";
    const blocks = splitIntoBlocks(body);
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toBe("```ts\nconst x = 1;\n\nconst y = 2;\n```");
  });

  it("treats a markdown table as one block", () => {
    const body = "| h1 | h2 |\n|----|----|\n| a  | b  |\n| c  | d  |";
    const blocks = splitIntoBlocks(body);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toBe(body);
  });
});

describe("captionChunks", () => {
  it("does not caption a single chunk", () => {
    expect(captionChunks(["hello"])).toEqual(["hello"]);
  });

  it("captions multiple chunks with `**Part i of N**\\n\\n`", () => {
    const captioned = captionChunks(["a", "b", "c"]);
    expect(captioned[0]).toBe("**Part 1 of 3**\n\na");
    expect(captioned[1]).toBe("**Part 2 of 3**\n\nb");
    expect(captioned[2]).toBe("**Part 3 of 3**\n\nc");
  });
});

describe("addComment chunking integration", () => {
  beforeEach(() => {
    mockedGraphQL.mockReset();
  });

  it("posts a single comment when body is short", async () => {
    mockedGraphQL.mockResolvedValue({
      commentCreate: {
        success: true,
        comment: { id: "c-1", body: "Hi", createdAt: "2026-04-26T12:00:00Z", url: "https://linear.app/test/AI-1#c-1" },
      },
    });
    const result = await addComment("issue-1", "Hi");
    expect(result.commentId).toBe("c-1");
    expect(result.chunkCount).toBeUndefined();
    expect(mockedGraphQL).toHaveBeenCalledTimes(1);
  });

  it("posts multiple comments and adds Part captions when body exceeds maxBytes", async () => {
    let n = 0;
    mockedGraphQL.mockImplementation(async (_q: string, vars?: Record<string, unknown>) => {
      n++;
      return {
        commentCreate: {
          success: true,
          comment: {
            id: `c-${n}`,
            body: String((vars ?? {}).body ?? ""),
            createdAt: `2026-04-26T12:00:0${n}Z`,
            url: `https://linear.app/test/AI-1#c-${n}`,
          },
        },
      };
    });
    const big = ("paragraph one. ".repeat(40) + "\n\n").repeat(20);
    const result = await addComment("issue-1", big, { maxBytes: 1000 });

    expect(result.chunkCount).toBeGreaterThan(1);
    expect(result.commentId).toBe("c-1");

    const bodies = mockedGraphQL.mock.calls.map((call) => (call[1] as { body?: string }).body ?? "");
    expect(bodies[0]).toMatch(/^\*\*Part 1 of \d+\*\*\n\n/);
    expect(bodies[1]).toMatch(/^\*\*Part 2 of \d+\*\*\n\n/);
    expect(mockedGraphQL.mock.calls.length).toBe(result.chunkCount);
  });

  it("does not chunk when noSplit is true (lets API errors propagate)", async () => {
    mockedGraphQL.mockResolvedValue({
      commentCreate: {
        success: true,
        comment: { id: "c-only", body: "x", createdAt: "2026-04-26T12:00:00Z", url: "https://linear.app/test/AI-1#c-only" },
      },
    });
    const big = "x".repeat(70_000);
    await addComment("issue-1", big, { noSplit: true });

    expect(mockedGraphQL).toHaveBeenCalledTimes(1);
    const body = (mockedGraphQL.mock.calls[0][1] as { body?: string }).body ?? "";
    // Body should NOT be captioned and should equal the full input (no chunking)
    expect(body.startsWith("**Part")).toBe(false);
    expect(body.length).toBe(70_000);
  });
});
