import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { prisma } from './db.js';
import { hashPassword, verifyPassword, signToken, requireAuth } from './auth.js';
import { registerSchema, loginSchema, readingSchema, lifestyleSchema, medicationSchema, parse } from './validators.js';

export const app = express();

// Ephemeral presence: no medical or account data is persisted for presence.
const presence = new Map();
const PRESENCE_TTL_MS = 75_000;

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const slots = ['MORNING','AFTER_BREAKFAST','AFTER_LUNCH','AFTER_DINNER'];
const slotLabels = { MORNING:'Morning (fasting)', AFTER_BREAKFAST:'After breakfast', AFTER_LUNCH:'After lunch', AFTER_DINNER:'After dinner' };
const dateOnly = (s) => new Date(`${s}T00:00:00.000Z`);
const todayUTC = () => new Date().toISOString().slice(0,10);
const ownedReading = (id, userId) => prisma.reading.findFirst({ where: { id, userId } });
function requireRole(role){return (req,res,next)=>req.user.role===role?next():res.status(403).json({error:`This feature is available to ${role.toLowerCase()} accounts only.`});}

app.get('/api/health', (_req,res) => res.json({ status:'ok', service:'Sweety API' }));

// Lightweight heartbeat used by the patient/doctor chat presence indicators.
app.post('/api/presence/heartbeat', requireAuth, (req,res) => {
  const active = req.body?.active !== false && req.body?.visible !== false;
  presence.set(req.user.id, { lastSeen: Date.now(), active });
  res.json({ success:true });
});

app.get('/api/presence', requireAuth, async (req,res,next) => {
  try {
    const ids = [...new Set(String(req.query.ids || '').split(',').filter(Boolean))].slice(0,50);
    if (!ids.length) return res.json({ items:{} });
    const links = await prisma.doctorPatientConnection.findMany({
      where:{ status:'ACCEPTED', OR:[
        { doctorId:req.user.id, patientId:{ in:ids } },
        { patientId:req.user.id, doctorId:{ in:ids } }
      ]},
      select:{ doctorId:true, patientId:true }
    });
    const allowed = new Set(links.map(x => x.doctorId===req.user.id ? x.patientId : x.doctorId));
    const now = Date.now(), items = {};
    for (const id of ids) {
      if (!allowed.has(id)) continue;
      const p = presence.get(id);
      const age = p ? now-p.lastSeen : Infinity;
      items[id] = age > PRESENCE_TTL_MS ? { status:'OFFLINE', lastSeen:p?.lastSeen || null }
        : !p.active ? { status:'AWAY', lastSeen:p.lastSeen }
        : { status:'ONLINE', lastSeen:p.lastSeen };
    }
    res.json({ items });
  } catch(e) { next(e); }
});

// Recent inbound messages for accepted care connections, polled by each signed-in user.
app.get('/api/messages/inbox', requireAuth, async (req,res,next) => {
  try {
    const links = await prisma.doctorPatientConnection.findMany({
      where:{ status:'ACCEPTED', OR:[{doctorId:req.user.id},{patientId:req.user.id}] },
      select:{ doctorId:true, patientId:true }
    });
    const peerIds = links.map(x => x.doctorId===req.user.id ? x.patientId : x.doctorId);
    if (!peerIds.length) return res.json({ items:[] });
    const items = await prisma.consultationMessage.findMany({
      where:{ recipientId:req.user.id, senderId:{in:peerIds} },
      include:{ sender:{select:{id:true,name:true,role:true}} },
      orderBy:{createdAt:'desc'}, take:100
    });
    res.json({items});
  } catch(e) { next(e); }
});

app.post('/api/auth/register', authLimiter, async (req,res,next) => { try {
  const data = parse(registerSchema, req.body); const email = data.email.toLowerCase();
  if (await prisma.user.findUnique({ where:{email} })) return res.status(409).json({ error:'An account with this email already exists.' });
  const user = await prisma.user.create({ data:{ name:data.name, email, role:req.body.role==='DOCTOR'?'DOCTOR':'PATIENT', passwordHash:await hashPassword(data.password), ...(req.body.role==='DOCTOR'?{doctorProfile:{create:{specialty:String(req.body.specialty||'General practice').slice(0,100),clinicName:String(req.body.clinicName||'').slice(0,120)||null,bio:String(req.body.bio||'').slice(0,1000)||null}}}:{}) }, select:{id:true,name:true,email:true,language:true,role:true,createdAt:true} });
  res.status(201).json({ user, token:signToken(user) });
} catch(e){next(e);} });
app.post('/api/auth/login', authLimiter, async (req,res,next) => { try {
  const data = parse(loginSchema, req.body); const user = await prisma.user.findUnique({ where:{email:data.email.toLowerCase()} });
  if (!user || !(await verifyPassword(data.password,user.passwordHash))) return res.status(401).json({error:'Email or password is incorrect.'});
  const safe = {id:user.id,name:user.name,email:user.email,language:user.language,role:user.role,createdAt:user.createdAt}; res.json({user:safe,token:signToken(user)});
} catch(e){next(e);} });
app.get('/api/auth/me', requireAuth, (req,res)=>res.json({user:req.user}));
app.patch('/api/auth/profile', requireAuth, async(req,res,next)=>{try { const language = ['en','te','hi'].includes(req.body.language) ? req.body.language : 'en'; const name = typeof req.body.name==='string' && req.body.name.trim() ? req.body.name.trim().slice(0,80) : req.user.name; const user=await prisma.user.update({where:{id:req.user.id},data:{language,name},select:{id:true,name:true,email:true,language:true,role:true,createdAt:true}});res.json({user});}catch(e){next(e);}});

