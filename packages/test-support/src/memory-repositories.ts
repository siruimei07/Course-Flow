import {
  buildCourseItem,
  buildCourseSetup,
  buildGradeResult,
  buildGradingScheme,
  buildLetterGradeScale,
  buildMeetingException,
  buildTaskLabel,
  buildTerm,
  buildTermArchived,
  buildUpdatedTerm,
  notFound,
  projectGradebook,
  validationError,
  versionConflict,
  type AcademicCalendarException,
  type AcademicTerm,
  type AcademicsRepository,
  type Clock,
  type CommandResult,
  type CourseDetail,
  type CourseId,
  type CourseItem,
  type CoursePlanningDetail,
  type CourseSetupView,
  type CreateCourseItem,
  type CreateCourseWithSchedule,
  type CreateTerm,
  type GradeComponentId,
  type GradeResult,
  type GradebookSnapshot,
  type GradingScheme,
  type IdGenerator,
  type LetterGradeScale,
  type LetterGradeScaleId,
  type MeetingException,
  type PlanningRepository,
  type SaveGradeResult,
  type SaveGradingScheme,
  type SaveLetterGradeScale,
  type SaveMeetingException,
  type SaveTaskLabel,
  type SetCourseArchived,
  type SetCourseLetterGradeScale,
  type SetTermArchived,
  type TaskLabel,
  type TaskLabelId,
  type TermId,
  type TermSummary,
  type TermDetail,
  type UpdateCourseItem,
  type UpdateTerm,
  type UserId,
  type UserScope,
} from "@courseflow/core";

type UserState = {
  activeTermId: TermId | null;
  courses: Map<CourseId, CourseSetupView>;
  gradeScales: Map<LetterGradeScaleId, LetterGradeScale>;
  gradingSchemes: Map<GradingScheme["id"], GradingScheme>;
  items: Map<CourseId, Map<CourseItem["id"], CourseItem>>;
  labels: Map<TermId, Map<TaskLabelId, TaskLabel>>;
  terms: Map<TermId, Readonly<{ exceptions: AcademicCalendarException[]; term: AcademicTerm }>>;
};

function newUserState(): UserState {
  return {
    activeTermId: null,
    courses: new Map(),
    gradeScales: new Map(),
    gradingSchemes: new Map(),
    items: new Map(),
    labels: new Map(),
    terms: new Map(),
  };
}

function cloneCourseItem(item: CourseItem): CourseItem {
  return { ...item, labels: [...item.labels] };
}

export class MemoryCourseFlowRepository implements AcademicsRepository, PlanningRepository {
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #users = new Map<UserId, UserState>();

  constructor(input: Readonly<{ clock: Clock; ids: IdGenerator }>) {
    this.#clock = input.clock;
    this.#ids = input.ids;
  }

