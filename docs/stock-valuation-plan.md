# Moving weighted average stock valuation

Date: 2026-09-17.

Status: phases 1 through 7 completed on 2026-09-17. The user selected moving
weighted average cost. Receptions, loadings, and counting returns now update
valuation within their stock transactions. Counting preserves original loading
costs and records the split between returned value and cost of goods sold.
Loading and counting reads enforce authorized cost visibility and historical
cost checks. Product stock displays now show reconciled warehouse values,
weighted average costs, and assigned movement values for authorized readers.
Historical preview/apply migration and checked cutover are implemented. The
application database migration has been applied and reconciled: eight products,
136 ledger entries, 56 loading snapshots and seven counting records. A fresh
preview has zero anomalies and zero proposed changes. Future unvalued history
requires reconciliation before loading or counting. The valuation read
permission is granted only to yahia's dedicated role.

## Objective and scope

Track the purchase value of stock remaining in the warehouse, recalculate its
average cost as receptions and returns arrive, and preserve the cost assigned to
goods loaded onto a tour. These historical costs will provide the foundation for
`/rentabilite`.

This phase covers valuation, reception/loading/counting integration, product
display, historical migration, and targeted verification. Building
`/rentabilite` follows this phase. Selling prices remain separately managed.

Use the purchase amounts already recorded on reception lines, currently TTC in
DZD. This is a management valuation based on those amounts; allocation of
additional purchase charges and a separate tax accounting model are outside
this phase.

## Agreed calculation

For a product with warehouse quantity `Q` and purchase value `V`, a reception
adds quantity `q` and its recorded line amount `A`:

```text
New quantity = Q + q
New stock value = V + A
New average unit cost = (V + A) / (Q + q)
```

Use the quantity remaining immediately before the reception, rather than all
quantities ever purchased. Calculate per product and base unit; packaging
quantities are converted to base units by the existing reception flow.

| Operation | Warehouse quantity | Warehouse value | Average unit cost |
| --- | ---: | ---: | ---: |
| Existing stock: 100 units at 50 DA | 100 | 5,000 DA | 50 DA |
| Receive 100 units for 6,000 DA | 200 | 11,000 DA | 55 DA |
| Load 40 units onto a tour | 160 | 8,800 DA | 55 DA |
| Receive 40 units for 2,800 DA | 200 | 11,600 DA | 58 DA |
| Return 10 units from that tour at their original cost | 210 | 12,150 DA | approximately 57.8571 DA |

The tour retains its original assigned cost of 2,200 DA. With 10 units returned,
550 DA returns to the warehouse and 1,650 DA becomes the cost of the 30 units
sold. The later reception does not change that tour's assigned costs.

## Business rules

- A reception updates quantity and value atomically.
- A reservation, reservation release, or preparation-stage cancellation does
  not change physical quantity or valuation.
- Loading transfers purchase value from the warehouse to goods held on the
  tour. Loading alone is not a sale or a realized expense.
- Counting splits the loaded purchase value between returned goods and goods
  sold. Returned goods restore their original assigned value, then the
  warehouse average is recalculated.
- New receptions never change the assigned costs of previous loadings or sales.
- Display the latest reception cost and weighted average as distinct values.
- An explicitly recorded zero purchase amount is valid. A missing or invalid
  amount is unknown, never implicitly zero.
- Empty warehouse stock has zero value and no applicable average unit cost.
- Negative quantity, incompatible base units, broken source links, or unknown
  costs prevent a valuation from being labelled complete.

## Precision and reconciliation

Store monetary totals in integer centimes. Derive the displayed average from
total value and quantity; do not use a rounded displayed unit cost for later
calculations.

Allocate a partial loading proportionally from warehouse value using exact
integer arithmetic and a documented half-up rounding rule. A loading that
empties the warehouse takes its entire remaining value, leaving no residual.
For multiple lines of the same product, allocate the combined withdrawal first,
then distribute its value deterministically across lines.

Allocate the returned share from each line's original loaded value. The sold
share is the remaining value, so:

```text
Loaded value = returned value + cost of goods sold
Warehouse value change = reception value + returned value - loaded value
```

Test numeric limits and avoid unsafe floating-point intermediate calculations.
Minor rounding effects must remain explainable through the recorded totals.

## Proposed data design

Add a valuation service, with calculation helpers separated from database
operations, and a per-product current valuation record containing:

- Product ID, base unit, warehouse quantity, and warehouse value in centimes.
- Valuation status, method/version, update time, and concurrency revision.

Add an immutable valuation ledger linked to existing stock movement IDs and
their reception, reservation, counting, and tour sources. Record quantity/value
changes and the before/after balances. Unique source keys prevent duplicates.

Save the method/version and assigned total purchase value on loaded reservation
lines. Copy those historical costs into counting records with their returned
and sold allocations. Serialize authorized cost fields for the relevant views.

