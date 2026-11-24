/* Table-driven tests for the pure rules module.
 *
 *   node tests/cube.test.js
 *
 * No framework, no dependencies. Every expected figure below was worked out by
 * hand from the stated rule and is written as the arithmetic it came from, so
 * the table doubles as the specification.
 */
"use strict";

var C = require("../assets/cube.js");

var pass = 0;
var fail = 0;
var failures = [];
var caseCount = 0;

function near(a, b, tol) {
  if (typeof a !== "number" || typeof b !== "number") { return false; }
  if (!isFinite(a) || !isFinite(b)) { return a === b; }
  var t = tol === undefined ? 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) : tol;
  return Math.abs(a - b) <= t;
}

function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  failures.push(label + (detail ? "  — " + detail : ""));
}

function eq(label, actual, expected, tol) {
  if (typeof expected === "number") {
    check(label, near(actual, expected, tol), "got " + actual + ", want " + expected);
  } else {
    check(label, actual === expected, "got " + JSON.stringify(actual) + ", want " + JSON.stringify(expected));
  }
}

/* A calculator that renders NaN or Infinity is worse than no calculator, so
 * every number anywhere in a result is walked. */
function assertAllFinite(label, value, path, seen) {
  path = path || "";
  seen = seen || [];
  if (value === null || value === undefined) { return; }
  if (typeof value === "number") {
    check(label + " / finite:" + path, isFinite(value), "got " + value);
    return;
  }
  if (typeof value !== "object") { return; }
  if (seen.indexOf(value) >= 0) { return; }
  seen.push(value);
  Object.keys(value).forEach(function (k) {
    assertAllFinite(label, value[k], path ? path + "." + k : k, seen);
  });
}

/* ================================================================== *
 * 1. The constants must stay what the page claims they are
 * ================================================================== */

eq("const: courier divisor is 5000 cm3/kg", C.MODE_AIR_COURIER.divisorCm3PerKg, 5000);
eq("const: courier divisor quoted as 139 in3/lb", C.MODE_AIR_COURIER.divisorIn3PerLb, 139);
eq("const: air-freight divisor is 6000 cm3/kg", C.MODE_AIR_FREIGHT.divisorCm3PerKg, 6000);
eq("const: air-freight divisor quoted as 166 in3/lb", C.MODE_AIR_FREIGHT.divisorIn3PerLb, 166);
eq("const: surface divisor is 4000 cm3/kg", C.MODE_SURFACE.divisorCm3PerKg, 4000);
eq("const: sea LCL divisor is 1000 cm3/kg (1 CBM : 1 tonne)", C.MODE_SEA_LCL.divisorCm3PerKg, 1000);
eq("const: sea LCL bills per revenue tonne", C.MODE_SEA_LCL.basis, "revenueTonne");
eq("const: sea LCL minimum is 1 revenue tonne", C.SEA_LCL_MINIMUM_REVENUE_TONNES, 1);
eq("const: default round step is 0.5", C.DEFAULT_ROUND_STEP, 0.5);
eq("const: four modes", C.MODES.length, 4);

C.MODES.forEach(function (m) {
  check("const: " + m.id + " carries a note", typeof m.note === "string" && m.note.length > 40);
  check("const: " + m.id + " divisor is positive", m.divisorCm3PerKg > 0);
  check("const: " + m.id + " has a billing basis",
    m.basis === "weight" || m.basis === "revenueTonne");
});
check("const: the three carrier-set divisors are flagged indicative",
  C.MODE_AIR_COURIER.indicative === true && C.MODE_AIR_FREIGHT.indicative === true &&
  C.MODE_SURFACE.indicative === true);

/* The honesty note is load-bearing: it must keep saying what it says. */
check("const: fit note refuses the word optimum",
  /not a packing solver/i.test(C.FIT_METHOD_NOTE) && /axis-aligned/i.test(C.FIT_METHOD_NOTE));

/* ISO 6780 footprints and the container table. */
eq("const: 1200 x 1000 pallet", C.palletById("p1200x1000").lengthMm, 1200);
eq("const: Euro pallet is 800 mm wide", C.palletById("p1200x800").widthMm, 800);
eq("const: 40' HC internal height 269 cm", C.containerById("c40hc").heightCm, 269);
check("const: every container door is lower than its inside",
  C.CONTAINER_PRESETS.every(function (b) { return b.doorHeightCm < b.heightCm; }));

/* ================================================================== *
 * 2. Unit conversion — cm/inch and kg/lb
 * ================================================================== */

var LENGTH_CASES = [
  { v: 1, unit: "in", cm: 2.54, why: "the international inch, exact" },
  { v: 12, unit: "in", cm: 30.48, why: "a foot" },
  { v: 18.897637795275593, unit: "in", cm: 48, why: "48 cm back in inches" },
  { v: 0, unit: "in", cm: 0, why: "zero stays zero" },
  { v: 48, unit: "cm", cm: 48, why: "metric passes through" },
  { v: "", unit: "cm", cm: 0, why: "blank reads as zero" },
  { v: "nonsense", unit: "cm", cm: 0, why: "unparseable reads as zero" },
  { v: "1,200", unit: "cm", cm: 1200, why: "a pasted thousands separator" },
  { v: -5, unit: "cm", cm: -5, why: "toCm does not clamp; nonNeg does" }
];
LENGTH_CASES.forEach(function (c) {
  caseCount++;
  eq("toCm(" + c.v + " " + c.unit + ") — " + c.why, C.toCm(c.v, c.unit), c.cm, 1e-12);
});

var MASS_CASES = [
  { v: 1, unit: "lb", kg: 0.45359237, why: "the avoirdupois pound, exact" },
  { v: 2.2046226218487757, unit: "lb", kg: 1, why: "a kilo back in pounds" },
  { v: 7.9, unit: "kg", kg: 7.9, why: "metric passes through" },
  { v: "", unit: "lb", kg: 0, why: "blank reads as zero" }
];
MASS_CASES.forEach(function (c) {
  caseCount++;
  eq("toKg(" + c.v + " " + c.unit + ") — " + c.why, C.toKg(c.v, c.unit), c.kg, 1e-9);
});

eq("fromCm round-trips inches", C.fromCm(C.toCm(7.25, "in"), "in"), 7.25, 1e-12);
eq("fromKg round-trips pounds", C.fromKg(C.toKg(3.3, "lb"), "lb"), 3.3, 1e-12);

