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
      !permission.startsWith('deliverers.')
      && !permission.startsWith('tours.')),
  );
  assert.ok(PERMISSION_KEYS.includes('deliverers.read'));
  assert.ok(PERMISSION_KEYS.includes('deliverers.create'));
  assert.ok(PERMISSION_KEYS.includes('deliverers.update'));
  assert.ok(PERMISSION_KEYS.includes('deliverers.status.update'));
  assert.equal(INITIAL_MANAGER_PERMISSIONS.includes('deliverers.read'), false);
  assert.equal(INITIAL_MANAGER_PERMISSIONS.includes('deliverers.create'), false);
  assert.equal(INITIAL_MANAGER_PERMISSIONS.includes('deliverers.update'), false);
  assert.equal(
    INITIAL_MANAGER_PERMISSIONS.includes('deliverers.status.update'),
    false,
  );
  assert.ok(PERMISSION_KEYS.includes('tours.read'));
  assert.ok(PERMISSION_KEYS.includes('tours.create'));
  assert.equal(INITIAL_MANAGER_PERMISSIONS.includes('tours.read'), false);
  assert.equal(INITIAL_MANAGER_PERMISSIONS.includes('tours.create'), false);
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
  const toursRead = await grantYahiaFullAccessPermission('tours.read');
  const toursCreate = await grantYahiaFullAccessPermission('tours.create');
  const [yahiaRole, otherRole] = await Promise.all([
    database.collection('roles').findOne({ _id: yahiaRoleId }),
    database.collection('roles').findOne({ _id: otherRoleId }),
  ]);

  assert.equal(first.granted, true);
  assert.equal(second.granted, false);
  assert.equal(toursRead.granted, true);
  assert.equal(toursCreate.granted, true);
  assert.deepEqual(yahiaRole.permissions, [
    'deliverers.read',
    'deliverers.status.update',
    'tours.read',
    'tours.create',
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
