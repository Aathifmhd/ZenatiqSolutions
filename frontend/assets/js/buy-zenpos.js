// The Buy ZenPOS page: sends a new shop's details to Zenatiq. They arrive as a request in the
// ZenPOS Key Maker, where staff make the licence and send the key.
const form = document.querySelector('[data-zenpos-form]');
const error = form.querySelector('[data-error]');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.hidden = true;
  if (!form.reportValidity()) return;
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  try {
    const res = await fetch('/api/zenpos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'request', ...Object.fromEntries(new FormData(form)) }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error?.message || 'Something went wrong. Please try again, or WhatsApp us on 075 811 2170.');
    form.querySelectorAll('.form__head, .field-row, .field, [type=submit]').forEach((el) => { el.hidden = true; });
    form.querySelector('[data-sent]').classList.add('is-shown');
  } catch (err) {
    error.textContent = err instanceof TypeError ? "Couldn't reach Zenatiq. Check your internet connection and try again." : err.message;
    error.hidden = false;
    button.disabled = false;
  }
});
