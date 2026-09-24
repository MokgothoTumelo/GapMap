import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { createSubjectStore } from '../frontend/js/subject-store.js';
import { conceptGraphUrl } from '../frontend/js/subject-store.js';

// The subject store (ADR-0006): subject-level data is knowledge the Subject
// holds for *all* Learners — one YAML file per Subject, fetched, validated,
// and cached per Subject here. When the database lands, this seam is the
// swap point, not the pages.

const readYaml = (rel) =>
  yaml.load(readFileSync(join(process.cwd(), rel), 'utf8'), { schema: yaml.JSON_SCHEMA });

function storeOverFiles({ existing = {} } = {}) {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url in existing && existing[url] === null) {
      return { status: 404, ok: false, text: async () => '' };
    }
    const body = existing[url];
    if (body === undefined) return { status: 404, ok: false, text: async () => '' };
    return { status: 200, ok: true, text: async () => body };
  };
  const parseYaml = (text) => yaml.load(text, { schema: yaml.JSON_SCHEMA });
  return { store: createSubjectStore({ fetch: fetchImpl, parseYaml }), requests };
}

test.describe('subject store (ADR-0006)', () => {
  test('the slug policy matches the data directory and the assessment files', () => {
    expect(conceptGraphUrl({ grade: '12', subject: 'Mathematics' })).toBe(
      '/data/subjects/graph-g12-mathematics.yaml',
    );
    expect(conceptGraphUrl({ grade: 10, subject: 'Physical Sciences' })).toBe(
      '/data/subjects/graph-g10-physical-sciences.yaml',
    );
    expect(conceptGraphUrl({ grade: '11', subject: 'English Home Language' })).toBe(
      '/data/subjects/graph-g11-english-home-language.yaml',
    );
    expect(conceptGraphUrl({ grade: '12', subject: '' })).toBeNull();
    expect(conceptGraphUrl({})).toBeNull();
  });

  test('serves, validates, and caches a Subject graph', async () => {
    const graphYaml = readFileSync('data/subjects/graph-g12-mathematics.yaml', 'utf8');
    const { store, requests } = storeOverFiles({ existing: { '/data/subjects/graph-g12-mathematics.yaml': graphYaml } });

    const graph = await store.getConceptGraph({ grade: '12', subject: 'Mathematics' });
    expect(graph.id).toBe('graph-g12-mathematics');
    expect(graph.nodes.length).toBeGreaterThan(0);

    // Cached per Subject: a second Learner (or page) reuses the fetch.
    const again = await store.getConceptGraph({ grade: '12', subject: 'Mathematics' });
    expect(again).toBe(graph);
    expect(requests).toHaveLength(1);
  });

  test('a Subject without a graph resolves null — no fabricated chain', async () => {
    const { store } = storeOverFiles();
    expect(await store.getConceptGraph({ grade: '12', subject: 'Unknown Subject' })).toBeNull();
  });

  test('a malformed graph surfaces as a rejection, never as null', async () => {
    const cyclic = readYaml('data/subjects/graph-g12-mathematics.yaml');
    cyclic.edges.push({ requires: 'Quadratic Equations', for: 'Factorisation' });
    const { store } = storeOverFiles({
      existing: { '/data/subjects/graph-g12-mathematics.yaml': yaml.dump(cyclic) },
    });

    await expect(store.getConceptGraph({ grade: '12', subject: 'Mathematics' })).rejects.toThrow(
      /cycle/,
    );
  });
});