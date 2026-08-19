import EditorFlow from "./EditorFlow";

export default async function EditorPage({ params }: PageProps<"/editor/[id]">) {
  const { id } = await params;
  return <EditorFlow sessionId={id} />;
}
