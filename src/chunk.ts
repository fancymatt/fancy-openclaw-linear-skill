// Linear's GraphQL API rejects comment bodies above ~65535 characters.
// Default below that to leave headroom for caption prefixes and any
// UTF-8 multi-byte expansion when the API counts bytes vs. chars.
export const DEFAULT_MAX_COMMENT_BYTES = 60_000;

const FENCE_RE = /^(\s{0,3})(```+|~~~+)(.*)$/;

interface FenceState {
  open: boolean;
  marker: string;
  lang: string;
}

function detectFence(line: string, state: FenceState): FenceState {
  const m = FENCE_RE.exec(line);
  if (!m) return state;
  const marker = m[2];
  if (!state.open) {
    return { open: true, marker, lang: m[3].trim() };
  }
  // Closing requires same fence char and >= length
  if (marker[0] === state.marker[0] && marker.length >= state.marker.length && m[3].trim() === "") {
    return { open: false, marker: "", lang: "" };
  }
  return state;
}

/**
 * Split a markdown body into atomic blocks separated by blank lines.
 * Fenced code blocks and tables are kept whole even if they contain
 * (or are followed by) blank lines that would otherwise split them.
 */
export function splitIntoBlocks(body: string): string[] {
  const lines = body.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: FenceState = { open: false, marker: "", lang: "" };

  const flush = () => {
    if (current.length === 0) return;
    // Trim trailing blank lines that accumulated with the block
    while (current.length > 0 && current[current.length - 1].trim() === "") current.pop();
    if (current.length > 0) blocks.push(current.join("\n"));
    current = [];
  };

  for (const line of lines) {
    if (fence.open) {
      current.push(line);
      fence = detectFence(line, fence);
      continue;
    }
    const fm = FENCE_RE.exec(line);
    if (fm) {
      // Opening a fence: starts a new block if anything was pending
      if (current.length > 0 && current[current.length - 1].trim() === "") flush();
      current.push(line);
      fence = detectFence(line, fence);
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

/**
 * Last-resort line-level split for a single block that exceeds maxBytes.
 * Preserves fence balance: if the split point lies inside an open fence,
 * close it on the outgoing chunk and reopen with the same language on
 * the next chunk.
 */
function splitBlockByLines(block: string, maxBytes: number): string[] {
  const lines = block.split("\n");
  const result: string[] = [];
  let current: string[] = [];
  let fence: FenceState = { open: false, marker: "", lang: "" };

  const currentBytes = () => Buffer.byteLength(current.join("\n"), "utf8");

  for (const line of lines) {
    const probe = current.length === 0 ? line : current.join("\n") + "\n" + line;
    if (Buffer.byteLength(probe, "utf8") <= maxBytes || current.length === 0) {
      current.push(line);
      fence = detectFence(line, fence);
      continue;
    }
    // Need to flush before adding line
    let chunkText = current.join("\n");
    let reopenLine: string | null = null;
    if (fence.open) {
      chunkText = chunkText + "\n" + fence.marker;
      reopenLine = fence.marker + (fence.lang ? fence.lang : "");
    }
    result.push(chunkText);
    current = [];
    if (reopenLine !== null) current.push(reopenLine);
    current.push(line);
    fence = detectFence(line, fence);
  }
  if (current.length > 0) result.push(current.join("\n"));
  return result;
}

/**
 * Chunk a markdown comment body so each chunk fits within maxBytes.
 * Splits at paragraph (blank-line) boundaries, never inside a fenced
 * code block or table. Falls back to line-level splitting only when a
 * single block is itself larger than maxBytes.
 */
export function chunkCommentBody(body: string, maxBytes: number = DEFAULT_MAX_COMMENT_BYTES): string[] {
  if (Buffer.byteLength(body, "utf8") <= maxBytes) return [body];
  const blocks = splitIntoBlocks(body);
  const chunks: string[] = [];
  let current = "";

  for (const block of blocks) {
    const candidate = current.length === 0 ? block : current + "\n\n" + block;
    if (Buffer.byteLength(candidate, "utf8") <= maxBytes) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }
    if (Buffer.byteLength(block, "utf8") <= maxBytes) {
      current = block;
      continue;
    }
    const sub = splitBlockByLines(block, maxBytes);
    for (let i = 0; i < sub.length - 1; i++) chunks.push(sub[i]);
    current = sub[sub.length - 1];
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Apply `**Part i of N**\n\n` captions when N > 1; return chunks
 * unchanged when there's only one.
 */
export function captionChunks(chunks: string[]): string[] {
  if (chunks.length <= 1) return chunks;
  return chunks.map((c, i) => `**Part ${i + 1} of ${chunks.length}**\n\n${c}`);
}
