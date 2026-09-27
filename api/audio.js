// Vercel Function: GET /api/audio?v=<youtubeId>
// Extracts audio from a YouTube video (via yt-dlp) and streams it as audio/mpeg.
// Caches files under /tmp/gapmap-audio so repeat plays are instant.
//
// Security: only allow known youtube video IDs (11-char [A-Za-z0-9_-]).
// The browser never navigates to YouTube — learners stay on GapMap.

import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const CACHE_DIR = join('/tmp', 'gapmap-audio');
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// Prefer system yt-dlp; fall back to a path some hosts use.
const YT_DLP_CANDIDATES = ['yt-dlp', '/usr/local/bin/yt-dlp', '/tmp/yt-dlp'];

function findYtDlp() {
  for (const bin of YT_DLP_CANDIDATES) {
    try {
      // eslint-disable-next-line no-sync
      if (bin.includes('/') && !existsSync(bin)) continue;
      return bin;
    } catch {
      /* continue */
    }
  }
  return 'yt-dlp';
}

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cachePath(videoId) {
  return join(CACHE_DIR, `${videoId}.m4a`);
}

function extractAudio(videoId) {
  ensureCacheDir();
  const outTemplate = join(CACHE_DIR, `${videoId}.%(ext)s`);
  const bin = findYtDlp();
  const args = [
    '-f', 'bestaudio[ext=m4a]/bestaudio/best',
    '-x',
    '--audio-format', 'm4a',
    '--audio-quality', '5',
    '-o', outTemplate,
    '--no-playlist',
    '--no-warnings',
    '--quiet',
    `https://www.youtube.com/watch?v=${videoId}`,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      reject(new Error(`yt-dlp failed to start (${bin}): ${err.message}`));
    });
    child.on('close', (code) => {
      const target = cachePath(videoId);
      // yt-dlp may write .m4a or another audio ext after -x
      if (existsSync(target)) {
        resolve(target);
        return;
      }
      // Check common alternate extensions
      for (const ext of ['webm', 'mp3', 'opus', 'ogg']) {
        const alt = join(CACHE_DIR, `${videoId}.${ext}`);
        if (existsSync(alt)) {
          resolve(alt);
          return;
        }
      }
      reject(new Error(`yt-dlp exit ${code}: ${stderr.slice(0, 400) || 'no audio file produced'}`));
    });
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const videoId = String(req.query?.v || req.query?.id || '').trim();
  if (!YT_ID_RE.test(videoId)) {
    res.status(400).json({ error: 'Invalid or missing YouTube video id (v=)' });
    return;
  }

  try {
    ensureCacheDir();
    let file = cachePath(videoId);
    if (!existsSync(file)) {
      // Also accept other cached extensions from a previous run
      let found = null;
      for (const ext of ['m4a', 'webm', 'mp3', 'opus', 'ogg']) {
        const alt = join(CACHE_DIR, `${videoId}.${ext}`);
        if (existsSync(alt)) {
          found = alt;
          break;
        }
      }
      if (found) {
        file = found;
      } else {
        file = await extractAudio(videoId);
      }
    }

    const stat = statSync(file);
    const ext = file.split('.').pop().toLowerCase();
    const mime =
      ext === 'mp3' ? 'audio/mpeg' :
      ext === 'webm' || ext === 'opus' ? 'audio/webm' :
      ext === 'ogg' ? 'audio/ogg' :
      'audio/mp4'; // m4a

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200);

    await pipeline(createReadStream(file), res);
  } catch (err) {
    console.error('[api/audio]', videoId, err);
    if (!res.headersSent) {
      res.status(502).json({
        error: 'Could not extract audio for this video',
        detail: String(err && err.message ? err.message : err).slice(0, 300),
      });
    }
  }
}
