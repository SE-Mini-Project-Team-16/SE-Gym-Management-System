import { Booking, Equipment, GymClass, User } from "./models.js";

// Cache only summaries; access checks and membership/pass eligibility always read live data.
export function createSummaryCache({ ttl = 10_000, maxEntries = 500 } = {}) {
  const cache = new Map();
  return async (key, loader) => {
    const existing = cache.get(key);
    if (existing && existing.until > Date.now()) return existing.promise;
    const entry = { until: Date.now() + ttl };
    entry.promise = Promise.resolve()
      .then(loader)
      .catch((error) => {
        if (cache.get(key) === entry) cache.delete(key);
        throw error;
      });
    cache.delete(key);
    cache.set(key, entry);
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    return entry.promise;
  };
}

const count = (Model, filter) => Model.countDocuments(filter).maxTimeMS(1000);

export async function loadDashboard(user) {
  const now = new Date();
  const week = new Date(now.getTime() + 7 * 86400_000);
  const classFilter = { status: "Open", startsAt: { $gte: now } };
  if (user.role === "Trainer") classFilter.trainerId = user._id;
  const upcoming = GymClass.find(classFilter)
    .sort({ startsAt: 1 })
    .limit(5)
    .select("name startsAt durationMinutes availableSlots capacity")
    .lean()
    .maxTimeMS(1000);
  const available = count(Equipment, { status: "Available" });
  if (user.role === "Admin") {
    const [
      members,
      activeMembers,
      expiringSoon,
      availableEquipment,
      upcomingClasses,
    ] = await Promise.all([
      count(User, { role: "Member", disabled: false }),
      count(User, {
        role: "Member",
        disabled: false,
        membershipExpiresAt: { $gt: now },
      }),
      count(User, {
        role: "Member",
        disabled: false,
        membershipExpiresAt: { $gt: now, $lte: week },
      }),
      available,
      upcoming,
    ]);
    return {
      stats: { members, activeMembers, expiringSoon, availableEquipment },
      upcomingClasses,
    };
  }
  const [bookings, upcomingCount, availableEquipment, upcomingClasses] =
    await Promise.all([
      user.role === "Member"
        ? count(Booking, { memberId: user._id, status: "Active" })
        : Promise.resolve(null),
      count(GymClass, classFilter),
      available,
      upcoming,
    ]);
  return {
    stats: { bookings, upcomingCount, availableEquipment },
    upcomingClasses,
  };
}
