import ProjectSessions from "./ProjectSessions";

export default async function ProjectPage({ params }: PageProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  return <ProjectSessions projectId={projectId} />;
}
