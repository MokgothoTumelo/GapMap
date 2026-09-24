// Browser-side assessment loader: fetches a YAML assessment and validates it.
// The validation logic lives in core/validate.js (runtime-agnostic); this
// module owns the browser I/O (fetch + js-yaml). js-yaml is loaded as a global
// by the page (CDN classic script) before this deferred module runs.
import { validateAssessment } from '../../core/validate.js';

export { validateAssessment };

export async function load(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error('Fetch failed for ' + url + ' — serve the site over http, not file://');
  }
  if (!response.ok) throw new Error('Could not load assessment: ' + response.status + ' ' + response.statusText);
  if (typeof globalThis.jsyaml === 'undefined') throw new Error('js-yaml is not loaded');
  return validateAssessment(globalThis.jsyaml.load(await response.text()));
}