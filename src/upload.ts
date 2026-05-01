import fs from "node:fs/promises";
import path from "node:path";

import { putPresignedFile, linearGraphQL } from "./client";
import { addComment } from "./issues";

interface FileUploadResponse {
  fileUpload: {
    success: boolean;
    uploadFile?: {
      uploadUrl: string;
      assetUrl: string;
      headers?: Array<{
        key: string;
        value: string;
      }>;
    };
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
          uploadFile {
            uploadUrl
            assetUrl
            headers {
              key
              value
            }
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

  const upload = data.fileUpload.uploadFile;
  if (!data.fileUpload.success || !upload?.uploadUrl || !upload?.assetUrl) {
    throw new Error(`Failed to initialize upload for ${filePath}.`);
  }

  await putPresignedFile(
    upload.uploadUrl,
    content,
    contentType,
    upload.headers
  );

  if (issueId) {
    await addComment(issueId, upload.assetUrl);
  }

  return {
    filePath,
    assetUrl: upload.assetUrl,
    issueCommented: Boolean(issueId)
  };
}
