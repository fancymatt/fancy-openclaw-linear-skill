import fs from "node:fs/promises";
import path from "node:path";

import { putPresignedFile, linearGraphQL } from "./client";
import { addComment } from "./issues";

interface FileUploadResponse {
  fileUpload: {
    success: boolean;
    uploadUrl: string;
    assetUrl: string;
    headers?: Array<{
      key: string;
      value: string;
    }>;
  };
}

function detectContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".md" || extension === ".txt") {
    return "text/plain";
  }
  if (extension === ".json") {
    return "application/json";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".pdf") {
    return "application/pdf";
  }
  return "application/octet-stream";
}

export async function uploadFile(
  filePath: string,
  issueId?: string
): Promise<{ filePath: string; assetUrl: string; issueCommented: boolean }> {
  const content = await fs.readFile(filePath);
  const filename = path.basename(filePath);
  const contentType = detectContentType(filePath);
  const data = await linearGraphQL<FileUploadResponse>(
    `
      mutation FileUpload($contentType: String!, $filename: String!, $size: Int!) {
        fileUpload(contentType: $contentType, filename: $filename, size: $size) {
          success
          uploadUrl
          assetUrl
          headers {
            key
            value
          }
        }
      }
    `,
    {
      contentType,
      filename,
      size: content.byteLength
    }
  );

  if (!data.fileUpload.success || !data.fileUpload.uploadUrl || !data.fileUpload.assetUrl) {
    throw new Error(`Failed to initialize upload for ${filePath}.`);
  }

  await putPresignedFile(
    data.fileUpload.uploadUrl,
    content,
    contentType,
    data.fileUpload.headers
  );

  if (issueId) {
    await addComment(issueId, data.fileUpload.assetUrl);
  }

  return {
    filePath,
    assetUrl: data.fileUpload.assetUrl,
    issueCommented: Boolean(issueId)
  };
}
