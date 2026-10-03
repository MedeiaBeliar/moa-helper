import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {StatisticsStore} from './statistics-store.mjs';
import {domains,renderApp,renderPage,robots,sitemap,llms} from './pages.mjs';

const publicRoot=fileURLToPath(new URL('../public/',import.meta.url));
const localOnlyAssets=new Set(['index.html','statistics-share.js','statistics-export.js']);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
export function securityHeaders(hash){return {
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin',
  'Content-Security-Policy':`default-src 'self'; script-src 'self'${hash?` 'sha256-${hash}'`:''}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`,
  'Permissions-Policy':'camera=(), microphone=(), geolocation=(), display-capture=(self)',
  'Cross-Origin-Resource-Policy':'same-origin'
};}
// The handler is tested with in-memory request/response objects, without a
// listener or local web server.
export function createHostedHandler({store,catalogue,template,allowedHosts=domains,assetRoot=publicRoot,now=()=>Date.now()}){
  const hosts=new Set(allowedHosts),limits=new Map();
  return async(req,res)=>{
    const send=(status,body,type='application/json; charset=utf-8',headers={})=>{
      res.writeHead(status,{...securityHeaders(),'Content-Type':type,'Cache-Control':'no-store',...headers});res.end(req.method==='HEAD'?undefined:body);
    };
    try{
      const host=(req.headers.host||'').toLowerCase();
      if(!hosts.has(host))return send(421,'Unknown host','text/plain');
      const url=new URL(req.url,`https://${host}`),origin=`https://${host}`,route=url.pathname;
      if(route==='/api/statistics'){
        if(req.method==='GET'||req.method==='HEAD')return send(200,JSON.stringify(store.read()));
        if(req.method!=='PUT')return send(405,'{}','application/json',{Allow:'GET, HEAD, PUT'});
        if(req.headers.origin!==origin||req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')return send(403,'{"error":"Same-origin requests only"}');
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return send(415,'{}');
        // Nginx overwrites this header. Node has no public listener.
        const address=req.headers['x-real-ip']||req.socket?.remoteAddress||'unknown',at=now();
        if(limits.size>10000)for(const [key,value]of limits)if(at-value.start>60000)limits.delete(key);
        const limit=limits.get(address);if(limit&&at-limit.start<60000){if(++limit.count>120)return send(429,'{"error":"Retry later"}','application/json',{'Retry-After':'60'});}else{if(limits.size>=20000)return send(503,'{}');limits.set(address,{start:at,count:1});}
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>32768)return send(413,'{}');chunks.push(chunk);}
        let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,'{"error":"Invalid JSON"}');}
        return send(200,JSON.stringify(store.submit(data)));
      }
      // Hosted mode deliberately has no state read/write API.
      if(route.startsWith('/api/'))return send(404,'{"error":"Not found"}');
      if(!['GET','HEAD'].includes(req.method))return send(405,'','text/plain',{Allow:'GET, HEAD'});
      if(route==='/healthz')return send(200,'ok','text/plain',{'X-Robots-Tag':'noindex'});
      if(route==='/robots.txt')return send(200,robots(origin),'text/plain; charset=utf-8');
      if(route==='/sitemap.xml')return send(200,sitemap(origin),'application/xml; charset=utf-8');
      if(route==='/llms.txt')return send(200,llms(origin),'text/plain; charset=utf-8');
      const aliases={'/index.html':'/','/en':'/en/','/guide/':'/guide','/statistics/':'/statistics','/en/guide/':'/en/guide','/en/statistics/':'/en/statistics'};
      if(aliases[route])return send(308,'','text/plain',{Location:aliases[route]});
      const language=route.startsWith('/en/')?'en':'ko';let page;
      if(route==='/'||route==='/en/')page=renderApp(template,{origin,language});
      else if(['/guide','/en/guide','/statistics','/en/statistics'].includes(route))page=renderPage({origin,language,page:route.split('/').at(-1),catalogue,statistics:store.read().statistics});
      if(page)return send(200,page.html,'text/html; charset=utf-8',{...securityHeaders(page.hash),'Cache-Control':'public, max-age=0, must-revalidate','Content-Language':language});
      const decoded=decodeURIComponent(route);
      if(decoded.split(/[\\/]/).some(segment=>segment.startsWith('.'))||decoded.includes('\\')||decoded.includes('\0'))return send(404,'Not found','text/plain');
      const file=path.resolve(assetRoot,'.'+decoded);
      if(!file.startsWith(path.resolve(assetRoot)+path.sep)||!types[path.extname(file)])return send(404,'Not found','text/plain');
      if(localOnlyAssets.has(path.relative(assetRoot,file)))return send(404,'Not found','text/plain');
      const data=await readFile(file);
      return send(200,data,types[path.extname(file)],{'Cache-Control':/\.(woff2|png|svg)$/.test(file)?'public, max-age=86400':'public, max-age=0, must-revalidate'});
    }catch(error){const status=error.status||(['ENOENT','EISDIR','ENOTDIR'].includes(error.code)?404:error instanceof URIError?400:500);return send(status,JSON.stringify({error:status===400?'Invalid submission':status===404?'Not found':'Service unavailable'}));}
  };
}

export async function startHosted({dataDir=process.env.MOA_DATA_DIR||'/var/lib/moa-helper',port=Number(process.env.PORT||3211)}={}){
  await mkdir(dataDir,{recursive:true});
  const catalogue=JSON.parse(await readFile(path.join(publicRoot,'example-blocks.json'),'utf8')).blocks;
  const template=await readFile(path.join(publicRoot,'index.html'),'utf8');
  const store=new StatisticsStore(path.join(dataDir,'statistics.sqlite'),catalogue);
  const server=http.createServer(createHostedHandler({store,catalogue,template}));
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  server.listen(port,'127.0.0.1',()=>console.log(`Moa Helper hosted service listening on 127.0.0.1:${port}`));
  const stop=()=>server.close(()=>{store.close();process.exit(0);});process.on('SIGTERM',stop);process.on('SIGINT',stop);
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await startHosted();
