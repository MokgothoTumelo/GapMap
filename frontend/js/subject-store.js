// The Subject store (ADR-0006): subject-level data is knowledge the Subject
// holds for *all* Learners — it is never per-Learner state. This seam is the
// middle ground between embedding subject data in Learner records (or page
// markup) and a full database: one YAML file per Subject under
// `data/subjects/`, fetched, schema-validated semantically (core/validate.js),
// and cached per Subject here. When the database lands this is a
// serialisation change, not a model change — the same seam, backed by a row.
//
// Pure I/O lives here; validation logic lives in core/. js-yaml is loaded as
// a global by the page (the vendored copy); Node callers inject `parseYaml`.
import { validateConceptGraph } from '../../core/validate.js';

export { validateConceptGraph };

// "Grade 12 Mathematics" → /data/subjects/graph-g12-mathematics.yaml — the
// same g<grade> + hyphenated-subject slug policy as the assessment files.
export function conceptGraphUrl({ grade, subject } = {}) {
  if (!grade || !subject) return null;
  const gradePart = String(grade).replace(/\D/g, '');
  const subjectPart = String(subject)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-');
  if (!gradePart || !subjectPart) return null;
  return `/data/subjects/graph-g${gradePart}-${subjectPart}.yaml`;
}

function defaultParseYaml(text) {
  if (typeof globalThis.jsyaml === 'undefined') {
    throw new Error('js-yaml is not loaded');
  }
  return globalThis.jsyaml.load(text);
}

/**
 * The Subject-level store. Cached per Subject key, shared across Learners —
 * the cache is safe because a Concept Graph is frozen per Subject.
 *
 * A Subject without a graph is normal for data that hasn't been ported yet —
 * `getConceptGraph` resolves null and callers keep their non-graph behavior;
 * a graph that fails validation surfaces as a rejection (the Companion shows
 * the tool failure rather than masking it).
 */
export function createSubjectStore({ fetch = globalThis.fetch, parseYaml = defaultParseYaml } = {}) {
  if (!fetch) throw new Error('A fetch implementation is required');
  if (typeof parseYaml !== 'function') throw new Error('A parseYaml function is required');

  const graphCache = new Map();

  async function getConceptGraph({ grade, subject } = {}) {
    const url = conceptGraphUrl({ grade, subject });
    if (!url) return null;
    if (graphCache.has(url)) return graphCache.get(url);

    const graph = (async () => {
      let response;
      try {
        response = await fetch(url);
      } catch (error) {
        throw new Error('Fetch failed for ' + url + ' — serve the site over http, not file://');
      }
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(
          'Could not load the Concept Graph: ' + response.status + ' ' + response.statusText,
        );
      }
      return validateConceptGraph(parseYaml(await response.text()));
    })();

    graphCache.set(url, graph);
    return graph;
  }

  return {
    getConceptGraph,
    clearCache() {
      graphCache.clear();
    },
  };
}