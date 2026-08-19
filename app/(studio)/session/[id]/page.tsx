import SessionFlow from "./SessionFlow";

export default async function SessionPage({ params }: PageProps<"/session/[id]">) {
  const { id } = await params;
  return <SessionFlow sessionId={id} />;
}
