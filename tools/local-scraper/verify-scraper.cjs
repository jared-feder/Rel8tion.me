const fs=require('fs'),path=require('path'),crypto=require('crypto');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'scraper-integrity.json'),'utf8'));
let failed=false;
for(const entry of manifest.files){
 const file=path.join(__dirname,entry.name);
 try {const text=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');if(crypto.createHash('sha256').update(text).digest('hex')!==entry.sha256){console.error('Changed scraper file: '+entry.name);failed=true;}}
 catch {console.error('Missing or unreadable scraper file: '+entry.name);failed=true;}
}
if(failed)process.exit(1);
for(const name of process.argv.includes('--source-only')?[]:Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname,'package.json'),'utf8')).dependencies)){
 try {require.resolve(name,{paths:[__dirname]});}catch{console.error('Missing dependency: '+name);failed=true;}
}
if(failed)process.exit(1);
console.log(process.argv.includes('--source-only')?'Scraper source integrity passed.':'Scraper source integrity and dependency checks passed.');