Physical quantity must reconcile with `stockMovements`. The valuation record
does not replace the physical movement history. Warehouse value and value held
on uncounted tours must remain distinguishable.

## Transaction and concurrency integration

Integrate with the existing transactions in:

- `lib/reception-records.js`: reception movement and value addition.
- `lib/tour-loadings.js`: assigned cost snapshot and warehouse value removal.
- `lib/tour-countings.js`: returned value restoration and sold cost allocation.
- `lib/stock-movements.js`: reconciliation and movement presentation.
- `lib/products.js`: authorized valuation summaries for product views.

Use the existing product locks consistently across receptions, loadings, and
returns. Quantity, valuation, ledger entries, and historical snapshots must
commit or roll back together. Transaction retries and repeated confirmations
must not apply value changes twice.

Loading previews should include the assigned costs for authorized readers.
Their confirmation digest must account for valuation changes, so a concurrent
reception or return cannot silently change an approved loading summary. Keep
server-side write calculations authoritative regardless of cost visibility.

## Dates and historical data

Apply a new operation's valuation effect when it is recorded. Retain the
reception date for reporting. A reception entered with an older date does not
retroactively rewrite completed loading or sale costs.

Prepare a migration with preview and apply modes:

1. Inspect source records and stock movements without changing them. Check
   source links, quantities, base units, amounts, and timestamps.
2. Replay operations per product in recording order using source creation,
   loading, and counting timestamps, with stable ordering for equal timestamps.
   Preserve source line order within an operation. Flag ambiguous order when it
   can change the result.
3. Reconstruct warehouse balances, loaded cost snapshots, return allocations,
   and sold costs. Identify goods still held on tours.
4. Produce a report of proposed values and unresolved anomalies. Reconcile
   warehouse quantities with current physical stock before applying.
5. Back up affected records, verify that the preview's source data is unchanged,
   and apply versioned valuation records and cost fields. Preserve original
   reception amounts, physical movements, selling prices, payments, and expenses.
6. Make reruns idempotent and verify quantities and value conservation after
   application. Pause relevant writes during final migration or implement an
   equivalent checked cutover that prevents missed operations.

Products with unresolved history remain explicitly unvalued. Do not fabricate
costs or silently use the latest purchase cost. Resolve affected products before
enabling operations that require complete cost snapshots; assess this impact
in the preview report before rollout.

## Product interface and access

Show `Coût moyen pondéré` and `Valeur du stock en entrepôt` on the product's stock
section. Retain `Dernier coût d'achat` in pricing, with clearly distinct labels.
Show assigned movement values and incomplete valuation states where relevant.

Any updated table or list must use pagination and relevant search/filter
controls. Follow the existing application confirmation-dialog design.

Proposed permission: `stock.valuation.read`. Check it on the server before
returning valuation, cost snapshots, or purchase-margin comparisons. Existing
operation permissions continue to govern reception, loading, and counting
writes. Grant the new permission only to `yahia` through its dedicated
`yahia-full-access` role; do not add it to shared roles or other accounts.

## Implementation sequence

1. Implement exact allocation helpers, valuation records, ledger indexes, and
   reconciliation rules.
2. Add reception valuation updates to the existing reception transaction.
3. Add loading cost snapshots, previews/digests, and warehouse value transfers.
4. Add counting allocations and restoration of returns at original costs.
5. Add authorized product displays and movement values.
6. Implement historical preview/apply migration and checked cutover.
7. Complete targeted verification and reconcile migrated records.
8. Build `/rentabilite` as a subsequent feature using historical sales costs.

### Phase 1 implementation

- `lib/stock-valuation-calculations.js`: exact integer allocations with BigInt
  intermediates, half-up rounding, cumulative allocation across loading lines,
  receipt/loading/return balance transitions, and original loaded-cost splits.
  Average unit cost is a display quotient; calculations use integer totals.
- `lib/stock-valuation-records.js`: constructors and validators for versioned
  current balances and ledger entries, explicit unknown-cost records, and
  physical movement/source-link matching. Ledger constructors copy balances;
  future write services must append entries without rewriting previous ones.
- `lib/stock-valuations.js`: unique product, movement/version, and
  product/version/revision indexes; reconciliation of physical quantities,
  ledger continuity, original return costs, and final record pointers. Its
  database reader accepts a trusted database/session and uses sequential reads
  suitable for a snapshot transaction. It is an internal foundation, with no
  client-facing cost API.
- Focused calculation/record tests and isolated MongoDB integration tests cover
  these foundations. No indexes are automatically installed in the application
  database, and no production data or account permissions have been changed.

Verification completed on 2026-09-17: 27 calculation/record tests and six MongoDB
integration tests passed, including original-return-cost checks, concurrent
duplicate insertion, and reading within a snapshot transaction. ESLint passed
on all seven new JavaScript files. The integration database was temporary and
removed by test cleanup.

Commands for this phase (run the integration command in its own process):

