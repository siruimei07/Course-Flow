import type {
  CommandResult,
  CourseId,
  CourseItemId,
  GradeComponentId,
  GradingSchemeId,
  LetterGradeScaleId,
  UserScope,
} from "../shared";
import type {
  CourseItem,
  CoursePlanningDetail,
  CreateCourseItem,
  GradeResult,
  GradebookSnapshot,
  GradingScheme,
  LetterGradeScale,
  SaveGradeResult,
  SaveGradingScheme,
  SaveLetterGradeScale,
  SaveTaskLabel,
  TaskLabel,
  UpdateCourseItem,
} from "./types";

export interface PlanningRepository {
  createCourseItem(scope: UserScope, input: CreateCourseItem): Promise<CommandResult<CourseItem>>;
  getCoursePlanning(scope: UserScope, courseId: CourseId): Promise<CoursePlanningDetail | null>;
  getGradebook(
    scope: UserScope,
    courseId: CourseId,
    schemeId?: GradingSchemeId,
  ): Promise<GradebookSnapshot | null>;
  listGradingSchemes(scope: UserScope, courseId: CourseId): Promise<readonly GradingScheme[]>;
  listLetterGradeScales(scope: UserScope): Promise<readonly LetterGradeScale[]>;
  saveGradeResult(scope: UserScope, input: SaveGradeResult): Promise<CommandResult<GradeResult>>;
  saveGradingScheme(
    scope: UserScope,
    input: SaveGradingScheme,
  ): Promise<CommandResult<GradingScheme>>;
  saveLetterGradeScale(
    scope: UserScope,
    input: SaveLetterGradeScale,
  ): Promise<CommandResult<LetterGradeScale>>;
  saveTaskLabel(scope: UserScope, input: SaveTaskLabel): Promise<CommandResult<TaskLabel>>;
  setCourseItemLabels(
    scope: UserScope,
    input: Readonly<{
      expectedVersion: number;
      itemId: CourseItemId;
      labelIds: readonly TaskLabel["id"][];
    }>,
  ): Promise<CommandResult<CourseItem>>;
  setCourseItemState(
    scope: UserScope,
    input: Readonly<{
      expectedVersion: number;
      itemId: CourseItemId;
      state: CourseItem["state"];
    }>,
  ): Promise<CommandResult<CourseItem>>;
  updateCourseItem(scope: UserScope, input: UpdateCourseItem): Promise<CommandResult<CourseItem>>;
  deleteCourseItem(
    scope: UserScope,
    input: Readonly<{ expectedVersion: number; itemId: CourseItemId }>,
  ): Promise<void>;
  deleteGradeResult(
    scope: UserScope,
    input: Readonly<{ expectedVersion: number; gradeComponentId: GradeComponentId }>,
  ): Promise<void>;
  getLetterGradeScale(
    scope: UserScope,
    scaleId: LetterGradeScaleId,
  ): Promise<LetterGradeScale | null>;
}