/* A divisor's own unit depends on BOTH units being imperial. */
eq("divisor unit is in3/lb only when both units are imperial",
  C.divisorIsImperial("in", "lb"), true);
eq("inches with kilos is not an imperial divisor", C.divisorIsImperial("in", "kg"), false);
eq("cm with pounds is not an imperial divisor", C.divisorIsImperial("cm", "lb"), false);

/* The industry figures line up: 139 in3/lb and 5000 cm3/kg are the same rule
 * written twice, and 166 in3/lb is 6000 cm3/kg. */
eq("139 in3/lb is about 5000 cm3/kg",
  C.divisorToCm3PerKg(139, "in", "lb"), 5021.6936, 1e-3);
eq("5000 cm3/kg is about 139 in3/lb",
  C.divisorFromCm3PerKg(5000, "in", "lb"), 138.3995, 1e-3);
eq("166 in3/lb is about 6000 cm3/kg",
  C.divisorToCm3PerKg(166, "in", "lb"), 5997.1305, 1e-3);
eq("a metric divisor is left alone", C.divisorToCm3PerKg(5000, "cm", "kg"), 5000);

/* Where the round 4000 on surface rate cards comes from: 7 kg to the cubic
 * foot is 4045 cm3/kg. */
eq("7 kg per cubic foot is about 4045 cm3/kg", C.CM3_PER_CUBIC_FOOT / 7, 4045.2638, 1e-3);

/* ================================================================== *
 * 3. Helpers: num, nonNeg, howMany, ceilTo
 * ================================================================== */

[[null, 0], [undefined, 0], ["", 0], ["  ", 0], ["abc", 0], ["12.5", 12.5],
 ["-3", -3], [Infinity, 0], [-Infinity, 0], [NaN, 0], [0, 0], [1e5, 100000]
].forEach(function (c) {
  caseCount++;
  eq("num(" + JSON.stringify(c[0]) + ")", C.num(c[0]), c[1]);
});

[[-5, 0], [0, 0], [5, 5], ["", 0], ["-0.1", 0]].forEach(function (c) {
  caseCount++;
  eq("nonNeg(" + JSON.stringify(c[0]) + ")", C.nonNeg(c[0]), c[1]);
});

var HOWMANY_CASES = [
  { space: 47, size: 20, n: 2, why: "two along, 7 cm wasted" },
  { space: 47, size: 6, n: 7, why: "seven along" },
  { space: 30, size: 6, n: 5, why: "exact division" },
  { space: 60.96, size: 30.48, n: 2, why: "24 in into 2 ft — conversion dust must not cost a unit" },
  { space: 10, size: 0, n: 0, why: "a zero-size unit is counted as none, not as infinity" },
  { space: 0, size: 10, n: 0, why: "no space, no units" },
  { space: 5, size: 10, n: 0, why: "too big to fit once" },
  { space: -5, size: 10, n: 0, why: "negative space is none" }
];
HOWMANY_CASES.forEach(function (c) {
  caseCount++;
  eq("howMany(" + c.space + ", " + c.size + ") — " + c.why, C.howMany(c.space, c.size), c.n);
});

var CEIL_CASES = [
  { v: 9.8304, step: 0.5, out: 10, why: "the worked example rounds to 10 kg" },
  { v: 7.9, step: 0.5, out: 8, why: "7.9 kg becomes 8.0" },
  { v: 8, step: 0.5, out: 8, why: "already on the step, do not push it to 8.5" },
  { v: 8.0000000001, step: 0.5, out: 8, why: "float dust must not cost half a kilo" },
  { v: 0.2, step: 1, out: 1, why: "a courier's minimum whole kilo" },
  { v: 9.8304, step: 0, out: 9.8304, why: "no rounding means no rounding" },
  { v: 0, step: 0.5, out: 0, why: "nothing stays nothing" },
  { v: 12.5, step: -1, out: 12.5, why: "a negative step is ignored" }
];
CEIL_CASES.forEach(function (c) {
  caseCount++;
  eq("ceilTo(" + c.v + ", " + c.step + ") — " + c.why, C.ceilTo(c.v, c.step), c.out, 1e-9);
});

/* ================================================================== *
 * 4. Volumetric weight and the divide-by-zero guard
 * ================================================================== */

var VOL_CASES = [
  { vol: 49152, div: 5000, kg: 9.8304, why: "48 x 32 x 32 on a courier card" },
  { vol: 49152, div: 6000, kg: 8.192, why: "the same box as air freight" },
  { vol: 49152, div: 4000, kg: 12.288, why: "the same box on a surface card" },
  { vol: 1000000, div: 1000, kg: 1000, why: "1 CBM is 1 tonne under the W/M rule" },
  { vol: 49152, div: 0, kg: 0, why: "a zero divisor must not be infinity" },
  { vol: 49152, div: -5000, kg: 0, why: "a negative divisor is refused" },
  { vol: 0, div: 5000, kg: 0, why: "no box, no volumetric weight" }
];
VOL_CASES.forEach(function (c) {
  caseCount++;
  eq("volumetricKg(" + c.vol + " / " + c.div + ") — " + c.why,
    C.volumetricKg(c.vol, c.div), c.kg, 1e-9);
});

/* ================================================================== *
 * 5. Which weight is charging you — and the exact boundary
 * ================================================================== */

