import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {POLICY,localDay,slotsForDay,validateDay,priceFor} from './schedule.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const digest=s=>createHash('sha256').update(String(s)).digest();
const equal=(a,b)=>timingSafeEqual(digest(a),digest(b));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Cache-Control':'no-store'};
export function createApp({dbPath=process.env.DB_PATH||join(root,'data','bookings.sqlite'),secret=process.env.BOOKING_SECRET,adminToken=process.env.ADMIN_TOKEN,origins=process.env.ALLOWED_ORIGINS||'https://soccer-world-academy.onrender.com',now=()=>new Date()}={}){
 if(!secret||secret.length<32)throw new Error('BOOKING_SECRET must have at least 32 characters.');
 if(!adminToken||adminToken.length<16)throw new Error('ADMIN_TOKEN must have at least 16 characters.');
 mkdirSync(dirname(dbPath),{recursive:true});
 const db=new DatabaseSync(dbPath);db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
 db.exec(`CREATE TABLE IF NOT EXISTS bookings(id TEXT PRIMARY KEY,start TEXT NOT NULL,end TEXT NOT NULL,type TEXT NOT NULL,count INTEGER NOT NULL,total INTEGER NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'confirmed',created TEXT NOT NULL,idempotency TEXT NOT NULL UNIQUE,fingerprint TEXT NOT NULL);CREATE UNIQUE INDEX IF NOT EXISTS occupied_slot ON bookings(start) WHERE status='confirmed';`);
 const allowed=new Set(origins.split(',').map(s=>s.trim()).filter(Boolean));
 const managementToken=id=>createHmac('sha256',secret).update('manage:'+id).digest('hex');
 const publicBooking=b=>({id:b.id,start:b.start,end:b.end,type:b.type,count:b.count,total:b.total,status:b.status,location:POLICY.location,timezone:POLICY.timezone,name:b.name});
 const traffic=new Map();
 const server=createServer(async(req,res)=>{
  const origin=req.headers.origin;
  const ownOrigin=`${req.headers['x-forwarded-proto']==='https'?'https':'http'}://${req.headers.host}`;
  const corsAllowed=!origin||allowed.has(origin)||origin===ownOrigin;
  const h={...headers};
  if(origin&&corsAllowed){h['Access-Control-Allow-Origin']=origin;h.Vary='Origin';h['Access-Control-Allow-Headers']='Content-Type, Authorization, X-Booking-Token';h['Access-Control-Allow-Methods']='GET, POST, OPTIONS';}
  const send=(code,obj)=>{res.writeHead(code,{...h,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj));};
  const error=(code,message)=>{const e=new Error(message);e.status=code;throw e;};
  const admin=()=>{if(!equal(req.headers.authorization||'',`Bearer ${adminToken}`))error(401,'Sign in with your owner password.');};
  const readBody=async()=>{let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>8192)error(413,'Request is too large.');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{error(400,'Invalid request.');}};
  try{
   const url=new URL(req.url,'http://local');
   if(url.pathname.startsWith('/api/')&&!corsAllowed)return send(403,{error:'This origin is not allowed.'});
   if(req.method==='OPTIONS'){res.writeHead(204,h);return res.end();}
   if(req.method==='POST'){
    if(!String(req.headers['content-type']||'').startsWith('application/json'))error(415,'Use JSON requests.');
    const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',')[0].trim();
    const window=Math.floor(Date.now()/900000);const key=ip+':'+window;
    if(traffic.size>5000)for(const k of traffic.keys())if(!k.endsWith(':'+window))traffic.delete(k);
    const count=(traffic.get(key)||0)+1;traffic.set(key,count);if(count>100)error(429,'Too many requests. Please try again later.');
   }
   if(req.method==='GET'&&url.pathname==='/api/health'){db.prepare('SELECT 1').get();return send(200,{ok:true});}
   if(req.method==='GET'&&url.pathname==='/api/config')return send(200,{...POLICY,today:localDay(now()),bookingOpen:true});
   if(req.method==='GET'&&url.pathname==='/api/slots'){
    const day=url.searchParams.get('date');if(!validateDay(day,now()))error(400,'Choose a date within the next 90 days.');
    const occupied=new Set(db.prepare("SELECT start FROM bookings WHERE status='confirmed' AND start>=? AND start<?").all(day+'T00:00:00Z',new Date(Date.parse(day+'T00:00:00Z')+172800000).toISOString()).map(b=>b.start));
    return send(200,{date:day,timezone:POLICY.timezone,slots:slotsForDay(day,now()).map(s=>({...s,available:!occupied.has(s.start)}))});
   }
   if(req.method==='POST'&&url.pathname==='/api/bookings'){
    const b=await readBody();
    if(!b||typeof b!=='object')error(400,'Invalid booking.');
    const name=typeof b.name==='string'?b.name.trim():'';const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
    if(name.length<2||name.length>100||/[\u0000-\u001f]/.test(name))error(400,'Enter a name between 2 and 100 characters.');
    if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))error(400,'Enter a valid email address.');
    if(!UUID.test(b.idempotency||''))error(400,'Refresh the page and try again.');
    let total;try{total=priceFor(b.type,b.count);}catch(e){error(400,e.message);}
    const fingerprint=createHash('sha256').update(JSON.stringify([b.date,b.start,b.type,b.count,name,email])).digest('hex');
    const previous=db.prepare('SELECT * FROM bookings WHERE idempotency=?').get(b.idempotency);
    if(previous){if(previous.fingerprint!==fingerprint)error(409,'This request was already used for a different booking.');return send(200,{booking:publicBooking(previous),manageToken:managementToken(previous.id)});}
    const slot=slotsForDay(b.date,now()).find(s=>s.start===b.start);if(!slot)error(400,'Choose an available future session within academy hours.');
    const booking={id:randomUUID(),start:slot.start,end:slot.end,type:b.type,count:b.count,total,name,email,status:'confirmed',created:now().toISOString(),idempotency:b.idempotency,fingerprint};
    try{db.prepare('INSERT INTO bookings (id,start,end,type,count,total,name,email,status,created,idempotency,fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(booking));}catch(e){if(String(e.message).includes('UNIQUE'))error(409,'That hour was just booked. Please choose another time.');throw e;}
    return send(201,{booking:publicBooking(booking),manageToken:managementToken(booking.id)});
   }
   const match=url.pathname.match(/^\/api\/bookings\/([0-9a-f-]{36})(\/cancel)?$/i);
   if(match){
    if(!equal(req.headers['x-booking-token']||'',managementToken(match[1])))error(404,'Booking not found. Use your saved confirmation link.');
    const b=db.prepare('SELECT * FROM bookings WHERE id=?').get(match[1]);if(!b)error(404,'Booking not found.');
    if(req.method==='GET'&&!match[2])return send(200,{booking:publicBooking(b)});
    if(req.method==='POST'&&match[2]){if(Date.parse(b.start)<=now().getTime())error(400,'Past sessions cannot be cancelled.');db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(b.id);return send(200,{booking:{...publicBooking(b),status:'cancelled'}});}
   }
   if(req.method==='GET'&&url.pathname==='/api/admin/bookings'){admin();return send(200,{bookings:db.prepare('SELECT id,start,end,type,count,total,name,email,status,created FROM bookings ORDER BY start DESC LIMIT 2000').all()});}
   const adminCancel=url.pathname.match(/^\/api\/admin\/bookings\/([0-9a-f-]{36})\/cancel$/i);
   if(req.method==='POST'&&adminCancel){admin();db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(adminCancel[1]);return send(200,{ok:true});}
   if(req.method==='GET'&&url.pathname==='/api/admin/export'){admin();return send(200,{exportedAt:now().toISOString(),bookings:db.prepare('SELECT * FROM bookings ORDER BY start').all()});}
   if(url.pathname.startsWith('/api/'))return send(404,{error:'Not found.'});
   if(req.method!=='GET'&&req.method!=='HEAD')return send(405,{error:'Method not allowed.'});
   if(url.pathname==='/booking-config.js'){res.writeHead(200,{...h,'Content-Type':'application/javascript'});return res.end('window.SWA_BOOKING_API = location.origin;');}
   const assets={'/':['index.html','text/html'],'/index.html':['index.html','text/html'],'/booking.html':['booking.html','text/html'],'/admin.html':['admin.html','text/html'],'/booking.js':['booking.js','application/javascript'],'/booking-link.js':['booking-link.js','application/javascript'],'/booking.css':['booking.css','text/css'],'/admin.js':['admin.js','application/javascript'],'/globe-soccer-ball.webp':['globe-soccer-ball.webp','image/webp']};
   const asset=assets[url.pathname];if(!asset)return send(404,{error:'Not found.'});
   const bytes=readFileSync(join(root,'public',asset[0]));res.writeHead(200,{...h,'Content-Type':asset[1]});res.end(req.method==='HEAD'?undefined:bytes);
  }catch(e){if(e.status)return send(e.status,{error:e.message});console.error('Request failed:',e.code||'internal');return send(500,{error:'We could not complete that request. Please try again.'});}
 });
 server.on('close',()=>db.close());
 return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.env.NODE_ENV==='production'&&!(process.env.DB_PATH||'').startsWith('/var/data/'))throw new Error('Production requires DB_PATH under the persistent /var/data disk.');
 const server=createApp();server.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Academy booking server ready.'));
 process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
}
