import { describe, expect, it } from 'vitest';
import { PolicyViolationError } from '../../src/index.js';
import {
  createDocumentPublishingPolicy,
  DocumentRepository,
  WorkspaceAccess,
  type DocumentRecord,
} from '../../examples/document-publishing.js';

const workspaceId = 'workspace-42';
const actorId = 'editor-17';
const documentId = 'doc-103';

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: documentId,
    workspaceId,
    title: 'Incident response runbook',
    body: 'Steps for coordinating service recovery.',
    reviewStatus: 'approved',
    openComments: 0,
    status: 'draft',
    ...overrides,
  };
}

describe('document publishing integration', () => {
  it('publishes an approved and complete document for a workspace editor', async () => {
    const document = makeDocument();
    const repository = new DocumentRepository([document]);
    const access = new WorkspaceAccess();
    access.grantEditor(workspaceId, actorId);
    const policy = createDocumentPublishingPolicy(repository, access);

    const result = await policy.execute({ actorId, workspaceId, documentId });

    expect(result.success).toBe(true);
    expect(result.value.status).toBe('published');
    expect(result.value.publishedAt).toEqual(expect.any(Number));
    expect(document.status).toBe('published');
  });

  it('does not publish when access or reviewer approval is missing', async () => {
    const document = makeDocument({ reviewStatus: 'pending' });
    const repository = new DocumentRepository([document]);
    const access = new WorkspaceAccess();
    access.grantEditor(workspaceId, actorId);
    const policy = createDocumentPublishingPolicy(repository, access);

    await expect(policy.execute({ actorId: 'guest-3', workspaceId, documentId }))
      .rejects.toMatchObject({
        code: 'POLICY_VIOLATION',
        violations: [expect.objectContaining({ ruleId: 'workspace-editor' })],
      });
    expect(document.status).toBe('draft');

    await expect(policy.execute({ actorId, workspaceId, documentId }))
      .rejects.toBeInstanceOf(PolicyViolationError);
    expect(document.status).toBe('draft');
  });

  it('blocks incomplete documents and unresolved review comments before mutation', async () => {
    const document = makeDocument({ title: '  ', openComments: 2 });
    const repository = new DocumentRepository([document]);
    const access = new WorkspaceAccess();
    access.grantEditor(workspaceId, actorId);
    const policy = createDocumentPublishingPolicy(repository, access);

    try {
      await policy.execute({ actorId, workspaceId, documentId });
      expect.fail('Expected the publication policy to reject the document');
    } catch (error) {
      expect(error).toBeInstanceOf(PolicyViolationError);
      expect((error as PolicyViolationError).violations.map(({ ruleId }) => ruleId))
         .toEqual(['content-complete', 'comments-resolved']);
    }
    expect(document.status).toBe('draft');
  });
});
