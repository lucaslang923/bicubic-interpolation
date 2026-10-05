# bicubic-interpolation

A small, zero-dependency JavaScript (ESM) library for bicubic convolution
interpolation on a regular 2D grid with configurable boundary handling.

## Usage

```js
import { createBicubicInterpolator, BOUNDARY } from 'bicubic-interpolation';

const grid = [
  [0, 1, 4],
  [1, 2, 5],
  [4, 5, 8],
];

const interp = createBicubicInterpolator(grid, { boundary: BOUNDARY.clamp });
interp.sample(1.5, 0.5); // interpolated value at column 1.5, row 0.5
```

## Exports

- `createBicubicInterpolator(grid, options?)` — returns `{ sample(x, y) }`.
  `grid` is `grid[row][col]`. `x` is the column coordinate, `y` is the row
  coordinate, both in grid-index space.
- `BOUNDARY` — frozen object with `clamp`, `wrap`, and `mirror` strategies.
  Each is a function `(index, length) => clampedIndex`. Pass one as
  `options.boundary`, or pass your own function with the same signature.

## Why this exists

When you have values on a regular grid and need a smooth interpolated surface
— smoother than bilinear gives — bicubic convolution is the standard choice.
The trade-off versus bilinear is cost (16 samples vs 4) and the possibility of
overshoot: the cubic kernel can produce values outside the range of the four
nearest grid points. If you need strict range preservation, use bilinear
instead.

The kernel is Keys' cubic with a = −0.5, the de facto default in image
processing. It is C1-continuous and exact for linear functions in the grid
interior under clamp boundary handling.

## Edge cases you will hit

- **Overshoot.** Near sharp transitions the interpolated value can exceed the
  range of the neighbouring grid values. This is inherent to cubic convolution,
  not a bug.
- **Boundary behaviour changes results near edges.** The four sample positions
  used around a point near the edge include indices outside `[0, n-1]`; the
  chosen strategy determines those values. `clamp` (the default) gives flat
  extrapolation, `mirror` gives zero-slope edges, `wrap` assumes periodicity.
- **Non-rectangular grids throw.** Every row must have the same length.
- **1×1 grids.** All three boundary strategies collapse to returning the single
  value, so every sample returns that value.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

