import { policy } from '../src/index.js';

export interface DocumentRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly body: string;
  readonly reviewStatus: 'pending' | 'approved';
  readonly openComments: number;
  status: 'draft' | 'published';
  publishedAt?: number;
}

export interface PublishContext {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly documentId: string;
}

export class DocumentRepository {
  readonly #documents = new Map<string, DocumentRecord>();

  constructor(documents: readonly DocumentRecord[]) {
    for (const document of documents) this.#documents.set(document.id, document);
  }

  get(documentId: string): DocumentRecord | undefined {
    return this.#documents.get(documentId);
  }

  publish(documentId: string, publishedAt: number): DocumentRecord {
    const document = this.#documents.get(documentId);
    if (!document) throw new Error(`Document '${documentId}' was not found`);
    if (document.status !== 'draft') throw new Error(`Document '${documentId}' is not a draft`);

    document.status = 'published';
    document.publishedAt = publishedAt;
    return { ...document };
  }
}

export class WorkspaceAccess {
  readonly #editors = new Set<string>();

  grantEditor(workspaceId: string, actorId: string): void {
    this.#editors.add(`${workspaceId}:${actorId}`);
  }

  async isEditor(workspaceId: string, actorId: string, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false;
    return this.#editors.has(`${workspaceId}:${actorId}`);
  }
}

export function createDocumentPublishingPolicy(
  documents: DocumentRepository,
  access: WorkspaceAccess
) {
  return policy<PublishContext>('Publish document', {
    timeoutMs: 5000,
    contextStrategy: 'snapshot',
  })
    .only('workspace-editor', async (context, signal) => {
      const allowed = await access.isEditor(context.workspaceId, context.actorId, signal);
      return allowed || 'Only workspace editors may publish documents';
    })
    .only('document-exists', async (context, signal) => {
      if (signal.aborted) return 'Document lookup was cancelled';
      return documents.get(context.documentId) !== undefined || 'Document was not found';
    })
    .only('review-approved', async (context, signal) => {
      if (signal.aborted) return 'Review lookup was cancelled';
      return documents.get(context.documentId)?.reviewStatus === 'approved'
        || 'Document requires reviewer approval';
    })
    .where('content-complete', (context) => {
      const document = documents.get(context.documentId);
      return Boolean(document?.title.trim() && document.body.trim())
        || 'Document title and body are required';
    })
    .where('comments-resolved', (context) => {
      const document = documents.get(context.documentId);
      return document?.openComments === 0
        || `${document?.openComments ?? 'Unknown'} unresolved comments remain`;
    })
    .to((context) => documents.publish(context.documentId, Date.now()));
}
