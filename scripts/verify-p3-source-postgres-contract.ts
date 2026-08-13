import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { asUserId, createAcademics, createPlanning, createSourceLibrary } from "@courseflow/core";
import {
  createPostgresCourseFlowRepository,
  createPostgresSourceLibraryRepository,
  createS3SourceObjectStore,
  loadRuntimeConfig,
} from "@courseflow/infrastructure";
import { migrateDatabase } from "@courseflow/infrastructure/migration";
import { Client } from "pg";

const configuredUrl = process.env.DATABASE_URL;
if (configuredUrl === undefined) throw new Error("DATABASE_URL is required.");

const adminUrl = new URL(configuredUrl);
const databaseName = `courseflow_p3_source_${randomUUID().replaceAll("-", "")}`;
const testUrl = new URL(configuredUrl);
testUrl.pathname = `/${databaseName}`;
const admin = new Client({ connectionString: adminUrl.toString() });
const clock = { now: () => new Date("2026-08-13T00:00:00.000Z") };
let courseRepository: ReturnType<typeof createPostgresCourseFlowRepository> | null = null;
let sourceRepository: ReturnType<typeof createPostgresSourceLibraryRepository> | null = null;
let objectStore: ReturnType<typeof createS3SourceObjectStore> | null = null;

async function main(): Promise<void> {
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await migrateDatabase(testUrl.toString());

    courseRepository = createPostgresCourseFlowRepository({
      clock,
      databaseUrl: testUrl.toString(),
      ids: { nextId: randomUUID },
    });
    sourceRepository = createPostgresSourceLibraryRepository(testUrl.toString());
    const owner = await courseRepository.ensureUserProfile({
      authSubject: "p3-source:owner",
      displayName: "Owner",
      locale: "zh-CN",
      timeZone: "Asia/Shanghai",
      userId: asUserId("00000000-0000-4000-9000-000000000031"),
    });
    const stranger = await courseRepository.ensureUserProfile({
      authSubject: "p3-source:stranger",
      displayName: "Stranger",
      locale: "zh-CN",
      timeZone: "Asia/Shanghai",
      userId: asUserId("00000000-0000-4000-9000-000000000032"),
    });
    const academics = createAcademics(courseRepository);
    const planning = createPlanning(courseRepository);
    const term = await academics.createTerm(owner, {
      endDate: "2026-12-18",
      name: "P3 Source Contract",
      readingWeeks: [],
      startDate: "2026-09-08",
      timeZone: "Asia/Shanghai",
    });
    const course = await academics.createCourseWithSchedule(owner, {
      code: "CSC-P3",
      colorKey: "orange",
      creditValue: "0.5",
      meetingPatterns: [],
      termId: term.value.id,
      title: "Source Manual Contract",
    });
    objectStore = createS3SourceObjectStore(
      loadRuntimeConfig("web", {
        ...process.env,
        DATABASE_URL: testUrl.toString(),
        NODE_ENV: "test",
      }),
    );
    const sourceLibrary = createSourceLibrary({
      clock,
      ids: { nextId: randomUUID },
      objectStore,
      repository: sourceRepository,
    });
    const sourcePdf = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
      "latin1",
    );
    const beforePlanning = await planning.getCoursePlanning(owner, course.value.course.id);
    assert.equal(beforePlanning?.items.length, 0);

    const plan = await sourceLibrary.beginUpload(owner, {
      assets: [
        {
          byteSize: sourcePdf.byteLength,
          declaredMimeType: "application/pdf",
          originalFilename: "contract-guide.pdf",
          position: 0,
        },
      ],
      courseId: course.value.course.id,
      displayName: "P3 Contract Guide",
      kind: "syllabus",
    });
    const target = plan.value.targets[0]!;
    const uploaded = await fetch(target.uploadUrl, {
      body: sourcePdf,
      headers: target.headers,
      method: target.method,
    });
    if (!uploaded.ok) {
      throw new Error(
        `P3 source PUT failed with ${uploaded.status}: ${(await uploaded.text()).slice(0, 500)}`,
      );
    }
    const completed = await sourceLibrary.completeUpload(owner, {
      expectedVersion: plan.value.source.version,
      sourceId: plan.value.source.id,
    });
    assert.equal(completed.value.status, "ready");
    assert.equal(completed.value.pageCount, 1);
    assert.equal((await sourceLibrary.listSources(owner)).total, 1);
    assert.equal((await sourceLibrary.listSources(stranger)).total, 0);
    await assert.rejects(
      sourceLibrary.getSourcePreview(stranger, completed.value.id),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "NOT_FOUND",
    );
    const preview = await sourceLibrary.getSourcePreview(owner, completed.value.id);
    const previewResponse = await fetch(preview.url);
    if (!previewResponse.ok) {
      throw new Error(
        `P3 source preview failed with ${previewResponse.status}: ${(await previewResponse.text()).slice(0, 500)}`,
      );
    }
    assert.deepEqual(Buffer.from(await previewResponse.arrayBuffer()), sourcePdf);
    assert.equal(
      (await planning.getCoursePlanning(owner, course.value.course.id))?.items.length,
      0,
    );

    const manualItem = await planning.createCourseItem(owner, {
      courseId: course.value.course.id,
      kind: "assignment",
      temporal: { date: "2026-09-10", kind: "date" },
      title: "Manually confirmed item",
    });
    await sourceLibrary.deleteSource(owner, {
      expectedVersion: completed.value.version,
      sourceId: completed.value.id,
    });
    const cleanup = new Client({ connectionString: testUrl.toString() });
    await cleanup.connect();
    try {
      const cleanupStatus = await cleanup.query<{ cleanup_status: string }>(
        "select cleanup_status from courseflow.source_documents where id=$1",
        [completed.value.id],
      );
      assert.equal(cleanupStatus.rows[0]?.cleanup_status, "complete");
    } finally {
      await cleanup.end();
    }
    assert.equal((await sourceLibrary.listSources(owner)).total, 0);
    await assert.rejects(
      sourceLibrary.getSourcePreview(owner, completed.value.id),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "NOT_FOUND",
    );
    const afterDelete = await planning.getCoursePlanning(owner, course.value.course.id);
    assert.equal(
      afterDelete?.items.some((item) => item.id === manualItem.value.id),
      true,
      "Deleting Source metadata/object must not delete the manually confirmed Course Item.",
    );

    process.stdout.write(
      "P3 Source PostgreSQL/S3 ownership, safe preview, zero-write upload and delete independence passed.\n",
    );
  } finally {
    objectStore?.close();
    await sourceRepository?.close();
    await courseRepository?.close();
    await admin.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  }
}

void main();
