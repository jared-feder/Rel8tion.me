const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const source=path.join(__dirname,'../tools/local-scraper');
test('source integrity survives Git line endings but rejects a changed worker',t=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'rel8tion-integrity-'));
  t.after(()=>{if(path.dirname(temporary)===path.resolve(os.tmpdir()))fs.rmSync(temporary,{recursive:true,force:true});});
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'scraper-integrity.json'),'utf8'));
  fs.copyFileSync(path.join(source,'scraper-integrity.json'),path.join(temporary,'scraper-integrity.json'));
  for(const {name} of manifest.files){const text=fs.readFileSync(path.join(source,name),'utf8').replace(/\r\n/g,'\n').replace(/\n/g,'\r\n');fs.writeFileSync(path.join(temporary,name),text);}
  const run=()=>spawnSync(process.execPath,[path.join(temporary,'verify-scraper.cjs'),'--source-only'],{encoding:'utf8'});
  assert.equal(run().status,0);
  fs.appendFileSync(path.join(temporary,'trulia-old-working-plus-patch.cjs'),'\n// changed source\n');
  const changed=run();assert.equal(changed.status,1);assert.match(changed.stderr,/Changed scraper file/);
});
