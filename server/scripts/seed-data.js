import bcrypt from "bcryptjs";
import { User, GymClass, Booking, Equipment } from "../src/models.js";

export async function seed(
  password,
  { memberCount = 10, bookingCount = 8 } = {},
) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 72
  )
    throw new Error(
      "Set DEMO_PASSWORD to a password between 12 and 72 characters.",
    );
  const passwordHash = await bcrypt.hash(password, 12);
  const expiry = (days) => new Date(Date.now() + days * 86400_000);
  const people = [
    {
      firstName: "Alex",
      lastName: "Morgan",
      email: "admin@gym.test",
      role: "Admin",
    },
    {
      firstName: "Sam",
      lastName: "Rivera",
      email: "trainer@gym.test",
      role: "Trainer",
    },
    ...Array.from({ length: memberCount }, (_, index) => ({
      firstName: index === 0 ? "Jordan" : `Member ${index + 1}`,
      lastName: "Lee",
      email: index === 0 ? "member@gym.test" : `member${index + 1}@gym.test`,
      role: "Member",
      tier: ["Basic", "Premium", "VIP"][index % 3],
      membershipExpiresAt: expiry(index === 1 ? -3 : index === 2 ? 3 : 30),
    })),
  ];
  const users = [];
  for (const person of people)
    users.push(
      await User.findOneAndUpdate(
        { email: person.email },
        { $set: { ...person, passwordHash, disabled: false } },
        { upsert: true, returnDocument: "after", runValidators: true },
      ),
    );
  const trainer = users.find((person) => person.role === "Trainer");
  const names = [
    "Morning strength",
    "Flow & restore",
    "Full body circuit",
    "Power hour",
    "Weekend mobility",
  ];
  const classes = [];
  for (const [index, name] of names.entries()) {
    const startsAt = expiry(index + 1);
    startsAt.setHours(7 + index * 2, 0, 0, 0);
    classes.push(
      await GymClass.findOneAndUpdate(
        { name, trainerId: trainer._id },
        {
          $set: {
            name,
            trainerId: trainer._id,
            startsAt,
            capacity: 250,
            availableSlots: 250,
            durationMinutes: index === 1 ? 45 : 60,
            status: "Open",
          },
        },
        { upsert: true, returnDocument: "after", runValidators: true },
      ),
    );
  }
  const members = users.filter((person) => person.role === "Member");
  for (
    let index = 0;
    index < Math.min(bookingCount, members.length * classes.length);
    index++
  ) {
    const member = members[index % members.length];
    const session =
      classes[Math.floor(index / members.length) % classes.length];
    await Booking.updateOne(
      { memberId: member._id, classId: session._id },
      { $set: { status: "Active" } },
      { upsert: true, runValidators: true },
    );
  }
  for (const session of classes) {
    const booked = await Booking.countDocuments({
      classId: session._id,
      status: "Active",
    });
    await GymClass.updateOne(
      { _id: session._id },
      { $set: { availableSlots: Math.max(0, session.capacity - booked) } },
    );
  }
  const items = [
    ["TRD-101", "Treadmill", "Cardio", "Available"],
    ["BIK-102", "Stationary bike", "Cardio", "Available"],
    ["RCK-103", "Squat rack", "Strength", "Available"],
    ["CAB-104", "Cable station", "Strength", "Under Maintenance"],
    ["MAT-105", "Training mats", "Mobility", "Available"],
    ["ROW-106", "Rowing machine", "Cardio", "Available"],
  ];
  for (const [inventoryId, name, category, status] of items)
    await Equipment.updateOne(
      { inventoryId },
      { $set: { name, category, status } },
      { upsert: true, runValidators: true },
    );
  await Promise.all([
    User.init(),
    GymClass.init(),
    Booking.init(),
    Equipment.init(),
  ]);
  return { users, classes };
}
