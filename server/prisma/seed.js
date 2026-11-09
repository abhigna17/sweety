import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma=new PrismaClient();
try{
 const email='demo@sweety.health';
 const user=await prisma.user.upsert({where:{email},update:{},create:{name:'Alex Morgan',email,passwordHash:await bcrypt.hash('SweetyDemo123!',12)}});
 await prisma.reading.deleteMany({where:{userId:user.id}});
 const today=new Date();today.setUTCHours(0,0,0,0);
 const rows=[];for(let d=0;d<12;d++){const date=new Date(today);date.setUTCDate(today.getUTCDate()-d);for(let i=0;i<4;i++){if((d+i)%5===0)continue;rows.push({userId:user.id,date,slot:['MORNING','AFTER_BREAKFAST','AFTER_LUNCH','AFTER_DINNER'][i],value:[105,148,132,126][i]+((d*7+i*3)%17)-8});}}
 await prisma.reading.createMany({data:rows,skipDuplicates:true});
 const doctor=await prisma.user.upsert({where:{email:'doctor@sweety.health'},update:{},create:{name:'Dr. Maya Rao',email:'doctor@sweety.health',role:'DOCTOR',passwordHash:await bcrypt.hash('SweetyDoctor123!',12),doctorProfile:{create:{specialty:'Endocrinology',clinicName:'Sweety Demo Clinic',bio:'Demo clinician account for testing the patient–doctor workflow.',verified:true}}}});
 await prisma.doctorProfile.upsert({where:{userId:doctor.id},create:{userId:doctor.id,specialty:'Endocrinology',clinicName:'Sweety Demo Clinic',bio:'Demo clinician account for testing the patient–doctor workflow.',verified:true},update:{verified:true}});
 console.log('Patient demo: demo@sweety.health / SweetyDemo123!');
 console.log('Doctor demo: doctor@sweety.health / SweetyDoctor123!');
}catch(e){console.error(e);process.exitCode=1;}finally{await prisma.$disconnect();}
