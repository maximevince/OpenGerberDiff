import type { SourceFormat } from '../model/index.js';

const DRILL_EXTENSIONS = new Set(['drl', 'xln', 'exc', 'ncd', 'tap', 'drd', 'nc', 'txt']);

/**
 * Best-effort Gerber-vs-Excellon detection by extension, falling back to content
 * sniffing (`M48` header is Excellon). Mirrors the original tool's heuristic.
 */
export function detectFormat(fileName: string, content: string): SourceFormat {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (DRILL_EXTENSIONS.has(ext)) return 'drill';
  if (/^\s*M48\b/m.test(content.slice(0, 2000))) return 'drill';
  return 'gerber';
}
