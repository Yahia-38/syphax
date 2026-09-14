import { randomUUID } from 'node:crypto';

import { ObjectId } from 'mongodb';

import { getDatabase } from './mongodb.js';
import {
  ACCESS_ADMINISTRATION_PERMISSIONS,
  INITIAL_MANAGER_PERMISSIONS,
  isKnownPermission,
} from './permissions.js';
import { normalizeUsername } from './users.js';

const MANAGER_ROLE_KEY = 'manager';
const YAHIA_FULL_ACCESS_ROLE_KEY = 'yahia-full-access';
const YAHIA_USERNAME = 'yahia';
const ACCESS_MUTATION_LOCK_ID = 'access-administration-mutation';
const ACCESS_MUTATION_LOCK_DURATION = 10_000;
const ACCESS_MUTATION_LOCK_RETRIES = 80;
const ACCESS_MUTATION_LOCK_RETRY_DELAY = 25;

export class PermissionDeniedError extends Error {
  constructor(permission) {
    super(`Permission requise : ${permission}.`);
    this.name = 'PermissionDeniedError';
    this.code = 'FORBIDDEN';
    this.permission = permission;
  }
}

export class LastAccessAdministratorError extends Error {
  constructor() {
    super(
      'Le dernier compte actif capable d’administrer les accès doit être conservé.',
    );
    this.name = 'LastAccessAdministratorError';
    this.code = 'LAST_ACCESS_ADMINISTRATOR';
  }
}

const wait = (duration) => new Promise((resolve) => {
  setTimeout(resolve, duration);
});

const assertKnownPermission = (permission) => {
  if (!isKnownPermission(permission)) {
    throw new Error(`Permission inconnue : ${permission}.`);
  }
};

const normalizePermissions = (permissions) => {
  if (!Array.isArray(permissions)) {
    throw new Error('La liste des permissions est invalide.');
  }

  const normalizedPermissions = [...new Set(permissions)];

  for (const permission of normalizedPermissions) {
    assertKnownPermission(permission);
  }

  return normalizedPermissions;
};

const normalizeObjectIds = (ids, fieldName) => {
  if (!Array.isArray(ids)) {
    throw new Error(`${fieldName} est invalide.`);
  }

  if (ids.some((id) => typeof id !== 'string' || !ObjectId.isValid(id))) {
    throw new Error(`${fieldName} est invalide.`);
  }

  return [...new Map(
    ids.map((id) => {
      const objectId = new ObjectId(id);
      return [objectId.toString(), objectId];
    }),
  ).values()];
};

const hasAllAccessAdministrationPermissions = (permissions) =>
  ACCESS_ADMINISTRATION_PERMISSIONS.every((permission) =>
    permissions.has(permission));

const getAccessSnapshot = async (database) => {
  const [roles, users] = await Promise.all([
    database.collection('roles').find(
      {},
      { projection: { permissions: 1 } },
    ).toArray(),
    database.collection('users').find(
      {},
      { projection: { active: 1, roleIds: 1 } },
    ).toArray(),
  ]);

  return {
    roles: new Map(
      roles.map((role) => [
        role._id.toString(),
        Array.isArray(role.permissions) ? role.permissions : [],
      ]),
    ),
    users: users.map((user) => ({
      id: user._id.toString(),
      active: user.active !== false,
      roleIds: Array.isArray(user.roleIds)
        ? user.roleIds.map((roleId) => roleId.toString())
        : [],
    })),
  };
};

const hasActiveAccessAdministrator = ({ roles, users }) =>
  users.some((user) => {
    if (!user.active) {
      return false;
    }

    const permissions = new Set(
      user.roleIds.flatMap((roleId) => roles.get(roleId) ?? []),
    );

    return hasAllAccessAdministrationPermissions(permissions);
  });

const copyAccessSnapshot = (snapshot) => ({
  roles: new Map(snapshot.roles),
  users: snapshot.users.map((user) => ({ ...user, roleIds: [...user.roleIds] })),
});

const assertAccessAdministrationRemains = async (database, projectMutation) => {
  const currentSnapshot = await getAccessSnapshot(database);

  if (!hasActiveAccessAdministrator(currentSnapshot)) {
    return;
  }

  const projectedSnapshot = copyAccessSnapshot(currentSnapshot);
  projectMutation(projectedSnapshot);

  if (!hasActiveAccessAdministrator(projectedSnapshot)) {
    throw new LastAccessAdministratorError();
  }
};

