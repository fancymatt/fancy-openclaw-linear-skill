import axios from "axios";

import { ensureApiKey } from "./auth";

const LINEAR_API_URL = "https://api.linear.app/graphql";

interface LinearGraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export class LinearApiError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "LinearApiError";
    this.code = code;
  }
}

export async function linearGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const apiKey = ensureApiKey();
  let response;
  try {
    response = await axios.post<LinearGraphQLResponse<T>>(
      LINEAR_API_URL,
      { query, variables },
      {
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        const graphqlErrors = error.response.data?.errors?.map((e: {message: string}) => e.message).join("; ");
        if (error.response.status === 401) {
          throw new LinearApiError("Unauthorized", "UNAUTHORIZED");
        }
        throw new LinearApiError(
          graphqlErrors || `Linear API returned HTTP ${error.response.status}: ${error.response.statusText}`,
          `HTTP_${error.response.status}`
        );
      }
      throw new LinearApiError(
        `Network request to Linear API failed: ${error.message}. Check your internet connection and that api.linear.app is reachable.`,
        "NETWORK_ERROR"
      );
    }
    throw error;
  }

  if (response.data.errors?.length) {
    throw new LinearApiError(
      response.data.errors.map((error) => error.message).join("; "),
      "GRAPHQL_ERROR"
    );
  }

  if (!response.data.data) {
    throw new LinearApiError("Linear API returned no data.", "NO_DATA");
  }

  return response.data.data;
}

export async function putPresignedFile(
  url: string,
  content: Buffer,
  contentType: string,
  extraHeaders?: Array<{ key: string; value: string }>
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Length": String(content.byteLength)
  };

  for (const header of extraHeaders ?? []) {
    headers[header.key] = header.value;
  }

  await axios.put(url, content, {
    headers
  });
}
