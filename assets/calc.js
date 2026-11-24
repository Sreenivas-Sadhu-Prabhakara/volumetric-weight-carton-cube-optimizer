/* Volumetric weight and carton fit — page wiring.
 * Reads the form, hands plain values to the pure rules module in cube.js,
 * formats what comes back. No dependencies, no network.
 */
(function () {
  "use strict";

  var P = window.CartonCube;
  if (!P) { return; }

  function byId(id) { return document.getElementById(id); }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  /* ---------------- state ---------------- */

  var sys = "metric";                        // metric | imperial
  var cur = "INR";                           // INR | PHP
  var modeId = P.DEFAULT_MODE_ID;
  var roundStep = P.DEFAULT_ROUND_STEP;      // in the display mass unit
  var palletId = P.DEFAULT_PALLET_ID;
  var containerId = P.DEFAULT_CONTAINER_ID;

  var SYMBOL = { INR: "₹", PHP: "₱" };
  var LOCALE = { INR: "en-IN", PHP: "en-PH" };

  var LENGTH_FIELDS = ["unitL", "unitW", "unitH", "cartonL", "cartonW", "cartonH",
                       "board", "palletL", "palletW", "maxStack", "deck"];
  var MASS_FIELDS = ["unitWeight", "tare", "weighed"];
  var COUNT_FIELDS = ["pieces", "unitsShipped"];
  var ALL_FIELDS = LENGTH_FIELDS.concat(MASS_FIELDS, COUNT_FIELDS, ["divisor", "rate"]);

  /* Reset clears every field, then the seed functions below put back the ones
   * that come from the named constants in cube.js — the divisor, the rate, the
   * board thickness and the pallet figures — and leave the shipment's own
   * measurements blank for the user to type.
   */

  function lenUnit() { return sys === "imperial" ? "in" : "cm"; }
  function massUnit() { return sys === "imperial" ? "lb" : "kg"; }
  function mode() { return P.modeById(modeId); }
  function isRevenueTonne() { return mode().basis === "revenueTonne"; }

  /* ---------------- formatting ---------------- */

  function fmt(n, digits) {
    if (!isFinite(n)) { n = 0; }
    try {
      return new Intl.NumberFormat(LOCALE[cur], {
        minimumFractionDigits: 0, maximumFractionDigits: digits
      }).format(n);
    } catch (e) {
      return String(Math.round(n * 1000) / 1000);
    }
  }

  function money(n) {
    if (!isFinite(n)) { n = 0; }
    var digits = Math.abs(n) >= 1000 ? 0 : 2;
    try {
      return new Intl.NumberFormat(LOCALE[cur], {
        style: "currency", currency: cur,
        minimumFractionDigits: digits, maximumFractionDigits: digits
      }).format(n);
    } catch (e) {
      return SYMBOL[cur] + fmt(n, digits);
    }
  }

  function pct(n, digits) { return fmt(n, digits === undefined ? 1 : digits) + "%"; }

  function len(cm, digits) {
    return fmt(P.fromCm(cm, lenUnit()), digits === undefined ? 1 : digits) + " " + lenUnit();
  }

  function dims(o, digits) {
    var d = digits === undefined ? 1 : digits;
    return fmt(P.fromCm(o.l, lenUnit()), d) + " × " +
           fmt(P.fromCm(o.w, lenUnit()), d) + " × " +
           fmt(P.fromCm(o.h, lenUnit()), d) + " " + lenUnit();
  }

  function pair(aCm, bCm, digits) {
    var d = digits === undefined ? 1 : digits;
    return fmt(P.fromCm(aCm, lenUnit()), d) + " × " +
           fmt(P.fromCm(bCm, lenUnit()), d) + " " + lenUnit();
  }

  function mass(kg, digits) {
    return fmt(P.fromKg(kg, massUnit()), digits === undefined ? 2 : digits) + " " + massUnit();
  }

  /* Cubic metres matter to anyone shipping LCL, and a parcel is a small
   * fraction of one, so small figures get more decimals rather than rounding
   * away to 0.05. */
  function cbm(cm3) {
    var v = cm3 / P.CM3_PER_CUBIC_METRE;
    return fmt(v, v < 1 ? 4 : 2) + " CBM";
  }

  /* A parcel-sized volume in cubic metres or cubic feet rounds to zero and
   * tells the reader nothing, so below that it is left off. */
  function volume(cm3) {
    if (sys === "imperial") {
      var ft3 = cm3 / P.CM3_PER_CUBIC_FOOT;
      return fmt(cm3 / P.CM3_PER_CUBIC_INCH, 0) + " in³" +
             (ft3 >= 0.005 ? " · " + fmt(ft3, 2) + " ft³" : "");
    }
    return fmt(cm3, 0) + " cm³" +
           (cm3 / P.CM3_PER_CUBIC_METRE >= 0.00005 ? " · " + cbm(cm3) : "");
  }

  /* A void reads best in litres, and litres have no place on a page in inches. */
  function voidVolume(cm3) {
    if (sys === "imperial") {
      return fmt(cm3 / P.CM3_PER_CUBIC_INCH, 0) + " in³ · " +
             fmt(cm3 / P.CM3_PER_CUBIC_FOOT, 2) + " ft³";
    }
    return fmt(cm3, 0) + " cm³ · " + fmt(cm3 / P.CM3_PER_LITRE, 1) + " L";
  }

  function tonnes(kg) { return fmt(kg / P.KG_PER_TONNE, 3) + " t"; }

  function density(kgPerCbm) {
    if (sys === "imperial") {
      /* pounds per cubic foot keeps an inch-and-pound rate card readable */
      return fmt(kgPerCbm / P.KG_PER_POUND * (P.CM3_PER_CUBIC_FOOT / P.CM3_PER_CUBIC_METRE), 1) + " lb/ft³";
    }
    return fmt(kgPerCbm, 0) + " kg/CBM";
  }

  function count(n) { return fmt(n, 0); }

  function set(id, text) {
    var el = byId(id);
    if (el) { el.textContent = text; }
  }

  function round(n, d) {
    var f = Math.pow(10, d);
    return String(Math.round(n * f) / f);
  }

  /* ---------------- reading the form ---------------- */

  function val(id) {
    var el = byId(id);
    return el ? el.value : "";
  }

  function readInput() {
    return {
      units: { length: lenUnit(), mass: massUnit() },
      modeId: modeId,
      divisor: val("divisor"),
      rate: val("rate"),
      roundStep: roundStep,
      unit: { l: val("unitL"), w: val("unitW"), h: val("unitH"), weight: val("unitWeight") },
      carton: {
        l: val("cartonL"), w: val("cartonW"), h: val("cartonH"),
        board: val("board"), tare: val("tare"),
        unitsShipped: val("unitsShipped"), weighed: val("weighed"), pieces: val("pieces")
      },
      pallet: { l: val("palletL"), w: val("palletW"), maxStack: val("maxStack"), deck: val("deck") },
      containerId: containerId
    };
  }

  /* ---------------- labels that follow the toggles ---------------- */

  function paintSeg(attr, value) {
    all("[" + attr + "]").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute(attr) === String(value) ? "true" : "false");
    });
  }

  function paintUnitLabels() {
    all(".len-suf").forEach(function (s) { s.textContent = lenUnit(); });
    all(".mass-suf").forEach(function (s) { s.textContent = massUnit(); });
    set("divisor-unit", sys === "imperial" ? "in³/lb" : "cm³/kg");
    all("[data-round]").forEach(function (b) {
      var v = b.getAttribute("data-round");
      b.textContent = v === "0" ? "None" : v + " " + massUnit();
    });
    set("rate-unit", isRevenueTonne() ? "/RT" : "/" + massUnit());
    set("rate-hint", isRevenueTonne() ? "per revenue tonne, from your own quote"
                                      : "from your own rate card");
    set("rate-sym", SYMBOL[cur]);
    set("mode-note", mode().note);
    var box = P.containerById(containerId);
    set("c-loose-label", "Cartons loose-loaded in a " + box.label);
    set("c-pallets-label", "Pallets on a " + box.label + " floor");
    set("s-cost-label", isRevenueTonne() ? "Freight on the billed revenue tonnes"
                                         : "Freight on the chargeable weight");
    var rtRow = byId("row-rt");
    if (rtRow) { rtRow.hidden = !isRevenueTonne(); }
  }

  /* ---------------- seeding ---------------- */

  function seedDivisor() {
    var el = byId("divisor");
    if (el) { el.value = round(P.modeDivisorForUnits(modeId, lenUnit(), massUnit()), 2); }
  }

  function seedRate() {
    var el = byId("rate");
    if (!el) { return; }
    var r = P.INDICATIVE_RATES[cur];
    if (isRevenueTonne()) { el.value = round(r.perRevenueTonne, 2); return; }
    /* The table is per kilogram; a page in pounds quotes less money per pound. */
    el.value = round(sys === "imperial" ? r.perKg * P.KG_PER_POUND : r.perKg, 2);
  }

  function seedPallet() {
    var p = P.palletById(palletId);
    if (p.id === "custom") { return; }
    var l = byId("palletL"), w = byId("palletW");
    if (l) { l.value = round(P.fromCm(p.lengthMm / P.MM_PER_CM, lenUnit()), 2); }
    if (w) { w.value = round(P.fromCm(p.widthMm / P.MM_PER_CM, lenUnit()), 2); }
  }

  function seedBench() {
    var b = byId("board");
    if (b) { b.value = round(P.fromCm(P.DEFAULT_BOARD_CM, lenUnit()), 2); }
    var m = byId("maxStack");
    if (m) { m.value = round(P.fromCm(P.DEFAULT_MAX_STACK_CM, lenUnit()), 2); }
    var d = byId("deck");
    if (d) { d.value = round(P.fromCm(P.DEFAULT_PALLET_DECK_CM, lenUnit()), 2); }
  }

  /* ---------------- switching units keeps the shipment ---------------- */

  function switchSystem(next) {
    if (next === sys) { return; }
    var fromL = sys === "imperial" ? "in" : "cm";
    var toL = next === "imperial" ? "in" : "cm";
    var fromM = sys === "imperial" ? "lb" : "kg";
    var toM = next === "imperial" ? "lb" : "kg";

    /* Enough decimals that a value survives a trip out and back unchanged:
     * an inch reads to 2 places, a centimetre to 1, and 18.9 in converts back
     * to 48.0 cm rather than drifting to 48.01. */
    var lenDp = toL === "in" ? 2 : 1;
    var massDp = toM === "lb" ? 3 : 2;

    LENGTH_FIELDS.forEach(function (id) {
      var el = byId(id);
      if (el && el.value !== "") { el.value = round(P.fromCm(P.toCm(el.value, fromL), toL), lenDp); }
    });
    MASS_FIELDS.forEach(function (id) {
      var el = byId(id);
      if (el && el.value !== "") { el.value = round(P.fromKg(P.toKg(el.value, fromM), toM), massDp); }
    });
    var rate = byId("rate");
    if (rate && rate.value !== "" && !isRevenueTonne()) {
      var perKg = fromM === "lb" ? P.num(rate.value) / P.KG_PER_POUND : P.num(rate.value);
      rate.value = round(toM === "lb" ? perKg * P.KG_PER_POUND : perKg, toM === "lb" ? 4 : 2);
    }
    var div = byId("divisor");
    if (div && div.value !== "") {
      var cm3 = P.divisorToCm3PerKg(div.value, fromL, fromM);
      div.value = round(P.divisorFromCm3PerKg(cm3, toL, toM), toL === "in" ? 1 : 0);
    }

    sys = next;
    paintSeg("data-sys", sys);
    paintUnitLabels();
    fillReference();
    compute();
  }

  /* ---------------- rendering ---------------- */

  var CHARGE_CELLS = ["r-outer", "r-volume", "r-actual", "r-vol", "r-round", "r-charge",
                      "s-pieces", "s-weight", "s-rt", "s-cost", "s-costactual", "s-void",
                      "t-breakeven", "t-density", "t-mydensity", "t-head", "t-tipheight",
                      "t-evenbox", "w-now-dims", "w-now-kg", "w-now-cost", "w-rs-dims",
                      "w-rs-kg", "w-rs-cost", "w-save-kg", "w-save"];
  var FIT_CELLS = ["f-inner", "f-unit", "f-orient", "f-perlayer", "f-layers", "f-total",
                   "f-fill", "f-void", "f-voidkg"];
  /* The pallet and container counts depend on the CARTON, not on whether the
   * unit fits inside it, so they are gated separately. */
  var PALLET_CELLS = ["p-foot", "p-usable", "p-grid", "p-total", "p-units", "p-load",
                      "p-fill", "c-loose", "c-pallets"];

  function dash(ids) { ids.forEach(function (id) { set(id, "—"); }); }

  function render(r) {
    var ch = r.charge;
    var chargeOk = r.carton.outerVolumeCm3 > 0 && r.weights.actualKg > 0 && r.divisorCm3PerKg > 0;
    var fitOk = r.fit.fits;

    /* ---- the issues note ---- */
    var issues = byId("out-issues");
    if (issues) {
      if (r.issues.length) {
        issues.hidden = false;
        issues.textContent = r.issues.join(" ");
      } else {
        issues.hidden = true;
        issues.textContent = "";
      }
    }

    set("fit-method", P.FIT_METHOD_NOTE);

    /* ---- headline ---- */
    if (!chargeOk) {
      set("out-k", "Chargeable weight, one carton");
      set("out-main", "—");
      set("out-sub", "The scale weight, the three outside dimensions and a divisor above zero are all needed.");
      set("pill-basis", "—");
      set("pill-density", "—");
      set("pill-tip", "—");
      set("out-verdict", "Enter the unit, the carton and the divisor from your rate card.");
      dash(CHARGE_CELLS);
    } else {
      if (isRevenueTonne()) {
        set("out-k", "Revenue tonnes billed, " + count(ch.pieces) +
          (ch.pieces === 1 ? " carton" : " cartons"));
        set("out-main", fmt(ch.billedRevenueTonnes, 3) + " R/T");
      } else {
        set("out-k", "Chargeable weight, one carton");
        set("out-main", mass(ch.chargeablePerPieceKg, 2));
      }

      /* Sea LCL compares cubic metres with metric tonnes, so say it that way
       * rather than translating the measurement back into kilograms. */
      if (isRevenueTonne()) {
        if (ch.chargedOn === "volumetric") {
          set("out-sub", "The measurement is billing you: " + cbm(ch.volumeCm3 * ch.pieces) +
            " against " + tonnes(ch.shipmentActualKg) + " — the cube, not the weight." +
            (ch.minimumApplied ? " The one-revenue-tonne minimum then applies." : ""));
          set("pill-basis", "Billed on measurement");
        } else if (ch.chargedOn === "tie") {
          set("out-sub", "Exactly on the line: " + cbm(ch.volumeCm3 * ch.pieces) +
            " and " + tonnes(ch.shipmentActualKg) + " come to the same revenue tonnage.");
          set("pill-basis", "Exactly on the line");
        } else {
          set("out-sub", "The weight is billing you: " + tonnes(ch.shipmentActualKg) +
            " against " + cbm(ch.volumeCm3 * ch.pieces) + " — dense enough to pay by the tonne.");
          set("pill-basis", "Billed on weight");
        }
      } else if (ch.chargedOn === "volumetric") {
        set("out-sub", "The tape measure is billing you: " + mass(ch.volumetricKg, 2) +
          " against " + mass(ch.actualKg, 2) + " on the scale — " + mass(ch.excessKg, 2) +
          " more, up " + pct(ch.excessPct) + ".");
        set("pill-basis", "Billed on volume");
      } else if (ch.chargedOn === "tie") {
        set("out-sub", "Exactly on the line: both weights come to " + mass(ch.actualKg, 2) +
          ". One more centimetre and volume takes over.");
        set("pill-basis", "Exactly on the line");
      } else {
        set("out-sub", "The scale is billing you: " + mass(ch.actualKg, 2) + " against " +
          mass(ch.volumetricKg, 2) + " on the tape measure — " +
          mass(ch.actualKg - ch.volumetricKg, 2) + " of slack before volume takes over.");
        set("pill-basis", "Billed on the scale");
      }
      /* "161 vs 200 kg/CBM" — the parcel against the break-even density, which
       * is the whole rule in five characters. */
      set("pill-density", fmt(sys === "imperial"
          ? ch.densityKgPerCbm / P.KG_PER_POUND * (P.CM3_PER_CUBIC_FOOT / P.CM3_PER_CUBIC_METRE)
          : ch.densityKgPerCbm, sys === "imperial" ? 1 : 0) +
        " vs " + density(r.tipping.breakEvenDensityKgPerCbm));
      set("pill-tip", "Tips over at " + len(r.tipping.tippingHeightCm, 1) + " high");

      set("r-outer", dims(r.carton.outerCm, 1));
      set("r-volume", volume(r.carton.outerVolumeCm3));
      set("r-actual", mass(ch.actualKg, 2) +
        (r.weights.usedWeighed ? " (weighed)" : " (computed)"));
      set("r-vol-label", "Volumetric weight, ÷ " +
        fmt(P.divisorFromCm3PerKg(r.divisorCm3PerKg, lenUnit(), massUnit()),
          sys === "imperial" ? 1 : 0) + " " + (sys === "imperial" ? "in³/lb" : "cm³/kg"));
      set("r-vol", mass(ch.volumetricKg, 2));
      set("r-round-label", ch.roundStepKg > 0
        ? "Rounded up by the " + mass(ch.roundStepKg, 2) + " step"
        : "No rounding step applied");
      set("r-round", ch.roundingAddedKg > 0 ? "+ " + mass(ch.roundingAddedKg, 3) : "—");
      set("r-charge", mass(ch.chargeablePerPieceKg, 2));

      set("s-pieces", count(ch.pieces));
      set("s-weight", mass(ch.shipmentChargeableKg, 2));
      set("s-rt-label", "Revenue tonnes billed" +
        (ch.minimumApplied ? ", one R/T minimum applied" : ""));
      set("s-rt", fmt(ch.revenueTonnes, 3) + " → " + fmt(ch.billedRevenueTonnes, 3) + " R/T");
      set("s-cost", money(ch.cost));
      set("s-costactual", money(ch.costOnActualOnly));
      set("s-void", ch.costOfVoid > 0 ? money(ch.costOfVoid) : money(0));

      set("t-breakeven", volume(r.tipping.breakEvenVolumeCm3));
      set("t-density", density(r.tipping.breakEvenDensityKgPerCbm));
      set("t-mydensity", density(ch.densityKgPerCbm));
      set("t-head-label", r.tipping.overTheLine
        ? "Volume you would have to lose"
        : "Volume headroom left");
      set("t-head", r.tipping.overTheLine
        ? volume(-r.tipping.headroomCm3) +
          (r.tipping.volumeCutNeededPct >= 0.1
            ? " · " + pct(r.tipping.volumeCutNeededPct) + " of the box, or " +
              pct(r.tipping.linearCutNeededPct) + " off every side"
            : "")
        : volume(r.tipping.headroomCm3));
      set("t-tipheight", len(r.tipping.tippingHeightCm, 1) + " (now " +
        len(r.carton.outerCm.h, 1) + ")");
      set("t-evenbox", dims(r.tipping.evenBoxCm, 1));

      /* ---- the wedge ---- */
      set("w-now-dims", "Your carton, " + dims(r.carton.outerCm, 1));
      set("w-now-kg", isRevenueTonne() ? fmt(ch.billedRevenueTonnes, 3) + " R/T"
                                       : mass(ch.chargeablePerPieceKg, 2));
      set("w-now-cost", money(ch.cost));
      if (r.rightSize.found) {
        var rs = r.rightSize;
        set("w-rs-dims", "Right-size carton, " + dims(rs.outerCm, 1));
        set("w-rs-kg", isRevenueTonne() ? fmt(rs.charge.billedRevenueTonnes, 3) + " R/T"
                                        : mass(rs.charge.chargeablePerPieceKg, 2));
        set("w-rs-cost", money(rs.charge.cost));
        /* Both cells on this row are shipment totals, so they can be read
         * across without converting one of them in your head. */
        set("w-save-kg", isRevenueTonne()
          ? fmt(ch.billedRevenueTonnes - rs.charge.billedRevenueTonnes, 3) + " R/T"
          : mass(rs.savingPerCarton * ch.pieces, 2));
        set("w-save", rs.savingShipment > 0
          ? money(rs.savingShipment) + " · " + pct(rs.savingPct) : money(0));
        set("w-note", "Right-size carton: " + count(rs.grid.along) + " along × " +
          count(rs.grid.across) + " across × " + count(rs.grid.layers) + " high, the unit's " +
          rs.uprightDim + " upright, " + dims(rs.outerCm, 1) + " outside at " +
          len(r.carton.boardCm, 1) + " board. No clearance between units is allowed for and " +
          "the empty-carton weight is kept as entered, so the saving is a floor, not a " +
          "promise — round the size up to one your carton maker stocks.");
      } else {
        set("w-rs-dims", "Right-size carton");
        set("w-rs-kg", "—");
        set("w-rs-cost", "—");
        set("w-save-kg", "—");
        set("w-save", "—");
        if (!r.fit.fits) {
          set("w-note", "No right-size carton can be worked out until the unit fits the " +
            "carton you have entered.");
        } else if (r.unitsShipped > P.MAX_RIGHT_SIZE_UNITS) {
          set("w-note", "Too many units in one carton (" + count(r.unitsShipped) + ") to " +
            "search every grid, so no right-size box is suggested. The fit figures above " +
            "still hold.");
        } else {
          set("w-note", "No right-size carton worked out" +
            (r.rightSize.reason ? ": " + r.rightSize.reason : "."));
        }
      }

      /* ---- the verdict ---- */
      set("out-verdict", verdict(r));
    }

    /* ---- the fit side ---- */
    if (!fitOk) {
      dash(FIT_CELLS);
      set("f-orient", "—");
      set("f-perlayer-label", "Units per layer");
      set("f-fill-label", "Cube fill inside the carton");
      set("p-grid-label", "Cartons per layer × layers");
      if (r.unit.volumeCm3 > 0 && r.carton.innerVolumeCm3 > 0 && r.fit.reason) {
        set("f-inner", dims(r.carton.innerCm, 1));
        set("f-unit", dims(r.unit.cm, 1) + " · " + mass(r.unit.weightKg, 3));
        set("f-orient", "Does not fit");
        set("f-total", "0");
      }
    } else {
      var best = r.fit.best;
      set("f-inner", dims(r.carton.innerCm, 1));
      set("f-unit", dims(r.unit.cm, 1) + " · " + mass(r.unit.weightKg, 3));
      set("f-orient", "the unit's " + best.uprightDim + " upright");
      set("f-perlayer-label", "Units per layer, " + count(best.perRow) + " along × " +
        count(best.rows) + " across");
      set("f-perlayer", count(best.perLayer));
      set("f-layers", count(best.layers));
      set("f-total", count(r.unitsPerCarton) +
        (r.unitsShipped !== r.unitsPerCarton ? " (shipping " + count(r.unitsShipped) + ")" : ""));
      /* Fill and void follow what is going IN the carton, not its capacity. */
      set("f-fill-label", r.unitsShipped === r.unitsPerCarton
        ? "Cube fill inside the carton"
        : "Cube fill with " + count(r.unitsShipped) + " units in it");
      set("f-fill", pct(r.packed.fillPct));
      set("f-void", voidVolume(r.packed.voidCm3));
      set("f-voidkg", r.divisorCm3PerKg > 0 ? mass(r.voidVolumetricKg, 2) : "—");
    }

    /* ---- the pallet and the container ---- */
    var pf = r.pallet;
    if (!(r.carton.outerVolumeCm3 > 0)) {
      dash(PALLET_CELLS);
      set("p-grid-label", "Cartons per layer × layers");
    } else {
      set("p-foot", pair(pf.footprintCm.l, pf.footprintCm.w, 1));
      set("p-usable", len(pf.usableHeightCm, 1));
      if (pf.fit.fits) {
        set("p-grid-label", "Cartons per layer × layers, " + count(pf.fit.best.perRow) +
          " along × " + count(pf.fit.best.rows) + " across");
        set("p-grid", count(pf.fit.best.perLayer) + " × " + count(pf.fit.best.layers));
        set("p-total", count(pf.cartonsPerPallet));
        set("p-units", fitOk ? count(pf.unitsPerPallet) : "—");
        set("p-load", len(pf.loadedHeightCm, 1) + " · " + mass(pf.grossKg, 1));
        set("p-fill", pct(pf.fillPct));
      } else {
        set("p-grid-label", "Cartons per layer × layers");
        set("p-grid", "—");
        set("p-total", "0");
        set("p-units", "0");
        set("p-load", pf.fit.reason ? "carton does not fit the pallet" : "—");
        set("p-fill", "—");
      }
      set("c-loose", count(r.container.looseCartons) + " · " +
        pct(r.container.looseFillPct) + " of the cube");
      set("c-pallets", count(r.container.palletsOnFloor) + " · " +
        count(r.container.cartonsViaPallets) + " cartons, " +
        pct(r.container.floorUtilPct) + " of the floor");
    }
  }

  /* The one sentence worth reading, built from whichever case applies. */
  function verdict(r) {
    var ch = r.charge;
    var rs = r.rightSize;
    if (r.unit.volumeCm3 > 0 && r.carton.innerVolumeCm3 > 0 && !r.fit.fits) {
      return "Nothing fits in this carton yet. " + (r.fit.blocker
        ? "The unit's " + r.fit.blocker.rank + " side, " +
          len(r.fit.blocker.unitCm, 1) + ", is larger than the carton's " +
          r.fit.blocker.rank + " inside dimension, " + len(r.fit.blocker.boxCm, 1) +
          ". The weight figures above are the empty carton only."
        : r.fit.reason);
    }
    if (rs.found && rs.escapesVolumetric && rs.savingShipment > 0) {
      return "A " + dims(rs.outerCm, 1) + " carton holds the same " + count(r.unitsShipped) +
        " units and would be billed on its actual " + mass(ch.actualKg, 2) + " instead of " +
        mass(ch.volumetricKg, 2) + " of air — " + money(rs.savingShipment) + " on these " +
        count(ch.pieces) + " cartons, " + pct(rs.savingPct) + " off the freight.";
    }
    if (rs.found && rs.savingShipment > 0) {
      return "A " + dims(rs.outerCm, 1) + " carton holds the same " + count(r.unitsShipped) +
        " units and saves " + money(rs.savingShipment) + " on these " + count(ch.pieces) +
        " cartons, " + pct(rs.savingPct) + ". It is still billed on volume, because the goods " +
        "themselves are lighter than " + density(r.tipping.breakEvenDensityKgPerCbm) + ".";
    }
    /* Sea LCL with the minimum biting: a smaller carton genuinely cuts the cube
     * and still saves nothing, which is worth saying rather than hiding. */
    if (isRevenueTonne() && ch.minimumApplied) {
      return "The one-revenue-tonne minimum is already the floor on this shipment, so a " +
        "smaller carton cuts the cube — " + cbm(ch.volumeCm3 * ch.pieces) + " now — without " +
        "cutting the bill. Right-sizing only starts to pay once the shipment goes past " +
        "1 R/T, and consolidating into one booking is what helps below it.";
    }
    if (ch.chargedOn === "volumetric") {
      return "The carton is already as tight as a grid of these units allows, so there is no " +
        "box-sized saving left. You are billed on " +
        (isRevenueTonne() ? "measurement" : "volume") + " because the packed goods come to " +
        density(ch.densityKgPerCbm) + " against a break-even of " +
        density(r.tipping.breakEvenDensityKgPerCbm) + " — " +
        (isRevenueTonne()
          ? "only a denser pack, or goods that fill the cube, moves that."
          : "a mode with a larger divisor, or a denser mix in the same box, is the only way down.");
    }
    if (ch.chargedOn === "tie") {
      return "Exactly on the line. This is the largest box of its shape that is still billed " +
        "on the scale — one more centimetre on any side and you start paying for air.";
    }
    return "Billed on the scale, so the box is costing you nothing in air. There is room to " +
      "grow to " + dims(r.tipping.evenBoxCm, 1) + " — the same shape, " +
      volume(r.tipping.breakEvenVolumeCm3) + " — before the tape measure takes over.";
  }

  /* ---------------- reference figures in the assumptions ---------------- */

  function fillReference() {
    var list = byId("ref-modes");
    if (list) {
      while (list.firstChild) { list.removeChild(list.firstChild); }
      P.MODES.forEach(function (m) {
        var li = document.createElement("li");
        var b = document.createElement("strong");
        b.textContent = m.label + " — " + fmt(m.divisorCm3PerKg, 0) + " cm³/kg (" +
          fmt(m.divisorIn3PerLb, 1) + " in³/lb)" + (m.indicative ? ", indicative" : "") + ". ";
        li.appendChild(b);
        li.appendChild(document.createTextNode(m.note));
        list.appendChild(li);
      });
      var li2 = document.createElement("li");
      li2.textContent = "Every divisor above is a starting point, not a rule. Carriers set " +
        "their own, contracts override them, and the figure in the field is yours to change.";
      list.appendChild(li2);
    }

    set("ref-round", "no rounding, a 0.5 " + massUnit() + " step or a 1 " + massUnit() + " step");
    set("ref-board", len(P.DEFAULT_BOARD_CM, 2));
    set("ref-pallets", P.PALLET_PRESETS.filter(function (p) { return p.id !== "custom"; })
      .map(function (p) { return p.label; }).join(", "));
    set("ref-containers", P.CONTAINER_PRESETS.map(function (b) {
      return b.label + " " + b.lengthCm + " × " + b.widthCm + " × " + b.heightCm +
        " cm inside, door " + b.doorHeightCm + " cm";
    }).join("; "));
    set("ref-rates", "₹" + fmt(P.INDICATIVE_RATES.INR.perKg, 0) + " per kg and ₹" +
      fmt(P.INDICATIVE_RATES.INR.perRevenueTonne, 0) + " per revenue tonne; ₱" +
      fmt(P.INDICATIVE_RATES.PHP.perKg, 0) + " per kg and ₱" +
      fmt(P.INDICATIVE_RATES.PHP.perRevenueTonne, 0) + " per revenue tonne");
  }

  /* ---------------- compute ---------------- */

  function compute() {
    render(P.analyse(readInput()));
  }

  /* ---------------- wiring ---------------- */

  function wire() {
    ALL_FIELDS.forEach(function (id) {
      var el = byId(id);
      if (el) { el.addEventListener("input", compute); }
    });

    /* Typing your own pallet size makes the preset custom. */
    ["palletL", "palletW"].forEach(function (id) {
      var el = byId(id);
      if (el) {
        el.addEventListener("input", function () {
          palletId = "custom";
          paintSeg("data-pallet", palletId);
        });
      }
    });

    all("[data-sys]").forEach(function (b) {
      b.addEventListener("click", function () { switchSystem(b.getAttribute("data-sys")); });
    });

    all("[data-cur]").forEach(function (b) {
      b.addEventListener("click", function () {
        cur = b.getAttribute("data-cur");
        paintSeg("data-cur", cur);
        seedRate();
        paintUnitLabels();
        fillReference();
        compute();
      });
    });

    all("[data-mode]").forEach(function (b) {
      b.addEventListener("click", function () {
        var wasRt = isRevenueTonne();
        modeId = b.getAttribute("data-mode");
        paintSeg("data-mode", modeId);
        seedDivisor();
        if (wasRt !== isRevenueTonne()) { seedRate(); }
        paintUnitLabels();
        compute();
      });
    });

    all("[data-round]").forEach(function (b) {
      b.addEventListener("click", function () {
        roundStep = P.num(b.getAttribute("data-round"));
        paintSeg("data-round", roundStep);
        compute();
      });
    });

    all("[data-pallet]").forEach(function (b) {
      b.addEventListener("click", function () {
        palletId = b.getAttribute("data-pallet");
        paintSeg("data-pallet", palletId);
        seedPallet();
        compute();
      });
    });

    all("[data-container]").forEach(function (b) {
      b.addEventListener("click", function () {
        containerId = b.getAttribute("data-container");
        paintSeg("data-container", containerId);
        paintUnitLabels();
        compute();
      });
    });

    var printBtn = byId("print");
    if (printBtn) { printBtn.addEventListener("click", function () { window.print(); }); }

    var resetBtn = byId("reset");
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        ALL_FIELDS.forEach(function (id) {
          var el = byId(id);
          if (el) { el.value = ""; }
        });
        sys = "metric";
        cur = "INR";
        modeId = P.DEFAULT_MODE_ID;
        roundStep = P.DEFAULT_ROUND_STEP;
        palletId = P.DEFAULT_PALLET_ID;
        containerId = P.DEFAULT_CONTAINER_ID;
        paintSeg("data-sys", sys);
        paintSeg("data-cur", cur);
        paintSeg("data-mode", modeId);
        paintSeg("data-round", roundStep);
        paintSeg("data-pallet", palletId);
        paintSeg("data-container", containerId);
        seedDivisor();
        seedRate();
        seedBench();
        seedPallet();
        paintUnitLabels();
        fillReference();
        compute();
      });
    }

    paintSeg("data-sys", sys);
    paintSeg("data-cur", cur);
    paintSeg("data-mode", modeId);
    paintSeg("data-round", roundStep);
    paintSeg("data-pallet", palletId);
    paintSeg("data-container", containerId);
    paintUnitLabels();
    fillReference();
    compute();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