```bash
node --test --experimental-test-isolation=none --test-reporter=spec test/stock-valuation-calculations.test.js test/stock-valuation-records.test.js
node --env-file-if-exists=.env.local --test --experimental-test-isolation=none --test-reporter=spec test/stock-valuations.integration.test.js
./node_modules/.bin/eslint lib/stock-valuation-calculations.js lib/stock-valuation-records.js lib/stock-valuations.js test/stock-valuation-calculations.test.js test/stock-valuation-records.test.js test/stock-valuations.integration.test.js test/helpers/stock-valuation-fixtures.js
```

Before writing application code, read the relevant installed Next.js guides
under `node_modules/next/dist/docs/`. Use arrow functions and single quotes
wherever possible, following the repository instructions.

### Phase 2 implementation

- `lib/reception-stock-valuations.js`: internal transactional reception writer.
  It reads the previous physical movements and ledger under the reception's
  existing product locks, reconciles the current balance, and adds each
  reception line's exact purchase amount and base-unit quantity in source order.
  Complete balances receive one immutable ledger entry per physical movement.
  Current balances and their revision/last-entry pointers update together.
- `lib/reception-records.js`: installs valuation indexes alongside existing
  reception/stock indexes before the transaction, then writes valuation before
  inserting the reception and physical movements in the same transaction.
  Duplicate submission handling remains authoritative; retries cannot apply
  quantity or value twice. Valuation validation errors return a form line error.
- A product with no valuation, movements, ledger, or previous reception can
  initialize at zero before its first receipt. Missing valuation for existing
  history, including net-zero history or receptions lacking stock movements,
  remains `UNVALUED`, with a null value. New quantities follow physical stock,
  and reception amounts remain in their source records for later migration.
- A valid stored balance whose history no longer reconciles becomes `UNVALUED`
  on the next reception. This includes loadings/returns without valuation while
  tour integration remains pending. Its previous ledger entries and revision
  pointer are preserved; new receipt ledger entries await historical replay.
  Unknown value never becomes zero or a partial known total. Malformed stored
  records, incompatible physical units, negative physical quantities, and
  numeric overflow reject the entire reception transaction.
- Existing `receptions.create` authorization still governs writes. No valuation
  fields are added to reception responses, and no new permission is introduced.
  Earlier reception dates remain reporting dates: valuation applies when the
  operation is recorded and does not rewrite prior loaded/returned costs.

Verification completed on 2026-09-17: 15 new reception valuation integration
tests, 16 reception action/access integration tests, six valuation persistence
integration tests, and 27 calculation/record tests passed (64 targeted tests).
Coverage includes packaging conversion, repeated product lines, zero amounts,
concurrent suppliers sharing a product, duplicate submissions, original ledger
preservation, unknown histories, invalid units/balances, numeric overflow, and
rollback of valuation after ledger or physical movement failures. ESLint passed
on all four changed/new JavaScript files. Each integration process used and
removed its own temporary database; no application data or permissions were
changed during verification.

Run each integration command in its own process:

```bash
node --env-file-if-exists=.env.local --test --experimental-test-isolation=none --test-reporter=spec test/reception-stock-valuations.integration.test.js
node --env-file-if-exists=.env.local --test --experimental-test-isolation=none --test-reporter=spec test/reception-actions.authorization.integration.test.js
node --env-file-if-exists=.env.local --test --experimental-test-isolation=none --test-reporter=spec test/stock-valuations.integration.test.js
node --test --experimental-test-isolation=none --test-reporter=spec test/stock-valuation-calculations.test.js test/stock-valuation-records.test.js
./node_modules/.bin/eslint lib/reception-records.js lib/reception-stock-valuations.js test/reception-stock-valuations.integration.test.js test/reception-actions.authorization.integration.test.js
```

Phase 3 adds assigned loading costs, authorized previews/digests, and warehouse
value transfers. Until loading and counting integration and historical migration
are complete, only a fully reconciled valuation reader may describe stock value
as complete; a stored status alone does not establish completeness.

### Phase 3 implementation

- `lib/tour-loading-stock-valuations.js`: internal transactional preparation and
  write services. Reconciles each product's physical movements, ledger, current
  balance, and unit before allocating any cost. Calculates the combined
  withdrawal once per product, then distributes purchase value across lines in
  stable source order using the phase 1 cumulative half-up allocation. Full
  withdrawals leave zero quantity and value, including zero-cost receipts.
- `lib/tour-loadings.js`: preview reads now use a snapshot transaction covering
  permissions, reservations, prices, physical coverage, and valuation. The
  confirmation digest includes assigned purchase costs and the source balance's
  identity, revision, quantities, value, and ledger pointer. A concurrent receipt,
  complete return, or other loading invalidates approval even when the rounded
  assigned amount is unchanged. Hidden costs are still calculated and checked
  by the server, with the same digest for authorized and unauthorized readers.
