import { checkAuth } from "./auth";
import { createIssue, updateIssue, addComment, getIssue } from "./issues";
import { listTeams as listTeamsImport } from "./teams.js";
import { linearGraphQL } from "./client";
import { LinearApiError } from "./client";

interface TestIssueResponse {
  issue: {
    id: string;
    identifier: string;
    title: string;
  };
}

interface CreatedIssueResponse {
  issueCreate: {
    success: boolean;
    issue: {
      id: string;
      identifier: string;
      title: string;
    };
  };
}

export async function linearTest(): Promise<void> {
  console.log("🧪 Linear Test — Round-trip validation\n");

  // Generate unique test identifier
  const testId = `TEST-${Date.now().toString(36)}`;
  const testTitle = `[Linear CLI Test] ${testId}`;
  console.log(`📝 Test issue: ${testTitle}\n`);

  let issueId: string | null = null;
  let issueIdentifier: string | null = null;
  let failed = false;

  try {
    // Step 1: Create test issue
    console.log("1️⃣  Creating test issue...");
    const createData = await linearGraphQL<CreatedIssueResponse>(`
      mutation CreateTestIssue($title: String!) {
        issueCreate(input: { title: $title }) {
          success
          issue {
            id
            identifier
            title
          }
        }
      }
    `, { title: testTitle });

    if (!createData.issueCreate?.success || !createData.issueCreate?.issue) {
      throw new Error("Issue creation failed");
    }

    issueId = createData.issueCreate.issue.id;
    issueIdentifier = createData.issueCreate.issue.identifier;
    console.log(`   ✅ Created: ${issueIdentifier} (${issueId})\n`);

    // Step 2: Read back the issue
    console.log("2️⃣  Reading issue back...");
    const issueData = await linearGraphQL<TestIssueResponse>(`
      query GetTestIssue($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
        }
      }
    `, { id: issueId });

    if (!issueData?.issue || issueData.issue.identifier !== issueIdentifier) {
      throw new Error(`Issue read mismatch: expected ${issueIdentifier}`);
    }

    console.log(`   ✅ Read: ${issueData.issue.title}\n`);

    // Step 3: Add comment
    const commentBody = `Linear CLI test run at ${new Date().toISOString()}. All checks passed.`;
    console.log("3️⃣  Adding comment...");
    await addComment(issueId, commentBody);
    console.log(`   ✅ Commented\n`);

    // Step 4: Update status
    console.log("4️⃣  Updating status to 'Todo'...");
    await updateIssue(issueId, { stateId: "todo" });
    console.log(`   ✅ Updated\n`);

    // Step 5: Verify teams accessible
    console.log("5️⃣  Verifying teams access...");
    const teams = await listTeamsImport();
    console.log(`   ✅ Teams accessible: ${teams.length} teams\n`);

    // Step 6: Verify auth still valid
    console.log("6️⃣  Verifying auth...");
    const viewer = await checkAuth();
    console.log(`   ✅ Auth valid: ${viewer.name}\n`);

    // Step 7: Cleanup
    console.log("7️⃣  Cleaning up...");
    try {
      await updateIssue(issueId, { stateId: "done" });
      console.log(`   ✅ Marked test issue as Done\n`);
    } catch (err) {
      console.log(`   ⚠️  Cleanup warning: ${err instanceof Error ? err.message : String(err)}\n`);
      // Don't fail the test if cleanup fails
    }

  } catch (err) {
    failed = true;
    console.log(`\n❌ Test failed: ${err instanceof Error ? err.message : String(err)}\n`);

    // If we created an issue, try to clean it up
    if (issueId) {
      try {
        console.log("\n🧹 Attempting to clean up test issue...");
        await updateIssue(issueId, { stateId: "cancel" });
        console.log(`   ✅ Cleanup successful\n`);
      } catch (cleanupErr) {
        console.log(`   ⚠️  Cleanup failed (issue may need manual deletion): ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}\n`);
      }
    }
  }

  // Final status report
  console.log("\n" + "=".repeat(50));
  if (failed) {
    console.log("❌ Linear Test: FAILED\n");
    console.log("Check:");
    console.log("  • Auth token is valid and has correct permissions");
    console.log("  • Can create, read, update, and comment on issues");
    console.log("  • Your team ID is correct");
    console.log("\nIf all checks pass but test fails, report this as a bug.");
    process.exit(1);
  } else {
    console.log("✅ Linear Test: PASSED\n");
    console.log("All operations completed successfully:");
    console.log("  • Create issue");
    console.log("  • Read issue");
    console.log("  • Add comment");
    console.log("  • Update status");
    console.log("  • List teams");
    console.log("  • Verify auth");
    if (issueIdentifier) {
      console.log(`\nYou can delete the test issue if desired: ${issueIdentifier}`);
    }
    process.exit(0);
  }
}
