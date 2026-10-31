// Makes the key pair that signs licences, once: the private key goes into .env as
// LICENSE_PRIVATE_KEY (copy that line into Vercel's settings), and the public key, which client
// systems use to check licences, is printed. Run again, it only prints the public key.
//   npm run license-key
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { newKeyPair, publicKey } from './license.js';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

if (process.env.LICENSE_PRIVATE_KEY?.trim()) {
  console.log('.env already has LICENSE_PRIVATE_KEY. Its public key:');
} else {
  const { privateKey } = newKeyPair();
  const comment = '\n# Signs licences for client systems (ADMIN-SETUP.md, Licences). Copy this line into Vercel too.\n';
  appendFileSync(envFile, `${comment}LICENSE_PRIVATE_KEY=${privateKey}\n`);
  process.env.LICENSE_PRIVATE_KEY = privateKey;
  console.log('Made a new key pair. The private key is in .env as LICENSE_PRIVATE_KEY: copy that line into Vercel.');
  console.log('The public key, for client systems:');
}
console.log(publicKey());
