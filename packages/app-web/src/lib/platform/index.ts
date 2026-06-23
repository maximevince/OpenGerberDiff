/**
 * Platform capability layer. The web app NEVER imports Electron — instead an
 * optional native shell injects `window.nativeAPI` (see packages/app-shell-electron),
 * and we feature-detect it here. On the web these fall back to the standard browser
 * mechanisms (transient <input> for open, anchor download for save). This is the
 * seam Phase 9 plugs into; everything above this file is platform-agnostic.
 */

export interface NativeFile {
  name: string;
  bytes: Uint8Array;
}

export interface NativeAPI {
  /** 'darwin' | 'win32' | 'linux' */
  platform: string;
  /** Native open dialog → chosen files (null if cancelled). */
  openFiles(opts?: { multiple?: boolean; accept?: string[] }): Promise<NativeFile[] | null>;
  /** Native save dialog → true if written, false if cancelled. */
  saveFile(suggestedName: string, bytes: Uint8Array): Promise<boolean>;
  /** Subscribe to application-menu actions (open/save/about/…). */
  onMenu?(cb: (action: string) => void): void;
}

declare global {
  interface Window {
    nativeAPI?: NativeAPI;
  }
}

export function native(): NativeAPI | undefined {
  return typeof window !== 'undefined' ? window.nativeAPI : undefined;
}

export function isElectron(): boolean {
  return !!native();
}

/** Open files via the native dialog (Electron) or a transient <input> (web). */
export async function pickFiles(
  opts: { multiple?: boolean; accept?: string[] } = {},
): Promise<File[]> {
  const api = native();
  if (api) {
    const res = await api.openFiles(opts);
    return (res ?? []).map((f) => new File([f.bytes as BlobPart], f.name));
  }
  return webPick(opts.multiple ?? true, opts.accept);
}

function webPick(multiple: boolean, accept?: string[]): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    if (accept?.length) input.accept = accept.join(',');
    input.style.display = 'none';
    input.onchange = () => {
      resolve(Array.from(input.files ?? []));
      input.remove();
    };
    // If the dialog is cancelled there's no event; the input is simply GC'd.
    document.body.appendChild(input);
    input.click();
  });
}

/** Save bytes via the native dialog (Electron) or an anchor download (web). */
export async function saveBytes(name: string, bytes: Uint8Array): Promise<boolean> {
  const api = native();
  if (api) return api.saveFile(name, bytes);
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

/** Run `cb` for each native menu action; no-op on the web. Returns an unsubscriber-ish noop. */
export function onMenuAction(cb: (action: string) => void): void {
  native()?.onMenu?.(cb);
}
