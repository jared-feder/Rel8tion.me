const http=require('node:http');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');const port=Number(process.env.BUYER_PREVIEW_PORT||8768);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(req.method!=='GET'){res.writeHead(405);res.end('Read-only local preview');return;}
  let pathname=url.pathname;
  if(pathname==='/event'&&url.searchParams.get('preview')==='buyer')pathname='/apps/rel8tion-app/buyer-preview.html';
  if(pathname==='/'){res.writeHead(302,{Location:'/event?preview=buyer'});res.end();return;}
  const assetNames=['rel8tion-logo.png','Inter-Regular.ttf','Inter-Bold.ttf','PlusJakartaSans-ExtraBold.ttf'];
  const allowed=pathname==='/apps/rel8tion-app/buyer-preview.html'
    || /^\/apps\/rel8tion-app\/src\/[a-zA-Z0-9/_-]+\.js$/.test(pathname)
    || assetNames.some(name=>pathname==='/assets/rel8tion-brand/'+name)
    || pathname==='/assets/preview/tailwind-3.4.17.js';
  const target=path.resolve(root,'.'+decodeURIComponent(pathname));
  if(!allowed||!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404);res.end('No production APIs or records are available');return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'"});
  fs.createReadStream(target).pipe(res);console.log('GET '+pathname+' 200');
});
server.listen(port,'127.0.0.1',()=>console.log('Actual REL8TION renderer: http://127.0.0.1:'+port+'/event?preview=buyer'));