- Confirmation holds the existing product locks and writes immutable ledger
  entries, warehouse balances, physical movements, reservation cost snapshots,
  and tour status within one transaction. Duplicate confirmations return the
  existing loading without transferring value again. New receptions preserve
  previously assigned loading costs. Reservations and releases do not affect
  valuation.
- Loaded reservations store `purchaseCostAtLoading` with method/version, base
  unit, loaded base-unit quantity, exact total centimes, currency, and the
  reception tax basis. Existing sale-price snapshots remain distinct. The
  current reservation flow permits one active line per product/tour; the
  internal writer also supports multiple source lines for the same product.
- `stock.valuation.read` is checked on the server before serializing purchase
  snapshots or totals in loading previews. The existing `tours.load`,
  `tours.read`, and `pricing.read` requirements continue to govern loading.
  Other reservation/tour readers do not expose the new stored cost fields.
  The loading summary and application confirmation dialog show authorized
  purchase costs alongside the existing sale-price value. Search, filtering,
  and pagination remain available on desktop and mobile.
- Missing, explicitly unknown, malformed, incompatible, or unreconciled
  valuation blocks both preview and confirmation without changing stock or
  snapshots. Historical migration is required for affected products. Counting
  integration remains phase 4: a physical return without valuation makes the
  reconciliation incomplete and blocks subsequent loadings; phase 2 receipts
  continue preserving unknown values rather than inventing costs.
- `npm run access:grant-stock-valuation` grants the new permission only to
  `yahia` through `yahia-full-access`, idempotently. Executed on 2026-09-17; no
  shared role or other account was granted this permission.

Verification completed on 2026-09-17: 33 targeted loading integration tests,
13 tour action/authorization tests, and 15 reception valuation integration
tests passed (61 targeted tests). Loading coverage includes original-cost
return invalidation, repeated source lines, packaging, zero/full withdrawals,
numeric limits, concurrent tours/receptions, retries, permission revocation,
preservation of historical ledger/snapshots, and rollback after ledger or
physical movement failures. ESLint passed on all eight changed/new JavaScript
files. Integration processes used isolated databases and removed them.

The webpack production build passed (`npm run build -- --webpack`). The default
Turbopack build could not bind a worker port in this environment, including after
an escalated retry; it remains an environment limitation. Browser checks against
an isolated database passed at 1440px and 390px: costs and totals, authorization,
search/unit filtering, pagination, styled confirmation, no horizontal overflow,
and the incomplete-history error. A mobile confirmation committed six immutable
cost snapshots and matching warehouse transfers, with no browser exceptions.
The temporary UI server/browser and database were removed after verification.

Run integration commands in separate processes:

```bash
node --env-file-if-exists=.env.local --test --experimental-test-isolation=none --test-reporter=spec test/tour-loadings.integration.test.js
node --env-file-if-exists=.env.local --test --experimental-test-isolation=none --test-reporter=spec test/tour-actions.authorization.integration.test.js
node --env-file-if-exists=.env.local --test --experimental-test-isolation=none --test-reporter=spec test/reception-stock-valuations.integration.test.js
./node_modules/.bin/eslint lib/tour-loadings.js lib/tour-loading-stock-valuations.js lib/permissions.js scripts/grant-stock-valuation-permission.js 'app/(protected)/tournees/[id]/tour-loading-confirmation.js' test/tour-loadings.integration.test.js test/tour-actions.authorization.integration.test.js test/helpers/stock-valuation-fixtures.js
```

### Phase 4 implementation

- `lib/tour-counting-stock-valuations.js`: internal transactional preparation and
  return writer. Reconciles each product's warehouse balance, physical movements,
  and valuation ledger before counting. Validates each original loading snapshot
  against its ledger source, product, tour, reservation, unit, quantity, and cost.
  An existing return for the reservation prevents another transfer. Multiple
  source lines of the same product restore their own assigned costs in stable
  reservation order, with consecutive warehouse revisions.
- Each counting line copies `purchaseCostAtLoading` and stores
  `returnedValueInCentimes` and `costOfGoodsSoldInCentimes`. The original loaded
  value equals those two allocations exactly. Totals are stored as
  `totalPurchaseCostInCentimes`, `totalReturnedValueInCentimes`, and
  `totalCostOfGoodsSoldInCentimes`. Exact BigInt arithmetic and the existing
  half-up allocation rule apply; zero purchase costs and zero/full returns are
  valid. Warehouse quantity/value and combined cost overflow reject counting.
- `lib/tour-countings.js`: retains the existing product and cash coordination
  locks. Counting records, original-cost return ledger entries, warehouse
  balances, physical return movements, and tour status commit atomically.
  Zero returns record the full sold cost without a zero physical movement or
  ledger entry. Duplicate confirmations and transaction retries cannot apply a
  return twice. Existing historical selling prices and loaded reservation/ledger
  records remain unchanged; later receipts preserve recorded sold/returned costs.
