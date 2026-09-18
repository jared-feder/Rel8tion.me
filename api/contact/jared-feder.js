const VCARD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Feder;Jared;;;',
  'FN:Jared Feder',
  'ORG:REL8TION',
  'TITLE:Mortgage Strategist | Founder of REL8TION',
  'TEL;TYPE=CELL:+13477758059',
  'EMAIL;TYPE=INTERNET:email@jaredfeder.com',
  'URL:https://jaredfeder.com/bizcard/',
  'URL:https://www.linkedin.com/in/jared-feder',
  'NOTE:Mortgage · Real Estate · Technology · AI',
  'END:VCARD',
  ''
].join('\r\n');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send('Method Not Allowed');
  }

  res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="Jared-Feder.vcf"');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'HEAD') return res.status(200).end();
  return res.status(200).send(VCARD);
};
