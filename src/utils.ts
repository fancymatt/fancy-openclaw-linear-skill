/**
 * General utility functions for the Linear CLI.
 */

/**
 * Returns a human-readable relative time string for a given ISO timestamp.
 * Examples: "just now", "5m ago", "3h ago", "2d ago"
 */
export function relativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (diffMs < 0) {
    return "just now";
  }

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

/**
 * Wraps text to a given column width, preserving existing newlines.
 */
export function wrapText(text: string, width: number = 72): string {
  return text
    .split("\n")
    .map((line) => {
      if (line.length <= width) return line;
      const words = line.split(" ");
      const result: string[] = [];
      let current = "";
      for (const word of words) {
        if (current && current.length + 1 + word.length > width) {
          result.push(current);
          current = word;
        } else {
          current = current ? `${current} ${word}` : word;
        }
      }
      if (current) result.push(current);
      return result.join("\n");
    })
    .join("\n");
}

/**
 * Normalize issue descriptions passed through CLI flags.
 *
 * Shells do not turn "\\n" inside normal quoted arguments into real newlines,
 * which can collapse Markdown descriptions into a single heading in Linear.
 * Convert common escaped newline sequences here so `--description` remains safe,
 * while `--description-file` can preserve Markdown exactly.
 */
export function normalizeCliDescription(description: string): string {
  return description.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
}