- Counting sheets read permissions, tour state, reservations, ledger, and balances
  in one snapshot transaction. The approval digest includes the original loading
  cost regardless of reader visibility. A later receipt or another reconciled
  stock operation does not invalidate original-cost counting approval. Changed
  historical snapshots invalidate it; incomplete current history still blocks
  confirmation. Loading approvals continue to be invalidated by valued returns.
- `lib/tour-counting-purchase-costs.js`: pure cost-preview helpers, whitelisted
  snapshot serialization, safe totals, and validation of stored allocations.
  Missing or inconsistent historical counting allocations/totals remain null;
  readers do not silently reconstruct them or display unknown costs as zero.
- The counting sheet, totals, styled confirmation dialog, and recorded read-only
  sheet show original loaded costs, returned purchase value, and sold costs only
  after the server checks `stock.valuation.read`. Readers without that permission
  can count under the existing operation permissions and never receive cost
  fields, including on replay. General tour/reservation readers and confirmation
  responses do not expose stored costs. Existing search, unit filtering, and
  pagination are preserved on desktop and mobile. No new permission or account
  grant was needed.
- Missing, malformed, incompatible, unlinked, unknown, or unreconciled loading
  costs/history block the counting sheet and confirmation without partial writes,
  including when all submitted returns are zero. Historical tours need phase 6
  migration before counting; legacy recorded countings remain readable with an
  explicit incomplete-cost state for authorized readers.

Verification completed on 2026-09-17: 17 new counting valuation integration tests,
13 existing counting integration tests, 14 calculation/preview tests, 13 tour
Server Action/authorization tests, and one targeted cash-payment/counting
concurrency test passed (58 targeted tests). Coverage includes differently priced
later receipts, packaging, repeated product lines, empty warehouse stock,
rounding, zero costs, original-source mismatches, missing/partial history,
permission revocation, safe integer limits and overflow, concurrent
countings/receptions/loadings, retries, immutable snapshots, and full rollback
following ledger or physical movement failures. ESLint passed on all nine
changed/new JavaScript files. Integration databases were isolated and removed.

The webpack production build passed (`npm run build -- --webpack`). Browser
checks at 1440px and 390px passed for cost visibility, explicit-input gating,
search/unit filtering, pagination, totals and styled confirmation, no horizontal
overflow, the legacy migration error, and recorded read-only costs. A mobile
confirmation saved six immutable original-cost splits and matching return
movements/ledger entries; all six warehouse balances reconciled completely. No
browser exceptions occurred. The temporary server/browser and database were
removed after verification; application data and account grants were unchanged.

Run integration commands in separate processes:

```bash
node --env-file-if-exists=.env.local --test --experimental-test-isolation=none --test-reporter=spec test/tour-counting-stock-valuations.integration.test.js
node --env-file-if-exists=.env.local --test --experimental-test-isolation=none --test-reporter=spec test/tour-countings.integration.test.js
node --test --experimental-test-isolation=none --test-reporter=spec test/tour-counting-purchase-costs.test.js test/tour-counting.test.js
node --env-file-if-exists=.env.local --test --experimental-test-isolation=none --test-reporter=spec test/tour-actions.authorization.integration.test.js
node --env-file-if-exists=.env.local --test --experimental-test-isolation=none --test-reporter=spec --test-name-pattern='coordonne un nouveau comptage' test/cash-payments.integration.test.js
./node_modules/.bin/eslint lib/tour-countings.js lib/tour-counting-stock-valuations.js lib/tour-counting-purchase-costs.js 'app/(protected)/tournees/[id]/tour-counting-sheet.js' test/helpers/stock-valuation-fixtures.js test/tour-countings.integration.test.js test/tour-counting-stock-valuations.integration.test.js test/tour-counting-purchase-costs.test.js test/cash-payments.integration.test.js
```

### Phase 5 implementation

- `lib/products.js`: opt-in product valuation reads require `products.read` and
  check `stock.valuation.read` on the server. Permissions, product/base unit,
  physical stock, reservations, movement presentation, balance, and ledger are
  read within one snapshot transaction. Transaction reads are sequential.
  Ordinary product/catalogue reads keep their existing output, and readers
  without valuation access receive no valuation or movement-cost fields.
- `lib/product-stock-valuations.js`: internal transactional reader reconciles
  warehouse quantity/value and the immutable movement ledger before serializing
  whitelisted costs. Warehouse value includes reserved stock and excludes goods
  held on tours. The average is derived from value and warehouse quantity; it
  is never used to recalculate previously assigned movement values. Incomplete
  or inconsistent history produces null values, including movement values,
  rather than an unverified partial value or a replacement current-average cost.
- Pristine products show zero warehouse value and no applicable average without
  creating a stored balance. Net-zero legacy history and receptions without
  physical movements remain explicitly unvalued. Recorded zero-cost stock is
  valid and shows a zero average; fully emptied stock has zero value and no
  applicable average. Read operations do not migrate or repair stored data.
