import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_access_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const {
  LastAccessAdministratorError,
  PermissionDeniedError,
  deleteRole,
  deleteUser,
  grantYahiaFullAccessPermission,
  initializeManagerAccess,
  requireUserPermission,
  setUserActive,
  setUserRoles,
  updateRolePermissions,
  userHasPermission,
} = await import('../lib/access.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const {
  INITIAL_MANAGER_PERMISSIONS,
  PERMISSION_KEYS,
} = await import('../lib/permissions.js');

let database;

before(async () => {
  database = await getDatabase();
});

after(async () => {
  if (database) {
    await database.dropDatabase();
  }

  await closeMongoConnection();
});

test('le catalogue conserve les accès livreurs et tournées hors du rôle Manager partagé', () => {
  assert.deepEqual(
    INITIAL_MANAGER_PERMISSIONS,
    PERMISSION_KEYS.filter((permission) =>
      !permission.startsWith('cash.')
      && !permission.startsWith('deliverers.')
      && !permission.startsWith('tours.')),
  );
  assert.ok(PERMISSION_KEYS.includes('cash.read'));
  assert.ok(PERMISSION_KEYS.includes('cash.payments.create'));
  assert.ok(PERMISSION_KEYS.includes('cash.withdrawals.create'));
  assert.equal(INITIAL_MANAGER_PERMISSIONS.includes('cash.read'), false);
  assert.equal(
    INITIAL_MANAGER_PERMISSIONS.includes('cash.payments.create'),
    false,
  );
  assert.equal(
    INITIAL_MANAGER_PERMISSIONS.includes('cash.withdrawals.create'),
    false,
  );
  assert.ok(PERMISSION_KEYS.includes('deliverers.read'));
  assert.ok(PERMISSION_KEYS.includes('deliverers.create'));
  assert.ok(PERMISSION_KEYS.includes('deliverers.update'));
  assert.ok(PERMISSION_KEYS.includes('deliverers.credit-limit.read'));
  assert.ok(PERMISSION_KEYS.includes('deliverers.credit-limit.update'));
  assert.ok(PERMISSION_KEYS.includes('deliverers.status.update'));
  assert.equal(INITIAL_MANAGER_PERMISSIONS.includes('deliverers.read'), false);
  assert.equal(INITIAL_MANAGER_PERMISSIONS.includes('deliverers.create'), false);
  assert.equal(INITIAL_MANAGER_PERMISSIONS.includes('deliverers.update'), false);
  assert.equal(
    INITIAL_MANAGER_PERMISSIONS.includes('deliverers.credit-limit.read'),
    false,
  );
  assert.equal(
    INITIAL_MANAGER_PERMISSIONS.includes('deliverers.credit-limit.update'),
    false,
  );
  assert.equal(
    INITIAL_MANAGER_PERMISSIONS.includes('deliverers.status.update'),
    false,
  );
  assert.ok(PERMISSION_KEYS.includes('tours.read'));
  assert.ok(PERMISSION_KEYS.includes('tours.create'));
  assert.ok(PERMISSION_KEYS.includes('tours.load'));
  assert.ok(PERMISSION_KEYS.includes('tours.cancel'));
  assert.ok(PERMISSION_KEYS.includes('tours.count.prepare'));
  assert.ok(PERMISSION_KEYS.includes('tours.count.confirm'));
  assert.ok(PERMISSION_KEYS.includes('tours.expenses.read'));
  assert.ok(PERMISSION_KEYS.includes('tours.expenses.declare'));
  assert.ok(PERMISSION_KEYS.includes('tours.products.add'));
  assert.ok(PERMISSION_KEYS.includes('tours.products.release'));
  assert.equal(INITIAL_MANAGER_PERMISSIONS.includes('tours.read'), false);
  assert.equal(INITIAL_MANAGER_PERMISSIONS.includes('tours.create'), false);
  assert.equal(INITIAL_MANAGER_PERMISSIONS.includes('tours.load'), false);
  assert.equal(INITIAL_MANAGER_PERMISSIONS.includes('tours.cancel'), false);
  assert.equal(
    INITIAL_MANAGER_PERMISSIONS.includes('tours.count.prepare'),
    false,
  );
  assert.equal(
    INITIAL_MANAGER_PERMISSIONS.includes('tours.count.confirm'),
    false,
  );
  assert.equal(
    INITIAL_MANAGER_PERMISSIONS.includes('tours.expenses.read'),
    false,
  );
  assert.equal(
    INITIAL_MANAGER_PERMISSIONS.includes('tours.expenses.declare'),
    false,
  );
  assert.equal(
    INITIAL_MANAGER_PERMISSIONS.includes('tours.products.add'),
    false,
  );
  assert.equal(
    INITIAL_MANAGER_PERMISSIONS.includes('tours.products.release'),
    false,
  );
  assert.ok(INITIAL_MANAGER_PERMISSIONS.includes('pricing.update'));
  assert.ok(INITIAL_MANAGER_PERMISSIONS.includes('access.roles.manage'));
  assert.ok(INITIAL_MANAGER_PERMISSIONS.includes('access.roles.assign'));
});

