import { redirect } from "next/navigation";

export default async function ManagePage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  redirect(`/play/${encodeURIComponent(sessionId)}/manage/saves`);
}