- The product stock tab shows `Valeur du stock en entrepôt` and
  `Coût moyen pondéré` (TTC DZD per base unit, up to four average decimal places).
  Incomplete history shows an explicit reconciliation/migration message. The
  latest reception purchase cost remains separately labelled in pricing, with
  its existing reception-read access rules.
- The physical history shows signed assigned purchase values and explicit
  unknown states for authorized readers. Existing search, entry/exit filters,
  and eight-row pagination remain; a valuation-status filter is added for cost
  readers. Desktop and mobile layouts remain free of horizontal overflow and
  scrollable list/table containers. No permission or account grant was added.

Verification completed on 2026-09-17: 12 new product valuation integration tests,
23 existing product integration tests, four stock movement integration tests,
and 20 product action/authorization tests passed (59 targeted tests). Coverage
includes remaining-stock averages after loadings and differently priced receipts,
original loading/return movement values, reserved quantities, base units,
zero/empty stock, pristine products, missing/corrupt/unlinked/unknown history,
net-zero legacy movements, permission revocation and inactive users, hidden cost
fields, safe integer limits, and snapshot consistency during a later receipt.
Each integration process used and removed an isolated temporary database.
ESLint passed on all seven changed/new JavaScript files.

The webpack production build passed (`npm run build -- --webpack`). Browser
checks at 1440px and 390px passed for warehouse values, average precision, signed
assigned costs, search, direction and valuation filters, pagination, zero and
empty states, incomplete history, large totals without horizontal overflow,
permission-filtered columns and server payloads, and the separate latest purchase
cost in pricing. No browser exceptions occurred. The temporary UI database,
server, and browser were removed; application data and account grants were
unchanged.

Run integration commands in separate processes:

```bash
node --env-file-if-exists=.env.local --test --experimental-test-isolation=none --test-reporter=spec test/product-stock-valuations.integration.test.js
node --env-file-if-exists=.env.local --test --experimental-test-isolation=none --test-reporter=spec test/products.integration.test.js
node --env-file-if-exists=.env.local --test --experimental-test-isolation=none --test-reporter=spec test/stock-movements.integration.test.js
node --env-file-if-exists=.env.local --test --experimental-test-isolation=none --test-reporter=spec test/product-actions.authorization.integration.test.js
./node_modules/.bin/eslint lib/products.js lib/product-stock-valuations.js lib/stock-movements.js 'app/(protected)/produits/[id]/page.js' 'app/(protected)/produits/[id]/stock-movement-history.js' 'app/(protected)/produits/[id]/stock-valuation-summary.js' test/product-stock-valuations.integration.test.js
```

### Phase 6 implementation

- `lib/stock-valuation-migration-plan.js`: pure deterministic replay of reception,
  loading and counting source records against their existing physical movements.
  Uses reception `createdAt`, tour/reservation `loadedAt`, and counting
  `countedAt`; reporting reception dates never reorder operations. Historical
  base-unit quantities and packaging snapshots are checked without substituting
  current packaging definitions. Reception line order, stable reservation order
  for combined loading allocations, and counting line order are retained.
- Reconstructs versioned warehouse balances and ledger entries, original loading
  snapshots, counting allocations/totals, goods held on uncounted tours, and sold
  costs. Verifies physical reconciliation and exact purchase-value conservation
  across warehouse, held goods, and sold goods. Zero costs and zero/full returns
  remain valid; zero returns do not invent movements or ledger entries. Pristine
  products require no stored balance or coordination write.
- Equal recording times use existing immutable ledger revisions when they prove
  operation order. Receipt/return additions commute. Loading ties are checked
  across possible orders (up to six simultaneous operations); cost changes,
  unproven causal order, or larger unproven loading groups are reported as
  ambiguous and block application. Stable IDs/order do not silently resolve
  cost-changing ambiguity.
- Missing sources/movements/recording times/amounts, duplicates, incompatible
  units or quantities, inconsistent tour/counting state, malformed history,
  stock underflow and overflow, or conflicting known ledger/snapshot/totals
  block apply. Valid partial ledgers may be extended without changing their
  existing entries. Missing or explicitly null snapshots/allocations/totals can
  be filled from checked history; conflicting known costs are never overwritten.
  Unresolved products remain unchanged and explicitly unvalued in readers.
- `lib/stock-valuation-migration.js`: snapshot preview with source fingerprints,
  exact proposed changes, per-product balances and anomalies. Apply recomputes
  the plan, checks database/report/source integrity, saves the complete original
  BSON snapshot, and writes all changes in one transaction. Affected tours and
  products share document locks with application operations; a concurrent write
  forces retry and source revalidation. A stale reviewed plan cannot miss that
  operation. Direct database writes and other maintenance scripts must be
  suspended during cutover because they do not follow the application locks.
