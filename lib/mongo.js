// The MongoDB connection for the API functions, reused while a function instance stays warm.
import { MongoClient } from 'mongodb';
import { attachDatabasePool } from '@vercel/functions';

// Raise this when the indexes below change; each deployment then creates them once.
const SCHEMA_VERSION = 1;
const INDEXES = [
  ['team_members', { id: 1 }, { unique: true }],
  ['team_members', { email: 1 }, { unique: true }],
  ['clients', { id: 1 }, { unique: true }],
  ['projects', { id: 1 }, { unique: true }],
  ['projects', { connect_key: 1 }, { unique: true }],
  ['project_members', { project_id: 1, member_id: 1 }, { unique: true }],
  ['project_members', { member_id: 1 }],
  ['threads', { id: 1 }, { unique: true }],
  ['threads', { project_id: 1, last_message_at: -1 }],
  ['messages', { id: 1 }, { unique: true }],
  ['messages', { thread_id: 1, created_at: 1 }],
  ['messages', { project_id: 1, sender: 1, created_at: -1 }],
  ['tasks', { id: 1 }, { unique: true }],
  ['tasks', { project_id: 1, position: 1 }],
  ['project_finances', { project_id: 1 }, { unique: true }],
  ['payments', { id: 1 }, { unique: true }],
  ['payments', { project_id: 1, paid_on: -1 }],
  ['activity', { id: -1 }, { unique: true }],
  ['activity', { project_id: 1, id: -1 }],
  ['changes', { at: 1 }],
  // Change notes are only needed for a few minutes; MongoDB deletes them after a day.
  ['changes', { expire_at: 1 }, { expireAfterSeconds: 86400 }],
  ['sessions', { id: 1 }, { unique: true }],
  ['sessions', { member_id: 1 }],
  ['sessions', { expires_at: 1 }, { expireAfterSeconds: 0 }],
];

export const missingSettings = () =>
  ['MONGODB_URI', 'GOOGLE_CLIENT_ID', 'OWNER_EMAIL'].filter((name) => !process.env[name]?.trim());

let ready = null;
export function database() {
  if (!ready) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      appName: 'zenatiq-portal', maxPoolSize: 5, maxIdleTimeMS: 10000, serverSelectionTimeoutMS: 8000,
    });
    attachDatabasePool(client);
    ready = client.connect().then(async () => {
      const db = client.db(process.env.MONGODB_DB?.trim() || 'zenatiq');
      await prepare(db);
      return db;
    });
    ready.catch(() => {
      ready = null;
      client.close().catch(() => {});
    });
  }
  return ready;
}

async function prepare(db) {
  const meta = db.collection('meta');
  if ((await meta.findOne({ _id: 'schema' }))?.version === SCHEMA_VERSION) return;
  await Promise.all(INDEXES.map(([name, keys, options = {}]) => db.collection(name).createIndex(keys, options)));
  await meta.updateOne({ _id: 'schema' }, { $set: { version: SCHEMA_VERSION, at: new Date() } }, { upsert: true });
}

// The collection methods core/ops.js expects. MongoDB's own _id stays out of every result.
const HIDE = { projection: { _id: 0, expire_at: 0 } };
export function storeFor(db) {
  const wrap = (c) => ({
    find(filter = {}, { sort, limit } = {}) {
      let cursor = c.find(filter, HIDE);
      if (sort) cursor = cursor.sort(sort);
      if (limit) cursor = cursor.limit(limit);
      return cursor.toArray();
    },
    findOne: (filter = {}) => c.findOne(filter, HIDE),
    insertOne: (doc) => c.insertOne(c.collectionName === 'changes' ? { ...doc, expire_at: new Date() } : { ...doc }),
    updateOne: (filter, update, options) => c.updateOne(filter, update, options),
    updateMany: (filter, update) => c.updateMany(filter, update),
    deleteOne: (filter) => c.deleteOne(filter),
    deleteMany: (filter) => c.deleteMany(filter),
    countDocuments: (filter = {}) => c.countDocuments(filter),
  });
  const cache = new Map();
  return {
    col(name) {
      if (!cache.has(name)) cache.set(name, wrap(db.collection(name)));
      return cache.get(name);
    },
  };
}