test('initialise le Manager et son attribution de manière rejouable', async () => {
  const userId = new ObjectId();

  await database.collection('users').insertOne({
    _id: userId,
    username: 'manager-initial',
    createdAt: new Date(),
  });

  const [firstResult, secondResult] = await Promise.all([
    initializeManagerAccess({ username: ' Manager-Initial ' }),
    initializeManagerAccess({ username: 'manager-initial' }),
  ]);

  assert.equal(firstResult.roleId, secondResult.roleId);
  assert.equal(await database.collection('roles').countDocuments({}), 1);

  const [role, user] = await Promise.all([
    database.collection('roles').findOne({ key: 'manager' }),
    database.collection('users').findOne({ _id: userId }),
  ]);

  assert.equal(role.name, 'Manager');
  assert.deepEqual(role.permissions, [...INITIAL_MANAGER_PERMISSIONS]);
  assert.deepEqual(user.roleIds, [role._id]);
  assert.equal(await userHasPermission(userId.toString(), 'pricing.update'), true);
});

test('attribue les nouvelles permissions uniquement au rôle dédié de yahia', async () => {
  const yahiaRoleId = new ObjectId();
  const otherRoleId = new ObjectId();
  const yahiaId = new ObjectId();

  await Promise.all([
    database.collection('roles').insertMany([
      {
        _id: yahiaRoleId,
        key: 'yahia-full-access',
        name: 'Accès complet — yahia',
        permissions: ['deliverers.read'],
      },
      {
        _id: otherRoleId,
        key: 'autre-role',
        name: 'Autre rôle',
        permissions: ['deliverers.read'],
      },
    ]),
    database.collection('users').insertOne({
      _id: yahiaId,
      username: 'yahia',
      active: true,
      roleIds: [yahiaRoleId],
    }),
  ]);

  const first = await grantYahiaFullAccessPermission(
    'deliverers.status.update',
  );
  const second = await grantYahiaFullAccessPermission(
    'deliverers.status.update',
  );
  const creditLimitRead = await grantYahiaFullAccessPermission(
    'deliverers.credit-limit.read',
  );
  const creditLimitUpdate = await grantYahiaFullAccessPermission(
    'deliverers.credit-limit.update',
  );
  const toursRead = await grantYahiaFullAccessPermission('tours.read');
  const toursCreate = await grantYahiaFullAccessPermission('tours.create');
  const toursLoad = await grantYahiaFullAccessPermission('tours.load');
  const toursCancel = await grantYahiaFullAccessPermission('tours.cancel');
  const toursCountPrepare = await grantYahiaFullAccessPermission(
    'tours.count.prepare',
  );
  const toursCountConfirm = await grantYahiaFullAccessPermission(
    'tours.count.confirm',
  );
  const toursExpensesRead = await grantYahiaFullAccessPermission(
    'tours.expenses.read',
  );
  const toursExpensesDeclare = await grantYahiaFullAccessPermission(
    'tours.expenses.declare',
  );
  const toursProductsAdd = await grantYahiaFullAccessPermission(
    'tours.products.add',
  );
  const toursProductsRelease = await grantYahiaFullAccessPermission(
    'tours.products.release',
  );
  const cashRead = await grantYahiaFullAccessPermission('cash.read');
  const cashPaymentsCreate = await grantYahiaFullAccessPermission(
    'cash.payments.create',
  );
  const cashWithdrawalsCreate = await grantYahiaFullAccessPermission(
    'cash.withdrawals.create',
  );
  const [yahiaRole, otherRole] = await Promise.all([
    database.collection('roles').findOne({ _id: yahiaRoleId }),
    database.collection('roles').findOne({ _id: otherRoleId }),
  ]);

  assert.equal(first.granted, true);
  assert.equal(second.granted, false);
  assert.equal(creditLimitRead.granted, true);
  assert.equal(creditLimitUpdate.granted, true);
  assert.equal(toursRead.granted, true);
  assert.equal(toursCreate.granted, true);
  assert.equal(toursLoad.granted, true);
  assert.equal(toursCancel.granted, true);
  assert.equal(toursCountPrepare.granted, true);
  assert.equal(toursCountConfirm.granted, true);
  assert.equal(toursExpensesRead.granted, true);
  assert.equal(toursExpensesDeclare.granted, true);
  assert.equal(toursProductsAdd.granted, true);
  assert.equal(toursProductsRelease.granted, true);
  assert.equal(cashRead.granted, true);
  assert.equal(cashPaymentsCreate.granted, true);
  assert.equal(cashWithdrawalsCreate.granted, true);
  assert.deepEqual(yahiaRole.permissions, [
    'deliverers.read',
    'deliverers.status.update',
    'deliverers.credit-limit.read',
    'deliverers.credit-limit.update',
    'tours.read',
    'tours.create',
    'tours.load',
    'tours.cancel',
    'tours.count.prepare',
    'tours.count.confirm',
    'tours.expenses.read',
    'tours.expenses.declare',
    'tours.products.add',
    'tours.products.release',
    'cash.read',
    'cash.payments.create',
    'cash.withdrawals.create',
  ]);
  assert.deepEqual(otherRole.permissions, ['deliverers.read']);
});

