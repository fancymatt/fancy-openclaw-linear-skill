import { linearGraphQL } from "./client";
import { STATE_BLOCK, ASSIGNEE_BLOCK, TEAM_BLOCK } from "./fragments";
import { Issue, Project, ProjectMilestone } from "./types";
import { getIssue, updateIssue } from "./issues";

interface ProjectsResponse {
  projects: {
    nodes: Project[];
  };
}

interface ProjectByNameResponse {
  projects: {
    nodes: Project[];
  };
}

interface TeamProjectsResponse {
  team: {
    id: string;
    projects: {
      nodes: Array<{
        id: string;
        name: string;
      }>;
    };
  } | null;
}

interface ProjectMilestonesResponse {
  project: {
    projectMilestones: {
      nodes: ProjectMilestone[];
    };
  } | null;
}

interface ProjectIssuesResponse {
  projects: {
    nodes: Array<{
      issues: {
        nodes: Issue[];
      };
    }>;
  };
}

interface MilestoneCreateResponse {
  projectMilestoneCreate: {
    success: boolean;
    projectMilestone: ProjectMilestone | null;
  };
}

export async function findProjectByName(name: string): Promise<Project> {
  const data = await linearGraphQL<ProjectByNameResponse>(
    `
      query ProjectByName($name: String!) {
        projects(first: 50, filter: { name: { containsIgnoreCase: $name } }) {
          nodes {
            id
            name
            description
            content
            progress
            state
            startDate
            targetDate
          }
        }
      }
    `,
    { name }
  );

  const exact = data.projects.nodes.find((project) => project.name.toLowerCase() === name.toLowerCase());
  if (exact) {
    return exact;
  }
  if (data.projects.nodes.length === 1) {
    return data.projects.nodes[0];
  }
  throw new Error(`Could not uniquely resolve project "${name}".`);
}

export async function listProjects(): Promise<Project[]> {
  const data = await linearGraphQL<ProjectsResponse>(`
    query Projects {
      projects(first: 100) {
        nodes {
          id
          name
          description
          content
          progress
          state
          startDate
          targetDate
        }
      }
    }
  `);

  return data.projects.nodes;
}

export async function getProjectDetail(name: string): Promise<Project> {
  return findProjectByName(name);
}

export async function attachIssueToProject(issueId: string, projectName: string): Promise<Issue> {
  const project = await findProjectByName(projectName);
  return updateIssue(issueId, { projectId: project.id });
}

export async function getProjectIssues(projectName: string): Promise<Issue[]> {
  const data = await linearGraphQL<ProjectIssuesResponse>(
    `
      query ProjectIssues($name: String!) {
        projects(first: 20, filter: { name: { containsIgnoreCase: $name } }) {
          nodes {
            issues(first: 100) {
              nodes {
                id
                identifier
                title
                updatedAt
                priority
                ${STATE_BLOCK}
                ${ASSIGNEE_BLOCK}
                ${TEAM_BLOCK}
              }
            }
          }
        }
      }
    `,
    { name: projectName }
  );

  const project = data.projects.nodes.find((candidate) => candidate.issues);
  if (!project) {
    throw new Error(`Project not found: ${projectName}`);
  }

  return project.issues.nodes;
}

async function getProjectMilestones(projectId: string): Promise<ProjectMilestone[]> {
  const data = await linearGraphQL<ProjectMilestonesResponse>(
    `
      query ProjectMilestones($projectId: String!) {
        project(id: $projectId) {
          projectMilestones {
            nodes {
              id
              name
              description
              targetDate
            }
          }
        }
      }
    `,
    { projectId }
  );

  if (!data.project) {
    return [];
  }

  return data.project.projectMilestones.nodes;
}

export async function listMilestones(teamId: string): Promise<Array<ProjectMilestone & { projectName: string }>> {
  const teamData = await linearGraphQL<TeamProjectsResponse>(
    `
      query TeamProjects($teamId: String!) {
        team(id: $teamId) {
          id
          projects(first: 50) {
            nodes {
              id
              name
            }
          }
        }
      }
    `,
    { teamId }
  );

  if (!teamData.team) {
    throw new Error(`Team not found: ${teamId}`);
  }

  const results: Array<ProjectMilestone & { projectName: string }> = [];
  for (const project of teamData.team.projects.nodes) {
    const milestones = await getProjectMilestones(project.id);
    for (const milestone of milestones) {
      results.push({ ...milestone, projectName: project.name });
    }
  }

  return results;
}

export async function createMilestone(projectName: string, name: string, targetDate: string): Promise<ProjectMilestone> {
  const project = await findProjectByName(projectName);
  const data = await linearGraphQL<MilestoneCreateResponse>(
    `
      mutation CreateMilestone($input: ProjectMilestoneCreateInput!) {
        projectMilestoneCreate(input: $input) {
          success
          projectMilestone {
            id
            name
            description
            targetDate
          }
        }
      }
    `,
    {
      input: {
        projectId: project.id,
        name,
        targetDate
      }
    }
  );

  if (!data.projectMilestoneCreate.success || !data.projectMilestoneCreate.projectMilestone) {
    throw new Error(`Failed to create milestone ${name}.`);
  }

  return data.projectMilestoneCreate.projectMilestone;
}

export async function attachIssueToMilestone(issueId: string, milestoneName: string): Promise<Issue> {
  const issue = await getIssue(issueId);
  const projectId = issue.project?.id;
  if (!projectId) {
    throw new Error(`Issue ${issueId} is not attached to a project. Use project-attach first.`);
  }

  const milestones = await getProjectMilestones(projectId);
  const milestone = milestones.find((candidate) => candidate.name.toLowerCase() === milestoneName.toLowerCase());
  if (!milestone) {
    throw new Error(`Milestone not found: ${milestoneName}`);
  }

  return updateIssue(issueId, { projectMilestoneId: milestone.id });
}
