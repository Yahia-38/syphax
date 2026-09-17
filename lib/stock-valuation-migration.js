import { ObjectId } from 'mongodb';

import { ensureStockValuationIndexes, readStoredStockValuationReconciliation } from './stock-valuations.js';
import {
  STOCK_MIGRATION_COLLECTIONS, STOCK_MIGRATION_VERSION,
  fingerprintStockMigration, planStockValuationMigration,
} from './stock-valuation-migration-plan.js';

export const snapshotStockValuationMigration = async (database, session) => {
  if (!session?.inTransaction()) throw new TypeError('Migration snapshots require a transaction.');
  const snapshot = {};
  for (const name of STOCK_MIGRATION_COLLECTIONS) {
    snapshot[name] = await database.collection(name).find({}, { session }).sort({ _id: 1 }).toArray();
  }
  return snapshot;
};

const changeCounts = (plan) => ({
  valuations: plan.proposals.filter((proposal) => proposal.updateValuation).length,
  ledgerEntries: plan.proposals.reduce((count, proposal) => count + (proposal.newEntries?.length ?? 0), 0),
  reservations: plan.reservationUpdates.length,
  countings: plan.countingUpdates.length,
});
export const createStockValuationMigrationPreview = (databaseName, snapshot) => {
  const plan = planStockValuationMigration(snapshot);
  const preview = {
    version: STOCK_MIGRATION_VERSION, database: databaseName, generatedAt: new Date().toISOString(),
    sourceFingerprint: fingerprintStockMigration(snapshot), planFingerprint: fingerprintStockMigration(plan),
    sources: Object.fromEntries(STOCK_MIGRATION_COLLECTIONS.map((name) => [name, {
      count: snapshot[name].length, sha256: fingerprintStockMigration(snapshot[name]),
    }])),
    canApply: plan.canApply, products: plan.products, issues: plan.issues, changes: changeCounts(plan),
    loadingCosts: plan.reservationUpdates.map((update) => ({ reservationId: update._id.toHexString(), purchaseCostAtLoading: update.purchaseCostAtLoading })),
    countingCosts: plan.countingUpdates.map((update) => ({ countingId: update._id.toHexString(), fields: update.fields })),
    movementValues: plan.proposals.flatMap((proposal) => (proposal.newEntries ?? []).map((entry) => ({
      productId: entry.productId.toHexString(), stockMovementId: entry.sourceStockMovementId.toHexString(),
      kind: entry.kind, revision: entry.revision, before: entry.before, after: entry.after,
      quantityDeltaInBaseUnits: entry.quantityDeltaInBaseUnits, valueDeltaInCentimes: entry.valueDeltaInCentimes,
    }))),
  };
  return { ...preview, previewDigest: fingerprintStockMigration(preview) };
};

export const previewStockValuationMigration = async (database, client) => client.withSession(async (session) =>
  session.withTransaction(async () => createStockValuationMigrationPreview(
    database.databaseName, await snapshotStockValuationMigration(database, session),
  ), { readConcern: { level: 'snapshot' }, readPreference: 'primary' }));

const validatePreview = (database, preview) => {
  const { previewDigest, ...body } = preview ?? {};
  if (body.version !== STOCK_MIGRATION_VERSION || body.database !== database.databaseName
    || !/^[a-f\d]{64}$/u.test(previewDigest ?? '') || fingerprintStockMigration(body) !== previewDigest) {
    throw new Error('Invalid migration preview, altered report, or different database. Generate a new preview.');
  }
};
const expectedAfterMigration = (before, plan, productIds, tourIds) => {
  const after = {};
  // Preserve BSON objects and every unrelated field. Only the whitelisted cost
  // additions, balances, new ledger entries, and coordination counters may change.
  for (const name of STOCK_MIGRATION_COLLECTIONS) after[name] = [...before[name]];
  after.products = before.products.map((product) => productIds.has(product._id.toHexString()) ? {
    ...product, stockReferenceVersion: (product.stockReferenceVersion ?? 0) + 1,
  } : product);
  after.tours = before.tours.map((tour) => tourIds.has(tour._id.toHexString()) ? {
    ...tour, valuationMigrationReferenceVersion: (tour.valuationMigrationReferenceVersion ?? 0) + 1,
  } : tour);
  for (const proposal of plan.proposals) {
    if (proposal.updateValuation) {
      const position = after.stockValuations.findIndex((record) => record.productId.equals(proposal.valuation.productId));
      if (position < 0) after.stockValuations.push(proposal.valuation);
      else after.stockValuations[position] = { ...after.stockValuations[position], ...proposal.valuation };
    }
    after.stockValuationEntries.push(...(proposal.newEntries ?? []));
  }
  after.tourReservations = before.tourReservations.map((line) => {
    const update = plan.reservationUpdates.find((item) => item._id.equals(line._id));
    return update ? { ...line, purchaseCostAtLoading: update.purchaseCostAtLoading } : line;
  });
  after.tourCountings = before.tourCountings.map((counting) => {
    const update = plan.countingUpdates.find((item) => item._id.equals(counting._id));
    if (!update) return counting;
    const result = { ...counting, lines: counting.lines.map((line) => ({ ...line })) };
    for (const [key, value] of Object.entries(update.fields)) {
      const match = /^lines\.(\d+)\.(\w+)$/u.exec(key);
      if (match) result.lines[Number(match[1])][match[2]] = value;
      else result[key] = value;
    }
    return result;
  });
  for (const name of STOCK_MIGRATION_COLLECTIONS) after[name].sort((first, second) => first._id.toString().localeCompare(second._id.toString()));
  return after;
};