const acquireAccessMutationLock = async (database) => {
  const locks = database.collection('systemLocks');
  const owner = randomUUID();

  for (let attempt = 0; attempt < ACCESS_MUTATION_LOCK_RETRIES; attempt += 1) {
    const now = new Date();

    try {
      const lock = await locks.findOneAndUpdate(
        {
          _id: ACCESS_MUTATION_LOCK_ID,
          $or: [
            { owner },
            { owner: { $exists: false } },
            { expiresAt: { $lte: now } },
          ],
        },
        {
          $set: {
            owner,
            expiresAt: new Date(now.getTime() + ACCESS_MUTATION_LOCK_DURATION),
          },
        },
        { returnDocument: 'after', upsert: true },
      );

      if (lock?.owner === owner) {
        return owner;
      }
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }
    }

    await wait(ACCESS_MUTATION_LOCK_RETRY_DELAY);
  }

  throw new Error('La gestion des accès est momentanément occupée.');
};

const withAccessMutationLock = async (database, mutation) => {
  const owner = await acquireAccessMutationLock(database);

  try {
    return await mutation();
  } finally {
    await database.collection('systemLocks').deleteOne({
      _id: ACCESS_MUTATION_LOCK_ID,
      owner,
    });
  }
};

export const initializeManagerAccess = async ({ username }) => {
  const normalizedUsername = normalizeUsername(username ?? '');

  if (!normalizedUsername) {
    throw new Error('L’identifiant du Manager est obligatoire.');
  }

  const database = await getDatabase();
  const users = database.collection('users');
  const roles = database.collection('roles');
  const user = await users.findOne(
    { username: normalizedUsername },
    { projection: { username: 1 } },
  );

  if (!user) {
    throw new Error(`Le compte « ${normalizedUsername} » n’existe pas.`);
  }

  await roles.createIndex(
    { key: 1 },
    { name: 'unique_role_key', unique: true },
  );

  const createdAt = new Date();
  const role = await roles.findOneAndUpdate(
    { key: MANAGER_ROLE_KEY },
    {
      $setOnInsert: {
        key: MANAGER_ROLE_KEY,
        name: 'Manager',
        permissions: [...INITIAL_MANAGER_PERMISSIONS],
        createdAt,
        updatedAt: createdAt,
      },
    },
    { returnDocument: 'after', upsert: true },
  );

  await users.updateOne(
    { _id: user._id },
    { $addToSet: { roleIds: role._id } },
  );

  return {
    roleId: role._id.toString(),
    roleName: role.name,
    username: user.username,
  };
};

export const grantYahiaFullAccessPermission = async (permission) => {
  assertKnownPermission(permission);

  const database = await getDatabase();
  const [role, user] = await Promise.all([
    database.collection('roles').findOne(
      { key: YAHIA_FULL_ACCESS_ROLE_KEY },
      { projection: { _id: 1, name: 1 } },
    ),
    database.collection('users').findOne(
      { username: YAHIA_USERNAME },
      { projection: { roleIds: 1, username: 1 } },
    ),
  ]);

  if (!role) {
    throw new Error('Le rôle dédié « yahia-full-access » n’existe pas.');
  }

  if (
    !user
    || !Array.isArray(user.roleIds)
    || !user.roleIds.some((roleId) => roleId?.toString() === role._id.toString())
  ) {
    throw new Error(
      'Le rôle dédié « yahia-full-access » n’est pas attribué au compte « yahia ».',
    );
  }

  const result = await database.collection('roles').updateOne(
    { _id: role._id, permissions: { $ne: permission } },
    {
      $addToSet: { permissions: permission },
      $set: { updatedAt: new Date() },
    },
  );

  return {
    granted: result.modifiedCount === 1,
    permission,
    roleId: role._id.toString(),
    roleName: role.name,
    username: user.username,
  };
};

export const getUserPermissions = async (userId) => {
  if (typeof userId !== 'string' || !ObjectId.isValid(userId)) {
    return [];
  }

  const database = await getDatabase();
  const user = await database.collection('users').findOne(
    { _id: new ObjectId(userId), active: { $ne: false } },
    { projection: { roleIds: 1 } },
  );

  if (!user || !Array.isArray(user.roleIds) || user.roleIds.length === 0) {
    return [];
  }

  const roles = await database.collection('roles').find(
    { _id: { $in: user.roleIds } },
    { projection: { permissions: 1 } },
  ).toArray();

  return [...new Set(
    roles.flatMap((role) =>
      Array.isArray(role.permissions) ? role.permissions : []),
  )];
};

export const userHasPermission = async (userId, permission) => {
  assertKnownPermission(permission);
  return (await getUserPermissions(userId)).includes(permission);
};

export const requireUserPermission = async (userId, permission) => {
  if (!(await userHasPermission(userId, permission))) {
    throw new PermissionDeniedError(permission);
  }

  return true;
};

