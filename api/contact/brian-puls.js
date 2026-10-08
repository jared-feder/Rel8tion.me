const VCARD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Puls;Brian;;;',
  'FN:Brian Puls',
  'ORG:Nationwide Mortgage Bankers',
  'TITLE:Producing Branch Manager',
  'TEL;TYPE=CELL:+15165272705',
  'EMAIL;TYPE=INTERNET:bpuls@nmbnow.com',
  'URL:https://irel8.me/brian',
  'NOTE:NMLS #36142',
  'END:VCARD',
  ''
].join('\r\n');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send('Method Not Allowed');
  }

  res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="Brian-Puls.vcf"');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'HEAD') return res.status(200).end();
  return res.status(200).send(VCARD);
};
