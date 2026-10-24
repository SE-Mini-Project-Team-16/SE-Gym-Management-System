import React, { useState } from "react";
import { ArrowRight } from "lucide-react";
import { request } from "./api.js";

export default function RegistrationForm({ onBack, onRegistered, notify }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const password = data.get("password");
    if (new TextEncoder().encode(password).length > 72) {
      setError(
        "Use a password of at most 72 UTF-8 bytes. Some characters use more than one byte.",
      );
      return;
    }
    if (password !== data.get("confirmPassword")) {
      setError("Your passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const email = data.get("email").trim().toLowerCase();
      await request("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          firstName: data.get("firstName"),
          lastName: data.get("lastName"),
          email,
          phoneNumber: data.get("phoneNumber"),
          password,
        }),
      });
      onRegistered(email);
    } catch (error) {
      setError(error.message);
      notify(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <span className="eyebrow">START YOUR NEXT CHAPTER</span>
      <h2>Create your account.</h2>
      <p>Join as a member. Reception can help you activate your membership.</p>
      <form onSubmit={submit} aria-label="Member registration" aria-busy={busy}>
        <fieldset disabled={busy}>
          <div className="registration-names">
            <label>
              First name
              <input
                name="firstName"
                required
                maxLength={50}
                autoComplete="given-name"
              />
            </label>
            <label>
              Last name
              <input
                name="lastName"
                required
                maxLength={50}
                autoComplete="family-name"
              />
            </label>
          </div>
          <label>
            Email address
            <input
              name="email"
              type="email"
              required
              maxLength={100}
              autoComplete="email"
            />
          </label>
          <label>
            Phone number
            <input
              name="phoneNumber"
              type="tel"
              inputMode="numeric"
              pattern="[0-9]{1,15}"
              required
              maxLength={15}
              autoComplete="tel-national"
              aria-describedby="phone-help"
            />
          </label>
          <p className="field-help" id="phone-help">
            Use 1 to 15 digits, without spaces or symbols.
          </p>
          <label>
            Password
            <input
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={64}
              autoComplete="new-password"
              aria-describedby="password-help"
            />
          </label>
          <p className="field-help" id="password-help">
            Use 12 to 64 characters, up to 72 UTF-8 bytes.
          </p>
          <label>
            Confirm password
            <input
              name="confirmPassword"
              type="password"
              required
              minLength={12}
              maxLength={64}
              autoComplete="new-password"
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Creating account…" : "Create account"}
            <ArrowRight size={18} />
          </button>
        </fieldset>
      </form>
      <p className="help">
        Already have an account?{" "}
        <button
          type="button"
          className="text-button"
          onClick={onBack}
          disabled={busy}
        >
          Sign in instead
        </button>
      </p>
    </>
  );
}
