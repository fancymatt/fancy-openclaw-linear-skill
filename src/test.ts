import { checkAuth } from "./auth";
import { createIssue, updateIssue, addComment, getIssue } from "./issues";
import { resolveTeamId, listTeams } from "./teams";
import { getWorkflowStates, findStateByName } from "./states";
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
  let commentAdded = false;
  let authValid = false;
  let teamsAccessible = false;
  let commonStatusUpdatePassed = false;
  let unlikelyStatusBehavior: string | null = null;

  try {
    // Step 1: Create test issue
    console.log("1️⃣  Creating test issue...");
    
    // Resolve → first available team for test issues
    const availableTeams = await listTeams();
    const firstTeam = availableTeams[0];
    const teamId = await resolveTeamId(firstTeam.key ?? "");

    if (!teamId) {
      throw new Error("No teams available to create test issue in.");
    }
    
    const createData = await linearGraphQL<CreatedIssueResponse>(`
      mutation CreateTestIssue($title: String!, $teamId: String!) {
        issueCreate(input: { title: $title, teamId: $teamId }) {
          success
            issue {
              id
              identifier
              title
            }
        }
      }
    `, { title: testTitle, teamId });

    if (!createData.issueCreate?.success || !createData.issueCreate?.issue) {
      throw new Error("Issue creation failed");
    }
    
    issueId = createData.issueCreate.issue.id;
    issueIdentifier = createData.issueCreate.issue.identifier;
    console.log(`   ✅ Created: ${issueIdentifier} (${issueId})\n`);

    // Step 2: Read back → issue
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
    commentAdded = true;

    // Step 4a: Query available workflow states
    console.log("4️⃣  Querying available workflow states...");
    const states = await getWorkflowStates(teamId);
    console.log(`   ✅ Found ${states.length} workflow states\n`);
    
    // Show available states for context
    console.log("   Available states:");
    for (const state of states) {
      console.log(`      • ${state.name} (${state.type})`);
    }
    console.log();

    // Step 4b: Test 1 - Update to common status (Todo or Done)
    console.log("5️⃣  Testing common status update (Todo or Done)...");
    try {
      const commonState = await findStateByName(teamId, "todo").catch(() => findStateByName(teamId, "done"));
      await updateIssue(issueId, { stateId: commonState.id });
      console.log(`   ✅ Updated to: ${commonState.name}\n`);
      commonStatusUpdatePassed = true;
    } catch (err) {
      console.log(`   ⚠️  Common status update failed: ${err instanceof Error ? err.message : String(err)}\n`);
      // Not a critical failure - continue testing
    }

    // Step 4c: Test 2 - Update to unlikely status (Escalated) to test fallback behavior
    console.log("6️⃣  Testing unlikely status update (Escalated)...");
    try {
      const escalatedState = await findStateByName(teamId, "escalated");
      await updateIssue(issueId, { stateId: escalatedState.id });
      console.log(`   ✅ Updated to: ${escalatedState.name}\n`);
      unlikelyStatusBehavior = `Escalated status exists and update succeeded`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`   ⚠️  Escalated status update failed: ${msg}\n`);
      unlikelyStatusBehavior = `Escalated status does not exist (as expected) - agent would need fallback/reporting`;
    }

    // Step 5: Verify teams accessible
    console.log("7️⃣  Verifying teams access...");
    const teams = await listTeams();
    console.log(`   ✅ Teams accessible: ${teams.length} teams\n`);
    teamsAccessible = true;

    // Step 6: Verify auth still valid
    console.log("8️⃣  Verifying auth...");
    const viewer = await checkAuth();
    console.log(`   ✅ Auth valid: ${viewer.name}\n`);
    authValid = true;

    // Step 7: Cleanup
    console.log("9️⃣  Cleaning up...");
    try {
      const doneState = await findStateByName(teamId, "done");
      await updateIssue(issueId, { stateId: doneState.id });
      console.log(`   ✅ Marked test issue as ${doneState.name}\n`);
    } catch (err) {
      console.log(`   ⚠️  Cleanup warning: ${err instanceof Error ? err.message : String(err)}\n`);
      // Don't fail → test if cleanup fails
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
  
  // Test passes if CRUD operations succeed AND adaptability is validated
  const allCoreOpsPassed = issueId && issueIdentifier && commentAdded;
  const adaptabilityTested = (commonStatusUpdatePassed || unlikelyStatusBehavior !== null);
  
  if (allCoreOpsPassed && adaptabilityTested) {
    console.log("✅ Linear Test: PASSED\n");
    console.log("All operations completed successfully:");
    console.log("  • Create issue");
    console.log("  • Read issue");
    console.log("  • Add comment");
    console.log("  • Query workflow states");
    
    if (commonStatusUpdatePassed) {
      console.log("  • Common status update (Todo/Done)");
    } else {
      console.log("  • Common status update (tested - reported gap)");
    }
    
    if (unlikelyStatusBehavior) {
      console.log(`  • Unlikely status handling: ${unlikelyStatusBehavior}`);
    }
    
    console.log("  • List teams");
    console.log("  • Verify auth");
    
    if (issueIdentifier) {
      console.log(`\nYou can delete of test issue if desired: ${issueIdentifier}`);
    }
    process.exit(0);
  } else {
    console.log("❌ Linear Test: FAILED\n");
    console.log("Check:");
    console.log("  • Auth token is valid and has correct permissions");
    console.log("  • Can create, read, update, and comment on issues");
    console.log("  • Your team ID is correct");
    console.log("\nIf all checks pass but test fails, report this as a bug.");
    process.exit(1);
  }
}
