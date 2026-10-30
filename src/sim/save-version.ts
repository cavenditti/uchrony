/** One world schema covers simulation records and configuration together.
 * Reject retired saves before expanding compressed data or initializing state. */
export const WORLD_VERSION = 2

/** Storage can distinguish an obsolete save from transient I/O or damaged bytes. */
export class UnsupportedSaveError extends Error {
  constructor(
    message = `Invalid world save: unsupported version; this app supports version ${WORLD_VERSION}. Create a new world; older saves are not supported.`,
  ) {
    super(message)
    this.name = 'UnsupportedSaveError'
  }
}

/** Current saves are deliberately not migrated; a new world uses current rules. */
export function assertWorldVersion(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid world save: expected an object')
  if ((value as { version?: unknown }).version !== WORLD_VERSION) throw new UnsupportedSaveError()
}
