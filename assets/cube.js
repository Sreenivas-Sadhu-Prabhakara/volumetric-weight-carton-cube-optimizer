/* Volumetric weight and carton cube — pure rules module.
 *
 * No DOM, no network, no dependencies, no clock. Every function takes plain
 * values and returns plain values, so the rules can be exercised on their own
 * (see tests/cube.test.js).
 *
 * Two linked ideas live here.
 *
 *   1. CHARGEABLE WEIGHT. A carrier bills the greater of what the scale says
 *      and what the tape measure says. The tape measure is turned into
 *      kilograms by dividing the cubic volume by a divisor, and the divisor is
 *      the whole game: it is set by the carrier, it differs by mode, and it is
 *      the single number that decides whether you are paying for goods or for
 *      air. Every divisor in this file is INDICATIVE and overridable.
 *
 *   2. CARTON CUBE. How many units go in a carton, and how many cartons go on
 *      a pallet or in a container, as a plain axis-aligned grid: units per row
 *      x rows per layer x layers, checked in all six orientations, best one
 *      reported with its fill percentage and its void. This is an orientation
 *      check, NOT a bin-packing solver — see FIT_METHOD_NOTE.
 *
 * The two meet at the break-even volume, actualWeight x divisor. Below it you
 * are billed on the scale; above it you are billed on air. That lets the module
 * name the box that would put a given parcel back on the actual-weight side.
 *
 * Internally everything is centimetres and kilograms. Inputs are normalised at
 * the boundary in analyse().
 */
