import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Dumbbell,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Ticket,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { request } from "./api.js";
import RegistrationForm from "./RegistrationForm.jsx";

const date = (value) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "No active membership";
const time = (value) =>
  new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
const fullDate = (value) =>
  new Date(value).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
const icons = {
  Dashboard: LayoutDashboard,
  Members: Users,
  Bookings: CalendarDays,
  Equipment: Dumbbell,
  "Entry pass": Ticket,
  "Verify pass": ScanLine,
};

function Toasts({ toasts, dismiss }) {
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((item) => (
        <div
          className={`toast ${item.type}`}
          key={item.id}
          role={item.type === "error" ? "alert" : "status"}
        >
          <span>{item.type === "error" ? "!" : <Check size={18} />}</span>
          <p>{item.message}</p>
          <button
            aria-label="Dismiss notification"
            onClick={() => dismiss(item.id)}
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Login({ onLogin, notify }) {
  const [busy, setBusy] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      onLogin(
        await request("/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: data.get("email"),
            password: data.get("password"),
          }),
        }),
      );
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <section className="login-story">
        <Brand />
        <div>
          <span className="eyebrow">MAKE ROOM FOR PROGRESS</span>
          <h1>
            Your next
            <br /> chapter starts
            <br /> with <em>you.</em>
          </h1>
          <p>
            One place for your training, your membership,
            <br /> and everything that keeps you moving.
          </p>
        </div>
        <small>GYM MANAGEMENT SYSTEM / TEAM 16</small>
      </section>
      <section className="login-form">
        <div>
          {registering ? (
            <RegistrationForm
              notify={notify}
              onBack={() => setRegistering(false)}
              onRegistered={(email) => {
                setRegisteredEmail(email);
                setRegistering(false);
                notify("Account created. Sign in to get started.");
              }}
            />
          ) : (
            <>
              <span className="eyebrow">WELCOME BACK</span>
              <h2>Good to see you.</h2>
              <p>Sign in to your gym account to get started.</p>
              <form onSubmit={submit}>
                <label>
                  Email address
                  <input
                    name="email"
                    type="email"
                    placeholder="you@example.com"
                    required
                    autoComplete="username"
                    maxLength={100}
                    defaultValue={registeredEmail}
                  />
                </label>
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    placeholder="Your password"
                    required
                    autoComplete="current-password"
                    maxLength={128}
                  />
                </label>
                <button className="primary" disabled={busy}>
                  {busy ? "Signing in…" : "Sign in"}
                  <ArrowRight size={18} />
                </button>
              </form>
              <p className="help">
                New to the gym?{" "}
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => setRegistering(true)}
                >
                  Create an account
                </button>
                <br /> Contact your gym reception.
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span>
        <Dumbbell size={23} />
      </span>
      <b>
        GMS<span className="brand-dot">.</span>
      </b>
      <small>GYM MANAGEMENT</small>
    </div>
  );
}
function Empty({ title = "Nothing here yet", children }) {
  return (
    <div className="empty">
      <CalendarDays size={30} />
      <h3>{title}</h3>
      <p>{children || "Check back soon for updates from your gym."}</p>
    </div>
  );
}
function Loading() {
  return (
    <div className="loading" role="status">
      <RefreshCw size={22} className="spin" /> Loading your gym…
    </div>
  );
}
function Badge({ children, muted }) {
  return <span className={`badge ${muted ? "muted" : ""}`}>{children}</span>;
}

