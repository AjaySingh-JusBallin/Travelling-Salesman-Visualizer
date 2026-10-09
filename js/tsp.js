/* ============================================================
   tsp.js — Problem / state management for the TSP Visualizer
   ------------------------------------------------------------
   Holds everything about the *problem instance*:
     - cities (labels + normalized positions)
     - the symmetric distance matrix
     - adding / removing / moving cities
     - editing and validating distances
     - deterministic preset instances
   It knows NOTHING about algorithms or rendering.
   ============================================================ */
(function () {
  'use strict';
  const TSP = (window.TSP = window.TSP || {});

  /** Limits that keep the visualization usable. */
  TSP.LIMITS = {
    MIN_CITIES: 2,
    MAX_ANIMATED_CITIES: 11, // animated graph cap
    MAX_BF_CITIES: 10,       // brute force gets silly beyond (n-1)! = 362880
    MAX_EXP_CITIES: 10
  };

  /** Labels: A..Z, then AA, AB, ... */
  function cityLabel(i) {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (i < 26) return letters[i];
    return letters[Math.floor(i / 26) - 1] + letters[i % 26];
  }

  /** Tiny deterministic PRNG (mulberry32) so presets & experiments are reproducible. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  TSP.mulberry32 = mulberry32;

  /** Euclidean distance between two normalized points, scaled for display. */
  function euclidean(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return Math.round(Math.hypot(dx, dy) * 100);
  }
  TSP.euclidean = euclidean;

  /* ---------------- TSPProblem ---------------- */
  class TSPProblem {
    constructor() {
      this.cities = [];   // [{ id, label, x, y }]  x,y in [0,1]
      this.dist = [];     // 2D symmetric matrix, dist[i][i] = 0
      this._nextId = 0;
    }

    get n() { return this.cities.length; }

    /** Add a city at a normalized position (default: pseudo-random but stable). */
    addCity(x, y) {
      if (this.n >= TSP.LIMITS.MAX_ANIMATED_CITIES) {
        throw new Error('City limit reached (' + TSP.LIMITS.MAX_ANIMATED_CITIES + '). Remove a city first.');
      }
      const rand = mulberry32(this._nextId * 7919 + 13);
      const city = {
        id: this._nextId++,
        label: cityLabel(this.cities.length),
        x: x !== undefined ? x : 0.12 + rand() * 0.76,
        y: y !== undefined ? y : 0.12 + rand() * 0.76
      };
      this.cities.push(city);
      // grow the matrix
      for (const row of this.dist) row.push(0);
      this.dist.push(new Array(this.n).fill(0));
      return city;
    }

    removeCity(index) {
      if (index < 0 || index >= this.n) return;
      this.cities.splice(index, 1);
      this.dist.splice(index, 1);
      for (const row of this.dist) row.splice(index, 1);
      // relabel so labels stay A.. in order
      this.cities.forEach((c, i) => { c.label = cityLabel(i); });
    }

    clear() {
      this.cities = [];
      this.dist = [];
      this._nextId = 0;
    }

    /** Symmetric distance set; diagonal forced to 0. */
    setDistance(i, j, v) {
      if (i === j) return;
      const val = Number(v);
      if (!Number.isFinite(val) || val < 0) throw new Error('Distance must be a non-negative finite number.');
      this.dist[i][j] = val;
      this.dist[j][i] = val;
    }

    /** Recalculate every distance from city positions (Euclidean). */
    recalcEuclidean() {
      for (let i = 0; i < this.n; i++) {
        for (let j = i + 1; j < this.n; j++) {
          const a = this.cities[i], b = this.cities[j];
          const d = euclidean(a.x, a.y, b.x, b.y);
          this.dist[i][j] = d;
          this.dist[j][i] = d;
        }
      }
    }

    /** Move a city; returns nothing (caller decides whether to recalc). */
    moveCity(index, x, y) {
      const c = this.cities[index];
      c.x = Math.min(0.97, Math.max(0.03, x));
      c.y = Math.min(0.97, Math.max(0.03, y));
    }

    /** Total cost of a closed tour given as city indices, e.g. [0,2,1,0]. */
    tourCost(path) {
      let cost = 0;
      for (let k = 0; k + 1 < path.length; k++) {
        cost += this.dist[path[k]][path[k + 1]];
      }
      return cost;
    }

    /** Check the instance is sane for TSP. Returns an array of error strings (empty = OK). */
    validate() {
      const errors = [];
      if (this.n < TSP.LIMITS.MIN_CITIES) {
        errors.push('Add at least ' + TSP.LIMITS.MIN_CITIES + ' cities to run an algorithm.');
        return errors;
      }
      for (let i = 0; i < this.n; i++) {
        for (let j = i + 1; j < this.n; j++) {
          const d = this.dist[i][j];
          if (!Number.isFinite(d)) errors.push('Distance ' + this.cities[i].label + '–' + this.cities[j].label + ' is not a number.');
          else if (d < 0) errors.push('Distance ' + this.cities[i].label + '–' + this.cities[j].label + ' is negative.');
        }
      }
      return errors;
    }

    /** Build n random cities with Euclidean distances (deterministic for a given seed). */
    randomize(n, seed) {
      this.clear();
      const rand = mulberry32(seed === undefined ? (Date.now() % 100000) : seed);
      for (let i = 0; i < n; i++) {
        this.addCity(0.10 + rand() * 0.80, 0.10 + rand() * 0.80);
      }
      this.recalcEuclidean();
    }

    /** Load a fixed-coordinate preset; distances computed from geometry (deterministic). */
    loadPreset(name) {
      const PRESETS = {
        preset4: [[0.20, 0.30], [0.80, 0.25], [0.70, 0.78], [0.22, 0.75]],
        preset6: [[0.15, 0.50], [0.32, 0.20], [0.65, 0.18], [0.85, 0.55], [0.60, 0.82], [0.28, 0.80]],
        preset8: [[0.12, 0.30], [0.30, 0.12], [0.58, 0.10], [0.82, 0.28], [0.88, 0.62], [0.66, 0.86], [0.34, 0.85], [0.10, 0.62]],
        symmetric: [[0.50, 0.08], [0.88, 0.38], [0.73, 0.85], [0.27, 0.85], [0.12, 0.38]] // regular pentagon-ish
      };
      this.clear();
      if (name === 'random') { this.randomize(7, 424242); return; }
      const coords = PRESETS[name];
      if (!coords) throw new Error('Unknown preset: ' + name);
      for (const [x, y] of coords) this.addCity(x, y);
      this.recalcEuclidean();
    }
  }

  TSP.TSPProblem = TSPProblem;
})();
