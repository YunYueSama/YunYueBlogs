type LocalDraft = { id: string; document: import('./contracts').ContentDocument; savedAt: string };
let cacheActive = false;
let cacheGeneration = 0;
export function setDraftCacheActive(active:boolean) { cacheActive=active;cacheGeneration++; }
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('yunyue-studio-drafts', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('drafts', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
export async function localDraft(id: string, value?: LocalDraft | null): Promise<LocalDraft | undefined> {
  const generation=cacheGeneration;
  if(value&&!cacheActive)return;
  const db = await database();
  try {
    // 退出或清理后，较晚完成的旧写入不能把私密草稿重新写回设备。
    if(value!==undefined&&(generation!==cacheGeneration||value&&!cacheActive))return;
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', value === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('drafts'); const req = value === undefined ? store.get(id) : value === null ? store.delete(id) : store.put(value);
      let result: LocalDraft | undefined;
      req.onsuccess = () => { result = value === undefined ? req.result : undefined; };
      tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function clearDrafts() {
  cacheGeneration++;
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').clear(); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
  finally { db.close(); }
}