function Dashboard({ data, navigate, refresh, busy }) {
  const user = data.user;
  const active = new Date(user.membershipExpiresAt).getTime() > Date.now();
  const metrics =
    user.role === "Admin"
      ? [
          ["Total members", data.stats.members, Users],
          ["Active memberships", data.stats.activeMembers, ShieldCheck],
          ["Expiring this week", data.stats.expiringSoon, Clock3],
          ["Equipment available", data.stats.availableEquipment, Dumbbell],
        ]
      : [
          ...(user.role === "Member"
            ? [["Your active bookings", data.stats.bookings, CalendarDays]]
            : []),
          ["Upcoming classes", data.stats.upcomingCount, Clock3],
          ["Equipment available", data.stats.availableEquipment, Dumbbell],
        ];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR DAILY OVERVIEW</span>
          <h1>Let’s keep moving, {user.firstName}.</h1>
          <p>A little consistency. A stronger you.</p>
        </div>
        <button className="secondary" disabled={busy} onClick={refresh}>
          <RefreshCw size={16} className={busy ? "spin" : ""} />
          Refresh
        </button>
      </div>
      <section className="hero">
        <div>
          <span className="eyebrow">SHOW UP. GET STRONGER.</span>
          <h2>
            Every session is
            <br /> a step forward.
          </h2>
          <p>Your gym, your goals, your pace. Make today count.</p>
          <button
            className="lime-button"
            onClick={() =>
              navigate(user.role === "Member" ? "Entry pass" : "Verify pass")
            }
          >
            {user.role === "Member"
              ? "Open entry pass"
              : "Verify a member pass"}
            <ArrowRight size={18} />
          </button>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit one" />
          <div className="orbit two" />
          <Dumbbell strokeWidth={1.1} />
          <span>
            ONE REP
            <br /> AT A TIME.
          </span>
        </div>
      </section>
      <section className="metrics" aria-label="Gym statistics">
        {metrics.map(([label, value, Icon]) => (
          <article className="metric" key={label}>
            <div>
              <span>{label}</span>
              <Icon size={18} />
            </div>
            <strong>{value ?? "—"}</strong>
            <small>Current gym overview</small>
          </article>
        ))}
      </section>
      <div className="dashboard-bottom">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">FIND YOUR RHYTHM</span>
              <h2>Coming up at the gym</h2>
            </div>
            <button
              className="text-button"
              onClick={() => navigate("Bookings")}
            >
              View bookings
              <ChevronRight size={16} />
            </button>
          </div>
          {data.upcomingClasses.length ? (
            <div className="class-list">
              {data.upcomingClasses.map((item) => (
                <div className="class-row" key={item._id}>
                  <div className="class-symbol">
                    <Dumbbell size={21} />
                  </div>
                  <div>
                    <h3>{item.name}</h3>
                    <p>
                      {fullDate(item.startsAt)} · {time(item.startsAt)} ·{" "}
                      {item.durationMinutes} min
                    </p>
                  </div>
                  <Badge muted={item.availableSlots === 0}>
                    {item.availableSlots
                      ? `${item.availableSlots} spots left`
                      : "Full"}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="A little breathing room">
              Your gym has no upcoming classes scheduled.
            </Empty>
          )}
        </section>
        {user.role === "Member" ? (
          <section className="panel membership">
            <div className="panel-heading">
              <h2>Your membership</h2>
              <ShieldCheck size={21} />
            </div>
            <span className="eyebrow">{user.tier} PLAN</span>
            <h3>
              More room
              <br /> to grow.
            </h3>
            <Badge muted={!active}>
              {active ? "Membership active" : "Membership expired"}
            </Badge>
            <p className="membership-date">
              {active ? "Valid until" : "Expiry date"}
              <strong>{date(user.membershipExpiresAt)}</strong>
            </p>
            <button
              className="secondary"
              onClick={() => navigate("Entry pass")}
            >
              View digital pass
              <ArrowRight size={16} />
            </button>
          </section>
        ) : (
          <section className="panel membership">
            <ShieldCheck size={28} />
            <h3>
              A smooth start
              <br /> for every member.
            </h3>
            <p>Check a digital entry pass before welcoming a member in.</p>
            <button
              className="secondary"
              onClick={() => navigate("Verify pass")}
            >
              Verify entry pass
              <ArrowRight size={16} />
            </button>
          </section>
        )}
      </div>
    </>
  );
}

function EntryPass({ api, notify }) {
  const [pass, setPass] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setBusy(true);
    setError("");
    setPass(null);
    try {
      const result = await api("/passes/me");
      if (current === generation.current) setPass(result);
    } catch (error) {
      if (current === generation.current) {
        setError(error.message);
        notify(error.message, "error");
      }
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }, [api, notify]);
  useEffect(() => {
    refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  // Refresh while this page is visible; never show an expired code as usable.
  useEffect(() => {
    if (!pass) return;
    const id = setTimeout(
      refresh,
      Math.max(1000, new Date(pass.expiresAt).getTime() - Date.now() - 30_000),
    );
    return () => clearTimeout(id);
  }, [pass, refresh]);
  const valid = pass && new Date(pass.expiresAt).getTime() > now;
  function download() {
    const svg = document.querySelector("#entry-pass-qr");
    if (!svg || !valid) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "gym-entry-pass.svg";
    link.click();
    URL.revokeObjectURL(url);
    notify(`Pass downloaded. It expires at ${time(pass.expiresAt)}.`);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">READY WHEN YOU ARE</span>
          <h1>Your digital entry pass.</h1>
          <p>Show this code to reception when you arrive.</p>
        </div>
      </div>
      <div className="pass-layout">
        <section className="entry-card">
          <div className="entry-top">
            <Brand />
            <Badge>MEMBER PASS</Badge>
          </div>
          {busy ? (
            <Loading />
          ) : error ? (
            <Empty title="Pass unavailable">{error}</Empty>
          ) : valid ? (
            <>
              <div className="qr-wrap">
                <QRCodeSVG
                  id="entry-pass-qr"
                  value={pass.token}
                  size={248}
                  level="M"
                  marginSize={4}
                  title="Gym entry pass QR code"
                />
              </div>
              <h2>{pass.member.name}</h2>
              <p>{pass.member.tier} membership</p>
              <Badge>Ready for check-in</Badge>
              <div className="pass-details">
                <div>
                  <span>CODE EXPIRES</span>
                  <strong>{time(pass.expiresAt)}</strong>
                </div>
                <div>
                  <span>MEMBERSHIP UNTIL</span>
                  <strong>{date(pass.member.membershipExpiresAt)}</strong>
                </div>
              </div>
            </>
          ) : (
            <Empty title="This pass has expired">
              Refresh your pass to get a new code.
            </Empty>
          )}
        </section>
        <section className="pass-guide">
          <span className="eyebrow">A GOOD START TO YOUR SESSION</span>
          <h2>
            Walk in.
            <br /> Check in.
            <br /> Get moving.
          </h2>
          <p>
            Your code refreshes automatically while this screen is open. Each
            code lasts up to 15 minutes and is only valid with an active
            membership.
          </p>
          <div className="notice">
            <ShieldCheck size={23} />
            <p>
              Reception confirms your current membership when they scan your
              pass.
            </p>
          </div>
          <div className="button-row">
            <button className="primary" disabled={busy} onClick={refresh}>
              <RefreshCw size={16} />
              Refresh pass
            </button>
            <button
              className="secondary"
              disabled={!valid || busy}
              onClick={download}
            >
              <ArrowDownToLine size={16} />
              Save code
            </button>
          </div>
          <p className="small">
            A saved code expires at the same time as the one on screen. An
            internet connection is required to refresh and verify passes.
          </p>
        </section>
      </div>
    </>
  );
}

function VerifyPass({ api, notify }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    const token = new FormData(event.currentTarget).get("pass").trim();
    try {
      const result = await api("/passes/verify", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      setResult(result);
      notify("Membership confirmed. This member is ready to enter.");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">RECEPTION</span>
          <h1>Welcome them in.</h1>
          <p>
            Scan a member’s QR code with your reader, then verify their pass.
          </p>
        </div>
      </div>
      <section className="panel verify">
        <form onSubmit={submit}>
          <label>
            Entry pass code
            <textarea
              name="pass"
              required
              maxLength={4096}
              rows={5}
              placeholder="Scan or paste the entry pass code here"
              onChange={() => setResult(null)}
            />
          </label>
          <button className="primary" disabled={busy}>
            <ScanLine size={18} />
            {busy ? "Checking membership…" : "Verify pass"}
          </button>
        </form>
        {result && (
          <div className="verified" role="status">
            <ShieldCheck size={32} />
            <h2>
              {result.member.firstName} {result.member.lastName}
            </h2>
            <p>
              {result.member.tier} · Valid until{" "}
              {date(result.member.membershipExpiresAt)}
            </p>
            <Badge>Entry confirmed</Badge>
          </div>
        )}
      </section>
    </>
  );
}

function Collection({ page, api, notify }) {
  const [items, setItems] = useState(null);
  const [classes, setClasses] = useState([]);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setItems(null);
    setError("");
    const path = {
      Members: "/members",
      Bookings: "/bookings",
      Equipment: "/equipment",
    }[page];
    Promise.all([
      api(path, { signal: controller.signal }),
      ...(page === "Bookings"
        ? [api("/classes", { signal: controller.signal })]
        : []),
    ])
      .then(([data, sessions]) => {
        setItems(data.items);
        setClasses(sessions?.items || []);
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setError(error.message);
          notify(error.message, "error");
        }
      });
    return () => controller.abort();
  }, [page, api, notify, version]);
  const headings = {
    Members: [
      "THE PEOPLE WHO SHOW UP",
      "Your gym community.",
      "An overview of the first 50 current members.",
    ],
    Bookings: [
      "MAKE TIME FOR YOURSELF",
      "Your training schedule.",
      "Your recent bookings and the next classes at your gym.",
    ],
    Equipment: [
      "TOOLS FOR YOUR NEXT CHAPTER",
      "Built for your progress.",
      "Browse up to 50 equipment items at your gym.",
    ],
  };
  const [eyebrow, title, description] = headings[page];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <button className="secondary" onClick={() => setVersion((v) => v + 1)}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>
      <section className="panel collection">
        {error ? (
          <Empty title="Unable to load this page">
            {error} Use Refresh to try again.
          </Empty>
        ) : items === null ? (
          <Loading />
        ) : !items.length ? (
          <Empty title={`No ${page.toLowerCase()} yet`} />
        ) : page === "Members" ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Plan</th>
                  <th>Membership until</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item._id}>
                    <td>
                      <strong>
                        {item.firstName} {item.lastName}
                      </strong>
                    </td>
                    <td>{item.tier}</td>
                    <td>{date(item.membershipExpiresAt)}</td>
                    <td>
                      <Badge
                        muted={new Date(item.membershipExpiresAt) <= new Date()}
                      >
                        {new Date(item.membershipExpiresAt) > new Date()
                          ? "Active"
                          : "Expired"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : page === "Bookings" ? (
          <div className="class-list">
            {items.map((item) => (
              <div className="class-row" key={item._id}>
                <div className="class-symbol">
                  <CalendarDays size={20} />
                </div>
                <div>
                  <h3>{item.classId?.name || "Class unavailable"}</h3>
                  <p>
                    {item.classId?.startsAt
                      ? `${fullDate(item.classId.startsAt)} · ${time(item.classId.startsAt)}`
                      : "Contact reception for details"}
                  </p>
                </div>
                <Badge
                  muted={
                    item.status === "Cancelled" ||
                    item.classId?.status === "Cancelled"
                  }
                >
                  {item.classId?.status === "Cancelled"
                    ? "Class cancelled"
                    : item.status}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <div className="equipment-grid">
            {items.map((item) => (
              <article key={item._id}>
                <Dumbbell size={28} />
                <Badge muted={item.status !== "Available"}>{item.status}</Badge>
                <h3>{item.name}</h3>
                <p>
                  {item.category} · {item.inventoryId}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
      {page === "Bookings" && !error && (
        <section className="panel catalog">
          <div className="panel-heading">
            <h2>Upcoming classes</h2>
          </div>
          <p className="small">
            Booking and cancellation tools are being built by the team. Contact
            reception to reserve a place.
          </p>
          {classes.length ? (
            classes.map((item) => (
              <div className="class-row" key={item._id}>
                <div>
                  <h3>{item.name}</h3>
                  <p>
                    {fullDate(item.startsAt)} · {time(item.startsAt)}
                  </p>
                </div>
                <Badge muted={!item.availableSlots}>
                  {item.availableSlots} spots left
                </Badge>
              </div>
            ))
          ) : (
            <Empty title="No classes scheduled" />
          )}
        </section>
      )}
    </>
  );
}

export default function App() {
  // Per architecture §3.4: sessions stay in memory, never localStorage.
  const [session, setSession] = useState(null);
  const [page, setPage] = useState("Dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [dashboardError, setDashboardError] = useState("");
  const [busy, setBusy] = useState(false);
  const dashboardRequest = useRef(0);
  const notify = useCallback((message, type = "success") => {
    const id = crypto.randomUUID();
    setToasts((values) => [...values.slice(-3), { id, message, type }]);
    setTimeout(
      () => setToasts((values) => values.filter((item) => item.id !== id)),
      7000,
    );
  }, []);
  const api = useCallback(
    async (path, options = {}) => {
      try {
        return await request(path, { ...options, token: session?.token });
      } catch (error) {
        if (error.status === 401) {
          setSession((current) =>
            current?.token === session?.token ? null : current,
          );
        }
        throw error;
      }
    },
    [session?.token],
  );
  const refreshDashboard = useCallback(async () => {
    const current = ++dashboardRequest.current;
    setBusy(true);
    setDashboardError("");
    try {
      const result = await api("/dashboard");
      if (current === dashboardRequest.current) setDashboard(result);
    } catch (error) {
      if (current === dashboardRequest.current) {
        setDashboardError(error.message);
        notify(error.message, "error");
      }
    } finally {
      if (current === dashboardRequest.current) setBusy(false);
    }
  }, [api, notify]);
  useEffect(() => {
    if (session && page === "Dashboard") refreshDashboard();
    return () => {
      dashboardRequest.current++;
    };
  }, [session, page, refreshDashboard]);
  const navigate = (value) => {
    setPage(value);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const pages = session
    ? [
        "Dashboard",
        ...(session.user.role === "Admin" ? ["Members"] : []),
        "Bookings",
        "Equipment",
        session.user.role === "Member" ? "Entry pass" : "Verify pass",
      ]
    : [];
  return (
    <>
      <Toasts
        toasts={toasts}
        dismiss={(id) =>
          setToasts((values) => values.filter((item) => item.id !== id))
        }
      />
      {!session ? (
        <Login
          notify={notify}
          onLogin={(value) => {
            setDashboard(null);
            setPage("Dashboard");
            setSession(value);
            notify(`Welcome back, ${value.user.firstName}.`);
          }}
        />
      ) : (
        <div className="app-shell">
          <aside
            id="mobile-navigation"
            className={`sidebar ${menuOpen ? "open" : ""}`}
          >
            <Brand />
            <div className="sidebar-section">YOUR WORKSPACE</div>
            <nav aria-label="Main navigation">
              {pages.map((value) => {
                const Icon = icons[value];
                return (
                  <button
                    key={value}
                    aria-current={page === value ? "page" : undefined}
                    onClick={() => navigate(value)}
                  >
                    <Icon size={19} />
                    {value}
                    {page === value && <span className="nav-indicator" />}
                  </button>
                );
              })}
            </nav>
            <div className="sidebar-note">
              <span className="tiny-star">✳</span>
              <h3>
                Progress starts
                <br /> with showing up.
              </h3>
              <p>We’re glad you’re here.</p>
            </div>
            <div className="profile">
              <span className="avatar">
                {session.user.firstName[0]}
                {session.user.lastName[0]}
              </span>
              <div>
                <strong>
                  {session.user.firstName} {session.user.lastName}
                </strong>
                <small>{session.user.role}</small>
              </div>
              <button
                aria-label="Sign out"
                onClick={() => {
                  setSession(null);
                  setDashboard(null);
                  setMenuOpen(false);
                }}
              >
                <LogOut size={17} />
              </button>
            </div>
          </aside>
          {menuOpen && (
            <button
              className="scrim"
              aria-label="Close navigation"
              onClick={() => setMenuOpen(false)}
            />
          )}
          <div className="main-area">
            <header className="topbar">
              <div>
                <button
                  className="menu-toggle"
                  aria-label={menuOpen ? "Close menu" : "Open menu"}
                  aria-expanded={menuOpen}
                  aria-controls="mobile-navigation"
                  onClick={() => setMenuOpen(!menuOpen)}
                >
                  {menuOpen ? <X size={22} /> : <Menu size={22} />}
                </button>
                <span className="breadcrumb">
                  Workspace
                  <ChevronRight size={14} />
                  <strong>{page}</strong>
                </span>
              </div>
              <span className="today">
                <CalendarDays size={16} />
                {fullDate(new Date())}
              </span>
            </header>
            <main className="content" id="main-content" key={page}>
              {page === "Dashboard" ? (
                dashboardError ? (
                  <section className="panel">
                    <Empty title="Unable to load your dashboard">
                      {dashboardError}
                    </Empty>
                    <button className="secondary" onClick={refreshDashboard}>
                      Try again
                    </button>
                  </section>
                ) : dashboard ? (
                  <Dashboard
                    data={dashboard}
                    navigate={navigate}
                    refresh={refreshDashboard}
                    busy={busy}
                  />
                ) : (
                  <Loading />
                )
              ) : page === "Entry pass" ? (
                <EntryPass api={api} notify={notify} />
              ) : page === "Verify pass" ? (
                <VerifyPass api={api} notify={notify} />
              ) : (
                <Collection page={page} api={api} notify={notify} />
              )}
            </main>
            <footer>
              GMS · A little stronger, every day.
              <span>TEAM 16 / GYM MANAGEMENT SYSTEM</span>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
