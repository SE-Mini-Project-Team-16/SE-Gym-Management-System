// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import App from "./App.jsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function start(
  handler = async () => ({
    ok: true,
    json: async () => ({ user: { role: "Member" } }),
  }),
) {
  const fetch = vi.fn(handler);
  vi.stubGlobal("fetch", fetch);
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
  return fetch;
}
function fill(password = "a-long-member-password", confirmation = password) {
  for (const [label, value] of [
    ["First name", "Nitesh"],
    ["Last name", "Harsur"],
    ["Email address", "NITESH@GYM.TEST"],
    ["Phone number", "09876543210"],
    ["Password", password],
    ["Confirm password", confirmation],
  ])
    fireEvent.change(screen.getByLabelText(label, { exact: true }), {
      target: { value },
    });
}
const submit = () =>
  fireEvent.submit(screen.getByRole("form", { name: "Member registration" }));

describe("member registration UI / issue #2", () => {
  it("opens accessible required fields with the documented limits and can return to sign-in", () => {
    const fetch = start();
    expect(
      screen.getByRole("heading", { name: "Create your account." }),
    ).toBeInTheDocument();
    for (const [name, length] of [
      ["First name", 50],
      ["Last name", 50],
      ["Email address", 100],
      ["Phone number", 15],
      ["Password", 64],
      ["Confirm password", 64],
    ]) {
      expect(screen.getByLabelText(name, { exact: true })).toBeRequired();
      expect(screen.getByLabelText(name, { exact: true })).toHaveAttribute(
        "maxlength",
        String(length),
      );
    }
    expect(screen.getByLabelText("Password", { exact: true })).toHaveAttribute(
      "minlength",
      "12",
    );
    expect(screen.getByLabelText("Phone number")).toHaveAttribute(
      "pattern",
      "[0-9]{1,15}",
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign in instead" }));
    expect(
      screen.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("submits only registration fields and returns to login with the email prefilled", async () => {
    const fetch = start();
    fill();
    submit();
    expect(
      await screen.findByRole("heading", { name: "Good to see you." }),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("/api/auth/register");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(options.body)).toEqual({
      firstName: "Nitesh",
      lastName: "Harsur",
      email: "nitesh@gym.test",
      phoneNumber: "09876543210",
      password: "a-long-member-password",
    });
    expect(screen.getByLabelText("Email address")).toHaveValue(
      "nitesh@gym.test",
    );
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Account created. Sign in to get started.",
    );
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it.each([409, 429])(
    "keeps entered fields and shows a retryable %s response",
    async (status) => {
      start(async () => ({
        ok: false,
        status,
        json: async () => ({
          message:
            status === 409
              ? "This email address is already registered."
              : "Too many registration attempts. Please try again later.",
        }),
      }));
      fill();
      submit();
      const alerts = await screen.findAllByRole("alert");
      expect(alerts[0]).toHaveTextContent(
        status === 409
          ? "already registered"
          : "Too many registration attempts",
      );
      expect(screen.getByLabelText("First name")).toHaveValue("Nitesh");
      expect(
        screen.getByRole("button", { name: "Create account" }),
      ).toBeEnabled();
    },
  );

  it("rejects mismatched passwords before contacting the server", async () => {
    const fetch = start();
    fill("a-long-member-password", "another-long-password");
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your passwords do not match.",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects passwords beyond bcrypt's byte limit before contacting the server", async () => {
    const fetch = start();
    fill("界".repeat(25));
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "at most 72 UTF-8 bytes",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("disables the form while submitting and prevents duplicate submissions", async () => {
    let finish;
    const fetch = start(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fill();
    submit();
    expect(
      screen.getByRole("button", { name: "Creating account…" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Email address")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Sign in instead" }),
    ).toBeDisabled();
    submit();
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true, json: async () => ({}) }));
    expect(
      screen.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeInTheDocument();
  });

  it("restores the form after a network failure", async () => {
    start(async () => {
      throw new Error("Unable to connect. Please try again.");
    });
    fill();
    submit();
    expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent(
      "Unable to connect",
    );
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeEnabled();
    expect(screen.getByLabelText("Email address")).toHaveValue(
      "NITESH@GYM.TEST",
    );
  });
});
