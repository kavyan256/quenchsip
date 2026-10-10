// The sign-in sheet (sign in / create account / email code). Resolves with the user, or null if closed.
import { signIn, signUp, confirmSignUp, resendCode, AuthError } from './auth.js';
import { svg } from './art.js';
import { escape } from './api.js';

// The shared judges' account. Public on purpose: it can run at most 5 events, deleted after a day.
export const DEMO = { email: 'judge@quench.kavyan.dev', password: 'QuenchJudge2026' };

export function openAuthSheet({ title = 'Sign in to Quench', sub = 'Your events stay with you on any device.', cta = 'Sign in', mode = 'signin' } = {}) {
  return new Promise((resolve) => {
    const returnFocus = document.activeElement;
    const back = document.createElement('div');
    back.className = 'au-back';
    document.body.append(back);
    let email = '';

    const close = (user = null) => {
      back.remove();
      removeEventListener('keydown', onKey);
      returnFocus?.focus?.();
      resolve(user);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    addEventListener('keydown', onKey);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });

    const head = (t, s, art) => `<div class="au-head"><span class="art">${svg(art)}</span><div><h2 id="auTitle">${escape(t)}</h2><p>${escape(s)}</p></div><button type="button" class="au-close" aria-label="Close">×</button></div>`;
    const tabs = (on) => `<div class="au-tabs" role="tablist"><button type="button" role="tab" data-mode="signin" class="${on === 'signin' ? 'on' : ''}" aria-selected="${on === 'signin'}">Sign in</button><button type="button" role="tab" data-mode="signup" class="${on === 'signup' ? 'on' : ''}" aria-selected="${on === 'signup'}">Create account</button></div>`;

    const render = (screen, msg = '') => {
      const err = msg ? `<p class="au-error" role="alert">${escape(msg)}</p>` : '';
      let body = '';
      if (screen === 'signin') {
        body = head(title, sub, 'clipboard') + tabs('signin') + `
          <form data-form="signin">
            <label for="auEmail">Email</label><input id="auEmail" type="email" autocomplete="email" required value="${escape(email)}" placeholder="you@example.com">
            <label for="auPass">Password</label><input id="auPass" type="password" autocomplete="current-password" required placeholder="Your password">
            ${err}<button type="submit" class="primary-btn">${escape(cta)}</button>
          </form>
          <div class="au-demo"><b>Judging Quench?</b>Use the demo account: ${DEMO.email}<br><button type="button" data-demo>Fill in the demo account</button></div>`;
      } else if (screen === 'signup') {
        body = head('Create your account', 'Planning is free. Saving and running events needs an account.', 'drop') + tabs('signup') + `
          <form data-form="signup">
            <label for="auEmail">Email</label><input id="auEmail" type="email" autocomplete="email" required value="${escape(email)}" placeholder="you@example.com">
            <label for="auPass">Password</label><input id="auPass" type="password" autocomplete="new-password" required minlength="8" placeholder="At least 8 characters, with a number">
            <p class="hint">At least 8 characters, with a number.</p>
            ${err}<button type="submit" class="primary-btn">Create account</button>
          </form>`;
      } else {
        body = head('Check your email', `We sent a 6-digit code to ${email}.`, 'phone') + `
          <form data-form="code">
            <label for="auCode">Code</label><input id="auCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required placeholder="123456" class="au-code-input">
            <p class="hint">No email after a minute? Check spam, or <button type="button" class="au-link" data-resend>send it again</button>.</p>
            ${err}<button type="submit" class="primary-btn">Verify</button>
          </form>`;
      }
      back.innerHTML = `<div class="au-sheet" role="dialog" aria-modal="true" aria-labelledby="auTitle">${body}</div>`;
      back.querySelector('.au-close').onclick = () => close();
      back.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { email = back.querySelector('#auEmail')?.value || email; render(b.dataset.mode); }));
      back.querySelector('[data-demo]')?.addEventListener('click', () => { back.querySelector('#auEmail').value = DEMO.email; back.querySelector('#auPass').value = DEMO.password; });
      back.querySelector('[data-resend]')?.addEventListener('click', async () => {
        try { await resendCode(email); render('code', 'A new code is on its way.'); } catch (e) { render('code', e.message); }
      });
      const form = back.querySelector('form');
      form.addEventListener('submit', (e) => { e.preventDefault(); submit(screen, form); });
      [...back.querySelectorAll('input')].find((i) => !i.value)?.focus(); // the first empty field
    };

    let pass = '';
    const busy = (form, on) => { const b = form.querySelector('[type=submit]'); b.disabled = on; if (on) b.dataset.label = b.textContent; b.textContent = on ? 'Please wait…' : b.dataset.label || b.textContent; };
    const submit = async (screen, form) => {
      busy(form, true);
      try {
        if (screen === 'signin') {
          email = form.querySelector('#auEmail').value;
          close(await signIn(email, form.querySelector('#auPass').value));
        } else if (screen === 'signup') {
          email = form.querySelector('#auEmail').value;
          pass = form.querySelector('#auPass').value;
          const { confirm } = await signUp(email, pass);
          if (confirm) render('code');
          else close(await signIn(email, pass));
        } else {
          await confirmSignUp(email, form.querySelector('#auCode').value);
          if (pass) close(await signIn(email, pass));
          else render('signin', 'Email verified. Sign in to continue.');
        }
      } catch (err) {
        if (err instanceof AuthError && err.code === 'UserNotConfirmedException') {
          try { await resendCode(email); } catch {}
          pass = form.querySelector('#auPass')?.value || pass;
          return render('code', err.message);
        }
        busy(form, false);
        const p = form.querySelector('.au-error') || Object.assign(document.createElement('p'), { className: 'au-error', role: 'alert' });
        p.textContent = err.message;
        form.querySelector('[type=submit]').before(p);
      }
    };

    render(mode);
  });
}
