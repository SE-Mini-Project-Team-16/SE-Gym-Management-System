// @vitest-environment jsdom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { EntryPass } from "./App.jsx";

let pass;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
  pass = {
    token: "signed-member-pass",
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    member: {
      name: "Jordan Lee",
      tier: "Premium",
      membershipExpiresAt: new Date(Date.now() + 86400_000).toISOString(),
    },
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const offline = () =>
  Object.assign(new Error("Service temporarily unavailable."), { status: 503 });
const mount = async (api) => {
  await act(async () => {
    render(<EntryPass api={api} notify={vi.fn()} />);
  });
};
const advance = async (milliseconds) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
};

describe("issue #10 entry pass availability", () => {
  it.each([503, 429])(
    "keeps a valid code visible during refresh, then recovers from a temporary error (%s)",
    async (status) => {
      let fail;
      const api = vi
        .fn()
        .mockResolvedValueOnce(pass)
        .mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              fail = reject;
            }),
        )
        .mockImplementation(async () => ({
          ...pass,
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
        }));
      await mount(api);
      await advance(90_000);
      expect(screen.getByTitle("Gym entry pass QR code")).toBeInTheDocument();
      await act(async () => fail(Object.assign(offline(), { status })));
      expect(screen.getByTitle("Gym entry pass QR code")).toBeInTheDocument();
      expect(screen.getByText(/Trying again shortly/)).toBeInTheDocument();
      await advance(1000);
      expect(api).toHaveBeenCalledTimes(3);
      expect(
        screen.queryByText(/Trying again shortly/),
      ).not.toBeInTheDocument();
    },
  );
  it("hides expired codes during an outage and retries with bounded backoff", async () => {
    const api = vi
      .fn()
      .mockRejectedValue(offline())
      .mockResolvedValueOnce(pass);
    await mount(api);
    await advance(120_000);
    expect(
      screen.queryByTitle("Gym entry pass QR code"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save code" })).toBeDisabled();
    expect(api.mock.calls.length).toBeLessThan(12);
    expect(screen.getByText(/retry automatically/)).toBeInTheDocument();
  });
  it.each([401, 403])(
    "clears a pass immediately on an authorization failure (%s) without retrying",
    async (status) => {
      const api = vi
        .fn()
        .mockResolvedValueOnce(pass)
        .mockRejectedValue(
          Object.assign(new Error("Membership unavailable."), { status }),
        );
      await mount(api);
      await act(async () =>
        fireEvent.click(screen.getByRole("button", { name: "Refresh pass" })),
      );
      expect(
        screen.queryByTitle("Gym entry pass QR code"),
      ).not.toBeInTheDocument();
      await advance(60_000);
      expect(api).toHaveBeenCalledTimes(2);
    },
  );
  it("retries immediately when connectivity returns", async () => {
    const api = vi
      .fn()
      .mockRejectedValueOnce(offline())
      .mockResolvedValue(pass);
    await mount(api);
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(api).toHaveBeenCalledTimes(2);
    expect(screen.getByTitle("Gym entry pass QR code")).toBeInTheDocument();
  });
  it("aborts a stalled request after ten seconds and recovers on retry", async () => {
    const api = vi
      .fn()
      .mockImplementationOnce(
        (path, { signal }) =>
          new Promise((resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("Timed out", "AbortError")),
              { once: true },
            );
          }),
      )
      .mockResolvedValue(pass);
    await mount(api);
    await advance(10_000);
    expect(screen.getByText(/took too long/)).toBeInTheDocument();
    await advance(1000);
    expect(api).toHaveBeenCalledTimes(2);
    expect(screen.getByTitle("Gym entry pass QR code")).toBeInTheDocument();
  });
  it("does not repeatedly refresh a code capped by membership expiry", async () => {
    pass.expiresAt = new Date(Date.now() + 20_000).toISOString();
    pass.member.membershipExpiresAt = pass.expiresAt;
    const api = vi
      .fn()
      .mockResolvedValueOnce(pass)
      .mockRejectedValue(
        Object.assign(new Error("Membership expired."), { status: 403 }),
      );
    await mount(api);
    await advance(19_000);
    expect(api).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(api).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByTitle("Gym entry pass QR code"),
    ).not.toBeInTheDocument();
  });
  it("aborts in-flight requests and cancels recovery when leaving the screen", async () => {
    let signal;
    const api = vi.fn((path, options) => {
      signal = options.signal;
      return new Promise(() => {});
    });
    const view = render(<EntryPass api={api} notify={vi.fn()} />);
    view.unmount();
    expect(signal.aborted).toBe(true);
    await advance(120_000);
    expect(api).toHaveBeenCalledTimes(1);
  });
});
