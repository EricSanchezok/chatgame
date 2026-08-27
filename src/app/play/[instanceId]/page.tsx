import { InstanceExperience } from "../../_components/instance-experience";

export default async function PlayPage({ params }: { params: Promise<{ instanceId: string }> }) {
  const { instanceId } = await params;
  return <InstanceExperience instanceId={instanceId} />;
}
