import axios from "axios";
import { linearGraphQL, LinearApiError, GraphQLErrorDetail, enrichMessage } from "../src/client";
import { setDebugMode } from "../src/debug";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

function mockResponse(data: unknown, errors?: unknown[]) {
  return {
    data: { data, errors },
    status: 200,
    statusText: "OK",
    headers: {},
    config: {} as any,
  };
}

beforeEach(() => {
  jest.restoreAllMocks();
  setDebugMode(false);
});

describe("LinearApiError", () => {
  it("stores details array", () => {
    const details: GraphQLErrorDetail[] = [
      { message: "Argument Validation Error", path: ["commentCreate", "input", "body"] },
    ];
    const err = new LinearApiError("test", "GRAPHQL_ERROR", details);
    expect(err.details).toEqual(details);
    expect(err.code).toBe("GRAPHQL_ERROR");
  });
});

describe("enrichMessage (via linearGraphQL)", () => {
  it("includes field path when present", async () => {
    mockedAxios.post.mockResolvedValueOnce(
      mockResponse(null, [{ message: "Argument Validation Error", path: ["commentCreate", "input", "body"] }])
    );

    await expect(linearGraphQL("q", {})).rejects.toThrow("field: commentCreate.input.body");
  });

  it("hints on self-reference errors", async () => {
    mockedAxios.post.mockResolvedValueOnce(
      mockResponse(null, [{ message: "Comment body cannot self-reference its own issue", path: ["commentCreate"] }])
    );

    await expect(linearGraphQL("q", {})).rejects.toThrow("bare issue identifier");
  });

  it("hints on comment too long errors", async () => {
    mockedAxios.post.mockResolvedValueOnce(
      mockResponse(null, [{ message: "Comment body is too long", path: ["commentCreate", "input"] }])
    );

    await expect(linearGraphQL("q", {})).rejects.toThrow("maximum length");
  });

  it("hints on team/label mismatch", async () => {
    mockedAxios.post.mockResolvedValueOnce(
      mockResponse(null, [{ message: "Label does not belong to this team" }])
    );

    await expect(linearGraphQL("q", {})).rejects.toThrow("different team");
  });

  it("hints on generic Argument Validation Error", async () => {
    mockedAxios.post.mockResolvedValueOnce(
      mockResponse(null, [{ message: "Argument Validation Error" }])
    );

    await expect(linearGraphQL("q", {})).rejects.toThrow("Re-run with --debug");
  });

  it("no hint for unrecognized non-validation errors", async () => {
    mockedAxios.post.mockResolvedValueOnce(
      mockResponse(null, [{ message: "Something completely different went wrong" }])
    );

    await expect(linearGraphQL("q", {})).rejects.toThrow("Something completely different went wrong");
    await expect(linearGraphQL("q", {})).rejects.not.toThrow("hint:");
  });

  it("handles multiple errors", async () => {
    mockedAxios.post.mockResolvedValueOnce(
      mockResponse(null, [
        { message: "First error", path: ["a"] },
        { message: "Second error" },
      ])
    );

    await expect(linearGraphQL("q", {})).rejects.toThrow("First error");
    await expect(linearGraphQL("q", {})).rejects.toThrow("Second error");
  });
});

describe("debug mode", () => {
  it("does not dump raw errors when debug is off", async () => {
    const spy = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockedAxios.post.mockResolvedValueOnce(
      mockResponse(null, [{ message: "Argument Validation Error", path: ["x"] }])
    );

    try { await linearGraphQL("q", {}); } catch {}
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining("[DEBUG]"));
    spy.mockRestore();
  });

  it("dumps raw errors to stderr when debug is on", async () => {
    setDebugMode(true);
    const spy = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockedAxios.post.mockResolvedValueOnce(
      mockResponse(null, [{ message: "Argument Validation Error", path: ["x"] }])
    );

    try { await linearGraphQL("q", {}); } catch {}
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[DEBUG]"));
    spy.mockRestore();
  });
});
