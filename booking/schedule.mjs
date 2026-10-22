export const TIMEZONE = 'America/Indiana/Indianapolis';
export const POLICY = Object.freeze({timezone:TIMEZONE,durationMinutes:60,privatePrice:50,groupPricePerPerson:20,groupMinimum:11,location:'Lawrence Park, Indianapolis, IN',hours:{weekdays:'6–8 PM',saturday:'2–6 PM',sunday:'2–5 PM'}});
const partsFormatter = new Intl.DateTimeFormat('en-CA',{timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function localParts(date){return Object.fromEntries(partsFormatter.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));}
export function localDay(date=new Date()){const p=localParts(date);return `${p.year}-${p.month}-${p.day}`;}
export function validateDay(day,now=new Date()){
 if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;
 const stamp=Date.parse(day+'T12:00:00Z');
 if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==day)return false;
 const diff=(Date.parse(day+'T00:00:00Z')-Date.parse(localDay(now)+'T00:00:00Z'))/86400000;
 return diff>=0&&diff<=90;
}
export function localHourToUTC(day,hour){
 const desired=Date.parse(`${day}T${String(hour).padStart(2,'0')}:00:00Z`);
 let value=desired;
 for(let i=0;i<3;i++){
  const p=localParts(new Date(value));
  const actual=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
  value+=desired-actual;
 }
 return new Date(value).toISOString();
}
export function slotsForDay(day,now=new Date()){
 if(!validateDay(day,now))return [];
 const weekday=new Date(day+'T12:00:00Z').getUTCDay();
 const [start,end]=weekday===6?[14,18]:weekday===0?[14,17]:[18,20];
 return Array.from({length:end-start},(_,i)=>{const hour=start+i;return {start:localHourToUTC(day,hour),end:localHourToUTC(day,hour+1),label:`${hour>12?hour-12:hour}:00–${hour+1>12?hour-11:hour+1}:00 PM`};}).filter(s=>Date.parse(s.start)>now.getTime());
}
export function priceFor(type,count){
 if(type==='private'&&count===1)return 50;
 if(type==='group'&&Number.isSafeInteger(count)&&count>=11&&count<=1000)return 20*count;
 throw new Error(type==='group'?'Group bookings require at least 11 players.':'A private lesson is for one player.');
}