app.get('/api/readings', requireAuth,requireRole('PATIENT'), async(req,res,next)=>{try{
  const page=Math.max(1,Number(req.query.page)||1), limit=Math.min(100,Math.max(1,Number(req.query.limit)||20));
  const where={userId:req.user.id}; if(req.query.from||req.query.to) where.date={...(req.query.from?{gte:dateOnly(req.query.from)}:{}),...(req.query.to?{lte:dateOnly(req.query.to)}:{})}; if(req.query.slot&&slots.includes(req.query.slot)) where.slot=req.query.slot;
  const [items,total]=await Promise.all([prisma.reading.findMany({where,orderBy:[{date:'desc'},{createdAt:'desc'}],skip:(page-1)*limit,take:limit}),prisma.reading.count({where})]); res.json({items,total,page,limit,pages:Math.ceil(total/limit)});
}catch(e){next(e);}});
app.post('/api/readings', requireAuth,requireRole('PATIENT'), async(req,res,next)=>{try{
  const d=parse(readingSchema,req.body); if(d.date>todayUTC()) return res.status(400).json({error:'Date cannot be in the future.'});
  const day=dateOnly(d.date); const existing=await prisma.reading.findMany({where:{userId:req.user.id,date:day}});
  if(existing.some(x=>x.slot===d.slot)) return res.status(409).json({error:`You already have an ${slotLabels[d.slot]} reading for this date.`});
  if(existing.length>=4) return res.status(400).json({error:'You can add only 4 readings per day.'});
  const item=await prisma.reading.create({data:{...d,date:day,userId:req.user.id}}); res.status(201).json({item});
}catch(e){ if(e.code==='P2002') return res.status(409).json({error:'A reading already exists for this time slot and date.'}); next(e);}});
app.get('/api/readings/:id', requireAuth,requireRole('PATIENT'), async(req,res,next)=>{try{const item=await ownedReading(req.params.id,req.user.id);if(!item)return res.status(404).json({error:'Reading not found.'});res.json({item});}catch(e){next(e);}});
app.put('/api/readings/:id', requireAuth,requireRole('PATIENT'), async(req,res,next)=>{try{
  const d=parse(readingSchema,req.body); if(d.date>todayUTC()) return res.status(400).json({error:'Date cannot be in the future.'});
  if(!await ownedReading(req.params.id,req.user.id)) return res.status(404).json({error:'Reading not found.'});
  const day=dateOnly(d.date); const conflict=await prisma.reading.findFirst({where:{userId:req.user.id,date:day,slot:d.slot,id:{not:req.params.id}}}); if(conflict)return res.status(409).json({error:`You already have an ${slotLabels[d.slot]} reading for this date.`});
  const item=await prisma.reading.update({where:{id:req.params.id},data:{...d,date:day}});res.json({item});
}catch(e){if(e.code==='P2002')return res.status(409).json({error:'A reading already exists for this time slot and date.'});next(e);}});
app.delete('/api/readings/:id', requireAuth,requireRole('PATIENT'), async(req,res,next)=>{try{const item=await ownedReading(req.params.id,req.user.id);if(!item)return res.status(404).json({error:'Reading not found.'});await prisma.reading.delete({where:{id:item.id}});res.json({success:true});}catch(e){next(e);}});

async function reportFor(userId,from,to){const readings=await prisma.reading.findMany({where:{userId,date:{gte:dateOnly(from),lte:dateOnly(to)}},orderBy:[{date:'asc'},{slot:'asc'}]});const values=readings.map(x=>x.value);return {from,to,count:values.length,highest:values.length?Math.max(...values):null,lowest:values.length?Math.min(...values):null,average:values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length*10)/10:null,readings};}
app.get('/api/reports/daily',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{try{const d=req.query.date||todayUTC();res.json(await reportFor(req.user.id,d,d));}catch(e){next(e);}});
app.get('/api/reports/month-to-date',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{try{const d=req.query.date||todayUTC();const from=`${d.slice(0,7)}-01`;res.json(await reportFor(req.user.id,from,d));}catch(e){next(e);}});
app.get('/api/reports/monthly',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{try{const now=new Date(`${(req.query.date||todayUTC())}T00:00:00Z`);const first=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1));const last=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),0));res.json(await reportFor(req.user.id,first.toISOString().slice(0,10),last.toISOString().slice(0,10)));}catch(e){next(e);}});
app.get('/api/reports/insights',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{try{const from=new Date();from.setUTCDate(from.getUTCDate()-29);const readings=await prisma.reading.findMany({where:{userId:req.user.id,date:{gte:dateOnly(from.toISOString().slice(0,10)),lte:dateOnly(todayUTC())}}});const bySlot=Object.fromEntries(slots.map(s=>{const a=readings.filter(r=>r.slot===s).map(r=>r.value);return [s,{count:a.length,average:a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length*10)/10:null}]}));const days=new Set(readings.map(r=>r.date.toISOString().slice(0,10))).size;const expected=30*4;const consistency=Math.round(readings.length/expected*100);const insights=[];if(readings.length)insights.push(`You recorded ${readings.length} readings across ${days} days in the last 30 days.`);const populated=Object.entries(bySlot).filter(([,v])=>v.count);if(populated.length>1){const high=populated.sort((a,b)=>b[1].average-a[1].average)[0];insights.push(`${slotLabels[high[0]]} has your highest average among the recorded time slots.`);}const sparse=Object.entries(bySlot).filter(([,v])=>v.count<3).map(([s])=>slotLabels[s]);if(sparse.length)insights.push(`There is limited data for: ${sparse.join(', ')}. More consistent recording can make comparisons more useful.`);res.json({bySlot,days,readings:readings.length,consistency:Math.min(100,consistency),insights});}catch(e){next(e);}});

app.get('/api/lifestyle',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{try{const items=await prisma.lifestyleEntry.findMany({where:{userId:req.user.id},orderBy:{occurredAt:'desc'},take:100});res.json({items});}catch(e){next(e);}});
app.post('/api/lifestyle',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{try{const d=parse(lifestyleSchema,req.body);const item=await prisma.lifestyleEntry.create({data:{...d,userId:req.user.id,occurredAt:new Date(d.occurredAt)}});res.status(201).json({item});}catch(e){next(e);}});
app.delete('/api/lifestyle/:id',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{try{const result=await prisma.lifestyleEntry.deleteMany({where:{id:req.params.id,userId:req.user.id}});if(!result.count)return res.status(404).json({error:'Entry not found.'});res.json({success:true});}catch(e){next(e);}});
app.get('/api/timeline',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{try{const [readings,lifestyle]=await Promise.all([prisma.reading.findMany({where:{userId:req.user.id},orderBy:{date:'desc'},take:50}),prisma.lifestyleEntry.findMany({where:{userId:req.user.id},orderBy:{occurredAt:'desc'},take:50})]);const items=[...readings.map(x=>({...x,type:'READING',occurredAt:x.date})),...lifestyle.map(x=>({...x,type:x.type,occurredAt:x.occurredAt}))].sort((a,b)=>new Date(b.occurredAt)-new Date(a.occurredAt));res.json({items});}catch(e){next(e);}});

