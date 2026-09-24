// Vercel serverless function: GET /api/download?id=...
// Proxies official past papers so learners stay on GapMap.

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

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const id = req.query?.id;
  if (!id || !DOWNLOAD_WHITELIST[id]) {
    res.status(404).json({ error: 'unknown resource id' });
    return;
  }

  const entry = DOWNLOAD_WHITELIST[id];
  const disposition = req.query?.disposition === 'inline' ? 'inline' : 'attachment';

  try {
    const upstream = await fetch(entry.url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GapMap/1.0)',
        Accept: 'application/pdf,*/*',
      },
    });

    if (!upstream.ok) {
      res.status(502).json({ error: 'upstream returned ' + upstream.status });
      return;
    }

    const contentType = upstream.headers.get('content-type') || 'application/pdf';
    const buffer = Buffer.from(await upstream.arrayBuffer());

    res.setHeader('Content-Type', contentType.includes('pdf') ? 'application/pdf' : contentType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${entry.filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(buffer);
  } catch (err) {
    console.error('[download]', err.message);
    res.status(502).json({ error: 'upstream unavailable' });
  }
}