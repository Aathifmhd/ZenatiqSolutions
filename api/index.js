// Vercel runs every /api request through this one function (see "rewrites" in vercel.json).
// The API itself is in backend/.
import { createApp } from '../backend/app.js';

export default createApp();
