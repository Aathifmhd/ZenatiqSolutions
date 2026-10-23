/* Zenatiq Solutions: site behaviour (no dependencies) */
(() => {
  const WA_NUMBER = '94758112170';
  const waLink = text => `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`;

  /* footer year */
  document.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });

  /* header border once the page scrolls */
  const header = document.querySelector('[data-header]');
  if (header) {
    const onScroll = () => header.classList.toggle('is-stuck', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* mobile menu */
  const menu = document.querySelector('[data-menu]');
  const menuBtn = document.querySelector('[data-menu-open]');
  if (menu && menuBtn) {
    const closeBtn = menu.querySelector('[data-menu-close]');
    const focusables = () => [...menu.querySelectorAll('a[href], button:not([disabled])')];

    const open = () => {
      menu.hidden = false;
      requestAnimationFrame(() => menu.classList.add('is-open'));
      menuBtn.setAttribute('aria-expanded', 'true');
      document.body.classList.add('no-scroll');
      closeBtn.focus();
    };
    const close = ({ restoreFocus = true } = {}) => {
      menu.classList.remove('is-open');
      menuBtn.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('no-scroll');
      setTimeout(() => { menu.hidden = true; }, 260);
      if (restoreFocus) menuBtn.focus();
    };

    menuBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', () => close());
    menu.addEventListener('click', e => { if (e.target.closest('a')) close({ restoreFocus: false }); });
    menu.addEventListener('keydown', e => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    window.matchMedia('(min-width: 1001px)').addEventListener('change', e => {
      if (e.matches && !menu.hidden) close({ restoreFocus: false });
    });
  }

  /* hero "what do you need?" picker: price + WhatsApp message follow the choice */
  document.querySelectorAll('[data-picker]').forEach(picker => {
    const price = picker.querySelector('[data-picker-price]');
    const cta = picker.querySelector('[data-picker-cta]');
    const sync = () => {
      const choice = picker.querySelector('input[type="radio"]:checked');
      if (!choice) return;
      if (price) price.textContent = choice.dataset.price;
      if (cta) cta.href = waLink(choice.dataset.msg);
    };
    picker.addEventListener('change', sync);
    sync();
  });

  /* scroll reveal: content stays visible if this never runs */
  const revealables = document.querySelectorAll('[data-reveal]');
  if (revealables.length && 'IntersectionObserver' in window &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.documentElement.classList.add('reveal-ready');
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealables.forEach(el => io.observe(el));
  }

  /* contact form: build a WhatsApp message (nothing is stored or sent by this site) */
  const form = document.querySelector('[data-wa-form]');
  if (form) {
    const sent = document.querySelector('[data-sent]');
    const preview = sent && sent.querySelector('pre');
    const openAgain = sent && sent.querySelector('[data-sent-open]');
    const copyBtn = sent && sent.querySelector('[data-sent-copy]');
    const siteField = form.querySelector('[data-site-url]');

    form.querySelectorAll('input[name="has_site"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const show = form.elements.has_site.value === 'yes';
        siteField.hidden = !show;
        if (show) siteField.querySelector('input').focus();
      });
    });

    const required = [...form.querySelectorAll('[data-required]')];
    const validate = () => {
      let firstBad = null;
      required.forEach(input => {
        const field = input.closest('.field');
        const bad = !input.value.trim();
        field.classList.toggle('is-invalid', bad);
        input.setAttribute('aria-invalid', bad ? 'true' : 'false');
        if (bad && !firstBad) firstBad = input;
      });
      if (firstBad) firstBad.focus();
      return !firstBad;
    };
    required.forEach(input => input.addEventListener('input', () => {
      if (input.value.trim()) {
        input.closest('.field').classList.remove('is-invalid');
        input.setAttribute('aria-invalid', 'false');
      }
    }));

    const buildMessage = () => {
      const data = new FormData(form);
      const needs = data.getAll('needs');
      const lines = [
        "Hi Zenatiq! I'd like a free mock-up.",
        '',
        `*Name:* ${data.get('name').trim()}`,
        `*Business:* ${data.get('business').trim()}${data.get('type') ? ` (${data.get('type')})` : ''}`,
        `*Interested in:* ${needs.length ? needs.join(', ') : 'Not sure yet'}`,
      ];
      if (data.get('has_site') === 'yes') {
        const url = (data.get('site_url') || '').trim();
        lines.push(`*Current website:* ${url || 'Yes'}`);
      } else {
        lines.push('*Current website:* None yet');
      }
      const notes = (data.get('notes') || '').trim();
      if (notes) lines.push('', notes);
      return lines.join('\n');
    };

    let lastUrl = '';
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!validate()) return;
      const message = buildMessage();
      lastUrl = waLink(message);
      window.open(lastUrl, '_blank', 'noopener');
      if (sent) {
        preview.textContent = message;
        sent.classList.add('is-shown');
      }
    });

    if (openAgain) openAgain.addEventListener('click', () => { if (lastUrl) window.open(lastUrl, '_blank', 'noopener'); });
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      const label = copyBtn.querySelector('span');
      try {
        await navigator.clipboard.writeText(preview.textContent);
        label.textContent = 'Copied';
      } catch {
        label.textContent = 'Select the text above to copy';
      }
      setTimeout(() => { label.textContent = 'Copy message'; }, 2200);
    });
  }
})();
