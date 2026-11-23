// A stand-in for Read Free's site, for test/windows/install-test.ps1: serves one folder's files
// over https on localhost with the certificate given (a .pfx, passphrase "readfree").
//   node serve.js <folder> <certificate.pfx> <port>
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const [site, pfx, port] = process.argv.slice(2);
https.createServer({ pfx: fs.readFileSync(pfx), passphrase: 'readfree' }, (req, res) => {
  const file = path.join(site, path.basename(decodeURIComponent(req.url.split('?')[0])));
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200).end(fs.readFileSync(file));
}).listen(Number(port), () => console.log(`serving ${site} on https://localhost:${port}/`));
