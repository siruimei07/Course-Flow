import { asCourseId, type SourceStatus } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import {
  SourceLibraryView,
  type SourceLibraryParameters,
} from "@/features/sources/source-library-view";

export const dynamic = "force-dynamic";

export default async function SourcesPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{
    courseId?: string;
    q?: string;
    sourceId?: string;
    status?: string;
    upload?: string;
  }>;
}>) {
  const { academics, scope, sources } = await getScopedCourseFlow();
  const parameters = await searchParams;
  const validStatuses = new Set<Exclude<SourceStatus, "deleted">>([
    "ready",
    "rejected",
    "uploading",
  ]);
  const status =
    parameters.status !== undefined &&
    validStatuses.has(parameters.status as Exclude<SourceStatus, "deleted">)
      ? (parameters.status as Exclude<SourceStatus, "deleted">)
      : undefined;
  const [courseSetups, library, allLibrary] = await Promise.all([
    academics.listCourses(scope),
    sources.listSources(scope, {
      ...(parameters.courseId === undefined ? {} : { courseId: asCourseId(parameters.courseId) }),
      ...(parameters.q === undefined ? {} : { search: parameters.q }),
      ...(status === undefined ? {} : { status }),
    }),
    sources.listSources(scope),
  ]);
  const courses = courseSetups
    .filter((setup) => setup.course.archivedAt === null && setup.term.archivedAt === null)
    .map((setup) => ({
      colorKey: setup.course.colorKey,
      code: setup.course.code,
      id: setup.course.id,
      title: setup.course.title,
    }));
  const selected =
    library.sources.find((source) => source.id === parameters.sourceId) ??
    library.sources[0] ??
    null;
  const viewParameters: SourceLibraryParameters = {
    ...(parameters.courseId === undefined ? {} : { courseId: parameters.courseId }),
    ...(parameters.q === undefined ? {} : { q: parameters.q }),
    ...(parameters.sourceId === undefined ? {} : { sourceId: parameters.sourceId }),
    ...(status === undefined ? {} : { status }),
  };

  return (
    <SourceLibraryView
      allSources={allLibrary.sources}
      courses={courses}
      filteredSources={library.sources}
      parameters={viewParameters}
      selected={selected}
      uploadCompleted={parameters.upload === "completed"}
    />
  );
}
