import {
  asCourseId,
  asSourceAssetId,
  asSourceDocumentId,
  type SourceDocumentSummary,
} from "@courseflow/core";
import { SourceLibraryView } from "@courseflow-web/features/sources/source-library-view";

const courseId = asCourseId("10000000-0000-4000-8000-000000000001");

const sources: readonly SourceDocumentSummary[] = [
  {
    assets: [
      {
        byteSize: 1_847_296,
        height: null,
        id: asSourceAssetId("60000000-0000-4000-8000-000000000011"),
        originalFilename: "CSC258 Lab Guide.pdf",
        position: 0,
        sha256: "8a2e9f83a1e5685f6c9f12b2ef1931c8",
        sniffedMimeType: "application/pdf",
        width: null,
      },
    ],
    contentFingerprint: "sha256:8a2e9f83a1e5685f6c9f12b2ef1931c8",
    courseCode: "CSC258H5",
    courseId,
    courseTitle: "Computer Organization",
    createdAt: "2026-08-13T00:00:00.000Z",
    deletedAt: null,
    displayName: "CSC258 Lab Guide.pdf",
    id: asSourceDocumentId("50000000-0000-4000-8000-000000000011"),
    kind: "assignment_brief",
    pageCount: 12,
    status: "ready",
    version: 2,
  },
  {
    assets: [
      {
        byteSize: 928_224,
        height: null,
        id: asSourceAssetId("60000000-0000-4000-8000-000000000012"),
        originalFilename: "CSC258 Course Syllabus.pdf",
        position: 0,
        sha256: null,
        sniffedMimeType: null,
        width: null,
      },
    ],
    contentFingerprint: null,
    courseCode: "CSC258H5",
    courseId,
    courseTitle: "Computer Organization",
    createdAt: "2026-08-13T00:00:00.000Z",
    deletedAt: null,
    displayName: "CSC258 Course Syllabus.pdf",
    id: asSourceDocumentId("50000000-0000-4000-8000-000000000012"),
    kind: "syllabus",
    pageCount: null,
    status: "uploading",
    version: 1,
  },
  {
    assets: [
      {
        byteSize: 354_877,
        height: 1600,
        id: asSourceAssetId("60000000-0000-4000-8000-000000000013"),
        originalFilename: "rubric-page-01.png",
        position: 0,
        sha256: null,
        sniffedMimeType: "image/png",
        width: 1200,
      },
    ],
    contentFingerprint: null,
    courseCode: "CSC258H5",
    courseId,
    courseTitle: "Computer Organization",
    createdAt: "2026-08-13T00:00:00.000Z",
    deletedAt: null,
    displayName: "Project rubric screenshots",
    id: asSourceDocumentId("50000000-0000-4000-8000-000000000013"),
    kind: "screenshot_set",
    pageCount: null,
    status: "rejected",
    version: 2,
  },
];

export default async function SourceHarnessPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ sourceId?: string }>;
}>) {
  const parameters = await searchParams;
  const selected = sources.find((source) => source.id === parameters.sourceId) ?? sources[0]!;

  return (
    <SourceLibraryView
      allSources={sources}
      basePath="/sources"
      courses={[
        {
          colorKey: "blue",
          code: "CSC258H5",
          id: courseId,
          title: "Computer Organization",
        },
      ]}
      filteredSources={sources}
      parameters={parameters}
      selected={selected}
    />
  );
}
