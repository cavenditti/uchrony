/** Structural simulation constants. These define coordinate units, serialized
 * representations, bounded allocations and historical conventions. They are
 * centralized for review but deliberately absent from live calibration: changing
 * them requires a migration or a verified rebuild of dependent state. */
export const CELL_SIZE = 12
export const CELL_METERS = 1024
export const MAX_ARMIES = 16_384
export const MAX_CENSUS_BINS = 2641
export const SEA_LEVEL = 0.095
export const GRID_W = 112
export const GRID_H = 72
export const ADVICE_LENGTH = 1200
export const ADVICE_HISTORY = 12
export const ADVICE_PENDING = 4
export const MOUNTAIN_ELEVATION = 0.43
export const MAX_PROVINCES = 4096
export const MAX_MAP_CELLS = 448 * 288
export const MAX_ENCODED_SAVE_BYTES = 512 * 1024 * 1024 - 1024
export const SOURCE_STRIDE = 6
export const TARGET_STRIDE = 4
export const WALK_MINUTES_PER_METER = 15 / 1000
export const INFLUENCE_RADIUS = 6000
export const INFLUENCE_MINUTES = 60
export const FIRM_SLOTS_PER_REGION = 4
export const FAST_FORWARD_MONTHS = 6
export const MAX_STATE_IDENTITIES = 256
export const LOT_SPAN = 16
export const BUILDING_CAPACITY = 8
export const URBAN_BLOCK_SPAN = 128

// Compatibility value; active enclave policy lives in configuration-defaults.
