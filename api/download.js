// Vercel Function: GET /api/download?id=...
// Proxies official past papers so learners stay on GapMap.
//
// This keeps the classic Node.js (req, res) handler signature — that's the
// signature Vercel was actually invoking this function with (switching to the
// Web Handler `request -> Response` style caused `new URL(request.url)` to
// throw, since req.url on the Node signature is just a path, not a full URL —
// that's what caused the 500 FUNCTION_INVOCATION_FAILED you just saw).
//
// The real fix is to STREAM the upstream PDF straight into `res` via Node
// streams instead of buffering it with `await upstream.arrayBuffer()` then
// `res.send(buffer)`. Vercel Functions hard-cap buffered responses at 4.5MB —
// several of the Siyavula textbooks and Mind the Gap guides are bigger than
// that, which is why View/Download looked broken for a chunk of the library.

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const DOWNLOAD_WHITELIST = {
  '1': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=CsNcmi8-trM%3D&tabid=4933&portalid=0&mid=13146', filename: 'Mathematics-P1-Nov-2024.pdf' },
  '2': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=8W2dAxBUTQA%3d&tabid=5193&portalid=0&mid=13724', filename: 'Mathematics-P2-Nov-2024.pdf' },
  '3': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=Yak0VdHytZc%3D&tabid=4504&portalid=0&mid=12321', filename: 'Physical-Sciences-P1-Nov-2023.pdf' },
  '4': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=3s86L5Ok4Ds%3D&tabid=4504&portalid=0&mid=12321', filename: 'Physical-Sciences-P2-Nov-2023.pdf' },
  '20': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=1KiiLnULnVY%3d&tabid=1869&portalid=0&mid=8659', filename: 'Mathematics-P1-Grade11-Nov-2018.pdf' },
  '21': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=4iD1QjMiShw%3d&tabid=1869&portalid=0&mid=8659', filename: 'Mathematics-P2-Grade11-Nov-2018.pdf' },
  '22': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=_BnHGkPLTbs%3d&tabid=1869&portalid=0&mid=8658', filename: 'Physical-Sciences-P1-Grade11-Nov-2018.pdf' },
  '23': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=oMu2OQls9CQ%3d&tabid=1869&portalid=0&mid=8658', filename: 'Physical-Sciences-P2-Grade11-Nov-2018.pdf' },
  '24': { url: 'https://www.education.gov.za/Portals/0/CD/Examinations/Grade%2011%20Papers/2016/Physical%20Sciences%20P2%20Grade%2011%20Nov%202016%20Eng.pdf?ver=2017-01-31-092553-000', filename: 'Physical-Sciences-P2-Grade11-Nov-2016.pdf' },
  '25': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=b5H9lDVw-o4%3d&tabid=1869&portalid=0&mid=7378', filename: 'Mathematics-P1-Grade11-Nov-2017.pdf' },
  '26': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=is_Q0BklAYs%3d&tabid=1869&portalid=0&mid=7378', filename: 'Mathematics-P2-Grade11-Nov-2017.pdf' },
  '30': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=xB_6NSmf6m8%3d&tabid=1853&portalid=0&mid=8657', filename: 'Mathematics-P1-Grade10-Nov-2018.pdf' },
  '31': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=RZ22JJ5tljc%3d&tabid=1853&portalid=0&mid=8657', filename: 'Mathematics-P2-Grade10-Nov-2018.pdf' },
  '32': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=NbdCRLTzv7E%3d&tabid=1853&portalid=0&mid=8656', filename: 'Physical-Sciences-P1-Grade10-Nov-2018.pdf' },
  '33': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=e-67gT6qA1I%3d&tabid=1853&portalid=0&mid=8656', filename: 'Physical-Sciences-P2-Grade10-Nov-2018.pdf' },
  '34': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=qtQcof03_Ek%3d&tabid=1853&portalid=0&mid=7303', filename: 'Mathematics-P1-Grade10-Nov-2017.pdf' },
  '35': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=d9QSWubpK7s%3d&tabid=1853&portalid=0&mid=7303', filename: 'Mathematics-P2-Grade10-Nov-2017.pdf' },
  '200': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=qcrl4lQ-Q5w%3d&tabid=670&portalid=0&mid=2498', filename: 'Mind-the-Gap-Mathematics-Gr12.pdf' },
  '201': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=c685LnK9Eiw%3d&tabid=670&portalid=0&mid=2498', filename: 'Mind-the-Gap-MathsLit-Gr12.pdf' },
  '202': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=s_OwwNPBaCU%3d&tabid=670&portalid=0&mid=2498', filename: 'Mind-the-Gap-PhysicalSciences-Physics-Gr12.pdf' },
  '203': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=iNSFEv2mwgg%3d&tabid=670&portalid=0&mid=2498', filename: 'Mind-the-Gap-PhysicalSciences-Chemistry-Gr12.pdf' },
  '204': { url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=uxQWvGa-ZA0%3d&tabid=670&portalid=0&mid=2498', filename: 'Mind-the-Gap-LifeSciences-Gr12.pdf' },
  '210': { url: 'https://www.siyavula.com/downloads/books/maths/Gr10_Mathematics_Learner_Eng_v11.pdf', filename: 'Gr10_Mathematics_Learner_Eng_v11.pdf' },
  '211': { url: 'https://www.siyavula.com/downloads/books/maths/Gr11_Mathematics_Learner_Eng.pdf', filename: 'Gr11_Mathematics_Learner_Eng.pdf' },
  '212': { url: 'https://www.siyavula.com/downloads/books/maths/Gr12_Mathematics_Learner_Eng.pdf', filename: 'Gr12_Mathematics_Learner_Eng.pdf' },
};

// Allow Vercel to give this function more time/memory for big textbook PDFs.
export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const id = req.query?.id;
  const entry = id ? DOWNLOAD_WHITELIST[id] : null;

  if (!entry) {
    res.status(404).json({ error: 'unknown resource id' });
    return;
  }

  const disposition = req.query?.disposition === 'inline' ? 'inline' : 'attachment';

  let upstream;
  try {
    upstream = await fetch(entry.url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GapMap/1.0)',
        Accept: 'application/pdf,*/*',
      },
    });
  } catch (err) {
    res.status(502).json({ error: 'upstream unavailable', detail: String(err.message || err) });
    return;
  }

  if (!upstream.ok || !upstream.body) {
    res.status(502).json({ error: 'upstream returned ' + upstream.status });
    return;
  }

  const upstreamType = (upstream.headers.get('content-type') || '').toLowerCase();

  // Some LinkClick.aspx-style links serve an HTML interstitial/error page with a
  // 200 status instead of the actual PDF when hit by a non-browser client. Catch
  // that here rather than silently handing the browser a "corrupt PDF".
  if (upstreamType.includes('text/html')) {
    res.status(502).json({
      error: 'source did not return a PDF (got HTML) — the upstream link may be dead or blocking automated requests',
    });
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', upstreamType.includes('pdf') ? 'application/pdf' : (upstreamType || 'application/pdf'));
  res.setHeader('Content-Disposition', `${disposition}; filename="${entry.filename}"`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const upstreamLength = upstream.headers.get('content-length');
  if (upstreamLength) res.setHeader('Content-Length', upstreamLength);

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  // Stream the body straight through — this is the key fix. We convert the
  // upstream fetch Response's web ReadableStream into a Node stream and pipe
  // it directly to `res`, so we never hold the whole file in memory at once.
  // That's what removes the 4.5MB buffered-response ceiling.
  try {
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (err) {
    // If streaming fails partway through, the headers are already sent, so we
    // can't send a JSON error — just log and let the connection end.
    console.error('[download] stream error', err.message);
    if (!res.writableEnded) res.end();
  }
}
