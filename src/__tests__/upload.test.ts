import fs from "node:fs/promises";
import path from "node:path";

import { linearGraphQL, putPresignedFile } from "../client";
import { addComment } from "../issues";
import { uploadFile } from "../upload";

jest.mock("../client", () => ({
  ...jest.requireActual("../client"),
  linearGraphQL: jest.fn(),
  putPresignedFile: jest.fn()
}));

jest.mock("../issues", () => ({
  addComment: jest.fn()
}));

const mockedGraphQL = linearGraphQL as jest.MockedFunction<typeof linearGraphQL>;
const mockPutPresignedFile = putPresignedFile as jest.MockedFunction<typeof putPresignedFile>;
const mockAddComment = addComment as jest.MockedFunction<typeof addComment>;

describe("uploadFile", () => {
  beforeEach(() => {
    mockedGraphQL.mockReset();
    mockPutPresignedFile.mockReset();
    mockAddComment.mockReset();
  });

  it("uploads file and returns asset URL", async () => {
    jest.spyOn(fs, "readFile").mockResolvedValueOnce(Buffer.from("test content"));
    mockedGraphQL.mockResolvedValue({
      fileUpload: {
        success: true,
        uploadUrl: "https://presigned-url.example.com/upload",
        assetUrl: "https://assets.linear.app/test.txt",
        headers: [{ key: "x-amz-tag", value: "test" }]
      }
    });

    const result = await uploadFile("/path/to/test.txt");
    expect(result.filePath).toBe("/path/to/test.txt");
    expect(result.assetUrl).toBe("https://assets.linear.app/test.txt");
    expect(result.issueCommented).toBe(false);
    expect(mockPutPresignedFile).toHaveBeenCalledWith(
      "https://presigned-url.example.com/upload",
      expect.any(Buffer),
      "text/plain",
      [{ key: "x-amz-tag", value: "test" }]
    );
  });

  it("detects content type by extension", async () => {
    jest.spyOn(fs, "readFile").mockResolvedValueOnce(Buffer.from("png-data"));
    mockedGraphQL.mockResolvedValue({
      fileUpload: { success: true, uploadUrl: "https://url", assetUrl: "https://asset", headers: [] }
    });

    await uploadFile("/path/to/image.png");
    expect(mockedGraphQL).toHaveBeenCalledWith(
      expect.stringContaining("fileUpload"),
      expect.objectContaining({ contentType: "image/png", filename: "image.png" })
    );
  });

  it("posts comment with asset URL when issueId provided", async () => {
    jest.spyOn(fs, "readFile").mockResolvedValueOnce(Buffer.from("data"));
    mockedGraphQL.mockResolvedValue({
      fileUpload: { success: true, uploadUrl: "https://url", assetUrl: "https://asset/file.md", headers: [] }
    });
    mockAddComment.mockResolvedValue({ issueId: "AI-100", body: "https://asset/file.md" });

    const result = await uploadFile("/path/to/file.md", "AI-100");
    expect(result.issueCommented).toBe(true);
    expect(mockAddComment).toHaveBeenCalledWith("AI-100", "https://asset/file.md");
  });

  it("throws when upload initialization fails", async () => {
    jest.spyOn(fs, "readFile").mockResolvedValueOnce(Buffer.from("data"));
    mockedGraphQL.mockResolvedValue({
      fileUpload: { success: false, uploadUrl: null, assetUrl: null, headers: [] }
    });
    await expect(uploadFile("/path/to/fail.txt")).rejects.toThrow("Failed to initialize upload");
  });
});