app.get('/api/medications',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{try{const items=await prisma.medication.findMany({where:{userId:req.user.id},include:{doses:{where:{active:true},orderBy:{time:'asc'}}},orderBy:{createdAt:'desc'}});res.json({items});}catch(e){next(e);}});
app.post('/api/medications',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{try{const d=parse(medicationSchema,req.body);const item=await prisma.medication.create({data:{...d,userId:req.user.id}});res.status(201).json({item});}catch(e){next(e);}});
app.patch('/api/medications/:id',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{try{const result=await prisma.medication.updateMany({where:{id:req.params.id,userId:req.user.id},data:{active:Boolean(req.body.active)}});if(!result.count)return res.status(404).json({error:'Medication not found.'});const item=await prisma.medication.findUnique({where:{id:req.params.id},include:{doses:true}});res.json({item});}catch(e){next(e);}});
app.delete('/api/medications/:id',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{try{const result=await prisma.medication.deleteMany({where:{id:req.params.id,userId:req.user.id}});if(!result.count)return res.status(404).json({error:'Medication not found.'});res.json({success:true});}catch(e){next(e);}});

// Medication dose schedules and date-specific adherence logs.
const validDoseTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const validDoseDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10) === value;
};

app.get('/api/medication-doses',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{
  try {
    const date = req.query.date || todayUTC();
    if (!validDoseDate(date)) return res.status(400).json({error:'Please provide a valid date in YYYY-MM-DD format.'});
    const items = await prisma.medicationDose.findMany({
      where:{active:true,medication:{userId:req.user.id,active:true}},
      include:{medication:{select:{id:true,name:true,dosage:true}},logs:{where:{date:dateOnly(date)}}},
      orderBy:[{time:'asc'},{createdAt:'asc'}]
    });
    res.json({date,items:items.map(d=>({...d,status:d.logs[0]?.status||'NOT_RECORDED',takenAt:d.logs[0]?.takenAt||null}))});
  } catch(e) { next(e); }
});

app.post('/api/medications/:id/doses',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{
  try {
    const {label,time,quantity} = req.body || {};
    if (typeof label!=='string'||!label.trim()||label.trim().length>60) return res.status(400).json({error:'Enter a dose label (up to 60 characters).'});
    if (!validDoseTime(time)) return res.status(400).json({error:'Enter a valid dose time in HH:MM format.'});
    if (typeof quantity!=='string'||!quantity.trim()||quantity.trim().length>80) return res.status(400).json({error:'Enter the prescribed dose quantity.'});
    const medication = await prisma.medication.findFirst({where:{id:req.params.id,userId:req.user.id}});
    if (!medication) return res.status(404).json({error:'Medication not found.'});
    const item = await prisma.medicationDose.create({data:{medicationId:medication.id,label:label.trim(),time,quantity:quantity.trim()}});
    res.status(201).json({item});
  } catch(e) { next(e); }
});

app.patch('/api/medication-doses/:id',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{
  try {
    const dose = await prisma.medicationDose.findFirst({where:{id:req.params.id,medication:{userId:req.user.id}}});
    if (!dose) return res.status(404).json({error:'Dose schedule not found.'});
    const data = {};
    if (req.body.label !== undefined) {
      if (typeof req.body.label!=='string'||!req.body.label.trim()||req.body.label.trim().length>60) return res.status(400).json({error:'Invalid dose label.'});
      data.label=req.body.label.trim();
    }
    if (req.body.time !== undefined) {
      if (!validDoseTime(req.body.time)) return res.status(400).json({error:'Invalid dose time.'});
      data.time=req.body.time;
    }
    if (req.body.quantity !== undefined) {
      if (typeof req.body.quantity!=='string'||!req.body.quantity.trim()||req.body.quantity.trim().length>80) return res.status(400).json({error:'Invalid dose quantity.'});
      data.quantity=req.body.quantity.trim();
    }
    if (req.body.active !== undefined) data.active=Boolean(req.body.active);
    const item=await prisma.medicationDose.update({where:{id:dose.id},data});
    res.json({item});
  } catch(e) { next(e); }
});

app.put('/api/medication-doses/:id/log',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{
  try {
    const date=req.body.date||todayUTC();
    const status=req.body.status;
    if (!validDoseDate(date)) return res.status(400).json({error:'Please provide a valid date in YYYY-MM-DD format.'});
    if (!['TAKEN','NOT_TAKEN'].includes(status)) return res.status(400).json({error:'Choose Taken or Not taken.'});
    const dose=await prisma.medicationDose.findFirst({where:{id:req.params.id,active:true,medication:{userId:req.user.id,active:true}}});
    if (!dose) return res.status(404).json({error:'Active dose schedule not found.'});
    const item=await prisma.medicationDoseLog.upsert({
      where:{doseId_date:{doseId:dose.id,date:dateOnly(date)}},
      create:{doseId:dose.id,date:dateOnly(date),status,takenAt:status==='TAKEN'?new Date():null},
      update:{status,takenAt:status==='TAKEN'?new Date():null}
    });
    res.json({item});
  } catch(e) { next(e); }
});

app.get('/api/medication-history',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{
  try {
    const from=req.query.from;
    const to=req.query.to;
    if ((from&&!validDoseDate(from))||(to&&!validDoseDate(to))) return res.status(400).json({error:'Dates must use YYYY-MM-DD format.'});
    const items=await prisma.medicationDoseLog.findMany({
      where:{dose:{medication:{userId:req.user.id}},...(from||to?{date:{...(from?{gte:dateOnly(from)}:{}),...(to?{lte:dateOnly(to)}:{})}}:{})},
      include:{dose:{include:{medication:{select:{id:true,name:true}}}}},
      orderBy:{date:'desc'},take:500
    });
    res.json({items});
  } catch(e) { next(e); }
});

