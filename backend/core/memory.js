// An in-memory stand-in for the part of MongoDB that the API uses, for the local demo and the
// tests. It follows MongoDB's rules where they matter here: { field: null } also matches a
// missing field, $ne matches missing fields, and sorting puts empty values first.

// Copies keep dates as dates, as MongoDB does (sessions expire by date).
const clone = (value) => structuredClone(value);
const isOps = (cond) => cond && typeof cond === 'object' && !Array.isArray(cond) && Object.keys(cond).some((k) => k.startsWith('$'));

function compare(a, b) {
  const an = a ?? null;
  const bn = b ?? null;
  if (an === bn) return 0;
  if (an === null) return -1;
  if (bn === null) return 1;
  return an < bn ? -1 : an > bn ? 1 : 0;
}

function test(value, cond) {
  const v = value ?? null;
  if (!isOps(cond)) return v === (cond ?? null);
  return Object.entries(cond).every(([op, arg]) => {
    switch (op) {
      case '$in': return arg.some((x) => v === (x ?? null));
      case '$ne': return v !== (arg ?? null);
      case '$lt': return v !== null && v < arg;
      case '$lte': return v !== null && v <= arg;
      case '$gt': return v !== null && v > arg;
      case '$gte': return v !== null && v >= arg;
      default: throw new Error(`Unsupported filter ${op}`);
    }
  });
}
const matches = (doc, filter = {}) => Object.entries(filter).every(([key, cond]) => test(doc[key], cond));

function apply(doc, update) {
  for (const [op, fields] of Object.entries(update)) {
    if (op === '$set') Object.assign(doc, clone(fields));
    else if (op === '$inc') for (const [k, n] of Object.entries(fields)) doc[k] = (doc[k] || 0) + n;
    else throw new Error(`Unsupported update ${op}`);
  }
}

export class MemoryStore {
  // data: { collectionName: [documents] }, changed in place. onWrite runs after every change.
  // cap: { collectionName: maxDocuments } keeps busy collections (like "changes") small.
  constructor(data = {}, { onWrite = () => {}, cap = {} } = {}) {
    this.data = data;
    this.onWrite = onWrite;
    this.cap = cap;
  }

  col(name) {
    const store = this;
    const docs = () => (store.data[name] ||= []);
    const wrote = () => {
      const max = store.cap[name];
      if (max && docs().length > max) docs().splice(0, docs().length - max);
      store.onWrite(name);
    };
    return {
      async find(filter = {}, { sort, limit } = {}) {
        let list = docs().filter((d) => matches(d, filter));
        if (sort) {
          const keys = Object.entries(sort);
          list = [...list].sort((a, b) => {
            for (const [k, dir] of keys) {
              const c = compare(a[k], b[k]);
              if (c) return c * dir;
            }
            return 0;
          });
        }
        if (limit) list = list.slice(0, limit);
        return clone(list);
      },
      async findOne(filter = {}) {
        return clone(docs().find((d) => matches(d, filter))) ?? null;
      },
      async insertOne(doc) {
        docs().push(clone(doc));
        wrote();
        return { acknowledged: true };
      },
      async updateOne(filter, update, { upsert = false } = {}) {
        const doc = docs().find((d) => matches(d, filter));
        if (doc) apply(doc, update);
        else if (upsert) {
          const created = Object.fromEntries(Object.entries(filter).filter(([, cond]) => !isOps(cond)));
          apply(created, update);
          docs().push(created);
        } else return { matchedCount: 0, modifiedCount: 0 };
        wrote();
        return { matchedCount: doc ? 1 : 0, modifiedCount: 1, upsertedCount: doc ? 0 : 1 };
      },
      async updateMany(filter, update) {
        const hits = docs().filter((d) => matches(d, filter));
        hits.forEach((d) => apply(d, update));
        if (hits.length) wrote();
        return { matchedCount: hits.length, modifiedCount: hits.length };
      },
      async deleteOne(filter) {
        const i = docs().findIndex((d) => matches(d, filter));
        if (i < 0) return { deletedCount: 0 };
        docs().splice(i, 1);
        wrote();
        return { deletedCount: 1 };
      },
      async deleteMany(filter) {
        const before = docs().length;
        store.data[name] = docs().filter((d) => !matches(d, filter));
        const deletedCount = before - store.data[name].length;
        if (deletedCount) wrote();
        return { deletedCount };
      },
      async countDocuments(filter = {}) {
        return docs().filter((d) => matches(d, filter)).length;
      },
    };
  }
}
