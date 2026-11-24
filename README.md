# Volumetric weight and carton-fit calculator for parcel shippers

A free, open-source single-page calculator for the packing bench. It answers two
questions that are really one question:

1. **What will the carrier actually bill?** The greater of the scale weight and
   the volumetric weight — and *which of the two is doing the charging, by how
   much, and in money.*
2. **How many units go in the carton, and how many cartons go on a pallet or in
   a container?** With the cube fill, the void left over, and the void priced as
   the weight it will be billed as.

They are one question because the void inside a carton weighs nothing on the
scale and plenty on the tape measure. So the page finishes by naming the smaller
carton that holds the same units — and, when it can, drops the parcel back onto
its actual weight.

## The divisor is the whole game

Volumetric weight is `length × width × height ÷ divisor`, and the divisor is
chosen by the carrier. The same unchanged carton can be billed at three
different weights on the same day:

| Mode | Divisor | Reads as | Billed on volume if lighter than |
|---|---|---|---|
| Air courier / express | 5,000 cm³/kg (139 in³/lb) | the 1:5 ratio | 200 kg per cubic metre |
| Air freight | 6,000 cm³/kg (166 in³/lb) | the air-cargo 1:6 ratio | 167 kg per cubic metre |
| Surface / road | 4,000 cm³/kg | a denser 1:4 ratio | 250 kg per cubic metre |
| Sea LCL | 1,000 cm³/kg | the weight-or-measurement rule, 1 CBM : 1 tonne | 1,000 kg per cubic metre |

**Every one of these is indicative.** They are the figures that turn up most
often on rate cards in India and the Philippines, not a standard anyone is
obliged to follow, and a single contract can override any of them. They live in
one place in the code — the `MODE_*` constants in `assets/cube.js` — and the
divisor on the page is a plain editable field, so put the number from your own
rate card in before you trust a rupee or a peso here.

Two details worth knowing. The round 4,000 on surface cards is not arbitrary:
road freight quoted per cubic foot at 7 kg to the cubic foot works out at 4,045
cm³/kg. And sea LCL is not a different rule at all — billing the greater of the
cubic metres and the metric tonnes *is* the same comparison with a divisor of
1,000, which is why this page runs one piece of arithmetic for all four modes
and changes only the billing unit and the one-revenue-tonne minimum.

## What it computes

- **Chargeable weight** per carton and for the shipment, rounded up to the
  carrier's step, and the freight at your own rate.
- **Which weight is charging you** — named, with the gap in kilograms, as a
  percentage, and in money. The money figure comes from pricing the shipment a
  second time with the volume rule switched off and taking the difference, so it
  carries the rounding and the minimum.
- **The exact boundary.** The two weights cross at one volume:
  `break-even volume = actual weight × divisor`. From that come the break-even
  density, the tipping height (hold the length and width — this is the height at
  which the box flips over), and the same box scaled onto the line.
- **Units per carton** — the best of the six axis-aligned orientations, with the
  grid, the cube fill and the void in litres and in billable kilograms.
- **Cartons per pallet** and cartons per container, loose-loaded and via pallets,
  with a check that a loaded pallet clears the container's door opening.
- **The right-size carton** — the smallest grid box that holds the units you are
  actually shipping, priced against the carton you are using.

## Who it's for

Direct-to-consumer and marketplace sellers, third-party logistics operators, and
exporters pricing a domestic leg — in India and the Philippines, in rupees or
pesos, in centimetres and kilograms or in inches and pounds.

## The named standards

There is no regulation here. There are conventions, and this is where they come
from:

- **The 1:6 air-cargo volumetric ratio** (6,000 cm³ to the kilogram, quoted as
  166 in³/lb) is the long-standing air-cargo convention published in the air
  cargo tariff rules and used by airlines and consolidators.
- **The 1:5 courier divisor** (5,000 cm³/kg, 139 in³/lb) is carrier practice on
  express and courier traffic, not a published standard.
- **The weight-or-measurement (W/M) revenue tonne** is the standard LCL ocean
  freight basis: the greater of one cubic metre and one metric tonne.
- **ISO 6780** defines the pallet footprints offered: 1200 × 1000, 1200 × 800,
  1219 × 1016 (the 48 × 40 inch pallet) and 1100 × 1100 mm.
- **Container internal dimensions** are the commonly published figures for 20'
  GP, 40' GP and 40' HC dry boxes. They vary by builder and by age of the box, so
  they are indicative.

## How to run

A static page with no dependencies and no network calls. Serve the folder:

```sh
python3 -m http.server 8137
```

Then open <http://localhost:8137/>. If that port is busy, any other will do.
Opening `index.html` straight off disk also works. Everything is computed in the
browser; nothing you type leaves your device.

## Checking the arithmetic

All the rules live in `assets/cube.js`, a pure module with no DOM, no clock and
no network access, so they can be exercised on their own:

```sh
node tests/cube.test.js
```

That runs a table of scenarios and edge cases and asserts a set of invariants
over every one of them. It covers the unit conversions in both directions
(including that 139 in³/lb and 5,000 cm³/kg are the same rule written twice, and
that a shipment entered in inches and pounds produces the identical answer to the
same shipment in centimetres and kilograms); the exact boundary where volumetric
overtakes actual weight, swept across six weight-and-divisor pairs at the line
and a hair either side of it; zero and negative dimensions; a zero divisor; a
unit larger than the carton, with the blocking side named for each of the three
size positions; the carton rounding steps; the sea LCL revenue-tonne minimum; and
the rule that no result field is ever `NaN` or `Infinity`. The sorted-sides fit
test is also checked against a brute-force sweep of all six orientations over
several hundred shapes.

## Honesty about scope

**The fit counts are not a packing optimum.** They are an axis-aligned
orientation check: every unit lies the same way up in a regular grid, and the
best of the six orientations is reported. Mixed orientations, interlocked and
pinwheel layers, nesting and a little squeeze on a soft product all beat it, and
the gap is not small — a 20-foot container takes eleven 1200 × 800 pallets on a
mixed floor pattern where this grid check finds eight. Read every count as a safe
floor you can certainly achieve, never as an optimum, and never as a reason to
tell a packer they are doing it wrong. This page is not a bin-packing solver and
does not pretend to be one.

Other limits worth saying plainly:

- **The divisor, the rounding step and the rate are yours.** Nothing on this page
  is a quotation. Fuel, security, remote-area, residential and handling
  surcharges, demurrage, duties and taxes are all out of scope.
- **Some carriers round each dimension up** to the next whole centimetre before
  multiplying. This page uses the figures you type.
- **Carriers measure the outside at its widest point** — tape, bulge and
  protruding labels included. Measure the carton as it leaves the bench.
- **A mixed shipment has to be checked carton by carton.** All cartons here are
  treated as identical, and some carriers compare the summed volume of a whole
  shipment against its summed scale weight rather than working piece by piece.
- **The right-size carton assumes no clearance** between units and no dunnage,
  and keeps the empty-carton weight you entered. A smaller box uses less board,
  so the saving is understated rather than overstated. Carton makers work to the
  sizes and flutes they stock: round it up to one they quote.
- **Pallets on a container floor** are a single tier in one orientation. Overhang
  is not allowed for. Double-stacking is often possible if the cargo bears the
  load.

MIT licensed.
