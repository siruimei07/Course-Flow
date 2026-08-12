import type { PlanningRepository } from "./repository";

export type PlanningCommands = Pick<
  PlanningRepository,
  | "createCourseItem"
  | "deleteCourseItem"
  | "deleteGradeResult"
  | "saveGradeResult"
  | "saveGradingScheme"
  | "saveLetterGradeScale"
  | "saveTaskLabel"
  | "setCourseItemLabels"
  | "setCourseItemState"
  | "updateCourseItem"
>;

export type PlanningQueries = Pick<
  PlanningRepository,
  | "getCoursePlanning"
  | "getGradebook"
  | "getLetterGradeScale"
  | "listGradingSchemes"
  | "listLetterGradeScales"
>;

export type Planning = PlanningCommands & PlanningQueries;

export function createPlanning(repository: PlanningRepository): Planning {
  return repository;
}