- Before commit, compares every source document against the expected result:
  only purchase-cost fields, valuation records, appended ledger entries and
  coordination counters may differ. Reconciles each affected product again.
  Original reception amounts, physical movements, selling prices, payments,
  expenses and other source metadata are retained. An atomic migration audit
  records source/result fingerprints; unchanged same-preview reruns are harmless.
  Subsequent business operations require a fresh preview, which preserves their
  recorded costs. Any backup/write/verification failure cancels the transaction.
- `scripts/migrate-stock-valuations.js` and `npm run stock:valuation-migrate`:
  private JSON/Markdown preview reports and explicit apply with a required BSON
  backup. Files use exclusive creation and mode 0600; backups are synchronized
  to disk before data changes. The JSON is a checked report, not an editable
  mapping. No new permission or account grant is introduced; this is an
  administrative CLI, with no public Server Action or client cost API.

Verification completed on 2026-09-17: 17 replay/preview tests, 13 isolated
migration integration tests, 27 calculation/record tests, six valuation
persistence tests and 12 product valuation/access tests passed (75 targeted
tests). Coverage includes original-cost returns after differently priced or
earlier-dated receipts, repeated product lines and centime rounding, packaging,
zero/full returns, unknown/net-zero/orphan history, partial immutable ledgers,
equal-time ambiguity/proven order, numeric limits, exact BSON backups, private
CLI files, preservation of financial history, stale/tampered/cross-database
reports, backup/ledger failures, concurrent applications and receptions,
subsequent counting/receptions, idempotency and rollback. ESLint passed on all
six new JavaScript files. Temporary integration databases were removed.

Browser checks against migrated isolated fixtures passed at 1440px and 390px:
warehouse value and average, assigned loading/return values, original
loaded/returned/sold counting totals, recorded read-only counting, authorized
and unauthorized views/payloads, no horizontal overflow, and no browser
exceptions. The temporary UI server/browser and database were removed. No
application source records, costs, account permissions or financial history
were changed during this verification.

Application preview generated on 2026-09-17: eight products reconcile, with zero
anomalies. Proposed additions are eight current valuations, 136 immutable ledger
entries, 56 loading snapshots and seven counting allocations/totals. Proposed
warehouse value is 211,560 DA; goods held on uncounted tours are zero; historical
cost of goods sold is 1,913,880 DA. The private review files are
`/tmp/syphax-stock-valuation-phase6-20260917.json` and `.md`. Preview made zero
database writes. This checkpoint preceded the reviewed application and checked
cutover completed in phase 7 below.

Migration runbook (use new output paths; keep reports/backups outside version
control and retain the backup):

```bash
npm run stock:valuation-migrate -- --preview <report-prefix>
# Review the Markdown and JSON; resolve source anomalies and regenerate if needed.
npm run stock:valuation-migrate -- --apply <report-prefix>.json --backup <backup.ejson>
# Generate a fresh preview after application: proposed changes should be zero.
npm run stock:valuation-migrate -- --preview <verification-prefix>
```

Targeted test commands; run each integration command in a separate process:

```bash
node --test --experimental-test-isolation=none --test-reporter=spec test/stock-valuation-migration-plan.test.js
node --env-file-if-exists=.env.local --test --experimental-test-isolation=none --test-reporter=spec test/stock-valuation-migration.integration.test.js
node --test --experimental-test-isolation=none --test-reporter=spec test/stock-valuation-calculations.test.js test/stock-valuation-records.test.js
node --env-file-if-exists=.env.local --test --experimental-test-isolation=none --test-reporter=spec test/stock-valuations.integration.test.js
node --env-file-if-exists=.env.local --test --experimental-test-isolation=none --test-reporter=spec test/product-stock-valuations.integration.test.js
./node_modules/.bin/eslint lib/stock-valuation-migration-plan.js lib/stock-valuation-migration.js scripts/migrate-stock-valuations.js test/helpers/stock-migration-fixtures.js test/stock-valuation-migration-plan.test.js test/stock-valuation-migration.integration.test.js
```

### Phase 7 application and reconciliation

Completed on 2026-09-17 against the configured `syphax` application database.
The fresh preview matched the phase 6 proposal and had zero anomalies. The
reviewed source fingerprint was checked against a new snapshot before cutover.
Recorded purchase amounts reconcile exactly with warehouse, held and sold
values; no source correction or replacement cost was needed.

Before application, retained a private BSON backup of all 17 source collections
and the reviewed JSON/Markdown reports. The migration CLI saved a second,
exact BSON backup of its eight source collections, synchronized it to disk,
and committed the checked changes atomically using application product/tour
locks. Added `/.backups/` to `.gitignore` to keep these private operational
files outside version control. Backup directories use mode 0700 and files
use mode 0600.