// Appointment requests are private to the requesting patient. This endpoint records a
// request only; it never claims a clinician has accepted or confirmed the booking.
app.get('/api/appointments', requireAuth,requireRole('PATIENT'), async (req,res,next)=>{try{
  const items=await prisma.appointmentRequest.findMany({where:{userId:req.user.id},orderBy:{createdAt:'desc'},take:50});
  res.json({items});
}catch(e){next(e);}});
app.post('/api/appointments', requireAuth,requireRole('PATIENT'), async (req,res,next)=>{try{
  const doctorUserId=String(req.body.doctorUserId||'').trim()||null;
  const linkedDoctor=doctorUserId?await prisma.user.findFirst({where:{id:doctorUserId,role:'DOCTOR'},include:{doctorProfile:true}}):null;
  if(doctorUserId&&!linkedDoctor)return res.status(404).json({error:'Doctor account not found.'});
  const doctorName=linkedDoctor?linkedDoctor.name:String(req.body.doctorName||'').trim().slice(0,100);
  const clinicName=String(req.body.clinicName||'').trim().slice(0,120)||null;
  const specialty=String(req.body.specialty||'').trim().slice(0,100)||null;
  const contactPhone=String(req.body.contactPhone||'').trim().slice(0,40)||null;
  const contactEmail=String(req.body.contactEmail||'').trim().slice(0,160)||null;
  const visitType=String(req.body.visitType||'');
  const reason=String(req.body.reason||'').trim().slice(0,1000);
  const preferredAt=new Date(req.body.preferredAt);
  if(!doctorName||!reason||!['PHONE','CLINIC','ONLINE'].includes(visitType)||!req.body.preferredAt||Number.isNaN(preferredAt.getTime()))
    return res.status(400).json({error:'Please provide a clinician name, visit type, valid preferred date and reason.'});
  if(preferredAt.getTime()<Date.now()-60000) return res.status(400).json({error:'Please choose a future appointment time.'});
  const item=await prisma.appointmentRequest.create({data:{userId:req.user.id,doctorName,clinicName:linkedDoctor?.doctorProfile?.clinicName||clinicName,specialty:linkedDoctor?.doctorProfile?.specialty||specialty,doctorUserId,contactPhone,contactEmail,visitType,preferredAt,reason}});
  res.status(201).json({item,message:'Your request has been saved as pending. The clinic must confirm it separately.'});
}catch(e){next(e);}});
app.delete('/api/appointments/:id', requireAuth,requireRole('PATIENT'), async(req,res,next)=>{try{
  const result=await prisma.appointmentRequest.deleteMany({where:{id:req.params.id,userId:req.user.id,status:'PENDING'}});
  if(!result.count)return res.status(404).json({error:'Pending appointment request not found.'});
  res.json({success:true});
}catch(e){next(e);}});

// DOCTOR DIRECTORY AND CONSENT-BASED CARE CONNECTIONS
app.get('/api/doctors', requireAuth, async(req,res,next)=>{try{
 const items=await prisma.doctorProfile.findMany({include:{user:{select:{id:true,name:true,email:true}}},orderBy:{createdAt:'desc'},take:100});
 res.json({items:items.map(x=>({id:x.user.id,name:x.user.name,email:x.user.email,specialty:x.specialty,clinicName:x.clinicName,bio:x.bio,verified:x.verified}))});
}catch(e){next(e);}});
app.get('/api/doctor/profile',requireAuth,requireRole('DOCTOR'),async(req,res,next)=>{try{const profile=await prisma.doctorProfile.findUnique({where:{userId:req.user.id}});res.json({profile});}catch(e){next(e);}});
app.patch('/api/doctor/profile',requireAuth,requireRole('DOCTOR'),async(req,res,next)=>{try{const profile=await prisma.doctorProfile.update({where:{userId:req.user.id},data:{specialty:String(req.body.specialty||'').trim().slice(0,100),clinicName:String(req.body.clinicName||'').trim().slice(0,120)||null,bio:String(req.body.bio||'').trim().slice(0,1000)||null,phone:String(req.body.phone||'').trim().slice(0,40)||null}});res.json({profile});}catch(e){next(e);}});
app.get('/api/connections',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{try{const items=await prisma.doctorPatientConnection.findMany({where:{patientId:req.user.id},include:{doctor:{select:{id:true,name:true,doctorProfile:{select:{specialty:true,clinicName:true}}}}},orderBy:{createdAt:'desc'}});res.json({items});}catch(e){next(e);}});
app.post('/api/connections',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{try{const doctorId=String(req.body.doctorId||'');const doctor=await prisma.user.findFirst({where:{id:doctorId,role:'DOCTOR',doctorProfile:{verified:true}}});if(!doctor)return res.status(404).json({error:'Verified doctor not found.'});const item=await prisma.doctorPatientConnection.upsert({where:{doctorId_patientId:{doctorId,patientId:req.user.id}},create:{doctorId,patientId:req.user.id,status:'PENDING'},update:{status:'PENDING',consentedAt:null}});res.status(201).json({item});}catch(e){next(e);}});
app.get('/api/doctor/patients',requireAuth,requireRole('DOCTOR'),async(req,res,next)=>{try{const items=await prisma.doctorPatientConnection.findMany({where:{doctorId:req.user.id},include:{patient:{select:{id:true,name:true,email:true}}},orderBy:{createdAt:'desc'}});res.json({items});}catch(e){next(e);}});
app.patch('/api/doctor/connections/:id',requireAuth,requireRole('DOCTOR'),async(req,res,next)=>{try{const status=req.body.status;if(!['ACCEPTED','DECLINED'].includes(status))return res.status(400).json({error:'Choose ACCEPTED or DECLINED.'});const result=await prisma.doctorPatientConnection.updateMany({where:{id:req.params.id,doctorId:req.user.id},data:{status,consentedAt:status==='ACCEPTED'?new Date():null}});if(!result.count)return res.status(404).json({error:'Connection request not found.'});res.json({success:true});}catch(e){next(e);}});
app.delete('/api/connections/:id',requireAuth,async(req,res,next)=>{try{const where=req.user.role==='DOCTOR'?{id:req.params.id,doctorId:req.user.id}:{id:req.params.id,patientId:req.user.id};const r=await prisma.doctorPatientConnection.deleteMany({where});if(!r.count)return res.status(404).json({error:'Connection not found.'});res.json({success:true});}catch(e){next(e);}});
app.get('/api/doctor/patients/:patientId/summary',requireAuth,requireRole('DOCTOR'),async(req,res,next)=>{try{const connection=await prisma.doctorPatientConnection.findFirst({where:{doctorId:req.user.id,patientId:req.params.patientId,status:'ACCEPTED'}});if(!connection)return res.status(403).json({error:'Patient has not granted access to their records.'});const [patient,readings,lifestyle,appointments]=await Promise.all([prisma.user.findUnique({where:{id:req.params.patientId},select:{id:true,name:true,email:true}}),prisma.reading.findMany({where:{userId:req.params.patientId},orderBy:{date:'desc'},take:100}),prisma.lifestyleEntry.findMany({where:{userId:req.params.patientId},orderBy:{occurredAt:'desc'},take:50}),prisma.appointmentRequest.findMany({where:{userId:req.params.patientId,doctorUserId:req.user.id},orderBy:{preferredAt:'desc'}})]);res.json({patient,readings,lifestyle,appointments});}catch(e){next(e);}});
app.get('/api/doctor/appointments',requireAuth,requireRole('DOCTOR'),async(req,res,next)=>{try{const items=await prisma.appointmentRequest.findMany({where:{doctorUserId:req.user.id},include:{user:{select:{id:true,name:true,email:true}}},orderBy:{preferredAt:'asc'}});res.json({items});}catch(e){next(e);}});
app.patch('/api/doctor/appointments/:id',requireAuth,requireRole('DOCTOR'),async(req,res,next)=>{try{const status=String(req.body.status||'');if(!['CONFIRMED','DECLINED','CANCELLED','COMPLETED','RESCHEDULED'].includes(status))return res.status(400).json({error:'Invalid appointment status.'});const existing=await prisma.appointmentRequest.findFirst({where:{id:req.params.id,doctorUserId:req.user.id}});if(!existing)return res.status(404).json({error:'Appointment not found for this doctor.'});const result=await prisma.appointmentRequest.update({where:{id:req.params.id},data:{status,updatedByDoctorAt:new Date(),...(req.body.preferredAt?{preferredAt:new Date(req.body.preferredAt)}:{}),...(status==='CONFIRMED'&&existing.visitType==='ONLINE'?{meetingUrl:`https://meet.jit.si/sweety-${req.params.id}-${Date.now()}`}:{})}});const item=await prisma.appointmentRequest.findUnique({where:{id:req.params.id},include:{user:{select:{id:true,name:true,email:true}}}});res.json({item});}catch(e){next(e);}});
app.post('/api/doctor/appointments/:id/notes',requireAuth,requireRole('DOCTOR'),async(req,res,next)=>{try{const a=await prisma.appointmentRequest.findFirst({where:{id:req.params.id,doctorUserId:req.user.id}});if(!a)return res.status(404).json({error:'Appointment not found.'});const content=String(req.body.content||'').trim().slice(0,5000);if(!content)return res.status(400).json({error:'Enter consultation notes.'});const item=await prisma.consultationNote.create({data:{doctorId:req.user.id,patientId:a.userId,appointmentId:a.id,content}});res.status(201).json({item});}catch(e){next(e);}});
app.get('/api/messages/:otherUserId',requireAuth,async(req,res,next)=>{try{const other=req.params.otherUserId;const connected=await prisma.doctorPatientConnection.findFirst({where:{status:'ACCEPTED',OR:[{doctorId:req.user.id,patientId:other},{doctorId:other,patientId:req.user.id}]}});if(!connected)return res.status(403).json({error:'Messaging requires an accepted patient–doctor connection.'});const items=await prisma.consultationMessage.findMany({where:{OR:[{senderId:req.user.id,recipientId:other},{senderId:other,recipientId:req.user.id}]},orderBy:{createdAt:'desc'},take:200});items.reverse();res.json({items});}catch(e){next(e);}});
app.post('/api/messages/:otherUserId',requireAuth,async(req,res,next)=>{try{const other=req.params.otherUserId;const connected=await prisma.doctorPatientConnection.findFirst({where:{status:'ACCEPTED',OR:[{doctorId:req.user.id,patientId:other},{doctorId:other,patientId:req.user.id}]}});if(!connected)return res.status(403).json({error:'Messaging requires an accepted patient–doctor connection.'});const content=String(req.body.content||'').trim().slice(0,4000);if(!content)return res.status(400).json({error:'Message cannot be empty.'});const item=await prisma.consultationMessage.create({data:{senderId:req.user.id,recipientId:other,content}});res.status(201).json({item});}catch(e){next(e);}});
app.get('/api/doctor/notes',requireAuth,requireRole('DOCTOR'),async(req,res,next)=>{try{const items=await prisma.consultationNote.findMany({where:{doctorId:req.user.id},include:{patient:{select:{id:true,name:true}}},orderBy:{createdAt:'desc'},take:100});res.json({items});}catch(e){next(e);}});
app.get('/api/patient/notes',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{try{const items=await prisma.consultationNote.findMany({where:{patientId:req.user.id,visibleToPatient:true},include:{doctor:{select:{id:true,name:true}}},orderBy:{createdAt:'desc'}});res.json({items});}catch(e){next(e);}});

