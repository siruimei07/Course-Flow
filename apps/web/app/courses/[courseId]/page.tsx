import { redirect } from "next/navigation";

export default async function CoursePage({
  params,
}: Readonly<{ params: Promise<{ courseId: string }> }>) {
  const { courseId } = await params;
  redirect(`/courses?courseId=${encodeURIComponent(courseId)}`);
}
