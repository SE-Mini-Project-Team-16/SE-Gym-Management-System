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
  it("renders class cancellation control for Admin and dispatches cancellation API", async () => {
    const adminUser = {
      id: "admin1",
      firstName: "Alex",
      lastName: "Admin",
      role: "Admin",
    };
    const testClass = {
      _id: "class-123",
      name: "Power Circuit",
      startsAt: new Date(Date.now() + 3600_000).toISOString(),
      durationMinutes: 45,
      capacity: 10,
      availableSlots: 7,
    };
    let cancelled = false;
    mockApi((url, options) => {
      if (url.endsWith("/auth/login")) {
        return { body: { token: "admin-session", user: adminUser } };
      }
      if (url.endsWith("/classes/class-123/cancel") && options.method === "POST") {
        cancelled = true;
        return {
          body: {
            status: "success",
            message: 'Class "Power Circuit" cancelled. Enrolled members notified.',
          },
        };
      }
      if (url.endsWith("/classes")) {
        return { body: { items: cancelled ? [] : [testClass] } };
      }
      if (url.endsWith("/bookings")) {
        return { body: { items: [] } };
      }
      return { body: { ...dashboard, user: adminUser } };
    });
    vi.stubGlobal("confirm", () => true);

    render(<App />);
    await signIn("admin@gym.test");
    fireEvent.click(screen.getByRole("button", { name: "Bookings" }));

    expect(
      await screen.findByRole("heading", { name: "Upcoming classes" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Power Circuit")).toBeInTheDocument();

    const cancelBtn = screen.getByRole("button", { name: "Cancel class Power Circuit" });
    expect(cancelBtn).toBeInTheDocument();

    fireEvent.click(cancelBtn);

    expect(
      await screen.findByText('Class "Power Circuit" cancelled. Enrolled members notified.'),
    ).toBeInTheDocument();
  });
  it("does not render cancel buttons for Members, but renders notification update banner", async () => {
    const testClass = {
      _id: "class-456",
      name: "Morning Yoga",
      startsAt: new Date(Date.now() + 7200_000).toISOString(),
      durationMinutes: 60,
      capacity: 15,
      availableSlots: 10,
    };
    const mockNotes = [
      {
        _id: "note-1",
        message: 'The class "Power Circuit" scheduled for tomorrow has been cancelled.',
      },
    ];
    mockApi((url) => {
      if (url.endsWith("/auth/login")) {
        return { body: { token: "member-session", user } };
      }
      if (url.endsWith("/classes")) {
        return { body: { items: [testClass] } };
      }
      if (url.endsWith("/bookings")) {
        return { body: { items: [] } };
      }
      if (url.endsWith("/notifications")) {
        return { body: { items: mockNotes } };
      }
      return { body: dashboard };
    });

    render(<App />);
    await signIn();
    fireEvent.click(screen.getByRole("button", { name: "Bookings" }));

    expect(
      await screen.findByRole("heading", { name: "Upcoming classes" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Morning Yoga")).toBeInTheDocument();

    // Member should NOT see cancel class buttons
    expect(screen.queryByRole("button", { name: /Cancel class/ })).not.toBeInTheDocument();

    // Member should see class schedule update notification
    expect(screen.getByText("Class schedule updates")).toBeInTheDocument();
    expect(
      screen.getByText('The class "Power Circuit" scheduled for tomorrow has been cancelled.'),
    ).toBeInTheDocument();
  });
  it("renders equipment controls for Admin, filters items, and submits maintenance ticket via modal", async () => {
    const adminUser = {
      id: "admin1",
      firstName: "Alex",
      lastName: "Admin",
      role: "Admin",
    };
    const sampleEquipment = [
      {
        _id: "eq-1",
        inventoryId: "TRD-101",
        name: "Pro Treadmill",
        category: "Cardio",
        status: "Available",
      },
      {
        _id: "eq-2",
        inventoryId: "RCK-102",
        name: "Power Rack",
        category: "Strength",
        status: "Under Maintenance",
      },
    ];
    let submittedBody = null;
    mockApi((url, options) => {
      if (url.endsWith("/auth/login")) {
        return { body: { token: "admin-session", user: adminUser } };
      }
      if (url.endsWith("/equipment/tickets") && (!options || options.method === "GET")) {
        return { body: { items: [] } };
      }
      if (url.endsWith("/equipment/ticket") && options?.method === "POST") {
        submittedBody = JSON.parse(options.body);
        return {
          status: 201,
          body: {
            status: "success",
            ticketId: "TCK-101",
            message: "Ticket TCK-101 logged successfully.",
          },
        };
      }
      if (url.endsWith("/equipment")) {
        return { body: { items: sampleEquipment } };
      }
      return { body: { ...dashboard, user: adminUser } };
    });

    render(<App />);
    await signIn("admin@gym.test");
    fireEvent.click(screen.getByRole("button", { name: "Equipment" }));

    expect(await screen.findByRole("tab", { name: /All/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Available/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Under Maintenance/ })).toBeInTheDocument();

    expect(screen.getByText("Pro Treadmill")).toBeInTheDocument();
    expect(screen.getByText("Power Rack")).toBeInTheDocument();

    // Click "Under Maintenance" filter tab
    fireEvent.click(screen.getByRole("tab", { name: /Under Maintenance/ }));
    // Pro Treadmill is Available, so it should not be displayed when Under Maintenance is active
    expect(screen.queryByText("Pro Treadmill")).not.toBeInTheDocument();
    expect(screen.getByText("Power Rack")).toBeInTheDocument();

    // Open ticket modal
    fireEvent.click(screen.getByRole("button", { name: /Log maintenance ticket/ }));
    expect(screen.getByRole("heading", { name: "Log Maintenance Ticket" })).toBeInTheDocument();

    // Fill form
    fireEvent.change(screen.getByPlaceholderText("e.g. TRD-101"), {
      target: { value: "TRD-101" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/Describe the issue/),
      { target: { value: "Belt slipping during sprint." } },
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit ticket" }));

    await waitFor(() => {
      expect(submittedBody).toEqual({
        equipmentId: "TRD-101",
        issueDescription: "Belt slipping during sprint.",
      });
    });

    expect(
      await screen.findByText("Ticket TCK-101 logged successfully."),
    ).toBeInTheDocument();
  });

  it("allows Admin to toggle equipment status between Available and Under Maintenance", async () => {
    const adminUser = {
      id: "admin1",
      firstName: "Alex",
      lastName: "Admin",
      role: "Admin",
    };
    const sampleEquipment = [
      {
        _id: "eq-1",
        inventoryId: "TRD-101",
        name: "Pro Treadmill",
        category: "Cardio",
        status: "Available",
      },
    ];
    let patchedStatus = null;
    mockApi((url, options) => {
      if (url.endsWith("/auth/login")) {
        return { body: { token: "admin-session", user: adminUser } };
      }
      if (url.endsWith("/equipment/tickets")) {
        return { body: { items: [] } };
      }
      if (url.includes("/equipment/TRD-101/status") && options?.method === "PATCH") {
        patchedStatus = JSON.parse(options.body).status;
        return {
          body: {
            status: "success",
            message: `Equipment status updated to "${patchedStatus}".`,
          },
        };
      }
      if (url.endsWith("/equipment")) {
        return {
          body: {
            items: sampleEquipment.map((eq) =>
              patchedStatus ? { ...eq, status: patchedStatus } : eq,
            ),
          },
        };
      }
      return { body: { ...dashboard, user: adminUser } };
    });

    render(<App />);
    await signIn("admin@gym.test");
    fireEvent.click(screen.getByRole("button", { name: "Equipment" }));

    expect(await screen.findByText("Pro Treadmill")).toBeInTheDocument();
    const toggleBtn = screen.getByRole("button", { name: "Mark Under Maintenance" });
    expect(toggleBtn).toBeInTheDocument();

    fireEvent.click(toggleBtn);

    expect(
      await screen.findByText('Equipment status updated to "Under Maintenance".'),
    ).toBeInTheDocument();
    expect(patchedStatus).toBe("Under Maintenance");
  });
});
