import 'dotenv/config';
import { app } from './app.js';
const port=Number(process.env.PORT)||4000;
if(!process.env.JWT_SECRET) console.warn('WARNING: Set JWT_SECRET in your .env file before using this app.');
app.listen(port,()=>console.log(`Sweety API running at http://localhost:${port}`));