app.get('/api/privacy/export',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{try{const [user,readings,lifestyle,medications,appointments]=await Promise.all([prisma.user.findUnique({where:{id:req.user.id},select:{id:true,name:true,email:true,language:true,role:true,createdAt:true}}),prisma.reading.findMany({where:{userId:req.user.id}}),prisma.lifestyleEntry.findMany({where:{userId:req.user.id}}),prisma.medication.findMany({where:{userId:req.user.id}}),prisma.appointmentRequest.findMany({where:{userId:req.user.id}})]);res.json({exportedAt:new Date().toISOString(),user,readings,lifestyle,medications,appointments});}catch(e){next(e);}});
app.delete('/api/privacy/account',requireAuth,requireRole('PATIENT'),async(req,res,next)=>{try{await prisma.user.delete({where:{id:req.user.id}});res.json({success:true});}catch(e){next(e);}});


// ADMIN API ROUTES
// Admin access is restricted to platform-level metadata.
// Patient medical records are intentionally excluded.

app.get('/api/admin/overview', requireAuth, requireRole('ADMIN'), async (_req, res, next) => {
  try {
    const [
      patients, doctors, admins,
      verifiedDoctors, pendingDoctors,
      appointments, connections, acceptedConnections
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'PATIENT' } }),
      prisma.user.count({ where: { role: 'DOCTOR' } }),
      prisma.user.count({ where: { role: 'ADMIN' } }),
      prisma.doctorProfile.count({ where: { verified: true } }),
      prisma.doctorProfile.count({ where: { verified: false } }),
      prisma.appointmentRequest.count(),
      prisma.doctorPatientConnection.count(),
      prisma.doctorPatientConnection.count({ where: { status: 'ACCEPTED' } })
    ]);

    res.json({
      users: { patients, doctors, admins, total: patients + doctors + admins },
      doctors: { verified: verifiedDoctors, pending: pendingDoctors },
      appointments,
      connections: { total: connections, accepted: acceptedConnections }
    });
  } catch (e) { next(e); }
});

app.get('/api/admin/doctors', requireAuth, requireRole('ADMIN'), async (_req, res, next) => {
  try {
    const items = await prisma.doctorProfile.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        specialty: true,
        clinicName: true,
        bio: true,
        phone: true,
        verified: true,
        createdAt: true,
        user: {
          select: { id: true, name: true, email: true, createdAt: true }
        }
      }
    });
    res.json({ items });
  } catch (e) { next(e); }
});

