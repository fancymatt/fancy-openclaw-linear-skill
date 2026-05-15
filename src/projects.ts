import { linearGraphQL } from "./client";
import { STATE_BLOCK, ASSIGNEE_BLOCK, TEAM_BLOCK } from "./fragments";
import { Issue, Project, ProjectMilestone } from "./types";
import { findUserByName, getIssue, updateIssue } from "./issues";
import { resolveTeamId } from "./teams";

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

interface ProjectIssueNode {
  id: string;
  identifier: string;
  title: string;
  updatedAt?: string | null;
  priority?: number | null;
  state?: { id: string; name: string; type?: string | null } | null;
  assignee?: { id: string; name: string; email?: string | null } | null;
  team?: { id: string; key?: string; name?: string } | null;
  projectMilestone?: ProjectMilestone | null;
}

interface ProjectIssuesResponse {
  issues: {
    nodes: ProjectIssueNode[];
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
        issues(first: 100, filter: { project: { name: { containsIgnoreCase: $name } } }) {
          nodes {
            id
            identifier
            title
            updatedAt
            priority
            ${STATE_BLOCK}
            ${ASSIGNEE_BLOCK}
            ${TEAM_BLOCK}
            projectMilestone {
              id
              name
              description
              targetDate
            }
          }
        }
      }
    `,
    { name: projectName }
  );

  return data.issues.nodes.map((node) => ({
    ...node,
    milestone: node.projectMilestone ?? null
  }));
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

interface ProjectCreateResponse {
  projectCreate: {
    success: boolean
    project: { id: string; name: string; url: string } | null
  }
}

interface ProjectUpdateResponse {
  projectUpdate: {
    success: boolean
    project: { id: string; name: string; url: string } | null
  }
}

export interface ProjectCreateOptions {
  description?: string
  lead?: string
  state?: string
  targetDate?: string
  startDate?: string
}

export interface ProjectEditOptions {
  name?: string
  description?: string
  lead?: string
  state?: string
  targetDate?: string
  startDate?: string
}

export async function createProject(
  team: string,
  name: string,
  options: ProjectCreateOptions = {}
): Promise<{ id: string; name: string; url: string }> {
  const teamId = await resolveTeamId(team)
  const input: Record<string, unknown> = { teamIds: [teamId], name }

  if (options.description !== undefined) input.description = options.description
  if (options.state !== undefined) input.state = options.state
  if (options.targetDate !== undefined) input.targetDate = options.targetDate
  if (options.startDate !== undefined) input.startDate = options.startDate
  if (options.lead !== undefined) {
    const user = await findUserByName(options.lead)
    input.leadId = user.id
  }

  const data = await linearGraphQL<ProjectCreateResponse>(
    `
      mutation ProjectCreate($input: ProjectCreateInput!) {
        projectCreate(input: $input) {
          success
          project {
            id
            name
            url
          }
        }
      }
    `,
    { input }
  )

  if (!data.projectCreate.success || !data.projectCreate.project) {
    throw new Error(`Failed to create project "${name}".`)
  }

  return data.projectCreate.project
}

export async function editProject(
  projectId: string,
  options: ProjectEditOptions
): Promise<{ id: string; name: string; url: string }> {
  const input: Record<string, unknown> = {}

  if (options.name !== undefined) input.name = options.name
  if (options.description !== undefined) input.description = options.description
  if (options.state !== undefined) input.state = options.state
  if (options.targetDate !== undefined) input.targetDate = options.targetDate
  if (options.startDate !== undefined) input.startDate = options.startDate
  if (options.lead !== undefined) {
    const user = await findUserByName(options.lead)
    input.leadId = user.id
  }

  const data = await linearGraphQL<ProjectUpdateResponse>(
    `
      mutation ProjectUpdate($id: String!, $input: ProjectUpdateInput!) {
        projectUpdate(id: $id, input: $input) {
          success
          project {
            id
            name
            url
          }
        }
      }
    `,
    { id: projectId, input }
  )

  if (!data.projectUpdate.success || !data.projectUpdate.project) {
    throw new Error(`Failed to update project "${projectId}".`)
  }

  return data.projectUpdate.project
}

export async function attachIssueToProjectById(
  issueId: string,
  projectId: string,
  milestoneId?: string
): Promise<Issue> {
  const update: Record<string, unknown> = { projectId }
  if (milestoneId !== undefined) update.projectMilestoneId = milestoneId
  return updateIssue(issueId, update)
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