  #state(scope: UserScope): UserState {
    let state = this.#users.get(scope.userId);
    if (state === undefined) {
      state = newUserState();
      this.#users.set(scope.userId, state);
    }
    return state;
  }

  async createTerm(scope: UserScope, input: CreateTerm): Promise<CommandResult<AcademicTerm>> {
    const state = this.#state(scope);
    const built = buildTerm(input, this.#ids);
    state.terms.set(built.term.id, {
      exceptions: [...built.exceptions],
      term: built.term,
    });
    state.activeTermId ??= built.term.id;
    return { value: built.term, warnings: [] };
  }

  async updateTerm(scope: UserScope, input: UpdateTerm): Promise<CommandResult<AcademicTerm>> {
    const state = this.#state(scope);
    const current = state.terms.get(input.termId);
    if (current === undefined) throw notFound();
    const updated = buildUpdatedTerm(current.term, input);
    state.terms.set(updated.id, { exceptions: current.exceptions, term: updated });
    return { value: updated, warnings: [] };
  }

  async listTerms(scope: UserScope): Promise<readonly TermSummary[]> {
    const state = this.#state(scope);
    return [...state.terms.values()].map(({ term }) => ({
      ...term,
      courseCount: [...state.courses.values()].filter((course) => course.course.termId === term.id)
        .length,
      isActive: state.activeTermId === term.id,
    }));
  }

  async getTerm(scope: UserScope, termId: TermId): Promise<TermDetail | null> {
    const found = this.#state(scope).terms.get(termId);
    return found === undefined
      ? null
      : { calendarExceptions: [...found.exceptions], term: found.term };
  }

  async setActiveTerm(scope: UserScope, termId: TermId): Promise<void> {
    const state = this.#state(scope);
    const found = state.terms.get(termId);
    if (found === undefined || found.term.archivedAt !== null) throw notFound();
    state.activeTermId = termId;
  }

  async setTermArchived(
    scope: UserScope,
    input: SetTermArchived,
  ): Promise<CommandResult<AcademicTerm>> {
    const state = this.#state(scope);
    const current = state.terms.get(input.termId);
    if (current === undefined) throw notFound();
    const value = buildTermArchived(current.term, input, this.#clock.now());
    state.terms.set(value.id, { exceptions: current.exceptions, term: value });
    if (input.archived && state.activeTermId === value.id) state.activeTermId = null;
    return { value, warnings: [] };
  }

  async createCourseWithSchedule(
    scope: UserScope,
    input: CreateCourseWithSchedule,
  ): Promise<CommandResult<CourseSetupView>> {
    const state = this.#state(scope);
    const term = state.terms.get(input.termId);
    if (term === undefined) throw notFound();
    if (
      input.letterGradeScaleId !== undefined &&
      input.letterGradeScaleId !== null &&
      !state.gradeScales.has(input.letterGradeScaleId)
    ) {
      throw notFound();
    }
    const result = buildCourseSetup(term.term, term.exceptions, input, this.#ids);
    state.courses.set(result.value.course.id, result.value);
    return result;
  }

  async listCourses(scope: UserScope, termId?: TermId): Promise<readonly CourseSetupView[]> {
    return [...this.#state(scope).courses.values()].filter(
      (setup) => termId === undefined || setup.course.termId === termId,
    );
  }

  async getCourse(scope: UserScope, courseId: CourseId): Promise<CourseDetail | null> {
    return this.#state(scope).courses.get(courseId) ?? null;
  }

  async setCourseArchived(
    scope: UserScope,
    input: SetCourseArchived,
  ): Promise<CommandResult<CourseSetupView>> {
    const state = this.#state(scope);
    const setup = state.courses.get(input.courseId);
    if (setup === undefined) throw notFound();
    if (setup.course.version !== input.expectedVersion) throw versionConflict(setup.course.version);
    const value: CourseSetupView = {
      ...setup,
      course: {
        ...setup.course,
        archivedAt: input.archived ? this.#clock.now().toISOString() : null,
        version: setup.course.version + 1,
      },
    };
    state.courses.set(input.courseId, value);
    return { value, warnings: [] };
  }

  async setCourseLetterGradeScale(
    scope: UserScope,
    input: SetCourseLetterGradeScale,
  ): Promise<CommandResult<CourseSetupView>> {
    const state = this.#state(scope);
    const setup = state.courses.get(input.courseId);
    if (setup === undefined) throw notFound();
    if (setup.course.version !== input.expectedVersion) throw versionConflict(setup.course.version);
    if (input.letterGradeScaleId !== null && !state.gradeScales.has(input.letterGradeScaleId))
      throw notFound();
    const value: CourseSetupView = {
      ...setup,
      course: {
        ...setup.course,
        letterGradeScaleId: input.letterGradeScaleId,
        version: setup.course.version + 1,
      },
    };
    state.courses.set(input.courseId, value);
    return { value, warnings: [] };
  }

  async saveMeetingException(
    scope: UserScope,
    input: SaveMeetingException,
  ): Promise<CommandResult<MeetingException>> {
    const state = this.#state(scope);
    const setup = [...state.courses.values()].find((candidate) =>
      candidate.meetingPatterns.some((pattern) => pattern.id === input.meetingPatternId),
    );
    if (setup === undefined) throw notFound();
    const pattern = setup.meetingPatterns.find(
      (candidate) => candidate.id === input.meetingPatternId,
    )!;
    const existing = setup.meetingExceptions?.find(
      (candidate) =>
        candidate.meetingPatternId === input.meetingPatternId &&
        candidate.occurrenceDate === input.occurrenceDate,
    );
    const value = buildMeetingException(setup, pattern, input, this.#ids, existing);
    const exceptions = (setup.meetingExceptions ?? []).filter(
      (candidate) =>
        !(
          candidate.meetingPatternId === value.meetingPatternId &&
          candidate.occurrenceDate === value.occurrenceDate
        ),
    );
    state.courses.set(setup.course.id, { ...setup, meetingExceptions: [...exceptions, value] });
    return { value, warnings: [] };
  }

  async saveTaskLabel(scope: UserScope, input: SaveTaskLabel): Promise<CommandResult<TaskLabel>> {
    const state = this.#state(scope);
    if (!state.terms.has(input.termId)) throw notFound();
    const termLabels = state.labels.get(input.termId) ?? new Map<TaskLabelId, TaskLabel>();
    const value = buildTaskLabel(input, this.#ids);
    const duplicate = [...termLabels.values()].find(
      (label) => label.normalizedName === value.normalizedName && label.id !== value.id,
    );
    if (duplicate !== undefined) {
      throw validationError("该学期已有同名标签。", [
        { code: "DUPLICATE_LABEL", message: "请使用现有标签或更换名称。", path: "/displayName" },
      ]);
    }
    termLabels.set(value.id, value);
    state.labels.set(input.termId, termLabels);
    return { value, warnings: [] };
  }

  async createCourseItem(
    scope: UserScope,
    input: CreateCourseItem,
  ): Promise<CommandResult<CourseItem>> {
    const state = this.#state(scope);
    const course = state.courses.get(input.courseId);
    if (course === undefined) throw notFound();
    const termLabels = state.labels.get(course.course.termId) ?? new Map();
    const labels = (input.labelIds ?? []).map((labelId) => {
      const label = termLabels.get(labelId);
      if (label === undefined) throw notFound();
      return label;
    });
    const value = buildCourseItem(input, this.#ids, labels);
    const items = state.items.get(input.courseId) ?? new Map();
    items.set(value.id, value);
    state.items.set(input.courseId, items);
    return { value, warnings: [] };
  }

  async updateCourseItem(
    scope: UserScope,
    input: UpdateCourseItem,
  ): Promise<CommandResult<CourseItem>> {
    const state = this.#state(scope);
    const entry = [...state.items.entries()].find(([, items]) => items.has(input.itemId));
    const current = entry?.[1].get(input.itemId);
    if (entry === undefined || current === undefined) throw notFound();
    if (current.version !== input.expectedVersion) throw versionConflict(current.version);
    const value = buildCourseItem(
      {
        courseId: current.courseId,
        details: input.details ?? current.details,
        estimatedMinutes: input.estimatedMinutes ?? current.estimatedMinutes,
        kind: input.kind ?? current.kind,
        progressBps: input.progressBps ?? current.progressBps,
        temporal: input.temporal ?? current.temporal,
        title: input.title ?? current.title,
      },
      { nextId: () => current.id },
      current.labels,
    );
    const updated = { ...value, state: current.state, version: current.version + 1 };
    entry[1].set(updated.id, updated);
    return { value: updated, warnings: [] };
  }

  async setCourseItemState(
    scope: UserScope,
    input: Readonly<{
      expectedVersion: number;
      itemId: CourseItem["id"];
      state: CourseItem["state"];
    }>,
  ): Promise<CommandResult<CourseItem>> {
    const state = this.#state(scope);
    const items = [...state.items.values()].find((candidate) => candidate.has(input.itemId));
    const current = items?.get(input.itemId);
    if (items === undefined || current === undefined) throw notFound();
    if (current.version !== input.expectedVersion) throw versionConflict(current.version);
    const value = { ...current, state: input.state, version: current.version + 1 };
    items.set(value.id, value);
    return { value, warnings: [] };
  }

  async setCourseItemLabels(
    scope: UserScope,
    input: Readonly<{
      expectedVersion: number;
      itemId: CourseItem["id"];
      labelIds: readonly TaskLabelId[];
    }>,
  ): Promise<CommandResult<CourseItem>> {
    const state = this.#state(scope);
    const items = [...state.items.values()].find((candidate) => candidate.has(input.itemId));
    const current = items?.get(input.itemId);
    if (items === undefined || current === undefined) throw notFound();
    if (current.version !== input.expectedVersion) throw versionConflict(current.version);
    const setup = state.courses.get(current.courseId)!;
    const labelsById = state.labels.get(setup.course.termId) ?? new Map();
    const labels = input.labelIds.map((id) => {
      const label = labelsById.get(id);
      if (label === undefined) throw notFound();
      return label;
    });
    const value = { ...current, labels, version: current.version + 1 };
    items.set(value.id, value);
    return { value, warnings: [] };
  }

  async deleteCourseItem(
    scope: UserScope,
    input: Readonly<{ expectedVersion: number; itemId: CourseItem["id"] }>,
  ): Promise<void> {
    const state = this.#state(scope);
    const items = [...state.items.values()].find((candidate) => candidate.has(input.itemId));
    const current = items?.get(input.itemId);
    if (items === undefined || current === undefined) throw notFound();
    if (current.version !== input.expectedVersion) throw versionConflict(current.version);
    items.delete(input.itemId);
  }

  async getCoursePlanning(
    scope: UserScope,
    courseId: CourseId,
  ): Promise<CoursePlanningDetail | null> {
    const state = this.#state(scope);
    const course = state.courses.get(courseId);
    if (course === undefined) return null;
    return {
      courseId,
      items: [...(state.items.get(courseId)?.values() ?? [])].map(cloneCourseItem),
      labels: [...(state.labels.get(course.course.termId)?.values() ?? [])],
    };
  }

  async saveGradingScheme(
    scope: UserScope,
    input: SaveGradingScheme,
  ): Promise<CommandResult<GradingScheme>> {
    const state = this.#state(scope);
    if (!state.courses.has(input.courseId)) throw notFound();
    const existing =
      input.schemeId === undefined ? undefined : state.gradingSchemes.get(input.schemeId);
    if (
      input.schemeId !== undefined &&
      (existing === undefined || existing.courseId !== input.courseId)
    ) {
      throw notFound();
    }
    if (existing !== undefined && input.expectedVersion !== existing.version) {
      throw versionConflict(existing.version);
    }
    const existingIds = new Set(existing?.components.map((component) => component.id) ?? []);
    if (
      input.components.some(
        (component) => component.id !== undefined && !existingIds.has(component.id),
      )
    ) {
      throw notFound();
    }
    const results = new Map(
      existing?.components.flatMap((component) =>
        component.result === null ? [] : [[component.id, component.result] as const],
      ) ?? [],
    );
    const result = buildGradingScheme(input, this.#ids, results);
    if (result.value.isPrimary) {
      for (const [id, scheme] of state.gradingSchemes) {
        if (scheme.courseId === input.courseId && id !== result.value.id && scheme.isPrimary) {
          state.gradingSchemes.set(id, {
            ...scheme,
            isPrimary: false,
            version: scheme.version + 1,
          });
        }
      }
    }
    state.gradingSchemes.set(result.value.id, result.value);
    return result;
  }

  async saveGradeResult(
    scope: UserScope,
    input: SaveGradeResult,
  ): Promise<CommandResult<GradeResult>> {
    const state = this.#state(scope);
    const entry = [...state.gradingSchemes.entries()].find(([, scheme]) =>
      scheme.components.some((component) => component.id === input.gradeComponentId),
    );
    const component = entry?.[1].components.find(
      (candidate) => candidate.id === input.gradeComponentId,
    );
    if (entry === undefined || component === undefined) throw notFound();
    if (component.result !== null && input.expectedVersion !== component.result.version) {
      throw versionConflict(component.result.version);
    }
    const result = buildGradeResult(input, this.#ids, component.result?.id);
    const updatedComponents = entry[1].components.map((candidate) =>
      candidate.id === component.id ? { ...candidate, result: result.value } : candidate,
    );
    state.gradingSchemes.set(entry[0], { ...entry[1], components: updatedComponents });
    return result;
  }

  async deleteGradeResult(
    scope: UserScope,
    input: Readonly<{ expectedVersion: number; gradeComponentId: GradeComponentId }>,
  ): Promise<void> {
    const state = this.#state(scope);
    const entry = [...state.gradingSchemes.entries()].find(([, scheme]) =>
      scheme.components.some((component) => component.id === input.gradeComponentId),
    );
    const result = entry?.[1].components.find(
      (candidate) => candidate.id === input.gradeComponentId,
    )?.result;
    if (entry === undefined || result === undefined || result === null) throw notFound();
    if (result.version !== input.expectedVersion) throw versionConflict(result.version);
    state.gradingSchemes.set(entry[0], {
      ...entry[1],
      components: entry[1].components.map((component) =>
        component.id === input.gradeComponentId ? { ...component, result: null } : component,
      ),
    });
  }

  async saveLetterGradeScale(
    scope: UserScope,
    input: SaveLetterGradeScale,
  ): Promise<CommandResult<LetterGradeScale>> {
    const state = this.#state(scope);
    const existing = input.scaleId === undefined ? undefined : state.gradeScales.get(input.scaleId);
    if (input.scaleId !== undefined && existing === undefined) throw notFound();
    if (existing !== undefined && input.expectedVersion !== existing.version) {
      throw versionConflict(existing.version);
    }
    const value = buildLetterGradeScale(input, this.#ids);
    state.gradeScales.set(value.id, value);
    return { value, warnings: [] };
  }

  async getLetterGradeScale(
    scope: UserScope,
    scaleId: LetterGradeScaleId,
  ): Promise<LetterGradeScale | null> {
    return this.#state(scope).gradeScales.get(scaleId) ?? null;
  }

  async listLetterGradeScales(scope: UserScope): Promise<readonly LetterGradeScale[]> {
    return [...this.#state(scope).gradeScales.values()];
  }

  async listGradingSchemes(
    scope: UserScope,
    courseId: CourseId,
  ): Promise<readonly GradingScheme[]> {
    if (!this.#state(scope).courses.has(courseId)) return [];
    return [...this.#state(scope).gradingSchemes.values()].filter(
      (scheme) => scheme.courseId === courseId,
    );
  }

  async getGradebook(
    scope: UserScope,
    courseId: CourseId,
    schemeId?: GradingScheme["id"],
  ): Promise<GradebookSnapshot | null> {
    const state = this.#state(scope);
    const course = state.courses.get(courseId);
    if (course === undefined) return null;
    const scheme =
      schemeId === undefined
        ? ([...state.gradingSchemes.values()].find(
            (candidate) => candidate.courseId === courseId && candidate.isPrimary,
          ) ?? null)
        : (state.gradingSchemes.get(schemeId) ?? null);
    if (schemeId !== undefined && scheme === null) return null;
    if (scheme !== null && scheme.courseId !== courseId) return null;
    const scale =
      course.course.letterGradeScaleId === null
        ? null
        : (state.gradeScales.get(course.course.letterGradeScaleId) ?? null);
    return projectGradebook(courseId, scheme, scale);
  }
}