app.patch('/api/admin/doctors/:doctorId/verification', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
  try {
    if (typeof req.body.verified !== 'boolean') {
      return res.status(400).json({ error: 'verified must be true or false.' });
    }

    const profile = await prisma.doctorProfile.findUnique({
      where: { userId: req.params.doctorId }
    });

    if (!profile) {
      return res.status(404).json({ error: 'Doctor profile not found.' });
    }

    const updated = await prisma.doctorProfile.update({
      where: { userId: req.params.doctorId },
      data: { verified: req.body.verified },
      select: {
        userId: true,
        specialty: true,
        verified: true,
        user: { select: { name: true, email: true } }
      }
    });

    res.json({ doctor: updated });
  } catch (e) { next(e); }
});

app.get('/api/admin/users', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const where = {};
    const role = String(req.query.role || '').toUpperCase();
    if (['PATIENT', 'DOCTOR', 'ADMIN'].includes(role)) where.role = role;

    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } }
      ];
    }

    const items = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true
      }
    });

    res.json({ items });
  } catch (e) { next(e); }
});


app.post('/api/assistant',requireAuth,requireRole('PATIENT'),async(req,res)=>{
  const question=String(req.body.question||'').trim().slice(0,1000);
  if(!question)return res.status(400).json({error:'Please enter a question.'});
  try {
    const [readings,lifestyle,medications,appointments]=await Promise.all([
      prisma.reading.findMany({where:{userId:req.user.id},orderBy:[{date:'desc'},{createdAt:'desc'}],take:100}),
      prisma.lifestyleEntry.findMany({where:{userId:req.user.id},orderBy:{occurredAt:'desc'},take:50}),
      prisma.medication.findMany({where:{userId:req.user.id,active:true},take:30}),
      prisma.appointmentRequest.findMany({where:{userId:req.user.id},orderBy:{createdAt:'desc'},take:20})
    ]);
    const q=question.toLowerCase();
    const slots={MORNING:'Morning fasting',AFTER_BREAKFAST:'After breakfast',AFTER_LUNCH:'After lunch',AFTER_DINNER:'After dinner'};
    const avg=a=>a.length?(a.reduce((x,y)=>x+y,0)/a.length).toFixed(1):null;
    const dkey=x=>{const d=new Date(x);return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10);};
    const date=x=>x?new Date(x).toLocaleDateString():'Date not recorded';
    const values=readings.map(x=>x.value);
    let answer=null;

    // Handle questions about records saved on a specific calendar date.
    const monthNames = {
      jan:1, january:1, feb:2, february:2, mar:3, march:3,
      apr:4, april:4, may:5, jun:6, june:6, jul:7, july:7,
      aug:8, august:8, sep:9, sept:9, september:9,
      oct:10, october:10, nov:11, november:11, dec:12, december:12
    };
    let requestedDate = null;
    const isoMatch = q.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    const dayFirstMatch = q.match(/\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(20\d{2}))?\b/);
    const monthFirstMatch = q.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/);

    if (isoMatch) {
      requestedDate = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    } else if (dayFirstMatch || monthFirstMatch) {
      const m = dayFirstMatch || monthFirstMatch;
      const day = Number(dayFirstMatch ? m[1] : m[2]);
      const month = monthNames[(dayFirstMatch ? m[2] : m[1]).toLowerCase()];
      const year = Number((dayFirstMatch ? m[3] : m[3]) || new Date().getFullYear());
      const candidate = new Date(Date.UTC(year, month - 1, day));
      if (candidate.getUTCFullYear() === year &&
          candidate.getUTCMonth() === month - 1 &&
          candidate.getUTCDate() === day) {
        requestedDate = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      }
    }

    if (requestedDate && /\b(report|records?|readings?|tracking|logged|saved|what\s+was)\b/.test(q)) {
      const start = new Date(`${requestedDate}T00:00:00.000Z`);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      const nextDate = end.toISOString().slice(0,10);

      const [dayReadings, dayLifestyle] = await Promise.all([
        prisma.reading.findMany({
          where: {userId:req.user.id, date:{gte:dateOnly(requestedDate),lt:dateOnly(nextDate)}},
          orderBy:{slot:'asc'}
        }),
        prisma.lifestyleEntry.findMany({
          where:{userId:req.user.id,occurredAt:{gte:start,lt:end}},
          orderBy:{occurredAt:'asc'}
        })
      ]);

      const dayValues = dayReadings.map(x=>x.value);
      const dayTypes = {MEAL:'Meal',ACTIVITY:'Activity',SLEEP:'Sleep',NOTE:'Note'};
      const readingLines = dayReadings.map(x =>
        `• ${slots[x.slot] || x.slot}: ${x.value} mg/dL${x.note ? ` — ${x.note}` : ''}`
      );
      const lifestyleLines = dayLifestyle.map(x =>
        `• ${dayTypes[x.type] || x.type}: ${x.title}${x.description ? ` — ${x.description}` : ''}`
      );

      answer = `Your Sweety report for ${date(requestedDate)}\n\n` +
        (dayReadings.length
          ? `Glucose readings (${dayReadings.length}):\n${readingLines.join('\n')}\n\nDaily average: ${avg(dayValues)} mg/dL\nHighest recorded: ${Math.max(...dayValues)} mg/dL\nLowest recorded: ${Math.min(...dayValues)} mg/dL`
          : 'No glucose readings were saved on this date.') +
        `\n\nLifestyle entries (${dayLifestyle.length}):\n` +
        (lifestyleLines.length ? lifestyleLines.join('\n') : 'No lifestyle entries were saved on this date.') +
        '\n\nThis is a factual summary of saved records, not a diagnosis or medical assessment.';

    } else if(/\b(doctor|clinician|physician)\b/.test(q)&&/\b(summary|summari[sz]e|share|report|prepare)\b/.test(q)){
      if(!readings.length) answer='You have not saved any glucose readings yet, so there is no glucose summary to share. Add readings first, then ask me again.';
      else {
        const sorted=[...readings].sort((a,b)=>new Date(a.date)-new Date(b.date));
        const bySlot=Object.entries(slots).map(([key,label])=>{const a=readings.filter(x=>x.slot===key).map(x=>x.value);return `${label}: ${a.length} reading(s), average ${avg(a)??'—'} mg/dL`;});
        const lo=dkey(sorted[0].date),hi=dkey(sorted.at(-1).date);
        const journal=lifestyle.filter(x=>{const k=dkey(x.occurredAt);return k&&k>=lo&&k<=hi;}).slice(0,8);
        answer=`Recorded summary for clinician\nPeriod: ${date(sorted[0].date)} – ${date(sorted.at(-1).date)}\nReadings: ${values.length}\nAverage: ${avg(values)} mg/dL\nHighest recorded: ${Math.max(...values)} mg/dL\nLowest recorded: ${Math.min(...values)} mg/dL\n\nBy time slot:\n${bySlot.join('\n')}\n\nLifestyle entries in this period:\n${journal.length?journal.map(x=>`• ${date(x.occurredAt)} — ${x.title}${x.description?': '+x.description:''}`).join('\n'):'No matching lifestyle entries.'}\n\nThis is a factual record summary, not a diagnosis or treatment recommendation. Please ask your clinician to interpret it.`;
      }
    } else if(/\b(compare|comparison|correlate|correlation|relationship)\b/.test(q)&&/\b(glucose|reading|lifestyle|meal|food|sleep|activity|exercise)\b/.test(q)){
      const byDate=new Map();for(const x of lifestyle){const k=dkey(x.occurredAt);if(k){if(!byDate.has(k))byDate.set(k,[]);byDate.get(k).push(x);}}
      const matched=readings.filter(x=>byDate.has(dkey(x.date)));
      if(!matched.length)answer='I could not find glucose readings and lifestyle entries saved on the same dates. Add entries on matching dates and I can compare what was recorded.';
      else {const groups=new Map();for(const x of matched){const k=dkey(x.date);if(!groups.has(k))groups.set(k,{r:[],l:byDate.get(k)});groups.get(k).r.push(x);}answer=`I found ${groups.size} date(s) with both types of records:\n${[...groups.entries()].slice(0,10).map(([k,g])=>`${date(k)} — ${g.r.map(x=>`${slots[x.slot]||x.slot}: ${x.value} mg/dL`).join(', ')}. Lifestyle: ${g.l.map(x=>x.title).join('; ')}.`).join('\n')}\n\nThese are records from matching dates. They do not show that a lifestyle activity caused a glucose change.`;}
    } else if(/\b(weekly|week|last 7 days|past 7 days)\b/.test(q)&&/\b(progress|summary|tracking|recorded|wellness|reading|pattern)\b/.test(q)){
      const cutoff=new Date();cutoff.setDate(cutoff.getDate()-6);const key=cutoff.toISOString().slice(0,10);
      const r=readings.filter(x=>dkey(x.date)>=key),l=lifestyle.filter(x=>dkey(x.occurredAt)>=key);answer=`Your last-seven-day record summary: ${r.length} glucose reading(s) across ${new Set(r.map(x=>dkey(x.date))).size} day(s)${r.length?`, with a recorded average of ${avg(r.map(x=>x.value))} mg/dL`:''}. You also saved ${l.length} lifestyle entr${l.length===1?'y':'ies'}.${l.length?' Recent entries: '+l.slice(0,5).map(x=>`${date(x.occurredAt)} — ${x.title}`).join('; '):''}\n\nThis describes saved information, not a medical assessment.`;
    } else if(/\b(pattern|patterns|trend|trends|insight|insights)\b/.test(q)&&/\b(data|recorded|glucose|reading|health|wellness|slot)\b/.test(q)){
      if(!readings.length)answer='There are no glucose readings saved yet. Add a few readings to build a descriptive pattern summary.';
      else {const lines=Object.entries(slots).map(([k,label])=>{const a=readings.filter(x=>x.slot===k).map(x=>x.value);return `${label}: ${a.length} reading(s), average ${avg(a)??'—'} mg/dL`;});answer=`Your saved data contains ${readings.length} reading(s) across ${new Set(readings.map(x=>dkey(x.date))).size} day(s). Overall average: ${avg(values)} mg/dL; highest recorded: ${Math.max(...values)}; lowest recorded: ${Math.min(...values)}.\n\n${lines.join('\n')}\n\nThese are descriptive statistics only, not a judgement about whether a value is medically safe.`;}
    } else if(/\b(list|show|what|which|active|saved|currently)\b/.test(q)&&/\b(medication|medicines|reminders)\b/.test(q)){
      answer=medications.length?'Your active medication reminders:\n'+medications.map(x=>`• ${x.name} — ${x.dosage}; ${x.schedule}; reminder ${x.reminderAt||'not set'}`).join('\n'):'You have no active medication reminders saved.';
    } else if(/\b(appointment|appointments)\b/.test(q)&&/\b(list|show|pending|status|request|upcoming|scheduled)\b/.test(q)){
      answer=appointments.length?appointments.map(x=>`• ${x.doctorName} — ${x.status}; ${x.visitType}; preferred date ${date(x.preferredAt)}`).join('\n'):'You have no appointment requests saved.';

    } else if (/\b(summari[sz]e|overview)\b/.test(q) && /\b(recent|tracking|activity|health|records|data|progress)\b/.test(q)) {
      const sortedReadings = [...readings].sort((a,b) => new Date(b.date)-new Date(a.date));
      const sortedLifestyle = [...lifestyle].sort((a,b) => new Date(b.occurredAt)-new Date(a.occurredAt));
      const daysWithReadings = new Set(readings.map(x => dkey(x.date)).filter(Boolean));
      const daysWithLifestyle = new Set(lifestyle.map(x => dkey(x.occurredAt)).filter(Boolean));
      const allDates = [...readings.map(x => dkey(x.date)), ...lifestyle.map(x => dkey(x.occurredAt))].filter(Boolean).sort();
      const bySlot = Object.entries(slots).map(([key,label]) => {
        const items = readings.filter(x => x.slot === key).map(x => x.value);
        return `${label}: ${items.length} reading(s), average ${avg(items) ?? '—'} mg/dL`;
      });
      const typeLabels = {MEAL:'Meals', ACTIVITY:'Activity', SLEEP:'Sleep', NOTE:'Notes'};
      const byType = Object.entries(typeLabels).map(([key,label]) => {
        const items = lifestyle.filter(x => x.type === key);
        return `${label}: ${items.length}`;
      });
      const latestEntries = sortedLifestyle.slice(0,8).map(x =>
        `• ${date(x.occurredAt)} — ${typeLabels[x.type] || x.type}: ${x.title}${x.description ? ' — '+x.description : ''}`
      );
      answer = `Your recent tracking overview

Glucose records:
${readings.length} reading(s) across ${daysWithReadings.size} day(s).
${values.length ? `Average: ${avg(values)} mg/dL\nHighest recorded: ${Math.max(...values)} mg/dL\nLowest recorded: ${Math.min(...values)} mg/dL` : 'No glucose readings saved yet.'}

By time slot:
${bySlot.join('\n')}

Lifestyle records:
${lifestyle.length} entr${lifestyle.length === 1 ? 'y' : 'ies'} across ${daysWithLifestyle.size} day(s).
${byType.join('\n')}

Recent lifestyle entries:
${latestEntries.length ? latestEntries.join('\n') : 'No lifestyle entries saved yet.'}

${allDates.length ? `Your saved records currently span ${date(allDates[0])} to ${date(allDates.at(-1))}.` : 'No tracking dates are available yet.'}

This is a factual summary of saved records, not a diagnosis or medical assessment. Ask your clinician to interpret your results.`;
    } else if(/\b(lifestyle|journal|meals?|food|activities|activity|exercise|sleep)\b/.test(q)&&/\b(list|show|summari[sz]e|entries|recorded|what|which)\b/.test(q)){
      const requestedTypes = [];
      if(/\b(meals?|food)\b/.test(q)) requestedTypes.push('MEAL');
      if(/\b(activities|activity|exercise)\b/.test(q)) requestedTypes.push('ACTIVITY');
      if(/\b(sleep)\b/.test(q)) requestedTypes.push('SLEEP');
      if(/\b(notes?)\b/.test(q)) requestedTypes.push('NOTE');
      const selected = requestedTypes.length
        ? lifestyle.filter(x => requestedTypes.includes(x.type))
        : lifestyle;
      answer = selected.length
        ? `Your saved ${requestedTypes.length ? requestedTypes.map(x => ({MEAL:'meal',ACTIVITY:'activity',SLEEP:'sleep',NOTE:'note'}[x])).join(' and ') : 'lifestyle'} entries:\n${selected.slice(0,15).map(x=>`• ${date(x.occurredAt)} — ${x.title}${x.description?': '+x.description:''}`).join('\n')}`
        : `You have no matching ${requestedTypes.length ? 'entries' : 'lifestyle entries'} saved yet.`;
    } else if(/\b(telugu|తెలుగు)\b/.test(q)) answer='అవును! నేను తెలుగులో మాట్లాడగలను. మీ రికార్డులు, రిపోర్టులు లేదా Sweety ఫీచర్ల గురించి తెలుగులో అడగండి.';
    else if(/\b(hindi|हिन्दी|हिंदी)\b/.test(q)) answer='हाँ! मैं हिंदी में मदद कर सकता हूँ। आप अपने रिकॉर्ड, रिपोर्ट या Sweety की सुविधाओं के बारे में पूछ सकते हैं।';
    else if(/\b(hello|hi|hey|good morning|good evening)\b/.test(q)) answer='Hi! 💚 I’m Mochi. I can explain your saved records, compare matching dates, prepare a factual doctor summary, or help you use Sweety. What would you like to explore?';
    else if(/\b(help|features|what can you do|how do i)\b/.test(q)) answer='I can help you understand your saved glucose reports, summarize recorded trends, compare glucose and lifestyle entries on matching dates, list medication reminders and appointment requests, prepare a factual summary for your clinician, and explain how to use Sweety. I cannot diagnose or recommend treatment.';
    if(answer) return res.json({answer,provider:'sweety-data-engine'});

    // Hosted free-model providers are restricted to general, non-personal questions.
    // Patient records are never sent to third-party AI services.
    const provider=(process.env.AI_PROVIDER||'ollama').toLowerCase();
    const generalSystem='You are Mochi, a warm and concise guide to the Sweety application. Answer general product/how-to questions only. Do not provide medical diagnosis, treatment or medication advice. If asked about personal records, say those are answered by Sweety\'s private data engine.';
    const history=Array.isArray(req.body.history)?req.body.history.slice(-6).filter(m=>['user','assistant'].includes(m?.role)&&typeof m?.content==='string').map(m=>({role:m.role,content:m.content.slice(0,800)})):[];
    if(provider==='openrouter'&&process.env.OPENROUTER_API_KEY){
      if(/\b(glucose|sugar|blood|diabetes|reading|mg\/dl|medication|medicine|symptom|insulin|health record)\b/i.test(question)) return res.json({answer:'To protect your privacy, I do not send health-related questions to hosted AI providers. I can still summarize your saved records inside Sweety, or you can switch to the local Ollama provider for a private conversation.',provider:'privacy-fallback'});
      const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENROUTER_API_KEY}`,'Content-Type':'application/json','HTTP-Referer':process.env.CLIENT_ORIGIN||'http://localhost:5173','X-Title':'Sweety Mochi'},body:JSON.stringify({model:process.env.OPENROUTER_MODEL||'openrouter/free',messages:[{role:'system',content:generalSystem},{role:'user',content:question}],max_tokens:300})});
      if(response.ok){const data=await response.json();const text=data.choices?.[0]?.message?.content;if(text)return res.json({answer:text,provider:'openrouter'});}
      console.warn('OpenRouter unavailable; using built-in guide.');
    }
    if(provider==='ollama'){
      try{const base=(process.env.OLLAMA_BASE_URL||'http://127.0.0.1:11434').replace(/\/$/,'');const response=await fetch(`${base}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OLLAMA_MODEL||'qwen3:4b',messages:[{role:'system',content:generalSystem},{role:'user',content:question}],stream:false,think:false,options:{temperature:0.3,num_predict:220}}),signal:AbortSignal.timeout(30000)});if(response.ok){const data=await response.json();const text=String(data.message?.content||'').trim();if(text&&!/<think>|we are given|the user is asking/i.test(text))return res.json({answer:text,provider:'ollama'});}}catch(e){console.warn('Local model unavailable; using built-in guide.',e.message);}
    }
    return res.json({answer:'I can still help with your Sweety data even when the language model is unavailable. Try asking me to summarize your readings, compare glucose with lifestyle entries, identify recorded patterns, explain your weekly progress, list appointments or prepare a doctor summary.',provider:'built-in-guide'});
  }catch(e){console.error('Mochi assistant error:',e);return res.status(500).json({error:'Mochi had a little hiccup. Please try again.'});}
});

app.use((err,_req,res,_next)=>{console.error(err);const status=err.status||500;res.status(status).json({error:status===500?'Something went wrong. Please try again.':err.message});});
