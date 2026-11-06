// Loopback-only preview: no credentials, Supabase, Twilio or outbound HTTP.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {createWorkspace}=require('../lib/assistant-workspace');
const {threads,memoryStore,calendar}=require('../test/fixtures/assistant-workspace.cjs');
const root=path.resolve(__dirname,'..');
const mockStore=memoryStore();
const workspace=createWorkspace({transport:{ready:()=>true,send:async record=>mockStore.transition(record,'accepted',{event:'mock_provider_accepted',actor:'synthetic-only',at:'2026-11-06T16:00:00Z'},{provider_receipt:{sid:'SIMULATED-'+record.id,from:'+18448211802',simulation:true}})},source:{inbox:async()=>threads,thread:async key=>threads.find(t=>t.thread_key===key),calendar:async()=>calendar},store:mockStore,now:()=>new Date('2026-11-06T16:00:00Z')});
const actor={owner:true,id:'jared-preview',scopes:['read','draft','approve','send','simulate','dismiss'],threads:[]};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1');
    res.setHeader('Cache-Control','no-store');
    if(url.pathname==='/api/admin/assistant'){
      res.setHeader('Content-Type','application/json');
      if(req.method==='GET')return res.end(JSON.stringify(await workspace.read(actor)));
      if(req.method!=='POST'){res.statusCode=405;return res.end('{}');}
      // Cross-origin web pages cannot mutate the synthetic local workspace.
      if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`){res.statusCode=403;return res.end('{}');}
      let body='';for await(const chunk of req){body+=chunk;if(body.length>10000)throw new Error('Too large');}
      return res.end(JSON.stringify(await workspace.act(actor,JSON.parse(body))));
    }
    if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ok:true,inbox:[],agents:[],counts:{}}));}
    const relative=['/','/admin','/admin.html','/command','/command.html'].includes(url.pathname)?'apps/rel8tion-app/admin.html':decodeURIComponent(url.pathname).replace(/^\//,'');
    const file=path.resolve(root,relative);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;return res.end('Not found');}
    // Only public app/asset files are available; never expose repo or env files.
    const publicPath=path.relative(root,file).replaceAll('\\','/');
    if(!/^(apps\/rel8tion-app|assets)\//.test(publicPath)||publicPath.split('/').some(part=>part.startsWith('.'))||!['.html','.js','.css','.svg','.png','.jpg','.jpeg','.woff','.woff2'].includes(path.extname(file))){res.statusCode=404;return res.end('Not found');}
    const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[ext]||'application/octet-stream');
    let content=fs.readFileSync(file);
    if(relative==='apps/rel8tion-app/admin.html')content=content.toString().replace('    verify();',"    state.verified = true; state.credentialVerified = true; state.area = 'assistant'; render();");
    res.end(content);
  }catch(error){res.statusCode=error.status||500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:false,error:error.message}));}
});
server.listen(Number(process.env.ASSISTANT_PREVIEW_PORT||4317),'127.0.0.1',()=>console.log('Synthetic COMMAND preview: http://127.0.0.1:4317/admin?area=assistant (no delivery; data resets on restart)'));
