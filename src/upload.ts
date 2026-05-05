import fs from "node:fs/promises";
import path from "node:path";

import { putPresignedFile, linearGraphQL } from "./client";
import { addComment } from "./issues";

interface ImageCommentCreateResponse {
  commentCreate: { success: boolean; comment: { id: string } | null };
}

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

// Posts an image as an embedded Prosemirror image node so it renders inline in
// Linear rather than as a bare URL. Falls back to Markdown ![alt](url) if the
// API rejects the bodyData (e.g. schema mismatch).
async function postImageComment(issueId: string, assetUrl: string, filename: string): Promise<void> {
  try {
    const bodyData = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: assetUrl, alt: filename, title: null }
        }
      ]
    };
    const data = await linearGraphQL<ImageCommentCreateResponse>(
      `mutation AddImageComment($issueId: String!, $bodyData: JSON!) {
        commentCreate(input: { issueId: $issueId, bodyData: $bodyData }) {
          success
          comment { id }
        }
      }`,
      { issueId, bodyData: JSON.stringify(bodyData) }
    );
    if (data.commentCreate.success) return;
  } catch {
    // fall through
  }
  await addComment(issueId, `![${filename}](${assetUrl})`);
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
    if (contentType.startsWith("image/")) {
      await postImageComment(issueId, upload.assetUrl, filename);
    } else {
      await addComment(issueId, upload.assetUrl);
    }
  }

  return {
    filePath,
    assetUrl: upload.assetUrl,
    issueCommented: Boolean(issueId)
  };
}
