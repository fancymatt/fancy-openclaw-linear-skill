import { linearGraphQL } from "./client";

interface DeleteIssueResponse {
  issueDelete: { success: boolean };
}

export async function deleteIssue(issueId: string): Promise<{ success: boolean; id: string }> {
  const data = await linearGraphQL<DeleteIssueResponse>(
    `
      mutation DeleteIssue($id: String!) {
        issueDelete(id: $id) {
          success
        }
      }
    `,
    { id: issueId }
  );
  return { success: data.issueDelete.success, id: issueId };
}

interface DeleteCommentResponse {
  commentDelete: { success: boolean };
}

export async function deleteComment(commentId: string): Promise<{ success: boolean; id: string }> {
  const data = await linearGraphQL<DeleteCommentResponse>(
    `
      mutation DeleteComment($id: String!) {
        commentDelete(id: $id) {
          success
        }
      }
    `,
    { id: commentId }
  );
  return { success: data.commentDelete.success, id: commentId };
}