var CHARGE_CASES = [
  {
    label: "the worked example: a light, bulky parcel on a courier card",
    input: { basis: "weight", volumeCm3: 49152, actualKg: 7.9, divisorCm3PerKg: 5000,
             roundStepKg: 0.5, pieces: 8, rate: 85 },
    want: {
      volumetricKg: 9.8304,            // 49152 / 5000
      heavierKg: 9.8304,
      chargedOn: "volumetric",
      excessKg: 1.9304,                // 9.8304 - 7.9, the air
      chargeablePerPieceKg: 10,        // rounded up to the next half kilo
      roundingAddedKg: 0.1696,
      shipmentChargeableKg: 80,        // 10 x 8 cartons
      shipmentActualKg: 63.2,
      cost: 6800,                      // 80 kg x 85
      costOnActualOnly: 5440,          // ceil(7.9 -> 8.0) x 8 x 85
      costOfVoid: 1360,
      densityKgPerCbm: 160.7259114583  // 7.9 / 0.049152
    }
  },
  {
    label: "a dense parcel: the scale wins",
    input: { basis: "weight", volumeCm3: 20000, actualKg: 12, divisorCm3PerKg: 5000,
             roundStepKg: 0.5, pieces: 1, rate: 85 },
    want: { volumetricKg: 4, heavierKg: 12, chargedOn: "actual", excessKg: 0,
            chargeablePerPieceKg: 12, costOfVoid: 0, cost: 1020 }
  },
  {
    label: "the exact boundary: volume = actual x divisor is a tie",
    input: { basis: "weight", volumeCm3: 50000, actualKg: 10, divisorCm3PerKg: 5000,
             roundStepKg: 0, pieces: 1, rate: 100 },
    want: { volumetricKg: 10, heavierKg: 10, chargedOn: "tie", excessKg: 0, cost: 1000 }
  },
  {
    label: "one cubic centimetre under the boundary: the scale still wins",
    input: { basis: "weight", volumeCm3: 49999, actualKg: 10, divisorCm3PerKg: 5000,
             roundStepKg: 0, pieces: 1, rate: 100 },
    want: { volumetricKg: 9.9998, heavierKg: 10, chargedOn: "actual", excessKg: 0 }
  },
  {
    label: "one cubic centimetre over the boundary: volume takes over",
    input: { basis: "weight", volumeCm3: 50001, actualKg: 10, divisorCm3PerKg: 5000,
             roundStepKg: 0, pieces: 1, rate: 100 },
    want: { volumetricKg: 10.0002, heavierKg: 10.0002, chargedOn: "volumetric",
            excessKg: 0.0002 }
  },
  {
    label: "rounding alone can make the boundary invisible on the invoice",
    input: { basis: "weight", volumeCm3: 50001, actualKg: 10, divisorCm3PerKg: 5000,
             roundStepKg: 0.5, pieces: 1, rate: 100 },
    want: { chargedOn: "volumetric", chargeablePerPieceKg: 10.5,
            cost: 1050, costOnActualOnly: 1000, costOfVoid: 50 }
  },
  {
    label: "no rounding step: the awkward figure is billed as it stands",
    input: { basis: "weight", volumeCm3: 49152, actualKg: 7.9, divisorCm3PerKg: 5000,
             roundStepKg: 0, pieces: 1, rate: 85 },
    want: { chargeablePerPieceKg: 9.8304, roundingAddedKg: 0, cost: 835.584 }
  },
  {
    label: "a whole-kilo card rounds harder",
    input: { basis: "weight", volumeCm3: 49152, actualKg: 7.9, divisorCm3PerKg: 5000,
             roundStepKg: 1, pieces: 1, rate: 85 },
    want: { chargeablePerPieceKg: 10, roundingAddedKg: 0.1696, cost: 850 }
  },
  {
    label: "a zero divisor leaves volume out of it rather than billing infinity",
    input: { basis: "weight", volumeCm3: 49152, actualKg: 7.9, divisorCm3PerKg: 0,
             roundStepKg: 0.5, pieces: 1, rate: 85 },
    want: { volumetricKg: 0, heavierKg: 7.9, chargedOn: "actual",
            chargeablePerPieceKg: 8, cost: 680 }
  },
  {
    label: "an empty form bills nothing, not NaN",
    input: { basis: "weight", volumeCm3: 0, actualKg: 0, divisorCm3PerKg: 5000,
             roundStepKg: 0.5, pieces: 0, rate: 0 },
    want: { volumetricKg: 0, heavierKg: 0, chargedOn: "actual", pieces: 1,
            cost: 0, excessPct: 0, densityKgPerCbm: 0 }
  },
  {
    label: "sea LCL: the cube wins and the one revenue tonne minimum bites",
    input: { basis: "revenueTonne", volumeCm3: 49152, actualKg: 7.9,
             divisorCm3PerKg: 1000, roundStepKg: 0.5, pieces: 8, rate: 3500 },
    want: {
      volumetricKg: 49.152,            // 0.049152 CBM against 0.0079 t
      chargedOn: "volumetric",
      chargeablePerPieceKg: 49.152,    // kilo rounding does not apply to R/T
      roundingAddedKg: 0,
      shipmentChargeableKg: 393.216,
      revenueTonnes: 0.393216,
      billedRevenueTonnes: 1,          // the minimum
      minimumApplied: true,
      billedQty: 1,
      cost: 3500
    }
  },
  {
    label: "sea LCL, big enough that the minimum does not apply",
    input: { basis: "revenueTonne", volumeCm3: 49152, actualKg: 7.9,
             divisorCm3PerKg: 1000, roundStepKg: 0.5, pieces: 200, rate: 3500 },
    want: { revenueTonnes: 9.8304, billedRevenueTonnes: 9.8304, minimumApplied: false,
            cost: 34406.4 }
  },
  {
    label: "sea LCL on dense cargo: the tonnes win",
    input: { basis: "revenueTonne", volumeCm3: 1000000, actualKg: 1800,
             divisorCm3PerKg: 1000, roundStepKg: 0, pieces: 1, rate: 3500 },
    want: { volumetricKg: 1000, heavierKg: 1800, chargedOn: "actual",
            revenueTonnes: 1.8, billedRevenueTonnes: 1.8, cost: 6300 }
  }
];

CHARGE_CASES.forEach(function (c) {
  caseCount++;
  var r = C.charge(c.input);
  assertAllFinite(c.label, r);
  Object.keys(c.want).forEach(function (k) {
    eq(c.label + " / " + k, r[k], c.want[k], 1e-6);
  });
  /* invariants that hold for every charge */
  check(c.label + " / inv: heavier is the max of the two",
    near(r.heavierKg, Math.max(r.actualKg, r.volumetricKg), 1e-9));
  check(c.label + " / inv: chargeable is never below the heavier",
    r.chargeablePerPieceKg >= r.heavierKg - 1e-9);
  check(c.label + " / inv: shipment total is pieces x per piece",
    near(r.shipmentChargeableKg, r.chargeablePerPieceKg * r.pieces, 1e-6));
  check(c.label + " / inv: the void never costs below zero",
    r.costOfVoid >= -1e-9);
  check(c.label + " / inv: excess is heavier minus actual",
    near(r.excessKg, r.heavierKg - r.actualKg, 1e-9));
});

