import type { CommandResult, CourseId, TermId, UserScope } from "../shared";
import type {
  AcademicTerm,
  CourseDetail,
  CourseSetupView,
  CreateCourseWithSchedule,
  CreateTerm,
  MeetingException,
  SaveMeetingException,
  SetCourseArchived,
  SetCourseLetterGradeScale,
  SetTermArchived,
  TermSummary,
  TermDetail,
  UpdateTerm,
} from "./types";

export interface AcademicsRepository {
  createCourseWithSchedule(
    scope: UserScope,
    input: CreateCourseWithSchedule,
  ): Promise<CommandResult<CourseSetupView>>;
  createTerm(scope: UserScope, input: CreateTerm): Promise<CommandResult<AcademicTerm>>;
  getCourse(scope: UserScope, courseId: CourseId): Promise<CourseDetail | null>;
  getTerm(scope: UserScope, termId: TermId): Promise<TermDetail | null>;
  listCourses(scope: UserScope, termId?: TermId): Promise<readonly CourseSetupView[]>;
  listTerms(scope: UserScope): Promise<readonly TermSummary[]>;
  saveMeetingException(
    scope: UserScope,
    input: SaveMeetingException,
  ): Promise<CommandResult<MeetingException>>;
  setActiveTerm(scope: UserScope, termId: TermId): Promise<void>;
  setTermArchived(scope: UserScope, input: SetTermArchived): Promise<CommandResult<AcademicTerm>>;
  setCourseArchived(
    scope: UserScope,
    input: SetCourseArchived,
  ): Promise<CommandResult<CourseSetupView>>;
  setCourseLetterGradeScale(
    scope: UserScope,
    input: SetCourseLetterGradeScale,
  ): Promise<CommandResult<CourseSetupView>>;
  updateTerm(scope: UserScope, input: UpdateTerm): Promise<CommandResult<AcademicTerm>>;
}
