# Moving weighted average stock valuation

Date: 2026-09-17.

Status: phases 1 and 2 implemented on 2026-09-17. The user selected moving
weighted average cost. New receptions now update valuation within their stock
transaction. Tour integration, product display, historical migration, and
permission grants remain planned. Existing unvalued history requires migration.

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