/* The boundary, swept. For a spread of weights and divisors, build a cube that
 * sits exactly on volume = actual x divisor, then nudge it either side. */
var SWEEP = [
  { actualKg: 1, div: 5000 }, { actualKg: 7.9, div: 5000 },
  { actualKg: 10, div: 6000 }, { actualKg: 25, div: 4000 },
  { actualKg: 0.5, div: 5000 }, { actualKg: 120, div: 1000 }
];
SWEEP.forEach(function (s) {
  caseCount++;
  var breakEven = s.actualKg * s.div;
  var base = { basis: "weight", actualKg: s.actualKg, divisorCm3PerKg: s.div,
               roundStepKg: 0, pieces: 1, rate: 1 };
  function at(vol) {
    var i = {};
    Object.keys(base).forEach(function (k) { i[k] = base[k]; });
    i.volumeCm3 = vol;
    return C.charge(i);
  }
  var lbl = "boundary sweep " + s.actualKg + " kg / " + s.div;
  eq(lbl + " / exactly on the line is a tie", at(breakEven).chargedOn, "tie");
  eq(lbl + " / just under is billed on the scale",
    at(breakEven * (1 - 1e-6)).chargedOn, "actual");
  eq(lbl + " / just over is billed on volume",
    at(breakEven * (1 + 1e-6)).chargedOn, "volumetric");
  eq(lbl + " / on the line the two weights are equal",
    at(breakEven).volumetricKg, s.actualKg, 1e-9);

  /* The tipping point must agree with the boundary, and a box built at the
   * tipping height must land exactly on the line. */
  var L = 48, W = 32;
  var t = C.tippingPoint({ actualKg: s.actualKg, divisorCm3PerKg: s.div, l: L, w: W, h: 1 });
  eq(lbl + " / break-even volume is actual x divisor", t.breakEvenVolumeCm3, breakEven, 1e-6);
  eq(lbl + " / break-even density is a million over the divisor",
    t.breakEvenDensityKgPerCbm, 1000000 / s.div, 1e-9);
  eq(lbl + " / a box at the tipping height ties",
    at(L * W * t.tippingHeightCm).chargedOn, "tie");
});

/* ================================================================== *
 * 6. The tipping point, read both ways
 * ================================================================== */

var TIP_OVER = C.tippingPoint({ actualKg: 7.9, divisorCm3PerKg: 5000, l: 48, w: 32, h: 32 });
eq("tipping / break-even volume", TIP_OVER.breakEvenVolumeCm3, 39500);      // 7.9 x 5000
eq("tipping / break-even density", TIP_OVER.breakEvenDensityKgPerCbm, 200); // 1e6 / 5000
eq("tipping / the box is over the line", TIP_OVER.overTheLine, true);
eq("tipping / tipping height", TIP_OVER.tippingHeightCm, 39500 / 1536, 1e-9);
eq("tipping / headroom has run out", TIP_OVER.headroomCm3, 39500 - 49152);
eq("tipping / volume to lose", TIP_OVER.volumeCutNeededPct, (1 - 39500 / 49152) * 100, 1e-9);
eq("tipping / linear shrink needed", TIP_OVER.linearCutNeededPct,
  (1 - Math.cbrt(39500 / 49152)) * 100, 1e-9);
eq("tipping / the same box scaled onto the line keeps its shape",
  TIP_OVER.evenBoxCm.l / TIP_OVER.evenBoxCm.w, 48 / 32, 1e-9);
check("tipping / the box on the line has the break-even volume",
  near(TIP_OVER.evenBoxCm.l * TIP_OVER.evenBoxCm.w * TIP_OVER.evenBoxCm.h, 39500, 1e-3));

var TIP_UNDER = C.tippingPoint({ actualKg: 12, divisorCm3PerKg: 5000, l: 30, w: 20, h: 20 });
eq("tipping / a dense box is under the line", TIP_UNDER.overTheLine, false);
eq("tipping / headroom in cm3", TIP_UNDER.headroomCm3, 60000 - 12000);
eq("tipping / nothing to cut", TIP_UNDER.volumeCutNeededPct, 0);
check("tipping / the box on the line is bigger than the box in hand",
  TIP_UNDER.evenBoxCm.l > 30);

var TIP_ZERO = C.tippingPoint({ actualKg: 0, divisorCm3PerKg: 0, l: 0, w: 0, h: 0 });
assertAllFinite("tipping / empty form", TIP_ZERO);
eq("tipping / empty form: no density", TIP_ZERO.breakEvenDensityKgPerCbm, 0);
eq("tipping / empty form: no tipping height", TIP_ZERO.tippingHeightCm, 0);

/* ================================================================== *
 * 7. Carton cube — the axis-aligned orientation check
 * ================================================================== */

var FIT_CASES = [
  {
    label: "the worked example: 20 x 14 x 6 units in a 47 x 31 x 31 carton",
    unit: { l: 20, w: 14, h: 6 }, box: { l: 47, w: 31, h: 31 },
    want: { fits: true, total: 20, perRow: 2, rows: 5, perLayer: 10, layers: 2,
            key: "L-H-W", uprightDim: "width",
            usedVolumeCm3: 33600, voidCm3: 45167 - 33600 }
    /* 20 fits two ways round (2x2x5 and 2x5x2); the flatter stack wins the tie */
  },
  {
    label: "exact division wastes nothing",
    unit: { l: 10, w: 10, h: 10 }, box: { l: 30, w: 20, h: 20 },
    want: { fits: true, total: 12, fillPct: 100, voidCm3: 0 }
  },
  {
    label: "only one orientation works: a long unit in a tall box",
    unit: { l: 30, w: 10, h: 10 }, box: { l: 12, w: 12, h: 40 },
    want: { fits: true, total: 1, key: "W-H-L" }
  },
  {
    label: "a unit longer than the carton says so, it does not return zero",
    unit: { l: 40, w: 30, h: 20 }, box: { l: 35, w: 30, h: 20 },
    want: { fits: false, total: 0, blockerRank: "longest", blockerUnit: 40, blockerBox: 35 }
  },
  {
    label: "a cube too fat for a flat carton names the smallest side",
    unit: { l: 12, w: 12, h: 12 }, box: { l: 10, w: 50, h: 50 },
    want: { fits: false, total: 0, blockerRank: "smallest", blockerUnit: 12, blockerBox: 10 }
  },
  {
    label: "a middling side can be the blocker",
    unit: { l: 9, w: 20, h: 20 }, box: { l: 10, w: 15, h: 40 },
    want: { fits: false, total: 0, blockerRank: "middle", blockerUnit: 20, blockerBox: 15 }
  },
  {
    label: "turning it on its side rescues an exact fit",
    unit: { l: 35, w: 30, h: 20 }, box: { l: 30, w: 20, h: 35 },
    want: { fits: true, total: 1 }
  },
  {
    label: "a zero unit side is refused, with a reason",
    unit: { l: 0, w: 10, h: 10 }, box: { l: 50, w: 50, h: 50 },
    want: { fits: false, total: 0, reasonHas: "unit" }
  },
  {
    label: "a zero carton side is refused, with a reason",
    unit: { l: 10, w: 10, h: 10 }, box: { l: 50, w: 0, h: 50 },
    want: { fits: false, total: 0, reasonHas: "box" }
  },
  {
    label: "inch-derived dimensions must not lose a unit to float dust",
    unit: { l: 30.48, w: 30.48, h: 30.48 }, box: { l: 60.96, w: 91.44, h: 30.48 },
    want: { fits: true, total: 6, fillPct: 100 }
  }
];