test('refuse côté serveur un utilisateur sans pricing.update', async () => {
  const userId = new ObjectId();

  await database.collection('users').insertOne({
    _id: userId,
    username: 'sans-tarifs',
    roleIds: [],
  });

  await assert.rejects(
    requireUserPermission(userId.toString(), 'pricing.update'),
    (error) =>
      error instanceof PermissionDeniedError
      && error.code === 'FORBIDDEN'
      && error.permission === 'pricing.update',
  );
});

test('le rôle Manager reste configurable sans être réinitialisé au rejeu', async () => {
  const manager = await database.collection('roles').findOne({ key: 'manager' });
  const managerUser = await database.collection('users').findOne({
    username: 'manager-initial',
  });
  const configuredPermissions = manager.permissions.filter(
    (permission) => permission !== 'pricing.update',
  );

  assert.deepEqual(
    await updateRolePermissions({
      roleId: manager._id.toString(),
      permissions: configuredPermissions,
    }),
    { updated: true },
  );
  await initializeManagerAccess({ username: managerUser.username });

  const configuredManager = await database.collection('roles').findOne({
    _id: manager._id,
  });
  assert.deepEqual(configuredManager.permissions, configuredPermissions);
  await assert.rejects(
    requireUserPermission(managerUser._id.toString(), 'pricing.update'),
    PermissionDeniedError,
  );

  await updateRolePermissions({
    roleId: manager._id.toString(),
    permissions: manager.permissions,
  });
});

test('protège le dernier administrateur actif contre un retrait de droits', async () => {
  const manager = await database.collection('roles').findOne({ key: 'manager' });

  await assert.rejects(
    updateRolePermissions({
      roleId: manager._id.toString().toUpperCase(),
      permissions: manager.permissions.filter(
        (permission) => permission !== 'access.roles.assign',
      ),
    }),
    (error) =>
      error instanceof LastAccessAdministratorError
      && error.code === 'LAST_ACCESS_ADMINISTRATOR',
  );

  const unchangedManager = await database.collection('roles').findOne({
    _id: manager._id,
  });
  assert.deepEqual(unchangedManager.permissions, manager.permissions);
});

test('protège le dernier administrateur actif contre retrait de rôle et suppression', async () => {
  const manager = await database.collection('roles').findOne({ key: 'manager' });
  const managerUser = await database.collection('users').findOne({
    username: 'manager-initial',
  });

  await assert.rejects(
    setUserRoles({ userId: managerUser._id.toString(), roleIds: [] }),
    LastAccessAdministratorError,
  );
  await assert.rejects(
    deleteUser(managerUser._id.toString().toUpperCase()),
    LastAccessAdministratorError,
  );
  await assert.rejects(
    setUserActive({ userId: managerUser._id.toString(), active: false }),
    LastAccessAdministratorError,
  );
  await assert.rejects(
    deleteRole(manager._id.toString()),
    LastAccessAdministratorError,
  );

  assert.ok(await database.collection('users').findOne({ _id: managerUser._id }));
  assert.deepEqual(managerUser.roleIds, [manager._id]);
});
