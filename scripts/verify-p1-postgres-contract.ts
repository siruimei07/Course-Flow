import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { asUserId, createAcademics, createPlanning, createSchedule } from "@courseflow/core";
import { createPostgresCourseFlowRepository } from "@courseflow/infrastructure";
import { migrateDatabase } from "@courseflow/infrastructure/migration";
import { Client } from "pg";

const configuredUrl = process.env.DATABASE_URL;
if (configuredUrl === undefined) throw new Error("DATABASE_URL is required.");

const adminUrl = new URL(configuredUrl);
const databaseName = `courseflow_p1_contract_${randomUUID().replaceAll("-", "")}`;
const testUrl = new URL(configuredUrl);
testUrl.pathname = `/${databaseName}`;
const admin = new Client({ connectionString: adminUrl.toString() });
let repository: ReturnType<typeof createPostgresCourseFlowRepository> | null = null;

await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  await migrateDatabase(testUrl.toString());

  const makeRepository = () =>
    createPostgresCourseFlowRepository({
      clock: { now: () => new Date("2026-08-13T00:00:00.000Z") },
      databaseUrl: testUrl.toString(),
      ids: { nextId: randomUUID },
    });
  repository = makeRepository();
  const owner = await repository.ensureUserProfile({
    authSubject: "contract:owner",
    displayName: "Owner",
    locale: "zh-CN",
    timeZone: "America/Toronto",
    userId: asUserId("00000000-0000-4000-9000-000000000011"),
  });
  const stranger = await repository.ensureUserProfile({
    authSubject: "contract:stranger",
    displayName: "Stranger",
    locale: "zh-CN",
    timeZone: "Asia/Shanghai",
    userId: asUserId("00000000-0000-4000-9000-000000000012"),
  });
  const academics = createAcademics(repository);
  const planning = createPlanning(repository);
  const clock = { now: () => new Date("2026-09-09T01:30:00.000Z") };
  const schedule = createSchedule(repository, { clock });

  const term = await academics.createTerm(owner, {
    endDate: "2026-12-18",
    name: "P1 Contract Fall",
    readingWeeks: [{ endDate: "2026-10-16", name: "Reading Week", startDate: "2026-10-12" }],
    startDate: "2026-09-08",
    timeZone: "America/Toronto",
  });
  const course = await academics.createCourseWithSchedule(owner, {
    code: "CSC-P1",
    colorKey: "orange",
    creditValue: "0.5",
    meetingPatterns: [
      {
        kind: "lecture",
        localEndTime: "11:00",
        localStartTime: "10:00",
        locationText: "IB 345",
        weekdays: [0],
      },
      {
        kind: "tutorial",
        localEndTime: "13:00",
        localStartTime: "12:00",
        locationText: "TBA",
        weekdays: [1],
      },
      { kind: "practical", localEndTime: "16:00", localStartTime: "14:00", weekdays: [2] },
    ],
    termId: term.value.id,
    title: "P1 PostgreSQL Contract",
  });
  const label = await planning.saveTaskLabel(owner, {
    colorKey: "purple",
    displayName: "Needs Review",
    termId: term.value.id,
  });
  const item = await planning.createCourseItem(owner, {
    courseId: course.value.course.id,
    estimatedMinutes: 90,
    kind: "assignment",
    labelIds: [label.value.id],
    temporal: { date: "2026-09-30", kind: "date", note: "Pure course date" },
    title: "PostgreSQL-backed assignment",
  });
  await planning.createCourseItem(owner, {
    courseId: course.value.course.id,
    kind: "reading",
    temporal: { kind: "unscheduled", note: "Week 6; TBA" },
    title: "Unscheduled reading",
  });
  await planning.createCourseItem(owner, {
    courseId: course.value.course.id,
    kind: "exam",
    temporal: {
      at: "2026-10-31T23:59:00-04:00",
      kind: "deadline",
      timeZone: "America/Toronto",
    },
    title: "Exact-offset exam deadline",
  });
  await planning.createCourseItem(owner, {
    courseId: course.value.course.id,
    kind: "presentation",
    temporal: {
      endsAt: "2026-11-10T16:00:00-05:00",
      kind: "interval",
      startsAt: "2026-11-10T14:00:00-05:00",
      timeZone: "America/Toronto",
    },
    title: "Presentation interval",
  });
  const scheme = await planning.saveGradingScheme(owner, {
    components: [
      { title: "Midterm", weightBps: 2_000 },
      { title: "Final", weightBps: 8_000 },
    ],
    courseId: course.value.course.id,
    isPrimary: true,
    name: "Default",
  });
  await planning.saveGradeResult(owner, {
    earned: "80",
    gradeComponentId: scheme.value.components[0]!.id,
    possible: "100",
  });

  await assert.rejects(
    academics.updateTerm(owner, {
      expectedVersion: 0,
      name: "Stale overwrite",
      termId: term.value.id,
    }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "VERSION_CONFLICT",
  );
  assert.equal(await academics.getCourse(stranger, course.value.course.id), null);
  assert.equal(await planning.getCoursePlanning(stranger, course.value.course.id), null);
  assert.equal(await planning.getGradebook(stranger, course.value.course.id), null);
  assert.deepEqual(await academics.listTerms(stranger), []);
  assert.equal(await schedule.getScheduleSnapshot(stranger, { termId: term.value.id }), null);

  await repository.close();
  repository = null;
  repository = makeRepository();
  const reconnectedAcademics = createAcademics(repository);
  const reconnectedPlanning = createPlanning(repository);
  const reconnectedSchedule = createSchedule(repository, { clock });
  const reloadedCourse = await reconnectedAcademics.getCourse(owner, course.value.course.id);
  assert.equal(reloadedCourse?.meetingPatterns.length, 3);
  assert.deepEqual(
    reloadedCourse?.meetingPatterns.map((meeting) => meeting.kind).toSorted(),
    ["lecture", "tutorial", "practical"].toSorted(),
  );
  assert.equal(reloadedCourse?.calendarExceptions[0]?.kind, "reading_week");
  const reloadedPlanning = await reconnectedPlanning.getCoursePlanning(
    owner,
    course.value.course.id,
  );
  const reloadedItem = reloadedPlanning?.items.find((candidate) => candidate.id === item.value.id);
  assert.equal(reloadedItem?.id, item.value.id);
  assert.equal(reloadedItem?.labels[0]?.id, label.value.id);
  assert.deepEqual(reloadedPlanning?.items.map((candidate) => candidate.temporal.kind).toSorted(), [
    "date",
    "deadline",
    "interval",
    "unscheduled",
  ]);
  assert.equal(
    reloadedPlanning?.items.find((candidate) => candidate.temporal.kind === "date")?.temporal
      .kind === "date"
      ? reloadedPlanning.items.find((candidate) => candidate.temporal.kind === "date")?.temporal
          .date
      : null,
    "2026-09-30",
  );
  const gradebook = await reconnectedPlanning.getGradebook(owner, course.value.course.id);
  assert.equal(gradebook?.courseId, course.value.course.id);
  assert.equal(gradebook?.earnedCourseBps, 1_600);
  assert.equal(gradebook?.gradedPortionPercentBps, 8_000);
  assert.equal(gradebook?.gradedWeightBps, 2_000);
  assert.equal(gradebook?.ungradedCount, 1);
  assert.equal(gradebook?.unknownWeightResultCount, 0);
  assert.equal(gradebook?.components[0]?.result?.earnedMilli, 80_000n);
  assert.equal(gradebook?.components[0]?.result?.possibleMilli, 100_000n);
  assert.equal(gradebook?.components[1]?.result, null);
  const scheduleSnapshot = await reconnectedSchedule.getScheduleSnapshot(owner, {
    termId: term.value.id,
  });
  assert.equal(scheduleSnapshot?.courses.length, 1);
  assert.equal(scheduleSnapshot?.items.length, 4);
  assert.equal(scheduleSnapshot?.taskBoard.snapshotId, scheduleSnapshot?.snapshotId);
  assert.equal(scheduleSnapshot?.calendar.snapshotId, scheduleSnapshot?.snapshotId);
  assert.equal(scheduleSnapshot?.dashboard.snapshotId, scheduleSnapshot?.snapshotId);
  assert.equal(scheduleSnapshot?.calendar.skipped.total, 1);
  assert.equal(scheduleSnapshot?.timeZone, "America/Toronto");
  await repository.close();
  repository = null;

  process.stdout.write("P1/P2 PostgreSQL ownership, persistence and snapshot contract passed.\n");
} finally {
  await repository?.close();
  await admin.query(
    "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
    [databaseName],
  );
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await admin.end();
}