FIT_CASES.forEach(function (c) {
  caseCount++;
  var r = C.fitBox(c.unit, c.box);
  assertAllFinite(c.label, r);
  var w = c.want;
  if (w.fits !== undefined) { eq(c.label + " / fits", r.fits, w.fits); }
  if (w.total !== undefined) { eq(c.label + " / total", r.total, w.total); }
  if (w.fillPct !== undefined) { eq(c.label + " / fill %", r.fillPct, w.fillPct, 1e-6); }
  if (w.voidCm3 !== undefined) { eq(c.label + " / void", r.voidCm3, w.voidCm3, 1e-6); }
  if (w.usedVolumeCm3 !== undefined) { eq(c.label + " / used volume", r.usedVolumeCm3, w.usedVolumeCm3, 1e-6); }
  if (w.key !== undefined) { eq(c.label + " / best orientation", r.best.key, w.key); }
  if (w.uprightDim !== undefined) { eq(c.label + " / upright dimension", r.best.uprightDim, w.uprightDim); }
  if (w.perRow !== undefined) { eq(c.label + " / per row", r.best.perRow, w.perRow); }
  if (w.rows !== undefined) { eq(c.label + " / rows", r.best.rows, w.rows); }
  if (w.perLayer !== undefined) { eq(c.label + " / per layer", r.best.perLayer, w.perLayer); }
  if (w.layers !== undefined) { eq(c.label + " / layers", r.best.layers, w.layers); }
  if (w.blockerRank !== undefined) {
    check(c.label + " / a blocker is named", !!r.blocker);
    if (r.blocker) {
      eq(c.label + " / blocker rank", r.blocker.rank, w.blockerRank);
      eq(c.label + " / blocker unit side", r.blocker.unitCm, w.blockerUnit);
      eq(c.label + " / blocker box side", r.blocker.boxCm, w.blockerBox);
    }
  }
  if (w.reasonHas !== undefined) {
    check(c.label + " / reason names the offender",
      typeof r.reason === "string" && r.reason.indexOf(w.reasonHas) >= 0, r.reason);
  }
  /* invariants */
  if (r.fits) {
    check(c.label + " / inv: used + void = box volume",
      near(r.usedVolumeCm3 + r.voidCm3, r.boxVolumeCm3, 1e-6));
    check(c.label + " / inv: fill is between 0 and 100", r.fillPct > 0 && r.fillPct <= 100 + 1e-9);
    check(c.label + " / inv: total = per layer x layers",
      r.total === r.best.perLayer * r.best.layers);
    check(c.label + " / inv: void is never negative", r.voidCm3 >= -1e-6);
  } else {
    check(c.label + " / inv: a miss always carries a reason", typeof r.reason === "string" && r.reason.length > 0);
    check(c.label + " / inv: a miss counts zero", r.total === 0);
  }
  if (r.orientations.length) {
    check(c.label + " / inv: all six orientations checked", r.orientations.length === 6);
    check(c.label + " / inv: the best really is the best",
      r.orientations.every(function (o) { return o.total <= r.best.total; }));
  }
});

/* The sorted-sides rule is the whole fit test, so prove it against a brute
 * force over the six orientations on random-ish boxes. */
(function () {
  caseCount++;
  var sizes = [3, 7, 9, 10, 12, 20, 31];
  var checked = 0, mismatches = 0;
  for (var a = 0; a < sizes.length; a++) {
    for (var b = 0; b < sizes.length; b++) {
      for (var c2 = 0; c2 < sizes.length; c2++) {
        var unit = { l: sizes[a], w: sizes[b], h: sizes[c2] };
        var box = { l: 12, w: 20, h: 31 };
        var r = C.fitBox(unit, box);
        var brute = C.ORIENTATIONS.some(function (o) {
          var u = [unit.l, unit.w, unit.h];
          return u[o.order[0]] <= box.l && u[o.order[1]] <= box.w && u[o.order[2]] <= box.h;
        });
        checked++;
        if (r.fits !== brute) { mismatches++; }
      }
    }
  }
  check("sorted-sides fit rule agrees with brute force over " + checked + " shapes",
    mismatches === 0, mismatches + " mismatches");
})();

/* The 2D floor fit for pallets in a container. */
var FLOOR_CASES = [
  { item: [120, 100], floor: [590, 235], count: 8, why: "1200 x 1000 pallets in a 20 ft, straight grid" },
  { item: [120, 80], floor: [590, 235], count: 8, why: "Euro pallets in a 20 ft, grid check only" },
  { item: [120, 100], floor: [1203, 235], count: 20, why: "1200 x 1000 pallets in a 40 ft" },
  { item: [120, 100], floor: [0, 235], count: 0, why: "no floor, no pallets" },
  { item: [0, 100], floor: [590, 235], count: 0, why: "no pallet, no count" },
  { item: [300, 300], floor: [590, 235], count: 0, why: "too wide for the box" }
];
FLOOR_CASES.forEach(function (c) {
  caseCount++;
  var r = C.floorFit(c.item[0], c.item[1], c.floor[0], c.floor[1]);
  eq("floorFit " + c.item.join("x") + " in " + c.floor.join("x") + " — " + c.why, r.count, c.count);
  assertAllFinite("floorFit " + c.why, r);
  check("floorFit " + c.why + " / utilisation is sane", r.utilPct >= 0 && r.utilPct <= 100 + 1e-9);
});
/* The grid check under-reports, and the page says so out loud. */
eq("floorFit finds only 8 Euro pallets in a 20 ft where a mixed pattern takes 11",
  C.floorFit(120, 80, 590, 235).count, 8);

