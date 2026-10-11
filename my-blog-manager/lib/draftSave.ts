export type DraftSaveResult = { id: string; lastModified: number };

/** 保存快照只确认自己的版本；请求期间的新编辑仍须继续保存。 */
export class DraftSaveCoordinator<T extends object> {
  private revision = 0;
  private savedRevision = 0;
  private pending: Promise<DraftSaveResult> | null = null;
  private receipt: DraftSaveResult | null = null;

  constructor(public id: string | null, private readonly persist: (payload: T & { id: string | null }) => Promise<DraftSaveResult>) {}

  get dirty() { return this.revision !== this.savedRevision; }
  markChanged() { this.revision += 1; }

  async save(readValues: () => T): Promise<DraftSaveResult> {
    // 手动保存遇到自动保存时，等待旧快照，再补存期间产生的新版本。
    while (this.pending) await this.pending;
    if (!this.dirty && this.receipt) return this.receipt;
    const revision = this.revision;
    const request = this.persist({ ...readValues(), id: this.id });
    this.pending = request;
    try {
      const result = await request;
      this.id = result.id;
      this.receipt = result;
      this.savedRevision = revision;
      return result;
    } finally {
      if (this.pending === request) this.pending = null;
    }
  }
}
