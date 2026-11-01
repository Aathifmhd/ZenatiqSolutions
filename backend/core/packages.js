// What each kind of package includes. Client systems show it on their Contact Zenatiq page (they ask
// for it with the widget API's "package" request), so a change here reaches every system at once.
import { addDays, addMonths } from './renewals.js';

// A one-time purchase comes with free updates and services for this long after it goes live.
export const FREE_SUPPORT_MONTHS = 2;
// The last day of the free updates and services, for a system that went live on `day`.
export const freeSupportUntil = (day) => addDays(addMonths(day, FREE_SUPPORT_MONTHS), -1);

export const PACKAGES = {
  one_time: {
    name: 'One-time purchase',
    services: [
      'The finished system, yours to keep using',
      `Free updates, fixes and help for ${FREE_SUPPORT_MONTHS} months after it goes live`,
      'After that, updates, changes and help are charged separately, and always quoted first',
    ],
  },
  yearly: {
    name: 'Yearly subscription',
    services: [
      'Hosting, so the system stays online',
      'Updates, fixes and backups',
      'Small updates and changes during the subscription',
      'Help on WhatsApp and by phone',
    ],
  },
};