Applied eight current valuations, 136 immutable ledger entries, 56 original
loading cost snapshots and seven counting cost allocations/totals. All eight
products reconcile with physical movements. Authorized product reads return
complete warehouse values and assigned movement costs; all seven recorded
counting sheets return their checked original loaded, returned and sold costs.

| Product | Warehouse base units | Warehouse value (DA) | Average cost (DA/base unit) |
| --- | ---: | ---: | ---: |
| HB-BLANCHE-1L | 390 | 28,080 | 72 |
| HB-BLANCHE-2L | 209 | 25,080 | 120 |
| HB-SELECTO-1L | 390 | 28,080 | 72 |
| HB-SELECTO-2L | 204 | 24,480 | 120 |
| HB-SLIM-ORANGE-1L | 390 | 28,080 | 72 |
| HB-SLIM-ORANGE-2L | 210 | 25,200 | 120 |
| HB-SLIM-CITRON-1L | 390 | 28,080 | 72 |
| HB-SLIM-CITRON-2L | 204 | 24,480 | 120 |

Exact purchase-value conservation after application:

```text
2,125,440 DA purchases = 211,560 DA warehouse
                      +       0 DA held on uncounted tours
                      + 1,913,880 DA cost of goods sold
```

Independent comparisons against the full pre-migration backup confirm that
receptions and physical stock movements are unchanged. Product selling prices,
tour metadata and reservation/counting fields other than the allowed costs and
coordination counters are unchanged. All nine unrelated collections remain
identical: `cashPayments`, `cashRegisters`, `cashWithdrawals`, `deliverers`,
`roles`, `sessions`, `suppliers`, `tourExpenses` and `users`. No permission or
account grant was introduced.

A fresh post-application preview reports eight reconciled products, zero
anomalies and zero proposed changes in every category. Reapplying the original
reviewed report returns `replayed: true`, the same result fingerprint and no
duplicate costs or ledger entries. The migration audit fingerprint matches the
independently read post-migration source snapshot.

Retained operational artifacts (outside version control):

```text
.backups/stock-valuation/20260917-phase7/
  review.json             reviewed proposal and source fingerprints
  review.md               human-readable proposal
  database-before.ejson   full pre-migration source-document backup
  migration-before.ejson exact migration source backup
  after.json              post-migration preview; zero proposed changes
  after.md                human-readable post-migration preview
  verification.json       reconciliation and preservation results
```

The backups contain original BSON source documents; they are document backups,
not MongoDB index/configuration dumps. Retain them before cleaning this checkout.

Audit identifiers:

```text
Preview/audit: 421116a10791a135c6809e7b41b723dd5b2fd7e955356a7da9e5d4ac9388b5b0
Before:        494915dee492c171fa0f5f92d2ace1d83063bc8a6cee849a5534f2eb08f0f1b7
After:         be774d68438eaf956b77651b18ee50daf266d6f0f4516e56744aa47f120dff5e
```

Targeted verification rerun for cutover: 17 migration planner tests, 13 isolated
migration integration tests and 12 isolated product valuation/access tests
passed (42 tests). The migration tests exercise rollback, exact BSON backups,
stale/tampered previews, concurrent applications/receptions, idempotency and
new receptions/counting after cutover. The product tests exercise reconciled
values, original costs, incomplete history, permission revocation and hidden
cost fields. Integration databases were isolated and removed by their teardown.
Live verification used read-only service calls and snapshot comparisons; no
extra live reception, loading or counting was created for testing.

Next: phase 8 builds `/rentabilite` using the reconciled historical sales costs.

## Targeted verification and acceptance criteria

Add focused calculation and integration coverage for:

- First reception, changed costs with unequal quantities, intervening loadings,
  repeated product lines, packaging conversion, and valid zero-cost receipts.
- Partial/full loadings and returns, returns after new receptions, several
  concurrent tours, empty stock, rounding, and numeric limits.
- Concurrent receptions, loadings, and countings; transaction rollback;
  stale previews; duplicate confirmations and transaction retries.
- Historical replay, equal/ambiguous timestamps, older-dated receptions,
  missing costs, inconsistent stock, migration reruns, and source changes
  between preview and apply.
- Server-side access checks and product display states for authorized and
  unauthorized readers.

Run only tests covering changed calculations, services, migration, and access
paths. Use isolated temporary databases for integration checks. Run lint on
changed JavaScript and verify the affected product screens on desktop/mobile.
Do not run the full test suite unless explicitly requested.

The phase is complete when current warehouse quantity reconciles with physical
movements, value transfers balance exactly, known historical costs remain fixed,
missing costs are visible, retries are idempotent, access is enforced, and the
migration can be reviewed and safely rerun.

## Foundation for `/rentabilite`

The next feature can calculate sales minus historical cost of goods sold minus
declared tour expenses. Cash collections and withdrawals do not determine sales
profit. Missing historical costs or expense declarations must be visible in
report completeness rather than silently treated as zero. Broader net profit
requires an additional model for overhead expenses.
