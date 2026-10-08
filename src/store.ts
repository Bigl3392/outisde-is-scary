import type { Receipt } from "./receipt";

const DB = "field-receipt";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("receipts", { keyPath: "receipt_id" });
      db.createObjectStore("metrics", { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const putReceipt = (r: Receipt) => tx("receipts", "readwrite", (s) => s.put(r));

export async function allReceipts(): Promise<Receipt[]> {
  const rows = await tx<Receipt[]>("receipts", "readonly", (s) => s.getAll());
  return rows.sort((a, b) => b.provenance.created_at.localeCompare(a.provenance.created_at));
}

export const putMetric = (m: Record<string, unknown>) => tx("metrics", "readwrite", (s) => s.add(m));
export const allMetrics = () => tx<Record<string, unknown>[]>("metrics", "readonly", (s) => s.getAll());
