// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import App from "./App.jsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const user = {
  id: "member1",
  firstName: "Jordan",
  lastName: "Lee",
  role: "Member",
  tier: "Premium",
  membershipExpiresAt: new Date(Date.now() + 86400_000).toISOString(),
};
const dashboard = {
  user,
  stats: { bookings: 2, upcomingCount: 3, availableEquipment: 4 },
  upcomingClasses: [],
};
function mockApi(handler) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options) => {
      const result = await handler(url, options);
      return {
        ok: (result.status || 200) < 400,
        status: result.status || 200,
        json: async () => result.body,
      };
    }),
  );
  vi.stubGlobal("scrollTo", vi.fn());
}
async function signIn() {
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: "member@gym.test" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "valid-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: /Let’s keep moving/ });
}

describe("responsive application shell", () => {
  it.each([200, 401])(
    "ignores late responses from a previous account (%s)",
    async (status) => {
      let logins = 0,
        firstAccountCalls = 0,
        finishOldRequest;
      const secondUser = { ...user, firstName: "Taylor" };
      mockApi((url, options) => {
        if (url.endsWith("/auth/login")) {
          logins++;
          return {
            body: {
              token: `session-${logins}`,
              user: logins === 1 ? user : secondUser,
            },
          };
        }
        if (options.headers.Authorization === "Bearer session-2")
          return { body: { ...dashboard, user: secondUser } };
        if (++firstAccountCalls === 1) return { body: dashboard };
        return new Promise((resolve) => {
          finishOldRequest = resolve;
        });
      });
      render(<App />);
      await signIn();
      fireEvent.click(
        screen.getByRole("button", { name: "Refresh", exact: true }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      await signIn();
      expect(
        screen.getByRole("heading", { name: /Let’s keep moving, Taylor/ }),
      ).toBeInTheDocument();
      await act(async () =>
        finishOldRequest(
          status === 200
            ? { body: dashboard }
            : { status: 401, body: { message: "Old session expired." } },
        ),
      );
      expect(
        screen.getByRole("heading", { name: /Let’s keep moving, Taylor/ }),
      ).toBeInTheDocument();
    },
  );
  it("shows failed login messages as a standardized accessible toast", async () => {
    mockApi(() => ({
      status: 401,
      body: { message: "Email or password is incorrect." },
    }));
    render(<App />);
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "member@gym.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Email or password is incorrect.",
    );
  });
  it("opens member pass navigation, displays a valid QR, and signs out", async () => {
    mockApi((url) => ({
      body: url.endsWith("/auth/login")
        ? { token: "session-token", user }
        : url.endsWith("/passes/me")
          ? {
              token: "signed-pass",
              expiresAt: new Date(Date.now() + 900_000).toISOString(),
              member: {
                name: "Jordan Lee",
                tier: "Premium",
                membershipExpiresAt: user.membershipExpiresAt,
              },
            }
          : dashboard,
    }));
    render(<App />);
    await signIn();
    fireEvent.click(screen.getByRole("button", { name: "Entry pass" }));
    expect(await screen.findByText("Ready for check-in")).toBeInTheDocument();
    expect(screen.getByTitle("Gym entry pass QR code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save code" })).toBeEnabled();
    expect(localStorage.length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
  it("does not show a QR or enable saving for an expired membership", async () => {
    mockApi((url) =>
      url.endsWith("/passes/me")
        ? {
            status: 403,
            body: {
              message: "An active membership is required for an entry pass.",
            },
          }
        : {
            body: url.endsWith("/auth/login")
              ? { token: "session-token", user }
              : dashboard,
          },
    );
    render(<App />);
    await signIn();
    fireEvent.click(screen.getByRole("button", { name: "Entry pass" }));
    expect(
      await screen.findByRole("heading", { name: "Pass unavailable" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTitle("Gym entry pass QR code"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save code" })).toBeDisabled();
  });
  it("exposes mobile navigation state and selects equipment", async () => {
    mockApi((url) => ({
      body: url.endsWith("/auth/login")
        ? { token: "session-token", user }
        : url.endsWith("/equipment")
          ? { items: [] }
          : dashboard,
    }));
    render(<App />);
    await signIn();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByRole("button", { name: "Close menu" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Equipment" }));
    expect(
      await screen.findByRole("heading", { name: "Built for your progress." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "No equipment yet" }),
      ).toBeInTheDocument(),
    );
  });
});
