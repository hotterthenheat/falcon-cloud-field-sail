/*
  Collects Content-Security-Policy violation reports (report-uri and the Reporting API) into the function log,
  one compact line each, so the policy in vercel.json can be checked before it is enforced.
*/

const MAX_BYTES = 16_384;

const pick = (r) => ({
  directive: r['effective-directive'] || r.effectiveDirective || r['violated-directive'] || '',
  blocked: String(r['blocked-uri'] || r.blockedURL || '').slice(0, 200),
  page: String(r['document-uri'] || r.documentURL || '').replace(/[?#].*$/, '').slice(0, 200),
  source: String(r['source-file'] || r.sourceFile || '').slice(0, 200),
  line: r['line-number'] || r.lineNumber || 0,
  disposition: r.disposition || '',
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end();
    return;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) break;
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const reports = Array.isArray(body) ? body.filter((r) => r?.type === 'csp-violation').map((r) => r.body || {}) : [body['csp-report'] || {}];
    for (const r of reports.slice(0, 20)) console.log('csp-violation', JSON.stringify(pick(r)));
  } catch {
    /* not a report */
  }
  res.statusCode = 204;
  res.end();
}