export const updateRolePermissions = async ({ roleId, permissions }) => {
  if (typeof roleId !== 'string' || !ObjectId.isValid(roleId)) {
    return { notFound: true };
  }

  const normalizedPermissions = normalizePermissions(permissions);
  const database = await getDatabase();

  return withAccessMutationLock(database, async () => {
    const roleObjectId = new ObjectId(roleId);
    const normalizedRoleId = roleObjectId.toString();
    const role = await database.collection('roles').findOne(
      { _id: roleObjectId },
      { projection: { _id: 1 } },
    );

    if (!role) {
      return { notFound: true };
    }

    await assertAccessAdministrationRemains(database, (snapshot) => {
      snapshot.roles.set(normalizedRoleId, normalizedPermissions);
    });

    await database.collection('roles').updateOne(
      { _id: roleObjectId },
      { $set: { permissions: normalizedPermissions, updatedAt: new Date() } },
    );

    return { updated: true };
  });
};

export const setUserRoles = async ({ userId, roleIds }) => {
  if (typeof userId !== 'string' || !ObjectId.isValid(userId)) {
    return { notFound: true };
  }

  const normalizedRoleIds = normalizeObjectIds(roleIds, 'La liste des rôles');
  const database = await getDatabase();

  return withAccessMutationLock(database, async () => {
    const userObjectId = new ObjectId(userId);
    const normalizedUserId = userObjectId.toString();
    const [user, matchingRoleCount] = await Promise.all([
      database.collection('users').findOne(
        { _id: userObjectId },
        { projection: { _id: 1 } },
      ),
      database.collection('roles').countDocuments({
        _id: { $in: normalizedRoleIds },
      }),
    ]);

    if (!user) {
      return { notFound: true };
    }

    if (matchingRoleCount !== normalizedRoleIds.length) {
      throw new Error('Au moins un rôle n’existe pas.');
    }

    await assertAccessAdministrationRemains(database, (snapshot) => {
      const projectedUser = snapshot.users.find(
        ({ id }) => id === normalizedUserId,
      );
      projectedUser.roleIds = normalizedRoleIds.map((roleId) => roleId.toString());
    });

    await database.collection('users').updateOne(
      { _id: userObjectId },
      { $set: { roleIds: normalizedRoleIds, updatedAt: new Date() } },
    );

    return { updated: true };
  });
};

export const setUserActive = async ({ userId, active }) => {
  if (typeof userId !== 'string' || !ObjectId.isValid(userId)) {
    return { notFound: true };
  }

  if (typeof active !== 'boolean') {
    throw new Error('L’état du compte est invalide.');
  }

  const database = await getDatabase();

  return withAccessMutationLock(database, async () => {
    const userObjectId = new ObjectId(userId);
    const normalizedUserId = userObjectId.toString();
    const user = await database.collection('users').findOne(
      { _id: userObjectId },
      { projection: { _id: 1 } },
    );

    if (!user) {
      return { notFound: true };
    }

    await assertAccessAdministrationRemains(database, (snapshot) => {
      const projectedUser = snapshot.users.find(
        ({ id }) => id === normalizedUserId,
      );
      projectedUser.active = active;
    });

    await database.collection('users').updateOne(
      { _id: userObjectId },
      { $set: { active, updatedAt: new Date() } },
    );

    if (!active) {
      await database.collection('sessions').deleteMany({ userId: userObjectId });
    }

    return { updated: true };
  });
};

export const deleteUser = async (userId) => {
  if (typeof userId !== 'string' || !ObjectId.isValid(userId)) {
    return { notFound: true };
  }

  const database = await getDatabase();

  return withAccessMutationLock(database, async () => {
    const userObjectId = new ObjectId(userId);
    const normalizedUserId = userObjectId.toString();
    const user = await database.collection('users').findOne(
      { _id: userObjectId },
      { projection: { _id: 1 } },
    );

    if (!user) {
      return { notFound: true };
    }

    await assertAccessAdministrationRemains(database, (snapshot) => {
      snapshot.users = snapshot.users.filter(({ id }) => id !== normalizedUserId);
    });

    await database.collection('users').deleteOne({ _id: userObjectId });
    await database.collection('sessions').deleteMany({ userId: userObjectId });

    return { deleted: true };
  });
};

export const deleteRole = async (roleId) => {
  if (typeof roleId !== 'string' || !ObjectId.isValid(roleId)) {
    return { notFound: true };
  }

  const database = await getDatabase();

  return withAccessMutationLock(database, async () => {
    const roleObjectId = new ObjectId(roleId);
    const normalizedRoleId = roleObjectId.toString();
    const role = await database.collection('roles').findOne(
      { _id: roleObjectId },
      { projection: { _id: 1 } },
    );

    if (!role) {
      return { notFound: true };
    }

    await assertAccessAdministrationRemains(database, (snapshot) => {
      snapshot.roles.delete(normalizedRoleId);
    });

    await database.collection('roles').deleteOne({ _id: roleObjectId });
    await database.collection('users').updateMany(
      { roleIds: roleObjectId },
      { $pull: { roleIds: roleObjectId }, $set: { updatedAt: new Date() } },
    );

    return { deleted: true };
  });
};
