// GapMap dev server — a minimal static file server + library download proxy.
//
// Serves the repo root statically: the demo screens at the root, frontend/,
// and core/demo-data/. The Learning Companion's Node service was retired with
// the move to Firebase AI Logic (see docs/adr/0004-firebase-ai-logic.md).
//
// One intentional API route: GET /api/download?id=<resourceId>
// Streams a whitelisted official paper to the browser so the Learner never
// leaves GapMap. Arbitrary user-supplied URLs are rejected.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(fileURLToPath(new URL('.', import.meta.url)));
// Strip a trailing separator so the prefix check is exact: fileURLToPath of a
// directory URL yields a trailing slash, and normalize/join preserve it —
// without this, `root + sep` double-slashes and every request fails the
// traversal guard.
const safeRoot = root.endsWith(sep) ? root.slice(0, -1) : root;
const port = Number(process.env.PORT || 8000);

const allowedOrigin = process.env.CORS_ORIGIN || '*';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

/** Server-side whitelist only. Frontend never supplies the URL. */
const DOWNLOAD_WHITELIST = {
  // --- Grade 12 ---
  '1': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=CsNcmi8-trM%3D&tabid=4933&portalid=0&mid=13146',
    filename: 'Mathematics-P1-Nov-2024.pdf',
  },
  '3': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=Yak0VdHytZc%3D&tabid=4504&portalid=0&mid=12321',
    filename: 'Physical-Sciences-P1-Nov-2023.pdf',
  },
  '4': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=3s86L5Ok4Ds%3D&tabid=4504&portalid=0&mid=12321',
    filename: 'Physical-Sciences-P2-Nov-2023.pdf',
  },
  // --- Grade 11 (official DBE common papers) ---
  '20': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=1KiiLnULnVY%3d&tabid=1869&portalid=0&mid=8659',
    filename: 'Mathematics-P1-Grade11-Nov-2018.pdf',
  },
  '21': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=4iD1QjMiShw%3d&tabid=1869&portalid=0&mid=8659',
    filename: 'Mathematics-P2-Grade11-Nov-2018.pdf',
  },
  '22': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=_BnHGkPLTbs%3d&tabid=1869&portalid=0&mid=8658',
    filename: 'Physical-Sciences-P1-Grade11-Nov-2018.pdf',
  },
  '23': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=oMu2OQls9CQ%3d&tabid=1869&portalid=0&mid=8658',
    filename: 'Physical-Sciences-P2-Grade11-Nov-2018.pdf',
  },
  '24': {
    url: 'https://www.education.gov.za/Portals/0/CD/Examinations/Grade%2011%20Papers/2016/Physical%20Sciences%20P2%20Grade%2011%20Nov%202016%20Eng.pdf?ver=2017-01-31-092553-000',
    filename: 'Physical-Sciences-P2-Grade11-Nov-2016.pdf',
  },
  '25': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=b5H9lDVw-o4%3d&tabid=1869&portalid=0&mid=7378',
    filename: 'Mathematics-P1-Grade11-Nov-2017.pdf',
  },
  '26': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=is_Q0BklAYs%3d&tabid=1869&portalid=0&mid=7378',
    filename: 'Mathematics-P2-Grade11-Nov-2017.pdf',
  },
  // --- Grade 10 (official DBE common papers) ---
  '30': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=xB_6NSmf6m8%3d&tabid=1853&portalid=0&mid=8657',
    filename: 'Mathematics-P1-Grade10-Nov-2018.pdf',
  },
  '31': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=RZ22JJ5tljc%3d&tabid=1853&portalid=0&mid=8657',
    filename: 'Mathematics-P2-Grade10-Nov-2018.pdf',
  },
  '32': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=NbdCRLTzv7E%3d&tabid=1853&portalid=0&mid=8656',
    filename: 'Physical-Sciences-P1-Grade10-Nov-2018.pdf',
  },
  '33': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=e-67gT6qA1I%3d&tabid=1853&portalid=0&mid=8656',
    filename: 'Physical-Sciences-P2-Grade10-Nov-2018.pdf',
  },
  '34': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=qtQcof03_Ek%3d&tabid=1853&portalid=0&mid=7303',
    filename: 'Mathematics-P1-Grade10-Nov-2017.pdf',
  },
  '35': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=d9QSWubpK7s%3d&tabid=1853&portalid=0&mid=7303',
    filename: 'Mathematics-P2-Grade10-Nov-2017.pdf',
  },

  // --- Added: study guides, textbooks, memos, extra papers & videos ---
  '2': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=8W2dAxBUTQA%3d&tabid=5193&portalid=0&mid=13724',
    filename: 'Mathematics-P2-Nov-2024.pdf',
  },
  '200': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=qcrl4lQ-Q5w%3d&tabid=670&portalid=0&mid=2498',
    filename: 'Mind-the-Gap-Mathematics-Gr12.pdf',
  },
  '201': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=c685LnK9Eiw%3d&tabid=670&portalid=0&mid=2498',
    filename: 'Mind-the-Gap-MathsLit-Gr12.pdf',
  },
  '202': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=s_OwwNPBaCU%3d&tabid=670&portalid=0&mid=2498',
    filename: 'Mind-the-Gap-PhysicalSciences-Physics-Gr12.pdf',
  },
  '203': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=iNSFEv2mwgg%3d&tabid=670&portalid=0&mid=2498',
    filename: 'Mind-the-Gap-PhysicalSciences-Chemistry-Gr12.pdf',
  },
  '204': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=uxQWvGa-ZA0%3d&tabid=670&portalid=0&mid=2498',
    filename: 'Mind-the-Gap-LifeSciences-Gr12.pdf',
  },
  '210': {
    url: 'https://www.siyavula.com/downloads/books/maths/Gr10_Mathematics_Learner_Eng_v11.pdf',
    filename: 'Gr10_Mathematics_Learner_Eng_v11.pdf',
  },
  '211': {
    url: 'https://www.siyavula.com/downloads/books/maths/Gr11_Mathematics_Learner_Eng.pdf',
    filename: 'Gr11_Mathematics_Learner_Eng.pdf',
  },
  '212': {
    url: 'https://www.siyavula.com/downloads/books/maths/Gr12_Mathematics_Learner_Eng.pdf',
    filename: 'Gr12_Mathematics_Learner_Eng.pdf',
  },
  '213': {
    url: 'https://www.siyavula.com/downloads/books/science/Gr10_PhysicalSciences_Learner_Eng.pdf',
    filename: 'Gr10_PhysicalSciences_Learner_Eng.pdf',
  },
  '214': {
    url: 'https://www.siyavula.com/downloads/books/science/Gr11_PhysicalSciences_Learner_Eng.pdf',
    filename: 'Gr11_PhysicalSciences_Learner_Eng.pdf',
  },
  '215': {
    url: 'https://www.siyavula.com/downloads/books/science/Gr12_PhysicalSciences_Learner_Eng.pdf',
    filename: 'Gr12_PhysicalSciences_Learner_Eng.pdf',
  },
  '216': {
    url: 'https://www.siyavula.com/downloads/books/life-science/Gr10_LifeSciences_Learner_Eng.pdf',
    filename: 'Gr10_LifeSciences_Learner_Eng.pdf',
  },
  '217': {
    url: 'https://www.siyavula.com/downloads/books/maths-lit/Gr10_MathsLit_Learner_Eng.pdf',
    filename: 'Gr10_MathsLit_Learner_Eng.pdf',
  },
  '220': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=5Xc2L4uffmA%3d&tabid=4682&portalid=0&mid=12679',
    filename: 'Life-Sciences-P1-Nov-2023.pdf',
  },
  '221': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=4yWO4CegNNE%3d&tabid=4682&portalid=0&mid=12679',
    filename: 'Life-Sciences-P2-Nov-2023.pdf',
  },
  '222': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=FOVa0T-5xWI%3d&tabid=4682&portalid=0&mid=12679',
    filename: 'Life-Sciences-P1-Memo-Nov-2023.pdf',
  },
  '223': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=qAWg2Im__MQ%3d&tabid=4682&portalid=0&mid=12679',
    filename: 'Life-Sciences-P2-Memo-Nov-2023.pdf',
  },
  '224': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=UH53U88PRPE%3d&tabid=5193&portalid=0&mid=13722',
    filename: 'Life-Sciences-P1-Nov-2024.pdf',
  },
  '225': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=B-Ss2iShxUE%3d&tabid=5193&portalid=0&mid=13722',
    filename: 'Life-Sciences-P2-Nov-2024.pdf',
  },
  '226': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=4RuUffqAKn4%3d&tabid=5193&portalid=0&mid=13722',
    filename: 'Life-Sciences-P1-Memo-Nov-2024.pdf',
  },
  '227': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=homj3rBe7xM%3d&tabid=5193&portalid=0&mid=13722',
    filename: 'Life-Sciences-P2-Memo-Nov-2024.pdf',
  },
  '230': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=G25285_TDS4%3d&tabid=4682&portalid=0&mid=12662',
    filename: 'Agricultural-Sciences-P1-Nov-2023.pdf',
  },
  '231': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=8CJDJS-_GM8%3d&tabid=4682&portalid=0&mid=12662',
    filename: 'Agricultural-Sciences-P2-Nov-2023.pdf',
  },
  '232': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=d9Kp98FXFwQ%3d&tabid=4682&portalid=0&mid=12662',
    filename: 'Agricultural-Sciences-P1-Memo-Nov-2023.pdf',
  },
  '233': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=KQFEycHuf0M%3d&tabid=4682&portalid=0&mid=12662',
    filename: 'Agricultural-Sciences-P2-Memo-Nov-2023.pdf',
  },
  '234': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=fS2uU1NiSaU%3d&tabid=5193&portalid=0&mid=13705',
    filename: 'Agricultural-Sciences-P1-Nov-2024.pdf',
  },
  '235': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=Yqv9n-LtyFU%3d&tabid=5193&portalid=0&mid=13705',
    filename: 'Agricultural-Sciences-P2-Nov-2024.pdf',
  },
  '236': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=VQUYDsw1iAU%3d&tabid=5193&portalid=0&mid=13705',
    filename: 'Agricultural-Sciences-P1-Memo-Nov-2024.pdf',
  },
  '237': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=fouORRrXSZ4%3d&tabid=5193&portalid=0&mid=13705',
    filename: 'Agricultural-Sciences-P2-Memo-Nov-2024.pdf',
  },
  '240': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=TbjDznPFtSA%3d&tabid=4682&portalid=0&mid=12648',
    filename: 'English-HL-P1-Nov-2023.pdf',
  },
  '241': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=KLPJighLTHA%3d&tabid=4682&portalid=0&mid=12648',
    filename: 'English-HL-P2-Nov-2023.pdf',
  },
  '242': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=wwZ88J_HrGE%3d&tabid=4682&portalid=0&mid=12648',
    filename: 'English-HL-P3-Nov-2023.pdf',
  },
  '243': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=KWZLnDejQBg%3d&tabid=4682&portalid=0&mid=12648',
    filename: 'English-HL-P1-Memo-Nov-2023.pdf',
  },
  '244': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=y6cq68rSCFw%3d&tabid=4682&portalid=0&mid=12648',
    filename: 'English-HL-P2-Memo-Nov-2023.pdf',
  },
  '245': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=nXCgrLfFghI%3d&tabid=4682&portalid=0&mid=12648',
    filename: 'English-HL-P3-Memo-Nov-2023.pdf',
  },
  '246': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=de2qPWCUDzw%3d&tabid=5193&portalid=0&mid=13691',
    filename: 'English-HL-P1-Nov-2024.pdf',
  },
  '247': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=22HdBbdLTxU%3d&tabid=5193&portalid=0&mid=13691',
    filename: 'English-HL-P2-Nov-2024.pdf',
  },
  '248': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=FxQD3wruMb4%3d&tabid=5193&portalid=0&mid=13691',
    filename: 'English-HL-P3-Nov-2024.pdf',
  },
  '249': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=9Vp_4NM3560%3d&tabid=5193&portalid=0&mid=13691',
    filename: 'English-HL-P1-Memo-Nov-2024.pdf',
  },
  '250': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=WKoPvyGnomY%3d&tabid=5193&portalid=0&mid=13691',
    filename: 'English-HL-P2-Memo-Nov-2024.pdf',
  },
  '251': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=LiIPgUlKNuU%3d&tabid=5193&portalid=0&mid=13691',
    filename: 'English-HL-P3-Memo-Nov-2024.pdf',
  },
  '260': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=5VCFfxPhz6k%3d&tabid=4682&portalid=0&mid=12680',
    filename: 'Mathematical-Literacy-P1-Nov-2023.pdf',
  },
  '261': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=8heLhdxLIws%3d&tabid=4682&portalid=0&mid=12680',
    filename: 'Mathematical-Literacy-P2-Nov-2023.pdf',
  },
  '262': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=2JxLqGZq7Cw%3d&tabid=4682&portalid=0&mid=12680',
    filename: 'Mathematical-Literacy-P1-Memo-Nov-2023.pdf',
  },
  '263': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=qVim9petgX4%3d&tabid=4682&portalid=0&mid=12680',
    filename: 'Mathematical-Literacy-P2-Memo-Nov-2023.pdf',
  },
  '264': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=r3H6xWQUYXg%3d&tabid=5193&portalid=0&mid=13723',
    filename: 'Mathematical-Literacy-P1-Nov-2024.pdf',
  },
  '265': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=1EZXhzf3-sI%3d&tabid=5193&portalid=0&mid=13723',
    filename: 'Mathematical-Literacy-P2-Nov-2024.pdf',
  },
  '266': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=AY2Qj8huxtE%3d&tabid=5193&portalid=0&mid=13723',
    filename: 'Mathematical-Literacy-P1-Memo-Nov-2024.pdf',
  },
  '267': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=xrUiB59LW4E%3d&tabid=5193&portalid=0&mid=13723',
    filename: 'Mathematical-Literacy-P2-Memo-Nov-2024.pdf',
  },
  '270': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=D_T4clPBpkk%3d&tabid=5193&portalid=0&mid=13724',
    filename: 'Mathematics-P1-Memo-Nov-2024.pdf',
  },
  '272': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=0DIM92_2Vu8%3d&tabid=5193&portalid=0&mid=13724',
    filename: 'Mathematics-P2-Memo-Nov-2024.pdf',
  },
  '280': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=6g6X4xphO7I%3d&tabid=4682&portalid=0&mid=12685',
    filename: 'Physical-Sciences-P1-Memo-Nov-2023.pdf',
  },
  '281': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=1JdWi95UKbY%3d&tabid=4682&portalid=0&mid=12685',
    filename: 'Physical-Sciences-P2-Memo-Nov-2023.pdf',
  },
  // --- Grade 12, November 2022 (official DBE common papers) ---
  '400': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=Yk0N110o7uQ%3d&tabid=3294&portalid=0&mid=10967',
    filename: 'Agricultural-Sciences-P1-Nov-2022.pdf',
  },
  '401': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=1bIuy8wTc2U%3d&tabid=3294&portalid=0&mid=10967',
    filename: 'Agricultural-Sciences-P2-Nov-2022.pdf',
  },
  '402': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=qAmmEkPSXRw%3d&tabid=3294&portalid=0&mid=10967',
    filename: 'Agricultural-Sciences-P1-Memo-Nov-2022.pdf',
  },
  '403': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=kZPav9o1Bg0%3d&tabid=3294&portalid=0&mid=10967',
    filename: 'Agricultural-Sciences-P2-Memo-Nov-2022.pdf',
  },
  '404': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=Fg44KuXQ8Es%3d&tabid=3294&portalid=0&mid=10984',
    filename: 'Life-Sciences-P1-Nov-2022.pdf',
  },
  '405': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=FPGyIKhYDUw%3d&tabid=3294&portalid=0&mid=10984',
    filename: 'Life-Sciences-P2-Nov-2022.pdf',
  },
  '406': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=uKa3J7piCac%3d&tabid=3294&portalid=0&mid=10984',
    filename: 'Life-Sciences-P1-Memo-Nov-2022.pdf',
  },
  '407': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=nh7PJ8c7s8g%3d&tabid=3294&portalid=0&mid=10984',
    filename: 'Life-Sciences-P2-Memo-Nov-2022.pdf',
  },
  '408': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=TmBjjP7joNg%3d&tabid=3294&portalid=0&mid=10953',
    filename: 'English-HL-P1-Nov-2022.pdf',
  },
  '409': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=oQCVhvL8WnE%3d&tabid=3294&portalid=0&mid=10953',
    filename: 'English-HL-P2-Nov-2022.pdf',
  },
  '410': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=gFBCYV3CPk0%3d&tabid=3294&portalid=0&mid=10953',
    filename: 'English-HL-P3-Nov-2022.pdf',
  },
  '411': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=ccaoiCIq45c%3d&tabid=3294&portalid=0&mid=10953',
    filename: 'English-HL-P1-Memo-Nov-2022.pdf',
  },
  '412': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=ht1T_MDlzQI%3d&tabid=3294&portalid=0&mid=10953',
    filename: 'English-HL-P2-Memo-Nov-2022.pdf',
  },
  '413': {
    url: 'https://www.education.gov.za/LinkClick.aspx?fileticket=7cNJI9cBOoU%3d&tabid=3294&portalid=0&mid=10953',
    filename: 'English-HL-P3-Memo-Nov-2022.pdf',
  },
};

