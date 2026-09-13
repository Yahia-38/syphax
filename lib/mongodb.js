import { MongoClient } from 'mongodb';

let productionClientPromise;

const connectToMongoDB = () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('La variable MONGODB_URI est manquante.');
  }

  return new MongoClient(uri).connect();
};

export const getMongoClient = () => {
  if (process.env.NODE_ENV === 'development') {
    globalThis.syphaxMongoClientPromise ??= connectToMongoDB();
    return globalThis.syphaxMongoClientPromise;
  }

  productionClientPromise ??= connectToMongoDB();
  return productionClientPromise;
};

export const getDatabase = async () => {
  const client = await getMongoClient();
  return client.db();
};

export const closeMongoConnection = async () => {
  const clientPromise =
    process.env.NODE_ENV === 'development'
      ? globalThis.syphaxMongoClientPromise
      : productionClientPromise;

  if (!clientPromise) {
    return;
  }

  const client = await clientPromise;
  await client.close();

  globalThis.syphaxMongoClientPromise = undefined;
  productionClientPromise = undefined;
};
