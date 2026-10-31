// Team: who can sign in to the portal, and what they're working on.
import { html, icon, mount, pageHead, pill, avatar, options, LABELS, modal, confirmDialog, toast, val } from '../lib.js';

export async function render(ctx) {
  const { el, db, store, me, isAdmin } = ctx;
  ctx.title = 'Team';
  await store.load();
  const [assignments, tasks] = await Promise.all([db.projects.allMembers(), db.tasks.list()]);
  if (!ctx.isCurrent()) return;

  const isOwner = me.role === 'owner';
  const people = [...store.team].sort((a, b) => Number(b.active) - Number(a.active) || a.full_name.localeCompare(b.full_name));

  // Changing your own password needs the current one. Your other devices are signed out.
  const passwordModal = () => modal({
    title: 'Change my password',
    submitLabel: 'Change password',
    body: html`
      <input name="email" type="email" autocomplete="username" value="${me.email}" hidden>
      <label class="field"><span>Current password</span><input class="input" name="password" type="password" autocomplete="current-password" required autofocus></label>
      <label class="field"><span>New password</span><input class="input" name="newPassword" type="password" autocomplete="new-password" required minlength="10" maxlength="200">
        <small class="field__hint">At least 10 characters.</small></label>
      <label class="field"><span>New password again</span><input class="input" name="again" type="password" autocomplete="new-password" required minlength="10" maxlength="200"></label>`,
    onSubmit: async (fd) => {
      if (fd.get('newPassword') !== fd.get('again')) throw new Error("The two new passwords don't match.");
      await db.changePassword(fd.get('password'), fd.get('newPassword'));
      toast('Password changed. Any other devices you were signed in on are now signed out.');
      return true;
    },
  });

  const memberModal = (member = null) => {
    const self = member?.id === me.id;
    const canManage = isAdmin && !(member?.role === 'owner' && !isOwner);
    const roles = isOwner ? LABELS.role : { admin: 'Admin', member: 'Member' };
    let actions = [];
    if (self) actions = [{ act: 'my-password', label: 'Change my password', icon: 'a-key' }];
    else if (member && canManage) {
      actions = [
        ...(member.active ? [{ act: 'password', label: 'Send a new temporary password', icon: 'a-key' }] : []),
        { act: member.active ? 'deactivate' : 'activate', label: member.active ? 'Remove access' : 'Give access again', danger: member.active },
        { act: 'delete', label: 'Delete', icon: 'a-trash', danger: true },
      ];
    }
    return modal({
      title: member ? (self ? 'Your details' : `Edit ${member.full_name}`) : 'Add a team member',
      submitLabel: member ? 'Save changes' : 'Add to team',
      body: html`
        ${member ? '' : html`<p class="modal__text">We'll email them their username (this email address) and a temporary password for <b>zenatiqsolutions.com/admin</b>. They choose their own password when they first sign in.</p>`}
        <label class="field"><span>Email</span><input class="input" name="email" type="email" required maxlength="200"
          value="${member?.email || ''}" ${member && !canManage ? 'readonly' : ''} placeholder="name@example.com" ${member ? '' : 'autofocus'}></label>
        <label class="field"><span>Full name</span><input class="input" name="full_name" required maxlength="120" value="${member?.full_name || ''}" ${member ? 'autofocus' : ''}></label>
        <div class="field-row">
          <label class="field"><span>Job title <em>(optional)</em></span><input class="input" name="job_title" maxlength="80" value="${member?.job_title || ''}" placeholder="e.g. Developer"></label>
          <label class="field"><span>Phone <em>(optional)</em></span><input class="input" name="phone" type="tel" maxlength="40" value="${member?.phone || ''}"></label>
        </div>
        ${canManage && !self ? html`<label class="field"><span>Role</span><select class="input" name="role">${options(roles, member?.role || 'member')}</select>
          <small class="field__hint">Owners and admins manage the team and see payments. Members see everything else.</small></label>` : ''}`,
      actions,
      onAction: async (act) => {
        if (act === 'my-password') return Boolean(await passwordModal());
        if (act === 'password') {
          const ok = await confirmDialog({
            title: `Send ${member.full_name} a new temporary password?`, confirmLabel: 'Send it', danger: false,
            message: `Their current password stops working and they're signed out everywhere. The new one goes to ${member.email}.`,
          });
          if (!ok) return false;
          const { emailed } = await db.team.sendPassword(member.id);
          toast(emailed ? `Emailed ${member.full_name} a new temporary password.` : "Email isn't set up here, so the new password is in the server's terminal.");
        } else if (act === 'delete') {
          const ok = await confirmDialog({ title: `Delete ${member.full_name}?`, message: 'Their tasks stay, but become unassigned. To keep their name on past work, use "Remove access" instead.' });
          if (!ok) return false;
          await db.team.remove(member.id);
          toast(`${member.full_name} deleted`);
        } else {
          await db.team.update(member.id, { active: act === 'activate' });
          toast(act === 'activate' ? `${member.full_name} can sign in again` : `${member.full_name} can no longer sign in`);
        }
      },
      onSubmit: async (fd) => {
        const row = { full_name: val(fd, 'full_name'), job_title: val(fd, 'job_title'), phone: val(fd, 'phone') };
        if (!member || canManage) row.email = val(fd, 'email').toLowerCase();
        if (fd.has('role')) row.role = val(fd, 'role');
        if (!member) return db.team.add({ ...row, role: row.role || 'member' });
        await db.team.update(member.id, row);
        toast('Saved');
        return true;
      },
    });
  };

  // After adding someone: did their email with the temporary password go out?
  const reportInvite = async ({ full_name: name, invite }) => {
    if (invite.emailed) return toast(`${name} added. We emailed them their username and a temporary password.`);
    if (!invite.problem) return toast(`${name} added. Email isn't set up here, so their temporary password is in the server's terminal.`);
    await modal({
      title: `${name} was added, but no email went out`,
      body: html`<p class="modal__text">${invite.problem}</p>
        <p class="modal__text">Once that's fixed, open ${name} on this page and choose <b>Send a new temporary password</b>.</p>`,
    });
  };

  mount(el, html`
    ${pageHead('Team', 'Everyone who can sign in to this portal.',
      isAdmin ? html`<button class="btn btn--primary" type="button" data-act="add">${icon('a-plus')}Add a team member</button>` : '')}
    <div class="team">${people.map((m) => {
      const projects = assignments.filter((a) => a.member_id === m.id).length;
      const open = tasks.filter((t) => t.assignee_id === m.id && t.status !== 'done').length;
      const editable = isAdmin || m.id === me.id;
      return html`
        <article class="mcard ${m.active ? '' : 'is-off'}">
          <div class="mcard__top">${avatar(m, 'av--lg')}
            <div><h3>${m.full_name}${m.id === me.id ? html` <span class="you">You</span>` : ''}</h3><p>${m.job_title || ''}</p></div></div>
          <div class="mcard__tags">${pill('role', m.role)}${m.active ? '' : html`<span class="pill pill--off">No access</span>`}</div>
          <ul class="mcard__info">
            <li>${icon('a-send')}<span>${m.email}</span></li>
            ${m.phone ? html`<li>${icon('phone')}<a href="tel:${m.phone.replace(/\s/g, '')}">${m.phone}</a></li>` : ''}
          </ul>
          <div class="mcard__foot"><span><b>${projects}</b> project${projects === 1 ? '' : 's'}</span><span><b>${open}</b> open task${open === 1 ? '' : 's'}</span>
            ${editable ? html`<button class="btn btn--ghost btn--sm" type="button" data-act="edit" data-id="${m.id}">${icon('a-edit')}${m.id === me.id && !isAdmin ? 'Edit my details' : 'Edit'}</button>` : ''}</div>
        </article>`;
    })}</div>
    <section class="card howto">
      <h2>How sign-in works</h2>
      <ol>
        <li>An owner or admin adds the person here. They get an email with their username (their email address) and a temporary password.</li>
        <li>They sign in at <b>zenatiqsolutions.com/admin</b> and choose their own password. The temporary one stops working after 7 days.</li>
        <li>Forgotten password? Open the person and choose <b>Send a new temporary password</b>.</li>
        <li>Removing access stops them signing in straight away. Their past work keeps their name.</li>
      </ol>
    </section>`, {
    add: async () => {
      const added = await memberModal();
      if (!added) return;
      await reportInvite(added);
      render(ctx);
    },
    edit: async (btn) => {
      const saved = await memberModal(store.member(btn.dataset.id));
      if (saved) {
        await store.load();
        if (btn.dataset.id === me.id) Object.assign(me, store.member(me.id));
        render(ctx);
      }
    },
  });
}
