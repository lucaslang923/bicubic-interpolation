/**
 * Boundary-handling strategies for grid indices that fall outside [0, n-1].
 *
 * Each strategy is a pure function (index, length) => clampedIndex, so they can
 * be composed and tested in isolation. The reason for exposing them as named
 * constants (rather than accepting arbitrary functions from the caller) is that
 * it keeps the public surface small and makes the set of supported behaviours
 * explicit — callers cannot accidentally pass a function with subtly wrong
 * semantics.
 */
export const BOUNDARY = Object.freeze({
  /**
   * Indices are clamped to the valid range. This produces flat extrapolation
   * outside the grid, which is smooth up to the first derivative but constant
   * beyond the boundary. A good default when the grid is known to cover the
   * full domain of interest.
   */
  clamp: (i, n) => {
    if (i < 0) return 0;
    if (i >= n) return n - 1;
    return i;
  },

  /**
   * Indices wrap modulo the grid length. Useful for periodic data such as
   * angular coordinates. The grid is assumed to represent one full period, so
   * the value at index n is identical to the value at index 0.
   */
  wrap: (i, n) => {
    const m = i % n;
    return m < 0 ? m + n : m;
  },

  /**
   * Indices are mirrored about the boundary. Index -1 maps to 0, -2 to 1, n
   * maps to n-2, n+1 to n-3, etc. This gives a continuous derivative of zero at
   * the edge, which avoids the sharp slope discontinuity that clamp produces.
   */
  mirror: (i, n) => {
    if (n === 1) return 0;
    const period = 2 * (n - 1);
    let m = i % period;
    if (m < 0) m += period;
    if (m >= n) m = period - m;
    return m;
  },
});

/**
 * Cubic convolution kernel (Keys' a = -0.5). This is the standard bicubic
 * kernel used by image-processing libraries. The value is 1 at 0, 0 at |t| >= 2,
 * and C1-continuous everywhere.
 *
 * We use the piecewise form rather than a single polynomial because it avoids
 * branching inside the hot loop: the caller sums four weighted samples and the
 * branch is implicit in which sample is which.
 */
function cubicWeight(t) {
  const at = Math.abs(t);
  if (at < 1) {
    return 1.5 * at * at * at - 2.5 * at * at + 1;
  }
  if (at < 2) {
    return -0.5 * at * at * at + 2.5 * at * at - 4 * at + 2;
  }
  return 0;
}

/**
 * Build a bicubic interpolator over a regular 2D grid.
 *
 * @param {number[][]} grid - 2D array grid[row][col]. Must be non-empty and
 *   rectangular (every row the same length). Values are treated as numbers.
 * @param {object} [options]
 * @param {(index: number, length: number) => number} [options.boundary=BOUNDARY.clamp]
 *   How to handle sample indices outside [0, length-1]. Pass one of the
 *   BOUNDARY strategies or a custom function with the same signature.
 * @returns {{ sample: (x: number, y: number) => number }} An object with a
 *   `sample(x, y)` method. x is the column coordinate, y is the row coordinate,
 *   both in grid-index space (integer values land exactly on grid nodes).
 */
export function createBicubicInterpolator(grid, options = {}) {
  if (!Array.isArray(grid) || grid.length === 0) {
    throw new TypeError('grid must be a non-empty 2D array');
  }
  const cols = grid[0].length;
  if (cols === 0) {
    throw new TypeError('grid rows must be non-empty');
  }
  for (let r = 0; r < grid.length; r++) {
    if (!Array.isArray(grid[r]) || grid[r].length !== cols) {
      throw new TypeError('grid must be rectangular');
    }
  }

  const boundary = options.boundary || BOUNDARY.clamp;
  if (typeof boundary !== 'function') {
    throw new TypeError('boundary must be a function');
  }

  const rows = grid.length;

  /**
   * Fetch a grid value with boundary handling applied to both indices.
   * Inlined conceptually; kept as a closure to avoid re-passing grid/boundary.
   */
  function get(ri, ci) {
    const r = boundary(ri, rows);
    const c = boundary(ci, cols);
    return grid[r][c];
  }

  return {
    /**
     * Sample the interpolated surface at (x, y).
     *
     * The algorithm performs two 1D cubic convolutions: first along rows for
     * each of the four relevant column positions, then along columns across
     * those four intermediate results. This is mathematically identical to a
     * full 4×4 tensor convolution but does 8 weight multiplies instead of 16.
     */
    sample(x, y) {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;

      // Offsets relative to the cell containing (x, y): -1, 0, +1, +2.
      const offsets = [-1, 0, 1, 2];

      // Cubic weights for the four sample positions along each axis.
      const wx = offsets.map((o) => cubicWeight(fx - o));
      const wy = offsets.map((o) => cubicWeight(fy - o));

      // First pass: for each of the four column offsets, convolve along rows.
      const rowResults = offsets.map((dc) => {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += wy[k] * get(iy + offsets[k], ix + dc);
        }
        return sum;
      });

      // Second pass: convolve the four row results along columns.
      let result = 0;
      for (let k = 0; k < 4; k++) {
        result += wx[k] * rowResults[k];
      }
      return result;
    },
  };
}
