/**
 * @ogd/core — public API surface.
 *
 * Pure TypeScript: no DOM, no canvas, no Node-fs, no framework. Runs identically
 * in a browser Web Worker and in Node/Deno (CLI). See docs/03 §0, §2.
 */

export const OGD_CORE_VERSION = '0.0.0';

export * from './model/index.js';
export * from './units.js';
export * from './hash.js';
export * from './parse/index.js';