/* ================================================================== *
 * 8. The right-size box
 * ================================================================== */

var RS = C.rightSizeInner({ l: 20, w: 14, h: 6 }, 20);
eq("right-size / found", RS.found, true);
eq("right-size / volume is 20 units with nothing spare", RS.volumeCm3, 20 * 20 * 14 * 6);
check("right-size / the most compact of the equal-volume grids wins",
  [RS.l, RS.w, RS.h].slice().sort(function (x, y) { return x - y; }).join("x") === "28x30x40",
  RS.l + "x" + RS.w + "x" + RS.h);
eq("right-size / grid multiplies out to the units",
  RS.grid.along * RS.grid.across * RS.grid.layers, 20);

var RS_ONE = C.rightSizeInner({ l: 20, w: 14, h: 6 }, 1);
eq("right-size / one unit needs one unit of space", RS_ONE.volumeCm3, 1680);

var RS_PRIME = C.rightSizeInner({ l: 10, w: 10, h: 10 }, 7);
eq("right-size / 7 cubes cannot tile a box, so some space is wasted",
  RS_PRIME.found, true);
check("right-size / 7 cubes take a grid of at least 7 places",
  RS_PRIME.grid.along * RS_PRIME.grid.across * RS_PRIME.grid.layers >= 7);
check("right-size / the box is never smaller than the units it holds",
  RS_PRIME.volumeCm3 >= 7 * 1000 - 1e-9);

[[{ l: 0, w: 10, h: 10 }, 5], [{ l: 10, w: 10, h: 10 }, 0],
 [{ l: 1, w: 1, h: 1 }, C.MAX_RIGHT_SIZE_UNITS + 1]].forEach(function (c) {
  caseCount++;
  var r = C.rightSizeInner(c[0], c[1]);
  check("right-size / refuses impossible input with a reason",
    r.found === false && typeof r.reason === "string" && r.reason.length > 0);
  assertAllFinite("right-size refusal", r);
});

/* ================================================================== *
 * 9. analyse() — the whole page, end to end
 * ================================================================== */

function base(over) {
  var i = {
    units: { length: "cm", mass: "kg" },
    modeId: "courier",
    divisor: 5000,
    rate: 85,
    roundStep: 0.5,
    unit: { l: 20, w: 14, h: 6, weight: 0.35 },
    carton: { l: 48, w: 32, h: 32, board: 0.5, tare: 0.9,
              unitsShipped: "", weighed: "", pieces: 8 },
    pallet: { l: 120, w: 100, maxStack: 180, deck: 15 },
    containerId: "c40hc"
  };
  if (over) {
    Object.keys(over).forEach(function (k) {
      if (over[k] && typeof over[k] === "object" && i[k] && typeof i[k] === "object") {
        Object.keys(over[k]).forEach(function (k2) { i[k][k2] = over[k][k2]; });
      } else {
        i[k] = over[k];
      }
    });
  }
  return i;
}

