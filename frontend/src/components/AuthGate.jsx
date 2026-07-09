import { useEffect, useRef, useState } from "react";
import { totpSetup } from "../api";
import styles from "./AuthGate.module.css";

function Field({ label, ...props }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <input className={styles.input} {...props} />
    </label>
  );
}

function CodeInput({ value, onChange, autoFocus }) {
  return (
    <input
      className={`${styles.input} ${styles.code}`}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="000000"
      aria-label="6-digit authenticator code"
      autoFocus={autoFocus}
    />
  );
}

function LoginRegister({ auth, busy, run }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const submit = (e) => {
    e.preventDefault();
    if (mode === "register" && password !== confirm) {
      run(() => Promise.reject(new Error("passwords do not match")));
      return;
    }
    run(() => (mode === "login" ? auth.login(email, password) : auth.register(email, password)));
  };

  return (
    <form onSubmit={submit}>
      <div className={styles.tabs} role="tablist">
        {["login", "register"].map((m) => (
          <button
            key={m} type="button" role="tab" aria-selected={mode === m}
            className={styles.tab} data-active={mode === m ? "yes" : "no"}
            onClick={() => setMode(m)}
          >
            {m === "login" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>
      <Field label="Email" type="email" value={email} required autoComplete="email"
             onChange={(e) => setEmail(e.target.value)} />
      <Field label="Password" type="password" value={password} required
             minLength={8} maxLength={128}
             autoComplete={mode === "login" ? "current-password" : "new-password"}
             onChange={(e) => setPassword(e.target.value)} />
      {mode === "register" && (
        <Field label="Confirm password" type="password" value={confirm} required
               autoComplete="new-password" onChange={(e) => setConfirm(e.target.value)} />
      )}
      <button className={styles.primary} disabled={busy}>
        {mode === "login" ? "Continue" : "Create account"}
      </button>
      {mode === "register" && (
        <p className={styles.hint}>
          Two-factor authentication is required — have Google or Microsoft
          Authenticator ready on your phone.
        </p>
      )}
    </form>
  );
}

function TotpChallenge({ auth, busy, run }) {
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");

  const submit = (e) => {
    e.preventDefault();
    run(() => (useRecovery ? auth.useRecovery(recoveryCode) : auth.verifyTotp(code)));
  };

  return (
    <form onSubmit={submit}>
      <h2 className={styles.step}>Two-factor check</h2>
      {useRecovery ? (
        <Field label="Recovery code" value={recoveryCode} placeholder="xxxx-xxxx-xxxx"
               required onChange={(e) => setRecoveryCode(e.target.value)} autoFocus />
      ) : (
        <>
          <p className={styles.hint}>Enter the 6-digit code from your authenticator app.</p>
          <CodeInput value={code} onChange={setCode} autoFocus />
        </>
      )}
      <button className={styles.primary} disabled={busy || (!useRecovery && code.length !== 6)}>
        Verify
      </button>
      <button type="button" className={styles.linkBtn}
              onClick={() => setUseRecovery((v) => !v)}>
        {useRecovery ? "Use authenticator code instead" : "Lost your device? Use a recovery code"}
      </button>
      <button type="button" className={styles.linkBtn} onClick={auth.cancel}>
        Back to sign in
      </button>
    </form>
  );
}

function TotpSetup({ auth, busy, run }) {
  const [setup, setSetup] = useState(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState(null);

  useEffect(() => {
    let alive = true;
    totpSetup()
      .then((s) => { if (alive) setSetup(s); })
      .catch((e) => { if (alive) setError(e.message || "could not start 2FA setup"); });
    return () => { alive = false; };
  }, []);

  if (recoveryCodes) {
    return (
      <div>
        <h2 className={styles.step}>Save your recovery codes</h2>
        <p className={styles.hint}>
          Each code signs you in once if you lose your authenticator. They are
          shown only now — store them somewhere safe.
        </p>
        <ul className={styles.codes}>
          {recoveryCodes.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <button className={styles.primary} onClick={auth.finishSetup}>
          I saved them — open the dashboard
        </button>
      </div>
    );
  }

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await auth.enableTotp(code);
      setRecoveryCodes(r.recovery_codes);
    });
  };

  return (
    <form onSubmit={submit}>
      <h2 className={styles.step}>Set up two-factor authentication</h2>
      {error && <p className={styles.error}>{error}</p>}
      {!setup && !error && <p className={styles.hint}>Preparing your QR code…</p>}
      {setup && (
        <>
          <p className={styles.hint}>
            Scan with Google or Microsoft Authenticator, then enter the 6-digit
            code it shows.
          </p>
          {/* PNG comes from our own backend (segno-generated), not user content. */}
          <div className={styles.qr}>
            <img src={setup.qr_png} width={220} height={220} alt="Two-factor setup QR code" />
          </div>
          <details className={styles.manual}>
            <summary>Can't scan? Enter the key manually</summary>
            <code className={styles.secret}>{setup.secret}</code>
          </details>
          <CodeInput value={code} onChange={setCode} />
          <button className={styles.primary} disabled={busy || code.length !== 6}>
            Activate
          </button>
        </>
      )}
      <button type="button" className={styles.linkBtn} onClick={auth.cancel}>
        Back to sign in
      </button>
    </form>
  );
}

export default function AuthGate({ auth, children }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errRef = useRef(null);

  const run = (fn) => {
    setBusy(true);
    setError("");
    fn()
      .catch((e) => {
        setError(e.message || "something went wrong");
        errRef.current?.focus();
      })
      .finally(() => setBusy(false));
  };

  if (auth.status === "authed") return children;

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>◆</span>
          <span className={styles.brandName}>SIGNAL</span>
          <span className={styles.brandSub}>terminal</span>
        </div>
        {auth.status === "loading" && <p className={styles.hint}>Checking session…</p>}
        {error && auth.status !== "loading" && (
          <p className={styles.error} tabIndex={-1} ref={errRef} role="alert">{error}</p>
        )}
        {auth.status === "anon" && <LoginRegister auth={auth} busy={busy} run={run} />}
        {auth.status === "totp_required" && <TotpChallenge auth={auth} busy={busy} run={run} />}
        {auth.status === "totp_setup" && <TotpSetup auth={auth} busy={busy} run={run} />}
        <p className={styles.foot}>Signals, not predictions — your data stays on your server.</p>
      </div>
    </div>
  );
}