export const applyStockValuationMigration = async (database, client, preview, saveBackup) => {
  validatePreview(database, preview);
  if (!preview.canApply) throw new Error('Migration has unresolved anomalies. Resolve them and generate a new preview.');
  if (typeof saveBackup !== 'function') throw new TypeError('Migration requires a durable backup callback.');
  await ensureStockValuationIndexes(database);
  return client.withSession(async (session) => session.withTransaction(async () => {
    const before = await snapshotStockValuationMigration(database, session);
    const currentFingerprint = fingerprintStockMigration(before);
    const prior = await database.collection('stockValuationMigrations').findOne({ _id: preview.previewDigest }, { session });
    if (prior) {
      if (prior.afterFingerprint !== currentFingerprint) throw new Error('Sources changed after migration. Generate a new preview.');
      return { replayed: true, changes: prior.changes, sourceFingerprint: prior.sourceFingerprint, afterFingerprint: prior.afterFingerprint };
    }
    if (currentFingerprint !== preview.sourceFingerprint) throw new Error('Sources changed since preview. Generate a new preview.');
    const plan = planStockValuationMigration(before);
    if (!plan.canApply || fingerprintStockMigration(plan) !== preview.planFingerprint) throw new Error('Migration plan changed or has unresolved anomalies. Generate a new preview.');
    const changes = changeCounts(plan);
    if (!Object.values(changes).some(Boolean)) return { replayed: false, changes, unchanged: true };
    const productIds = new Set(plan.proposals.filter((proposal) => proposal.updateValuation || proposal.newEntries?.length)
      .map((proposal) => proposal.summary.productId));
    for (const update of plan.reservationUpdates) productIds.add(before.tourReservations.find((line) => line._id.equals(update._id)).productId.toHexString());
    for (const update of plan.countingUpdates) {
      for (const line of before.tourCountings.find((counting) => counting._id.equals(update._id)).lines) productIds.add(line.productId.toHexString());
    }
    const tourIds = new Set(before.tourReservations.filter((line) => productIds.has(line.productId.toHexString()) && line.status === 'LOADED').map((line) => line.tourId.toHexString()));
    await saveBackup({ version: STOCK_MIGRATION_VERSION, database: database.databaseName,
      previewDigest: preview.previewDigest, sourceFingerprint: currentFingerprint, snapshot: before });
    // Touch tours before products, following loading/counting lock order. Every
    // relevant application write shares these documents. A conflict retries the
    // transaction and then rechecks the reviewed source fingerprint; stale input
    // cannot be applied. New receipts after commit use the migrated balance.
    for (const tourId of [...tourIds].sort()) {
      const result = await database.collection('tours').updateOne({ _id: new ObjectId(tourId) },
        { $inc: { valuationMigrationReferenceVersion: 1 } }, { session });
      if (result.matchedCount !== 1) throw new Error('Migration tour lock failed.');
    }
    for (const productId of [...productIds].sort()) {
      const result = await database.collection('products').updateOne({ _id: new ObjectId(productId) },
        { $inc: { stockReferenceVersion: 1 } }, { session });
      if (result.matchedCount !== 1) throw new Error('Migration product lock failed.');
    }
    for (const proposal of plan.proposals) {
      if (proposal.updateValuation) await database.collection('stockValuations').updateOne(
        { productId: proposal.valuation.productId }, { $set: proposal.valuation }, { upsert: true, session },
      );
      if (proposal.newEntries?.length) await database.collection('stockValuationEntries').insertMany(proposal.newEntries, { session });
    }
    for (const update of plan.reservationUpdates) await database.collection('tourReservations').updateOne(
      { _id: update._id, purchaseCostAtLoading: null },
      { $set: { purchaseCostAtLoading: update.purchaseCostAtLoading } }, { session },
    );
    for (const update of plan.countingUpdates) await database.collection('tourCountings').updateOne(
      { _id: update._id }, { $set: update.fields }, { session },
    );
    const expected = expectedAfterMigration(before, plan, productIds, tourIds);
    const after = await snapshotStockValuationMigration(database, session);
    if (fingerprintStockMigration(after) !== fingerprintStockMigration(expected)) throw new Error('Migration preservation check failed. Transaction cancelled.');
    for (const productId of productIds) {
      const product = before.products.find((record) => record._id.toHexString() === productId);
      const report = await readStoredStockValuationReconciliation({ database, session, productId: product._id, baseUnit: product.baseUnit });
      if (!report.complete) throw new Error('Migrated stock did not reconcile. Transaction cancelled.');
    }
    const afterFingerprint = fingerprintStockMigration(after);
    await database.collection('stockValuationMigrations').insertOne({ _id: preview.previewDigest,
      version: STOCK_MIGRATION_VERSION, appliedAt: new Date(), sourceFingerprint: currentFingerprint,
      afterFingerprint, changes }, { session });
    return { replayed: false, changes, sourceFingerprint: currentFingerprint, afterFingerprint };
  }, { readConcern: { level: 'snapshot' }, readPreference: 'primary', writeConcern: { w: 'majority' } }));
};