var ANALYSE_CASES = [
  {
    label: "the worked example, metric",
    input: base(),
    want: {
      "ok": true,
      "carton.innerCm.l": 47,
      "carton.innerCm.w": 31,
      "carton.innerCm.h": 31,
      "carton.outerVolumeCm3": 49152,
      "unitsPerCarton": 20,
      "unitsShipped": 20,
      "fit.best.key": "L-H-W",
      "fit.best.layers": 2,
      "fit.best.perLayer": 10,
      "fit.fillPct": 33600 / 45167 * 100,
      "fit.voidLitres": 11.567,
      "packed.fillPct": 33600 / 45167 * 100,
      "packed.voidCm3": 45167 - 33600,
      "weights.packedKg": 7.9,
      "weights.actualKg": 7.9,
      "charge.volumetricKg": 9.8304,
      "charge.chargedOn": "volumetric",
      "charge.chargeablePerPieceKg": 10,
      "charge.shipmentChargeableKg": 80,
      "charge.cost": 6800,
      "charge.costOfVoid": 1360,
      "voidVolumetricKg": 11567 / 5000,
      "tipping.breakEvenVolumeCm3": 39500,
      "tipping.tippingHeightCm": 39500 / 1536,
      "rightSize.found": true,
      "rightSize.outerCm.l": 41,
      "rightSize.outerCm.w": 29,
      "rightSize.outerCm.h": 31,
      "rightSize.charge.chargedOn": "actual",
      "rightSize.savingPerCarton": 2,
      "rightSize.savingShipment": 1360,
      "rightSize.escapesVolumetric": true,
      "pallet.usableHeightCm": 165,
      "pallet.cartonsPerPallet": 30,
      "pallet.unitsPerPallet": 600,
      "pallet.loadedHeightCm": 175,
      "pallet.grossKg": 237,
      "container.looseCartons": 1400,
      "container.palletsOnFloor": 20,
      "container.cartonsViaPallets": 600,
      "container.palletClearsDoor": true
    }
  },
  {
    label: "the same shipment on an air-freight divisor of 6000",
    input: base({ modeId: "airfreight", divisor: 6000 }),
    want: { "charge.volumetricKg": 8.192, "charge.chargedOn": "volumetric",
            "charge.chargeablePerPieceKg": 8.5, "charge.cost": 8.5 * 8 * 85 }
  },
  {
    label: "the same shipment on a surface divisor of 4000 costs more air",
    input: base({ modeId: "surface", divisor: 4000 }),
    want: { "charge.volumetricKg": 12.288, "charge.chargedOn": "volumetric",
            "charge.chargeablePerPieceKg": 12.5 }
  },
  {
    label: "sea LCL: the same carton under the weight-or-measurement rule",
    input: base({ modeId: "sealcl", divisor: 1000, rate: 3500 }),
    want: { "charge.billingUnit": "rt", "charge.volumetricKg": 49.152,
            "charge.revenueTonnes": 0.393216, "charge.billedRevenueTonnes": 1,
            "charge.minimumApplied": true, "charge.cost": 3500 }
  },
  {
    label: "a user divisor overrides the mode",
    input: base({ divisor: 4500 }),
    want: { "divisorCm3PerKg": 4500, "charge.volumetricKg": 49152 / 4500 }
  },
  {
    label: "a zero divisor is guarded and flagged",
    input: base({ divisor: 0 }),
    want: { "ok": false, "charge.volumetricKg": 0, "charge.chargedOn": "actual",
            "charge.chargeablePerPieceKg": 8 },
    issueHas: "divisor"
  },
  {
    label: "an empty form computes nothing and complains",
    input: {
      units: { length: "cm", mass: "kg" }, modeId: "courier",
      divisor: "", rate: "", roundStep: "",
      unit: { l: "", w: "", h: "", weight: "" },
      carton: { l: "", w: "", h: "", board: "", tare: "", unitsShipped: "", weighed: "", pieces: "" },
      pallet: { l: "", w: "", maxStack: "", deck: "" }, containerId: "c40hc"
    },
    want: { "ok": false, "charge.cost": 0, "unitsPerCarton": 0, "fit.fits": false,
            "charge.pieces": 1 }
  },
  {
    label: "negative dimensions are read as zero and called out",
    input: base({ unit: { l: -20, w: 14, h: 6 }, carton: { l: -48 } }),
    want: { "ok": false, "unit.cm.l": 0, "carton.outerVolumeCm3": 0 },
    issueHas: "below zero"
  },
  {
    label: "a unit larger than the carton says so instead of counting zero",
    input: base({ unit: { l: 60, w: 40, h: 40, weight: 2 } }),
    want: { "unitsPerCarton": 0, "fit.fits": false, "unitsShipped": 0,
            "weights.packedKg": 0.9 },
    issueHas: "does not fit"
  },
  {
    label: "asking for more units than fit is capped and flagged",
    input: base({ carton: { unitsShipped: 30 } }),
    want: { "unitsShipped": 20, "unitsCapped": true, "unitsRequested": 30 },
    issueHas: "only 20 fit"
  },
  {
    label: "a half-empty carton is still charged on the full cube",
    input: base({ carton: { unitsShipped: 10 } }),
    want: {
      "unitsShipped": 10, "weights.packedKg": 4.4,
      "charge.chargedOn": "volumetric", "charge.chargeablePerPieceKg": 10,
      "rightSize.escapesVolumetric": true,
      /* capacity is unchanged, but the fill and the void follow the 10 units
       * actually in the box, not the 20 it could hold */
      "unitsPerCarton": 20,
      "fit.fillPct": 33600 / 45167 * 100,
      "packed.usedVolumeCm3": 16800,
      "packed.voidCm3": 45167 - 16800,
      "packed.fillPct": 16800 / 45167 * 100,
      "voidVolumetricKg": (45167 - 16800) / 5000
    }
  },
  {
    label: "a weighed carton overrides the computed weight",
    input: base({ carton: { weighed: 9.2 } }),
    want: { "weights.usedWeighed": true, "weights.actualKg": 9.2,
            "weights.packedKg": 7.9, "charge.chargedOn": "volumetric" }
  },
  {
    label: "a dense carton is charged on the scale, with volume headroom",
    input: base({ unit: { weight: 1.2 }, carton: { tare: 1 } }),
    want: { "charge.actualKg": 25, "charge.chargedOn": "actual",
            "charge.chargeablePerPieceKg": 25, "charge.costOfVoid": 0,
            "tipping.overTheLine": false, "rightSize.escapesVolumetric": false }
  },
  {
    label: "board thickness thicker than the carton is caught",
    input: base({ carton: { board: 20 } }),
    want: { "carton.innerVolumeCm3": 0, "unitsPerCarton": 0 },
    issueHas: "board thickness"
  },
  {
    label: "no rounding step at all",
    input: base({ roundStep: 0 }),
    want: { "charge.chargeablePerPieceKg": 9.8304, "charge.roundingAddedKg": 0 }
  },
  {
    label: "a pallet allowance shorter than its own deck is caught",
    input: base({ pallet: { maxStack: 15, deck: 15 } }),
    want: { "pallet.usableHeightCm": 0, "pallet.cartonsPerPallet": 0 },
    issueHas: "deck"
  },
  {
    label: "a tall pallet that will not clear the container door is caught",
    input: base({ pallet: { maxStack: 300, deck: 15 } }),
    want: { "container.palletClearsDoor": false },
    issueHas: "door opening"
  },
  {
    label: "a 20 ft box holds fewer cartons than a 40 ft high cube",
    input: base({ containerId: "c20gp" }),
    want: { "container.label": "20' GP", "container.palletsOnFloor": 8 }
  },
  {
    label: "tiny units in a big carton: the right-size search bows out politely",
    input: base({ unit: { l: 1, w: 1, h: 1, weight: 0.001 },
                  carton: { l: 51, w: 51, h: 51 } }),
    want: { "unitsPerCarton": 125000, "rightSize.found": false }
  }
];

