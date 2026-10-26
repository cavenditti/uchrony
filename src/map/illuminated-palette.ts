/** Mineral-pigment colors for the illustrated landscape; data-layer colors stay independent. */
export const illuminated = {
  land: {
    dry: [185, 190, 133],
    green: [115, 157, 123],
    forest: [49, 109, 91],
    sand: [222, 188, 139],
    stone: [177, 153, 144],
    snow: [242, 235, 213],
    tundra: [179, 190, 174],
  },
  sea: { deep: [25, 51, 84], shallow: [46, 96, 135], shore: [100, 153, 164] },
  river: '#356d9f',
  bank: '#d8bf85',
  foliage: '#28775d',
  gold: '#c6a354',
  cities: [
    { walls: '#f0dcb5', roof: '#b74732', paving: '#dac398', trim: '#8b7351' },
    { walls: '#e5dfc7', roof: '#b54d40', paving: '#cbbf99', trim: '#6d7770' },
    { walls: '#eed6a8', roof: '#378b91', paving: '#d4b583', trim: '#9d764e' },
    { walls: '#e4c9b0', roof: '#475c87', paving: '#c8b297', trim: '#8b6854' },
  ],
} as const