function respond(res, status, headers, body) {
  res.writeHead(status, {
    'access-control-allow-origin': allowedOrigin,
    vary: 'Origin',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
    ...headers,
  });
  res.end(body);
}

function jsonError(res, status, message) {
  respond(
    res,
    status,
    { 'content-type': 'application/json' },
    JSON.stringify({ error: message }),
  );
}

/**
 * GET /api/download?id=<id>[&disposition=inline|attachment]
 * Looks up id in DOWNLOAD_WHITELIST, fetches the official URL server-side,
 * and streams the PDF back. Unknown ids → 404. Upstream failure → 502.
 */
async function handleDownload(req, res, searchParams) {
  const id = searchParams.get('id');
  if (!id || !DOWNLOAD_WHITELIST[id]) {
    jsonError(res, 404, 'unknown resource id');
    return;
  }

  const entry = DOWNLOAD_WHITELIST[id];
  const disposition =
    searchParams.get('disposition') === 'inline' ? 'inline' : 'attachment';

  let upstream;
  try {
    upstream = await fetch(entry.url, {
      redirect: 'follow',
      headers: {
        // Some education.gov.za LinkClick endpoints are picky about User-Agent.
        'User-Agent':
          'Mozilla/5.0 (compatible; GapMap/1.0; +https://gapmap.local)',
        Accept: 'application/pdf,*/*',
      },
    });
  } catch (err) {
    console.error('[download proxy] fetch failed for id=%s: %s', id, err.message);
    jsonError(res, 502, 'upstream unavailable');
    return;
  }

  if (!upstream.ok) {
    console.error(
      '[download proxy] upstream status %s for id=%s',
      upstream.status,
      id,
    );
    jsonError(res, 502, 'upstream returned ' + upstream.status);
    return;
  }

  const contentType =
    upstream.headers.get('content-type') || 'application/pdf';
  const filename = entry.filename;

  const headers = {
    'content-type': contentType.includes('pdf')
      ? 'application/pdf'
      : contentType,
    'content-disposition': `${disposition}; filename="${filename}"`,
    'cache-control': 'private, max-age=3600',
  };

  const len = upstream.headers.get('content-length');
  if (len) headers['content-length'] = len;

  res.writeHead(200, {
    'access-control-allow-origin': allowedOrigin,
    vary: 'Origin',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
    ...headers,
  });

  // Stream the body so large PDFs don't sit fully in memory.
  const body = upstream.body;
  if (!body) {
    res.end();
    return;
  }

  try {
    for await (const chunk of body) {
      if (!res.write(chunk)) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
    res.end();
  } catch (err) {
    console.error('[download proxy] stream error for id=%s: %s', id, err.message);
    if (!res.headersSent) {
      jsonError(res, 502, 'stream failed');
    } else {
      res.destroy();
    }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    // --- Library download proxy (Approach A) ---
    if (pathname === '/api/download' && (req.method === 'GET' || req.method === 'HEAD')) {
      await handleDownload(req, res, url.searchParams);
      return;
    }

    // --- Static files (unchanged behaviour) ---
    const relative = pathname === '/' ? '/index.html' : pathname;
    const path = normalize(join(safeRoot, relative));

    if (!path.startsWith(safeRoot + sep)) {
      respond(
        res,
        403,
        { 'content-type': 'application/json' },
        JSON.stringify({ error: 'forbidden' }),
      );
      return;
    }

    const contents = await readFile(path);
    respond(
      res,
      200,
      {
        'content-type': CONTENT_TYPES[extname(path)] || 'application/octet-stream',
        'cache-control': 'no-cache',
      },
      contents,
    );
  } catch (error) {
    if (error.code === 'ENOENT') {
      respond(
        res,
        404,
        { 'content-type': 'application/json' },
        JSON.stringify({ error: 'not found' }),
      );
      return;
    }
    if (!res.headersSent) {
      respond(
        res,
        500,
        { 'content-type': 'application/json' },
        JSON.stringify({ error: error.message }),
      );
    }
  }
});

server.listen(port, '0.0.0.0', () =>
  console.log(`GapMap running at http://localhost:${port}`),
);