ANALYSE_CASES.forEach(function (c) {
  caseCount++;
  var r = C.analyse(c.input);
  assertAllFinite(c.label, r);
  Object.keys(c.want || {}).forEach(function (pathKey) {
    var parts = pathKey.split(".");
    var v = r;
    for (var i = 0; i < parts.length && v !== null && v !== undefined; i++) { v = v[parts[i]]; }
    eq(c.label + " / " + pathKey, v, c.want[pathKey], 1e-6);
  });
  if (c.issueHas) {
    check(c.label + " / issue mentions \"" + c.issueHas + "\"",
      r.issues.some(function (s) { return s.indexOf(c.issueHas) >= 0; }),
      JSON.stringify(r.issues));
  }
  /* invariants that must hold on every run of the page */
  check(c.label + " / inv: issues are strings",
    r.issues.every(function (s) { return typeof s === "string" && s.length > 0; }));
  check(c.label + " / inv: units shipped never exceed what fits",
    r.unitsShipped <= r.unitsPerCarton);
  check(c.label + " / inv: units on a pallet = cartons x units per carton",
    r.pallet.unitsPerPallet === r.pallet.cartonsPerPallet * r.unitsShipped);
  check(c.label + " / inv: break-even volume = actual weight x divisor",
    near(r.tipping.breakEvenVolumeCm3, r.weights.actualKg * r.divisorCm3PerKg, 1e-6));
  check(c.label + " / inv: chargeable is the heavier of the two, rounded up",
    r.charge.chargeablePerPieceKg >= Math.max(r.charge.actualKg, r.charge.volumetricKg) - 1e-9);
  check(c.label + " / inv: the void never costs below zero", r.charge.costOfVoid >= -1e-9);
  check(c.label + " / inv: a right-size box is never bigger than the one in hand",
    !r.rightSize.found || r.rightSize.outerVolumeCm3 <= r.carton.outerVolumeCm3 + 1e-6);
  check(c.label + " / inv: right-sizing never costs more",
    !r.rightSize.found || r.rightSize.savingShipment >= -1e-9);
  check(c.label + " / inv: a carton that does not fit the unit explains itself",
    r.fit.fits || typeof r.fit.reason === "string");
  check(c.label + " / inv: fill percentages stay in range",
    r.fit.fillPct >= 0 && r.fit.fillPct <= 100 + 1e-9 &&
    r.packed.fillPct >= 0 && r.packed.fillPct <= 100 + 1e-9 &&
    r.pallet.fillPct >= 0 && r.pallet.fillPct <= 100 + 1e-9);
  check(c.label + " / inv: packed used + void = carton inside",
    near(r.packed.usedVolumeCm3 + r.packed.voidCm3, r.carton.innerVolumeCm3, 1e-6) ||
    r.carton.innerVolumeCm3 === 0);
  check(c.label + " / inv: packed volume is the units shipped",
    near(r.packed.usedVolumeCm3, r.unitsShipped * r.unit.volumeCm3, 1e-6));
  check(c.label + " / inv: the priced void is the packed void over the divisor",
    near(r.voidVolumetricKg,
      r.divisorCm3PerKg > 0 ? r.packed.voidCm3 / r.divisorCm3PerKg : 0, 1e-9));
});

/* ---- metric and imperial must be the same shipment ---- */
(function () {
  caseCount++;
  var m = C.analyse(base());
  var IN = 1 / C.CM_PER_INCH, LB = 1 / C.KG_PER_POUND;
  var imperial = {
    units: { length: "in", mass: "lb" },
    modeId: "courier",
    divisor: C.divisorFromCm3PerKg(5000, "in", "lb"),
    rate: 85 * C.KG_PER_POUND,         // the same money per kilo, quoted per pound
    roundStep: 0.5 * LB,               // the same half kilo, quoted in pounds
    unit: { l: 20 * IN, w: 14 * IN, h: 6 * IN, weight: 0.35 * LB },
    carton: { l: 48 * IN, w: 32 * IN, h: 32 * IN, board: "", tare: 0.9 * LB,
              unitsShipped: "", weighed: "", pieces: 8 },
    pallet: { l: 120 * IN, w: 100 * IN, maxStack: 180 * IN, deck: 15 * IN },
    containerId: "c40hc"
  };
  var im = C.analyse(imperial);
  [["carton.outerVolumeCm3", 1e-6], ["weights.actualKg", 1e-9],
   ["divisorCm3PerKg", 1e-6], ["charge.volumetricKg", 1e-9],
   ["charge.chargeablePerPieceKg", 1e-9], ["charge.cost", 1e-6],
   ["unitsPerCarton", 0], ["pallet.cartonsPerPallet", 0],
   ["container.looseCartons", 0], ["tipping.breakEvenVolumeCm3", 1e-6]
  ].forEach(function (p) {
    var parts = p[0].split(".");
    function dig(o) { var v = o; for (var i = 0; i < parts.length; i++) { v = v[parts[i]]; } return v; }
    var a = dig(m), b = dig(im);
    check("imperial twin / " + p[0] + " matches the metric run",
      p[1] === 0 ? a === b : near(a, b, Math.max(p[1], Math.abs(a) * 1e-9)),
      "metric " + a + " vs imperial " + b);
  });
  eq("imperial twin / the divisor field is read as in3/lb", im.divisorIsImperial, true);
  assertAllFinite("imperial twin", im);
})();

/* ---- the divisor really is the whole game: sweep it ---- */
(function () {
  caseCount++;
  var last = Infinity;
  [4000, 5000, 6000, 8000, 20000].forEach(function (d) {
    var r = C.analyse(base({ divisor: d }));
    check("divisor sweep / a bigger divisor never costs more at " + d, r.charge.cost <= last + 1e-9,
      "cost " + r.charge.cost + " after " + last);
    last = r.charge.cost;
  });
  var tiny = C.analyse(base({ divisor: 1000000 }));
  eq("divisor sweep / a huge divisor puts the parcel back on the scale",
    tiny.charge.chargedOn, "actual");
})();

/* ================================================================== *
 * 10. A pure module must not reach for the world
 * ================================================================== */

var SRC = require("fs").readFileSync(
  require("path").join(__dirname, "..", "assets", "cube.js"), "utf8");
[
  ["document", /\bdocument\b/],
  ["window", /\bwindow\b/],
  ["localStorage", /localStorage/],
  ["fetch", /\bfetch\s*\(/],
  ["XMLHttpRequest", /XMLHttpRequest/],
  ["eval", /\beval\s*\(/],
  ["new Function", /new\s+Function/],
  ["require", /\brequire\s*\(/],
  ["setTimeout", /setTimeout/],
  ["Date", /\bnew\s+Date\b/],
  ["Math.random", /Math\.random/]
].forEach(function (c) {
  check("module source is free of " + c[0], !c[1].test(SRC));
});
check("module ran without a DOM", typeof document === "undefined");

/* ---- report ---- */
if (failures.length) {
  failures.forEach(function (f) { console.log("FAIL  " + f); });
}
console.log("");
console.log("tables:  " + caseCount + " rows / scenarios");
console.log("asserts: " + (pass + fail) + "   passed: " + pass + "   failed: " + fail);
console.log(fail === 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(fail === 0 ? 0 : 1);
