/**
 * Test environment setup.
 * Provides a minimal `window` global so plugin code that uses
 * `window.setTimeout` / `window.crypto` works in a Node.js test context.
 */

// In the Obsidian runtime, `window` is the popout-aware global object.
// In Node.js tests, `window` is not defined.  Assign it from `globalThis`
// so that calls like `window.setTimeout(...)` behave identically to the
// built-in Node.js `setTimeout`.
(globalThis as unknown as Record<string, unknown>).window = globalThis;
