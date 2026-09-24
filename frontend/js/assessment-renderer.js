// Facade composing the assessment modules into the `GapMapAssessment` /
// `GapMapArtifacts` surfaces the pages call. Domain logic (scoring, validation)
// comes from core/; browser I/O (load) and feedback come from sibling modules.
import { load, validateAssessment } from './assessment-loader.js';
import { score, statusFor } from '../../core/scoring.js';
import { explanationForAnswer } from './assessment-feedback.js';

export const GapMapAssessment = {
  load,
  validate: validateAssessment,
  score,
  statusFor,
  explanationForAnswer,
};

export const GapMapArtifacts = {
  loadAssessment: load,
  scoreAssessment: score,
  explanationForAnswer,
  statusFor,
};