(function (root) {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Exact unit conversions. Nothing here is a rounded figure.
   * ------------------------------------------------------------------ */
  var CM_PER_INCH = 2.54;                 // international inch, exact by definition
  var KG_PER_POUND = 0.45359237;          // international avoirdupois pound, exact
  var CM3_PER_CUBIC_INCH = 16.387064;     // 2.54^3, exact
  var CM3_PER_CUBIC_FOOT = 28316.846592;  // 30.48^3, exact
  var CM3_PER_CUBIC_METRE = 1000000;
  var CM3_PER_LITRE = 1000;
  var KG_PER_TONNE = 1000;
  var MM_PER_CM = 10;

  /* A divisor quoted as in3/lb converts to cm3/kg by this factor
   * (16.387064 / 0.45359237 = 36.1273...). It is why a rate card saying
   * "139" and one saying "5000" are describing nearly the same rule. */
  var IN3_PER_LB_TO_CM3_PER_KG = CM3_PER_CUBIC_INCH / KG_PER_POUND;

  /* Comparisons of lengths that came from a conversion must not lose a whole
   * unit to floating-point dust: 12 in -> 30.48 cm must still divide 60.96 cm
   * exactly twice. */
  var FIT_EPSILON = 1e-9;

  /* ------------------------------------------------------------------ *
   * INDICATIVE DIVISORS — the only place a divisor is written down.
   *
   * Carriers set their own. These are the figures that appear most often on
   * rate cards in India and the Philippines, not a standard anyone is obliged
   * to follow, and a single contract can override any of them. Replace the
   * divisor on the page with the one printed on your own rate card before you
   * trust a rupee or a peso of the cost.
   * ------------------------------------------------------------------ */

  var MODE_AIR_COURIER = {
    id: "courier",
    label: "Air courier / express",
    tag: "courier",
    basis: "weight",
    billingUnit: "kg",
    divisorCm3PerKg: 5000,
    divisorIn3PerLb: 139,
    in3IsQuoted: true,
    indicative: true,
    note: "The 1:5 ratio — 5,000 cm³ to the kilo, 200 kg to the cubic metre. " +
          "The usual figure on international express and domestic air-courier " +
          "rate cards; cards written in inches and pounds quote the same rule " +
          "as 139 in³/lb."
  };

  var MODE_AIR_FREIGHT = {
    id: "airfreight",
    label: "Air freight (1:6)",
    tag: "air freight",
    basis: "weight",
    billingUnit: "kg",
    divisorCm3PerKg: 6000,
    divisorIn3PerLb: 166,
    in3IsQuoted: true,
    indicative: true,
    note: "The air-cargo volumetric ratio of 6,000 cm³ to the kilo — 167 kg to " +
          "the cubic metre, quoted as 166 in³/lb. Airlines and consolidators " +
          "price general cargo on it, so a consolidator is often cheaper than " +
          "an express courier on a light, bulky box purely because of this one " +
          "number."
  };

  var MODE_SURFACE = {
    id: "surface",
    label: "Surface / road",
    tag: "surface",
    basis: "weight",
    billingUnit: "kg",
    divisorCm3PerKg: 4000,
    divisorIn3PerLb: 111,
    in3IsQuoted: false,
    indicative: true,
    note: "A denser 1:4 ratio — 250 kg to the cubic metre. Road networks price " +
          "floor space harder than air does. Road freight quoted per cubic foot " +
          "at 7 kg to the cubic foot works out at about 4,045 cm³/kg, which is " +
          "where the round 4,000 on surface rate cards comes from. Plenty of " +
          "surface cards still use 5,000, so check yours."
  };

  var MODE_SEA_LCL = {
    id: "sealcl",
    label: "Sea LCL (W/M)",
    tag: "sea LCL",
    basis: "revenueTonne",
    billingUnit: "rt",
    divisorCm3PerKg: 1000,
    divisorIn3PerLb: 27.7,
    in3IsQuoted: false,
    indicative: false,
    note: "LCL is not billed per kilo at all: it is billed per revenue tonne, " +
          "the greater of the cubic metres and the metric tonnes. That " +
          "weight-or-measurement rule is 1 CBM to 1,000 kg, which is the same " +
          "comparison with a divisor of 1,000 cm³/kg — so the arithmetic on " +
          "this page is unchanged, only the billing unit differs. The 1:1 " +
          "ratio is the convention; the one-revenue-tonne minimum is not " +
          "universal."
  };

  var MODES = [MODE_AIR_COURIER, MODE_AIR_FREIGHT, MODE_SURFACE, MODE_SEA_LCL];
  var DEFAULT_MODE_ID = MODE_AIR_COURIER.id;

  /* A sea LCL bill of lading usually carries a floor. Indicative. */
  var SEA_LCL_MINIMUM_REVENUE_TONNES = 1;

  /* Carriers round the chargeable weight up before pricing it. Express cards
   * commonly step in half kilos, domestic cards in whole kilos, and a slab
   * card effectively does the same thing with wider steps. In the user's own
   * mass unit, not in kilograms. */
  var ROUND_STEPS = [
    { value: 0, label: "None" },
    { value: 0.5, label: "0.5" },
    { value: 1, label: "1" }
  ];
  var DEFAULT_ROUND_STEP = 0.5;

  /* ISO 6780 pallet footprints, in millimetres. */
  var PALLET_PRESETS = [
    { id: "p1200x1000", label: "1200 x 1000", lengthMm: 1200, widthMm: 1000,
      note: "An ISO 6780 footprint and the commonest general-purpose pallet in India and on Asian export legs." },
    { id: "p1200x800", label: "1200 x 800", lengthMm: 1200, widthMm: 800,
      note: "An ISO 6780 footprint, the European pallet." },
    { id: "p1219x1016", label: "1219 x 1016", lengthMm: 1219, widthMm: 1016,
      note: "An ISO 6780 footprint, the North-American 48 x 40 inch pallet seen on Philippine and US trades." },
    { id: "p1100x1100", label: "1100 x 1100", lengthMm: 1100, widthMm: 1100,
      note: "An ISO 6780 footprint, common in Japan and parts of South-East Asia." },
    { id: "custom", label: "Custom", lengthMm: 0, widthMm: 0,
      note: "Whatever your own pallet measures." }
  ];
  var DEFAULT_PALLET_ID = "p1200x1000";
  var DEFAULT_PALLET_DECK_CM = 15;   // deck height of a typical four-way pallet
  var DEFAULT_MAX_STACK_CM = 180;    // total height of the loaded pallet

  /* Internal dimensions of dry containers, in centimetres. INDICATIVE: they
   * differ by builder and by age of the box, sometimes by several centimetres,
   * and the door opening is always smaller than the inside. A unit load that
   * clears the inside height but not the door opening does not go in. */
  var CONTAINER_PRESETS = [
    { id: "c20gp", label: "20' GP", lengthCm: 590, widthCm: 235, heightCm: 239, doorHeightCm: 228 },
    { id: "c40gp", label: "40' GP", lengthCm: 1203, widthCm: 235, heightCm: 239, doorHeightCm: 228 },
    { id: "c40hc", label: "40' HC", lengthCm: 1203, widthCm: 235, heightCm: 269, doorHeightCm: 257 }
  ];
  var DEFAULT_CONTAINER_ID = "c40hc";

  /* Corrugated board. Single wall runs roughly 3-5 mm, double wall 6-8 mm. */
  var DEFAULT_BOARD_CM = 0.5;

  /* INDICATIVE freight rates, so the money column is never blank. Round
   * placeholders for illustration, nothing more — domestic courier rates in
   * both countries swing with lane, volume and contract, and an LCL rate per
   * revenue tonne depends on the trade. Replace them with your own rate card. */
  var INDICATIVE_RATES = {
    INR: { perKg: 85, perRevenueTonne: 3500 },
    PHP: { perKg: 55, perRevenueTonne: 2200 }
  };

  /* The right-size search walks every grid that holds the units, which costs
   * about units x ln(units) steps per orientation. Past this many units the
   * search is skipped rather than allowed to stall a keystroke. */
  var MAX_RIGHT_SIZE_UNITS = 2000;

  /* Said plainly, everywhere the fit figures are shown. */
  var FIT_METHOD_NOTE =
    "An axis-aligned orientation check, not a packing solver. Every unit is " +
    "laid the same way up in a plain grid, and the best of the six " +
    "orientations is reported. Mixed orientations, interlocked and pinwheel " +
    "patterns, nesting and a bit of squeeze routinely beat it — a 20-foot " +
    "container takes eleven 1200 x 800 pallets on a mixed pattern where this " +
    "grid check finds eight. Read every count here as a safe floor, not an " +
    "optimum.";

  /* ------------------------------------------------------------------ *
   * Small numeric helpers
   * ------------------------------------------------------------------ */

  function num(v) {
    if (v === null || v === undefined) { return 0; }
    if (typeof v === "string") {
      var s = v.replace(/[,\s]/g, "");
      if (s === "") { return 0; }
      v = s;
    }
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function nonNeg(v) {
    var n = num(v);
    return n > 0 ? n : 0;
  }

  function isBlank(v) {
    if (v === null || v === undefined) { return true; }
    if (typeof v === "string") { return v.replace(/[,\s]/g, "") === ""; }
    return false;
  }

  function tidy(n) {
    if (!isFinite(n)) { return 0; }
    return Math.round(n * 1e9) / 1e9;
  }

  /* floor(space / size) with the dust from a unit conversion ignored. */
  function howMany(space, size) {
    if (!(size > 0) || !(space > 0)) { return 0; }
    var n = Math.floor(space / size + FIT_EPSILON);
    return n > 0 ? n : 0;
  }

  /* Round a weight UP to the carrier's step. Step 0 means no rounding. */
  function ceilTo(value, step) {
    var v = num(value);
    var s = nonNeg(step);
    if (!(s > 0)) { return tidy(v); }
    return tidy(Math.ceil(v / s - FIT_EPSILON) * s);
  }

  function toCm(value, lengthUnit) {
    var v = num(value);
    return lengthUnit === "in" ? v * CM_PER_INCH : v;
  }

  function fromCm(valueCm, lengthUnit) {
    var v = num(valueCm);
    return lengthUnit === "in" ? v / CM_PER_INCH : v;
  }

  function toKg(value, massUnit) {
    var v = num(value);
    return massUnit === "lb" ? v * KG_PER_POUND : v;
  }

  function fromKg(valueKg, massUnit) {
    var v = num(valueKg);
    return massUnit === "lb" ? v / KG_PER_POUND : v;
  }

  /* A divisor is quoted in in3/lb only when BOTH units are imperial. */
  function divisorIsImperial(lengthUnit, massUnit) {
    return lengthUnit === "in" && massUnit === "lb";
  }

  function divisorToCm3PerKg(value, lengthUnit, massUnit) {
    var v = nonNeg(value);
    return divisorIsImperial(lengthUnit, massUnit) ? v * IN3_PER_LB_TO_CM3_PER_KG : v;
  }

  function divisorFromCm3PerKg(valueCm3PerKg, lengthUnit, massUnit) {
    var v = nonNeg(valueCm3PerKg);
    return divisorIsImperial(lengthUnit, massUnit) ? v / IN3_PER_LB_TO_CM3_PER_KG : v;
  }

  function modeById(id) {
    for (var i = 0; i < MODES.length; i++) {
      if (MODES[i].id === id) { return MODES[i]; }
    }
    return MODE_AIR_COURIER;
  }

  /* The divisor to show in the field when a mode is picked, in the user's own
   * unit. Imperial keeps the figure the rate card actually prints. */
  function modeDivisorForUnits(modeId, lengthUnit, massUnit) {
    var m = modeById(modeId);
    if (divisorIsImperial(lengthUnit, massUnit)) {
      return m.divisorIn3PerLb;
    }
    return m.divisorCm3PerKg;
  }

  function palletById(id) {
    for (var i = 0; i < PALLET_PRESETS.length; i++) {
      if (PALLET_PRESETS[i].id === id) { return PALLET_PRESETS[i]; }
    }
    return PALLET_PRESETS[0];
  }

  function containerById(id) {
    for (var i = 0; i < CONTAINER_PRESETS.length; i++) {
      if (CONTAINER_PRESETS[i].id === id) { return CONTAINER_PRESETS[i]; }
    }
    return CONTAINER_PRESETS[CONTAINER_PRESETS.length - 1];
  }

  /* ------------------------------------------------------------------ *
   * 1. CHARGEABLE WEIGHT
   * ------------------------------------------------------------------ */

  function volumetricKg(volumeCm3, divisorCm3PerKg) {
    var v = nonNeg(volumeCm3);
    var d = nonNeg(divisorCm3PerKg);
    if (!(d > 0)) { return 0; }        // guarded: a zero divisor is not infinity
    return tidy(v / d);
  }

  /* The comparison, the rounding, the shipment total and the money.
   *
   * input: { volumeCm3, actualKg, divisorCm3PerKg, roundStepKg, pieces,
   *          rate, basis }
   * basis "weight"       -> billed per kilo, rounded up per piece
   * basis "revenueTonne" -> billed per revenue tonne on the shipment, with a
   *                         minimum, and no per-piece kilo rounding
   */
  function charge(input) {
    var basis = input.basis === "revenueTonne" ? "revenueTonne" : "weight";
    var volume = nonNeg(input.volumeCm3);
    var actual = nonNeg(input.actualKg);
    var divisor = nonNeg(input.divisorCm3PerKg);
    var pieces = Math.floor(nonNeg(input.pieces)) || 1;
    var rate = nonNeg(input.rate);
    var stepKg = basis === "weight" ? nonNeg(input.roundStepKg) : 0;

    var vol = volumetricKg(volume, divisor);
    var heavier = Math.max(actual, vol);

    var which = "actual";
    if (vol > actual + FIT_EPSILON) { which = "volumetric"; }
    else if (Math.abs(vol - actual) <= FIT_EPSILON && vol > 0) { which = "tie"; }

    var chargeablePerPiece = ceilTo(heavier, stepKg);
    var roundingAddedKg = tidy(chargeablePerPiece - heavier);
    var shipmentChargeableKg = tidy(chargeablePerPiece * pieces);
    var shipmentActualKg = tidy(actual * pieces);
    var shipmentVolumetricKg = tidy(vol * pieces);

    /* What it would cost if volume never entered the picture — the clean way
     * to price the air, because it carries the rounding and the minimum. */
    var actualOnlyPerPiece = ceilTo(actual, stepKg);
    var shipmentActualOnlyKg = tidy(actualOnlyPerPiece * pieces);

    var revenueTonnes = tidy(shipmentChargeableKg / KG_PER_TONNE);
    var revenueTonnesOnActual = tidy(shipmentActualOnlyKg / KG_PER_TONNE);
    var billedRevenueTonnes = revenueTonnes;
    var billedRtOnActual = revenueTonnesOnActual;
    var minimumApplied = false;

    if (basis === "revenueTonne") {
      if (billedRevenueTonnes < SEA_LCL_MINIMUM_REVENUE_TONNES && volume > 0) {
        billedRevenueTonnes = SEA_LCL_MINIMUM_REVENUE_TONNES;
        minimumApplied = true;
      }
      if (billedRtOnActual < SEA_LCL_MINIMUM_REVENUE_TONNES && volume > 0) {
        billedRtOnActual = SEA_LCL_MINIMUM_REVENUE_TONNES;
      }
    }

    var billedQty = basis === "revenueTonne" ? billedRevenueTonnes : shipmentChargeableKg;
    var billedQtyOnActual = basis === "revenueTonne" ? billedRtOnActual : shipmentActualOnlyKg;

    var cost = tidy(billedQty * rate);
    var costOnActualOnly = tidy(billedQtyOnActual * rate);

    return {
      basis: basis,
      billingUnit: basis === "revenueTonne" ? "rt" : "kg",
      volumeCm3: tidy(volume),
      volumeCbm: tidy(volume / CM3_PER_CUBIC_METRE),
      divisorCm3PerKg: tidy(divisor),
      actualKg: tidy(actual),
      volumetricKg: vol,
      heavierKg: tidy(heavier),
      chargedOn: which,                        // "actual" | "volumetric" | "tie"
      excessKg: tidy(heavier - actual),        // the air, per piece, before rounding
      excessPct: actual > 0 ? tidy((heavier - actual) / actual * 100) : 0,
      densityKgPerCbm: volume > 0 ? tidy(actual / (volume / CM3_PER_CUBIC_METRE)) : 0,
      roundStepKg: tidy(stepKg),
      roundingAddedKg: roundingAddedKg,
      chargeablePerPieceKg: chargeablePerPiece,
      pieces: pieces,
      shipmentActualKg: shipmentActualKg,
      shipmentVolumetricKg: shipmentVolumetricKg,
      shipmentChargeableKg: shipmentChargeableKg,
      revenueTonnes: revenueTonnes,
      billedRevenueTonnes: billedRevenueTonnes,
      minimumApplied: minimumApplied,
      rate: tidy(rate),
      billedQty: tidy(billedQty),
      cost: cost,
      costOnActualOnly: costOnActualOnly,
      costOfVoid: tidy(cost - costOnActualOnly)
    };
  }

  /* Where the two weights cross. Everything below follows from one line:
   * volumetric overtakes actual at exactly volume = actual x divisor. */
  function tippingPoint(input) {
    var actual = nonNeg(input.actualKg);
    var divisor = nonNeg(input.divisorCm3PerKg);
    var l = nonNeg(input.l), w = nonNeg(input.w), h = nonNeg(input.h);
    var volume = tidy(l * w * h);

    var breakEven = tidy(actual * divisor);
    var density = divisor > 0 ? tidy(CM3_PER_CUBIC_METRE / divisor) : 0;

    /* Hold two sides, and this is the third at which the box tips over. */
    var tippingHeightCm = (l * w) > 0 ? tidy(breakEven / (l * w)) : 0;

    /* The same box, same proportions, scaled to sit exactly on the line. */
    var scale = volume > 0 && breakEven > 0 ? Math.cbrt(breakEven / volume) : 0;
    var evenBox = {
      l: tidy(l * scale),
      w: tidy(w * scale),
      h: tidy(h * scale)
    };

    var over = volume > breakEven + FIT_EPSILON;
    return {
      breakEvenVolumeCm3: breakEven,
      breakEvenVolumeCbm: tidy(breakEven / CM3_PER_CUBIC_METRE),
      breakEvenDensityKgPerCbm: density,
      volumeCm3: volume,
      overTheLine: over,
      tippingHeightCm: tippingHeightCm,
      headroomCm3: tidy(breakEven - volume),            // negative once over
      volumeCutNeededPct: over && volume > 0 ? tidy((1 - breakEven / volume) * 100) : 0,
      linearCutNeededPct: over && scale > 0 ? tidy((1 - scale) * 100) : 0,
      scaleToLine: tidy(scale),
      evenBoxCm: evenBox
    };
  }

  /* ------------------------------------------------------------------ *
   * 2. CARTON CUBE — axis-aligned orientation check
   * ------------------------------------------------------------------ */

  /* Unit dimension indexes: 0 = length, 1 = width, 2 = height.
   * order [a, b, c] means: a runs along the box length, b across the box
   * width, c stands upright. All six ways round. */
  var ORIENTATIONS = [
    { key: "L-W-H", order: [0, 1, 2] },
    { key: "L-H-W", order: [0, 2, 1] },
    { key: "W-L-H", order: [1, 0, 2] },
    { key: "W-H-L", order: [1, 2, 0] },
    { key: "H-L-W", order: [2, 0, 1] },
    { key: "H-W-L", order: [2, 1, 0] }
  ];
  var DIM_NAMES = ["length", "width", "height"];
  var SIZE_RANK_NAMES = ["smallest", "middle", "longest"];

  function ascending(a, b) { return a - b; }

  /* fitBox: how many copies of `unit` go into `box`, axis-aligned.
   *
   * Returns fits:false with a named blocker rather than a silent 0 when the
   * unit cannot go in at all. A box fits inside another box in SOME
   * axis-aligned orientation if and only if its sorted sides are each no
   * larger than the other's sorted sides — so the blocking pair can be named
   * exactly.
   */
  function fitBox(unit, box) {
    var u = [nonNeg(unit.l), nonNeg(unit.w), nonNeg(unit.h)];
    var b = [nonNeg(box.l), nonNeg(box.w), nonNeg(box.h)];
    var unitVolume = tidy(u[0] * u[1] * u[2]);
    var boxVolume = tidy(b[0] * b[1] * b[2]);

    var out = {
      fits: false,
      reason: null,
      blocker: null,
      total: 0,
      best: null,
      orientations: [],
      unitVolumeCm3: unitVolume,
      boxVolumeCm3: boxVolume,
      usedVolumeCm3: 0,
      voidCm3: 0,
      voidLitres: 0,
      fillPct: 0,
      method: FIT_METHOD_NOTE
    };

    if (!(unitVolume > 0)) {
      out.reason = "The unit has a zero or missing side, so nothing can be counted.";
      return out;
    }
    if (!(boxVolume > 0)) {
      out.reason = "The box has a zero or missing inside dimension, so nothing can be counted.";
      return out;
    }

    var su = u.slice().sort(ascending);
    var sb = b.slice().sort(ascending);
    for (var k = 0; k < 3; k++) {
      if (su[k] > sb[k] + FIT_EPSILON) {
        out.blocker = {
          rank: SIZE_RANK_NAMES[k],
          unitCm: tidy(su[k]),
          boxCm: tidy(sb[k])
        };
        out.reason = "The unit's " + SIZE_RANK_NAMES[k] + " side (" + tidy(su[k]) +
          " cm) is larger than the box's " + SIZE_RANK_NAMES[k] +
          " inside dimension (" + tidy(sb[k]) + " cm). It will not go in, " +
          "whichever way round you turn it.";
        return out;
      }
    }

    for (var i = 0; i < ORIENTATIONS.length; i++) {
      var o = ORIENTATIONS[i];
      var along = u[o.order[0]], across = u[o.order[1]], upright = u[o.order[2]];
      var perRow = howMany(b[0], along);
      var rows = howMany(b[1], across);
      var layers = howMany(b[2], upright);
      var perLayer = perRow * rows;
      out.orientations.push({
        key: o.key,
        index: i,
        alongCm: tidy(along),
        acrossCm: tidy(across),
        uprightCm: tidy(upright),
        uprightDim: DIM_NAMES[o.order[2]],
        perRow: perRow,
        rows: rows,
        perLayer: perLayer,
        layers: layers,
        total: perLayer * layers
      });
    }

    /* Best = most units. Ties go to the flatter stack (fewer layers means more
     * per layer, fewer handling moves and a more stable column), then to the
     * first orientation in the fixed list, so the answer is deterministic. */
    var best = out.orientations[0];
    for (var j = 1; j < out.orientations.length; j++) {
      var c = out.orientations[j];
      if (c.total > best.total) { best = c; continue; }
      if (c.total === best.total && c.total > 0 && c.layers < best.layers) { best = c; }
    }

    out.best = best;
    out.total = best.total;
    out.fits = best.total > 0;

    if (!out.fits) {
      /* Sorted sides said it fits, yet no grid holds one: only possible when a
       * side is so close to the box that the grid check rejects it. Say so. */
      out.reason = "The unit only just misses: no orientation leaves room for " +
        "even one. Check the inside dimensions.";
      return out;
    }

    out.usedVolumeCm3 = tidy(best.total * unitVolume);
    out.voidCm3 = tidy(boxVolume - out.usedVolumeCm3);
    out.voidLitres = tidy(out.voidCm3 / CM3_PER_LITRE);
    out.fillPct = tidy(out.usedVolumeCm3 / boxVolume * 100);
    return out;
  }

  /* A 2D version for pallets on a container floor: identical rectangles, one
   * orientation for all of them, both ways round. */
  function floorFit(itemL, itemW, floorL, floorW) {
    var il = nonNeg(itemL), iw = nonNeg(itemW);
    var fl = nonNeg(floorL), fw = nonNeg(floorW);
    if (!(il > 0) || !(iw > 0) || !(fl > 0) || !(fw > 0)) {
      return { count: 0, turned: false, utilPct: 0 };
    }
    var straight = howMany(fl, il) * howMany(fw, iw);
    var turned = howMany(fl, iw) * howMany(fw, il);
    var count = Math.max(straight, turned);
    return {
      count: count,
      turned: turned > straight,
      utilPct: tidy(count * il * iw / (fl * fw) * 100)
    };
  }

  /* ------------------------------------------------------------------ *
   * THE WEDGE — the smallest made-to-size carton that still holds the units.
   *
   * Walks every grid nx x ny x nz that holds at least `units`, in all six
   * orientations, and keeps the one with the least enclosing volume. Ties go
   * to the most compact shape (shortest longest side), so the answer is a box
   * a carton maker could actually quote rather than a 4-metre tube.
   *
   * No clearance between units and no dunnage is assumed — see the note on the
   * page. This is the floor of what is possible, not a specification.
   * ------------------------------------------------------------------ */
  function rightSizeInner(unit, units) {
    var u = [nonNeg(unit.l), nonNeg(unit.w), nonNeg(unit.h)];
    var n = Math.floor(nonNeg(units));
    var out = { found: false, reason: null, l: 0, w: 0, h: 0, volumeCm3: 0,
                grid: null, uprightDim: null, units: n };

    if (!(u[0] > 0 && u[1] > 0 && u[2] > 0)) {
      out.reason = "The unit has a zero or missing side.";
      return out;
    }
    if (n < 1) {
      out.reason = "No units to pack.";
      return out;
    }
    if (n > MAX_RIGHT_SIZE_UNITS) {
      out.reason = "Too many units to search (over " + MAX_RIGHT_SIZE_UNITS + ").";
      return out;
    }

    var bestVol = Infinity, bestLongest = Infinity, bestSecond = Infinity, best = null;

    for (var i = 0; i < ORIENTATIONS.length; i++) {
      var o = ORIENTATIONS[i];
      var a = u[o.order[0]], b = u[o.order[1]], c = u[o.order[2]];
      for (var nx = 1; nx <= n; nx++) {
        var maxNy = Math.ceil(n / nx);
        for (var ny = 1; ny <= maxNy; ny++) {
          var nz = Math.ceil(n / (nx * ny));
          var L = nx * a, W = ny * b, H = nz * c;
          var vol = L * W * H;
          var sides = [L, W, H].sort(ascending);
          var longest = sides[2], second = sides[1];
          var better = vol < bestVol - FIT_EPSILON ||
            (Math.abs(vol - bestVol) <= FIT_EPSILON &&
              (longest < bestLongest - FIT_EPSILON ||
                (Math.abs(longest - bestLongest) <= FIT_EPSILON && second < bestSecond - FIT_EPSILON)));
          if (better) {
            bestVol = vol; bestLongest = longest; bestSecond = second;
            best = { l: L, w: W, h: H, grid: { along: nx, across: ny, layers: nz },
                     uprightDim: DIM_NAMES[o.order[2]], key: o.key };
          }
        }
      }
    }

    if (!best) {
      out.reason = "No grid found.";
      return out;
    }
    out.found = true;
    out.l = tidy(best.l); out.w = tidy(best.w); out.h = tidy(best.h);
    out.volumeCm3 = tidy(bestVol);
    out.grid = best.grid;
    out.uprightDim = best.uprightDim;
    out.orientationKey = best.key;
    return out;
  }

  /* ------------------------------------------------------------------ *
   * The whole page in one call. Takes raw field values, normalises units,
   * returns plain numbers in centimetres and kilograms plus a list of issues
   * worth telling the user about.
   * ------------------------------------------------------------------ */
  function analyse(input) {
    input = input || {};
    var unitsIn = input.units || {};
    var lengthUnit = unitsIn.length === "in" ? "in" : "cm";
    var massUnit = unitsIn.mass === "lb" ? "lb" : "kg";

    var mode = modeById(input.modeId);
    var issues = [];

    var divisorCm3PerKg = divisorToCm3PerKg(input.divisor, lengthUnit, massUnit);
    if (!(divisorCm3PerKg > 0)) {
      issues.push("The divisor must be more than zero, so volumetric weight has been left out of the comparison. Put the figure from your rate card in.");
    }

    /* The rate is quoted per unit of mass, so it scales the OPPOSITE way to a
     * mass: money per pound is more money per kilogram. A revenue-tonne rate is
     * already metric and is left alone. */
    var rateEntered = nonNeg(input.rate);
    var rate = rateEntered;
    if (mode.basis !== "revenueTonne" && massUnit === "lb") {
      rate = tidy(rateEntered / KG_PER_POUND);
    }
    var roundStepKg = toKg(nonNeg(input.roundStep), massUnit);
    if (mode.basis === "revenueTonne" && roundStepKg > 0) {
      issues.push("Sea LCL bills in revenue tonnes to three decimals, so the kilo rounding step is not applied in this mode.");
    }

    /* A box or a weight below zero is a typo, not a measurement. Read it as
     * zero, and say so rather than quietly computing on it. */
    var unitRaw = input.unit || {};
    var cartonRaw = input.carton || {};
    var palletRaw = input.pallet || {};
    var negatives = [unitRaw.l, unitRaw.w, unitRaw.h, unitRaw.weight,
                     cartonRaw.l, cartonRaw.w, cartonRaw.h, cartonRaw.board,
                     cartonRaw.tare, cartonRaw.weighed, cartonRaw.unitsShipped,
                     cartonRaw.pieces, palletRaw.l, palletRaw.w,
                     palletRaw.maxStack, palletRaw.deck, input.rate, input.divisor];
    for (var ni = 0; ni < negatives.length; ni++) {
      if (num(negatives[ni]) < 0) {
        issues.push("A figure below zero has been read as zero. Dimensions and weights cannot be negative.");
        break;
      }
    }

    /* ---- the unit ---- */
    var unitCm = {
      l: nonNeg(toCm(unitRaw.l, lengthUnit)),
      w: nonNeg(toCm(unitRaw.w, lengthUnit)),
      h: nonNeg(toCm(unitRaw.h, lengthUnit))
    };
    var unitWeightKg = nonNeg(toKg(unitRaw.weight, massUnit));
    var unitVolumeCm3 = tidy(unitCm.l * unitCm.w * unitCm.h);
    if (!(unitVolumeCm3 > 0)) {
      issues.push("Enter the unit's length, width and height — all three have to be more than zero.");
    }

    /* ---- the carton ---- *
     * Board thickness is one wall. Blank falls back to the single-wall
     * default, which is a physical thickness and so always in centimetres. */
    var boardCm = isBlank(cartonRaw.board)
      ? DEFAULT_BOARD_CM
      : nonNeg(toCm(cartonRaw.board, lengthUnit));
    var outerCm = {
      l: nonNeg(toCm(cartonRaw.l, lengthUnit)),
      w: nonNeg(toCm(cartonRaw.w, lengthUnit)),
      h: nonNeg(toCm(cartonRaw.h, lengthUnit))
    };
    var outerVolumeCm3 = tidy(outerCm.l * outerCm.w * outerCm.h);
    if (!(outerVolumeCm3 > 0)) {
      issues.push("Enter the carton's outside length, width and height — the carrier measures the outside.");
    }
    var innerCm = {
      l: Math.max(0, tidy(outerCm.l - 2 * boardCm)),
      w: Math.max(0, tidy(outerCm.w - 2 * boardCm)),
      h: Math.max(0, tidy(outerCm.h - 2 * boardCm))
    };
    var innerVolumeCm3 = tidy(innerCm.l * innerCm.w * innerCm.h);
    if (outerVolumeCm3 > 0 && !(innerVolumeCm3 > 0)) {
      issues.push("The board thickness has eaten the whole carton. Check it — it is the thickness of one wall, not both.");
    }

    /* ---- fit ---- */
    var fit = fitBox(unitCm, innerCm);
    var unitsPerCarton = fit.total;
    /* A unit that is too big must be said out loud, not left as a quiet zero.
     * The wording here carries no figures, so it reads the same whichever
     * units the page is in; the sizes are shown beside the fit table. */
    if (unitVolumeCm3 > 0 && innerVolumeCm3 > 0 && !fit.fits) {
      if (fit.blocker) {
        issues.push("The unit does not fit inside this carton, whichever way round you " +
          "turn it: its " + fit.blocker.rank + " side is larger than the carton's " +
          fit.blocker.rank + " inside dimension.");
      } else {
        issues.push("The unit does not fit inside this carton in any orientation.");
      }
    }

    var requested = Math.floor(nonNeg(cartonRaw.unitsShipped));
    var unitsShipped = unitsPerCarton;
    var unitsCapped = false;
    if (requested > 0) {
      if (requested > unitsPerCarton) {
        unitsShipped = unitsPerCarton;
        unitsCapped = true;
        issues.push("You asked for " + requested + " units in the carton but only " +
          unitsPerCarton + " fit this way up, so " + unitsPerCarton + " has been used.");
      } else {
        unitsShipped = requested;
      }
    }

    /* ---- weights ---- */
    var tareKg = nonNeg(toKg(cartonRaw.tare, massUnit));
    var packedKg = tidy(unitsShipped * unitWeightKg + tareKg);
    var weighedKg = nonNeg(toKg(cartonRaw.weighed, massUnit));
    var usedWeighed = weighedKg > 0;
    var actualKg = usedWeighed ? weighedKg : packedKg;
    if (!(actualKg > 0)) {
      issues.push("The carton weighs nothing yet. Enter the weight of one unit and the empty carton, or weigh the packed carton.");
    }

    var pieces = Math.floor(nonNeg(cartonRaw.pieces)) || 1;

    /* ---- the charge ---- */
    var chargeNow = charge({
      basis: mode.basis,
      volumeCm3: outerVolumeCm3,
      actualKg: actualKg,
      divisorCm3PerKg: divisorCm3PerKg,
      roundStepKg: roundStepKg,
      pieces: pieces,
      rate: rate
    });

    var tipping = tippingPoint({
      actualKg: actualKg,
      divisorCm3PerKg: divisorCm3PerKg,
      l: outerCm.l, w: outerCm.w, h: outerCm.h
    });

    /* Fill and void for what is ACTUALLY going in the carton, which is not the
     * same as a full carton when fewer units are being shipped. A half-empty
     * carton is charged on the same cube as a full one, so the void has to be
     * measured against the units in it, not against its capacity. */
    var packedUsedCm3 = tidy(unitsShipped * unitVolumeCm3);
    var packedVoidCm3 = Math.max(0, tidy(innerVolumeCm3 - packedUsedCm3));
    var packed = {
      usedVolumeCm3: packedUsedCm3,
      voidCm3: packedVoidCm3,
      voidLitres: tidy(packedVoidCm3 / CM3_PER_LITRE),
      fillPct: innerVolumeCm3 > 0 ? tidy(packedUsedCm3 / innerVolumeCm3 * 100) : 0
    };

    /* The void, priced. Empty space inside the carton weighs nothing on the
     * scale and plenty on the tape measure. */
    var voidVolumetricKg = volumetricKg(packedVoidCm3, divisorCm3PerKg);

    /* ---- the wedge: the box that stops you paying for air ---- */
    var rs = rightSizeInner(unitCm, unitsShipped);
    var rightSize = {
      found: false,
      reason: rs.reason,
      innerCm: { l: 0, w: 0, h: 0 },
      outerCm: { l: 0, w: 0, h: 0 },
      outerVolumeCm3: 0,
      grid: null,
      uprightDim: null,
      charge: null,
      savingPerCarton: 0,
      savingShipment: 0,
      savingPct: 0,
      smaller: false,
      escapesVolumetric: false
    };
    if (rs.found && outerVolumeCm3 > 0) {
      var rsOuter = {
        l: tidy(rs.l + 2 * boardCm),
        w: tidy(rs.w + 2 * boardCm),
        h: tidy(rs.h + 2 * boardCm)
      };
      var rsVolume = tidy(rsOuter.l * rsOuter.w * rsOuter.h);
      /* Tare is kept as entered. A smaller carton uses less board and weighs
       * less, so the saving below is understated, never overstated. */
      var rsCharge = charge({
        basis: mode.basis,
        volumeCm3: rsVolume,
        actualKg: actualKg,
        divisorCm3PerKg: divisorCm3PerKg,
        roundStepKg: roundStepKg,
        pieces: pieces,
        rate: rate
      });
      rightSize.found = true;
      rightSize.reason = null;
      rightSize.innerCm = { l: rs.l, w: rs.w, h: rs.h };
      rightSize.outerCm = rsOuter;
      rightSize.outerVolumeCm3 = rsVolume;
      rightSize.grid = rs.grid;
      rightSize.uprightDim = rs.uprightDim;
      rightSize.charge = rsCharge;
      rightSize.savingPerCarton = tidy(chargeNow.chargeablePerPieceKg - rsCharge.chargeablePerPieceKg);
      rightSize.savingShipment = tidy(chargeNow.cost - rsCharge.cost);
      rightSize.savingPct = chargeNow.cost > 0
        ? tidy((chargeNow.cost - rsCharge.cost) / chargeNow.cost * 100) : 0;
      rightSize.smaller = rsVolume < outerVolumeCm3 - FIT_EPSILON;
      rightSize.escapesVolumetric =
        chargeNow.chargedOn === "volumetric" && rsCharge.chargedOn !== "volumetric";
    }

    /* ---- pallet ---- */
    var palletCm = {
      l: nonNeg(toCm(palletRaw.l, lengthUnit)),
      w: nonNeg(toCm(palletRaw.w, lengthUnit))
    };
    var maxStackCm = nonNeg(toCm(palletRaw.maxStack, lengthUnit));
    var deckCm = nonNeg(toCm(palletRaw.deck, lengthUnit));
    var usableHeightCm = Math.max(0, tidy(maxStackCm - deckCm));
    if (maxStackCm > 0 && !(usableHeightCm > 0)) {
      issues.push("The pallet deck is as tall as the whole stack allowance, so there is no room for cargo.");
    }
    var palletFit = fitBox(outerCm, { l: palletCm.l, w: palletCm.w, h: usableHeightCm });
    var cartonsPerPallet = palletFit.total;
    var pallet = {
      footprintCm: palletCm,
      maxStackCm: maxStackCm,
      deckCm: deckCm,
      usableHeightCm: usableHeightCm,
      fit: palletFit,
      cartonsPerPallet: cartonsPerPallet,
      unitsPerPallet: cartonsPerPallet * unitsShipped,
      loadedHeightCm: tidy(deckCm + (palletFit.best ? palletFit.best.layers * outerCm.h : 0)),
      grossKg: tidy(cartonsPerPallet * actualKg),
      fillPct: palletFit.fillPct,
      voidLitres: palletFit.voidLitres,
      palletsForShipment: cartonsPerPallet > 0 ? Math.ceil(pieces / cartonsPerPallet) : 0
    };

    /* ---- container ---- */
    var box = containerById(input.containerId);
    var looseFit = fitBox(outerCm, { l: box.lengthCm, w: box.widthCm, h: box.heightCm });
    var floor = floorFit(palletCm.l, palletCm.w, box.lengthCm, box.widthCm);
    var loadedPalletHeight = pallet.loadedHeightCm;
    var container = {
      id: box.id,
      label: box.label,
      internalCm: { l: box.lengthCm, w: box.widthCm, h: box.heightCm },
      doorHeightCm: box.doorHeightCm,
      internalCbm: tidy(box.lengthCm * box.widthCm * box.heightCm / CM3_PER_CUBIC_METRE),
      looseCartons: looseFit.total,
      looseFit: looseFit,
      looseFillPct: looseFit.fillPct,
      palletsOnFloor: floor.count,
      palletTurned: floor.turned,
      floorUtilPct: floor.utilPct,
      cartonsViaPallets: floor.count * cartonsPerPallet,
      palletClearsDoor: loadedPalletHeight > 0
        ? loadedPalletHeight <= box.doorHeightCm + FIT_EPSILON : true
    };
    if (loadedPalletHeight > 0 && !container.palletClearsDoor) {
      issues.push("A loaded pallet at " + tidy(loadedPalletHeight) + " cm is taller than the " +
        box.label + " door opening (" + box.doorHeightCm + " cm). Drop a layer or load the cartons loose.");
    }

    return {
      ok: outerVolumeCm3 > 0 && unitVolumeCm3 > 0 && actualKg > 0 && divisorCm3PerKg > 0,
      issues: issues,
      units: { length: lengthUnit, mass: massUnit },
      mode: mode,
      divisorCm3PerKg: tidy(divisorCm3PerKg),
      divisorIsImperial: divisorIsImperial(lengthUnit, massUnit),
      rate: tidy(rate),              // per kilogram, or per revenue tonne
      rateEntered: tidy(rateEntered),
      roundStepKg: tidy(roundStepKg),
      unit: { cm: unitCm, volumeCm3: unitVolumeCm3, weightKg: unitWeightKg },
      carton: {
        outerCm: outerCm, innerCm: innerCm, boardCm: boardCm,
        outerVolumeCm3: outerVolumeCm3, innerVolumeCm3: innerVolumeCm3,
        outerCbm: tidy(outerVolumeCm3 / CM3_PER_CUBIC_METRE)
      },
      fit: fit,
      packed: packed,
      unitsPerCarton: unitsPerCarton,
      unitsShipped: unitsShipped,
      unitsCapped: unitsCapped,
      unitsRequested: requested,
      weights: {
        tareKg: tareKg, unitWeightKg: unitWeightKg, packedKg: packedKg,
        weighedKg: weighedKg, usedWeighed: usedWeighed, actualKg: tidy(actualKg)
      },
      voidVolumetricKg: voidVolumetricKg,
      charge: chargeNow,
      tipping: tipping,
      rightSize: rightSize,
      pallet: pallet,
      container: container
    };
  }

  var CartonCube = {
    /* constants */
    CM_PER_INCH: CM_PER_INCH,
    KG_PER_POUND: KG_PER_POUND,
    CM3_PER_CUBIC_INCH: CM3_PER_CUBIC_INCH,
    CM3_PER_CUBIC_FOOT: CM3_PER_CUBIC_FOOT,
    CM3_PER_CUBIC_METRE: CM3_PER_CUBIC_METRE,
    CM3_PER_LITRE: CM3_PER_LITRE,
    KG_PER_TONNE: KG_PER_TONNE,
    MM_PER_CM: MM_PER_CM,
    IN3_PER_LB_TO_CM3_PER_KG: IN3_PER_LB_TO_CM3_PER_KG,
    FIT_EPSILON: FIT_EPSILON,
    MODE_AIR_COURIER: MODE_AIR_COURIER,
    MODE_AIR_FREIGHT: MODE_AIR_FREIGHT,
    MODE_SURFACE: MODE_SURFACE,
    MODE_SEA_LCL: MODE_SEA_LCL,
    MODES: MODES,
    DEFAULT_MODE_ID: DEFAULT_MODE_ID,
    SEA_LCL_MINIMUM_REVENUE_TONNES: SEA_LCL_MINIMUM_REVENUE_TONNES,
    ROUND_STEPS: ROUND_STEPS,
    DEFAULT_ROUND_STEP: DEFAULT_ROUND_STEP,
    PALLET_PRESETS: PALLET_PRESETS,
    DEFAULT_PALLET_ID: DEFAULT_PALLET_ID,
    DEFAULT_PALLET_DECK_CM: DEFAULT_PALLET_DECK_CM,
    DEFAULT_MAX_STACK_CM: DEFAULT_MAX_STACK_CM,
    CONTAINER_PRESETS: CONTAINER_PRESETS,
    DEFAULT_CONTAINER_ID: DEFAULT_CONTAINER_ID,
    DEFAULT_BOARD_CM: DEFAULT_BOARD_CM,
    INDICATIVE_RATES: INDICATIVE_RATES,
    MAX_RIGHT_SIZE_UNITS: MAX_RIGHT_SIZE_UNITS,
    FIT_METHOD_NOTE: FIT_METHOD_NOTE,
    ORIENTATIONS: ORIENTATIONS,
    DIM_NAMES: DIM_NAMES,
    /* helpers */
    num: num,
    nonNeg: nonNeg,
    isBlank: isBlank,
    howMany: howMany,
    ceilTo: ceilTo,
    toCm: toCm,
    fromCm: fromCm,
    toKg: toKg,
    fromKg: fromKg,
    divisorIsImperial: divisorIsImperial,
    divisorToCm3PerKg: divisorToCm3PerKg,
    divisorFromCm3PerKg: divisorFromCm3PerKg,
    modeById: modeById,
    modeDivisorForUnits: modeDivisorForUnits,
    palletById: palletById,
    containerById: containerById,
    /* rules */
    volumetricKg: volumetricKg,
    charge: charge,
    tippingPoint: tippingPoint,
    fitBox: fitBox,
    floorFit: floorFit,
    rightSizeInner: rightSizeInner,
    analyse: analyse
  };

  if (typeof module === "object" && module && module.exports) {
    module.exports = CartonCube;
  } else {
    root.CartonCube = CartonCube;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
