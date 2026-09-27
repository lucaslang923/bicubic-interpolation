import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createBicubicInterpolator, BOUNDARY } from '../src/index.js';

/**
 * Helper: compare floats with a tolerance. Using a relative+absolute tolerance
 * keeps the tests robust across platforms without hiding real regressions.
 */
function approxEqual(a, b, eps = 1e-9) {
  const diff = Math.abs(a - b);
  if (diff <= eps) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return diff <= eps * scale;
}

describe('createBicubicInterpolator', () => {
  describe('input validation', () => {
    test('throws on empty grid', () => {
      assert.throws(() => createBicubicInterpolator([]), /non-empty/);
    });

    test('throws on non-rectangular grid', () => {
      assert.throws(
        () => createBicubicInterpolator([[1, 2, 3], [4, 5]]),
        /rectangular/,
      );
    });

    test('throws when boundary is not a function', () => {
      assert.throws(
        () => createBicubicInterpolator([[1]], { boundary: 'clamp' }),
        /function/,
      );
    });
  });

  describe('exact grid points', () => {
    test('returns exact values at integer coordinates', () => {
      const grid = [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ];
      const interp = createBicubicInterpolator(grid);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          assert.ok(
            approxEqual(interp.sample(c, r), grid[r][c]),
            `exact at (${c}, ${r})`,
          );
        }
      }
    });
  });

  describe('constant field', () => {
    test('returns the constant everywhere for a uniform grid', () => {
      const grid = [
        [7, 7, 7, 7],
        [7, 7, 7, 7],
        [7, 7, 7, 7],
        [7, 7, 7, 7],
      ];
      const interp = createBicubicInterpolator(grid);
      // Interior and near-boundary points.
      const points = [
        [0.5, 0.5], [1.5, 2.5], [0.1, 3.2], [3.9, 0.1], [2.0, 2.0],
      ];
      for (const [x, y] of points) {
        assert.ok(approxEqual(interp.sample(x, y), 7), `constant at (${x}, ${y})`);
      }
    });
  });

  describe('linear field', () => {
    // For a linear function f(x,y) = a*x + b*y + c, bicubic convolution is
    // exact in the interior (where all four sample positions on each axis
    // fall within the grid). Under clamp boundary, sample duplication near
    // edges breaks exactness, so only interior points are tested here.
    test('reproduces a linear function exactly in the interior under clamp', () => {
      const a = 3, b = -2, c = 5;
      const cols = 5, rows = 4;
      const grid = Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, q) => a * q + b * r + c));
      const interp = createBicubicInterpolator(grid, { boundary: BOUNDARY.clamp });
      // Interior points: ix in [1, cols-3] and iy in [1, rows-3] so that all
      // four sample offsets (-1, 0, +1, +2) stay within the grid.
      const points = [
        [1.5, 1.5], [2.5, 1.5], [1.5, 2.0], [2.0, 2.0], [1.3, 1.7],
      ];
      for (const [x, y] of points) {
        const expected = a * x + b * y + c;
        assert.ok(
          approxEqual(interp.sample(x, y), expected, 1e-6),
          `linear at (${x}, ${y}): got ${interp.sample(x, y)}, expected ${expected}`,
        );
      }
    });
  });

  describe('boundary handling', () => {
    test('clamp produces flat extrapolation outside the grid', () => {
      // 1×1 grid: every sample should equal the single value.
      const interp = createBicubicInterpolator([[42]], { boundary: BOUNDARY.clamp });
      assert.ok(approxEqual(interp.sample(0, 0), 42));
      assert.ok(approxEqual(interp.sample(-1, -1), 42));
      assert.ok(approxEqual(interp.sample(5, 5), 42));
    });

    test('wrap treats the grid as one full period', () => {
      // A 1×4 grid that is constant: wrapping should still return the constant.
      const grid = [[10, 10, 10, 10]];
      const interp = createBicubicInterpolator(grid, { boundary: BOUNDARY.wrap });
      assert.ok(approxEqual(interp.sample(3.5, 0), 10));
      assert.ok(approxEqual(interp.sample(-0.5, 0), 10));
    });

    test('mirror reflects about the boundary', () => {
      // Linear ramp with mirror should reproduce the ramp inside and mirror
      // it outside, staying continuous. Test interior exactness.
      const grid = [[0, 1, 2, 3, 4]];
      const interp = createBicubicInterpolator(grid, { boundary: BOUNDARY.mirror });
      for (let i = 0; i < 5; i++) {
        assert.ok(approxEqual(interp.sample(i, 0), i), `mirror exact at ${i}`);
      }
    });
  });

  describe('separability', () => {
    test('interpolation is symmetric in x and y for a symmetric grid', () => {
      // A grid symmetric under transpose should give sample(x,y) == sample(y,x).
      const grid = [
        [1, 2, 3],
        [2, 4, 6],
        [3, 6, 9],
      ];
      const interp = createBicubicInterpolator(grid);
      const points = [
        [0.5, 0.5], [1.5, 0.5], [0.5, 1.5], [1.3, 2.1], [2.7, 0.3],
      ];
      for (const [x, y] of points) {
        assert.ok(
          approxEqual(interp.sample(x, y), interp.sample(y, x)),
          `symmetric at (${x}, ${y})`,
        );
      }
    });
  });

  describe('quadratic field', () => {
    test('interpolates a quadratic smoothly between grid points', () => {
      // f(x,y) = x^2. Bicubic is not exact for quadratics under Keys' kernel,
      // but the result should be smooth and bounded by the neighbouring values.
      const cols = 6;
      const grid = Array.from({ length: 1 }, () =>
        Array.from({ length: cols }, (_, i) => i * i));
      const interp = createBicubicInterpolator(grid);
      // At x=0.5 between f(0)=0 and f(1)=1, result should be between 0 and 1.
      const v = interp.sample(0.5, 0);
      assert.ok(v > 0 && v < 1, `quadratic midpoint in range: ${v}`);
    });
  });
});
